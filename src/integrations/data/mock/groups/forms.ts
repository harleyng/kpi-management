import type { Delegation, EvaluationItem, FormInstance, FormLaunch, FormStepAction, FormType, GoalChangeItem, Id, WorkflowStep } from '@/data/types';
import { cycleAllowsLaunch } from '@/lib/cycleRules';
import { KpiError, type RuleIssue } from '@/lib/errorCatalog';
import { COLUMN_FIELDS, SYSTEM_COLUMN, computedItemPct, formActualIssues, sameActual, validateScoreInput, withFormActual, type CanSubmitInput } from '@/lib/formRules';
import { isResultFinalised } from '@/lib/actualRules';
import { todayOf } from '@/lib/isoDate';
import { submitCheckInput } from '@/lib/formViewRules';
import { applyGoalChanges, changeItemIssues, planStatusOnEnterStep } from '@/lib/goalPlanRules';
import { resourceOfSubject } from '@/lib/permissionRules';
import {
  canCancelLaunch,
  canRevokeDelegation,
  canStartForm,
  checkAction,
  delegationIssues,
  editableColumn,
  isInInbox,
  isTerminal,
  launchPeriodIssues,
  launchTimingIssues,
  initialStep,
  normaliseStartStepNo,
  resolveStepActors,
  settleAutoSteps,
  startStepIssues,
  stepDeadline,
  validateLaunch,
  validateLaunchRule,
  validateWorkflow,
} from '@/lib/workflowRules';
import type { ChildInput, EvaluationItemPatch, FormActionInput, FormFilter, FormsGateway, NewLaunchInput, PageRequest, StartFormInput } from '../../types';
import { actorCan, clockOf, planIdResource, userResource } from '../authorize';
import { eqOpt, inList, newId, saveChildren, upsert } from '../rows';
import type { Runtime } from '../runtime';
import type { Tx } from '../store';
import {
  applyColumnEntry,
  assertMayEdit,
  assigneesFor,
  itemCalcContextOf,
  directoryOf,
  entitlementCtx,
  fireLaunch,
  planOfForm,
  planOwnerEmployeeId,
  recordFormActuals,
  refOrInvalid,
  setPlanStatus,
  stepOf,
  stepsOf,
  syncWorkPlan,
  throwDecision,
  throwIssues,
  throwRefusal,
} from '../workflowContext';
import { paginate } from './page';

/** The six score / comment columns of an evaluation item (`EvaluationItemPatch`). */
const SCORE_FIELDS = ['selfAchievementPct', 'selfComment', 'managerAchievementPct', 'managerComment', 'finalAchievementPct', 'finalComment'] as const;
/** Read-only copies of the actual and target (BR-KPI-17) and the system's bookkeeping: never writable through "Lưu nháp". */
const SNAPSHOT_FIELDS = ['actualSnapshot', 'actualTextSnapshot', 'targetSnapshot', 'actualEnteredBy', 'submittedActualValue', 'submittedActualText'] as const;
/** The columns whose step may change the actual on the form (PEND-06): the employee's, then the manager's. */
const ACTUAL_COLUMNS = ['SELF', 'MANAGER'] as const;

/**
 * The content check `checkAction` runs on SUBMIT / APPROVE — always built, for the form's type, by
 * the same builder the screens use for their blockers (`formViewRules.submitCheckInput`).
 */
function submitCheckOf(tx: Tx, form: FormInstance, step: WorkflowStep, steps: readonly WorkflowStep[]): CanSubmitInput {
  return submitCheckInput(form, step, steps, {
    goals: tx.all('Goal'),
    kgis: tx.all('Kgi'),
    items: tx.all('EvaluationItem'),
    changeItems: tx.all('GoalChangeItem'),
    workTasks: form.workPlanId ? tx.all('WorkTask').filter((t) => t.workPlanId === form.workPlanId) : [],
    periods: form.periodId ? [tx.get('CyclePeriod', form.periodId)] : [],
  });
}

export function formsGroup(rt: Runtime): FormsGateway {
  return {
    listWorkflows: rt.read('forms.listWorkflows', (tx, formType?: FormType) => tx.all('WorkflowTemplate').filter((w) => eqOpt(formType, w.formType))),
    listWorkflowSteps: rt.read('forms.listWorkflowSteps', (tx, workflowId?: Id) =>
      tx
        .all('WorkflowStep')
        .filter((s) => eqOpt(workflowId, s.workflowId))
        .sort((a, b) => (a.workflowId === b.workflowId ? a.stepNo - b.stepNo : a.workflowId < b.workflowId ? -1 : 1)),
    ),
    saveWorkflow: rt.write(
      'forms.saveWorkflow', { permission: 'cycle.manage' },
      (tx, input: Parameters<FormsGateway['saveWorkflow']>[2], steps: readonly ChildInput<WorkflowStep, 'workflowId' | 'stepNo'>[]) => {
        const stored = input.id !== undefined ? tx.get('WorkflowTemplate', input.id) : null;
        // A workflow's type never changes: its forms copied it (`FormInstance.formType`).
        if (stored && stored.formType !== input.formType) throw new KpiError('ERR-KPI-06', 'WorkflowTemplate.formType cannot change');
        // Steps are numbered 1…n in the order given; the rule sees them as they will be saved.
        const workflowId = stored?.id ?? 'new';
        const planned: WorkflowStep[] = steps.map((s, i) => ({ ...s, id: s.id ?? `new:${i}`, tenantId: tx.tenantId, workflowId, stepNo: i + 1 }));
        throwIssues(validateWorkflow(input.formType, planned));
        const parent = upsert(tx, 'WorkflowTemplate', input, { create: () => ({}) });
        return { parent, children: saveChildren(tx, 'WorkflowStep', 'workflowId', parent.id, steps, (i) => ({ stepNo: i + 1 })) };
      },
    ),

    listLaunches: rt.read('forms.listLaunches', (tx) => tx.all('FormLaunch').sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1))),
    getLaunch: rt.read('forms.getLaunch', (tx, launchId: Id) => tx.get('FormLaunch', launchId)),
    createLaunch: rt.write('forms.createLaunch', { permission: 'form.launch' }, (tx, input: NewLaunchInput) => {
      const clock = clockOf(tx);
      const workflow = refOrInvalid(tx, 'WorkflowTemplate', input.workflowId, 'FormLaunch.workflowId');
      const period = input.periodId === null ? null : refOrInvalid(tx, 'CyclePeriod', input.periodId, 'FormLaunch.periodId');
      const cycle = input.cycleId === null ? null : refOrInvalid(tx, 'PerformanceCycle', input.cycleId, 'FormLaunch.cycleId');
      const launch: FormLaunch = {
        id: newId(),
        tenantId: tx.tenantId,
        workflowId: workflow.id,
        formType: workflow.formType,
        name: input.name,
        timing: input.timing,
        scheduledAt: input.timing === 'SCHEDULED' ? input.scheduledAt : tx.now,
        launchRuleId: null,
        cycleId: input.cycleId,
        periodId: input.periodId,
        dueDays: input.dueDays,
        recipientMode: input.recipientMode,
        recipientFilter: input.recipientFilter,
        status: 'Scheduled',
        launchedAt: null,
        createdBy: tx.ctx.actorUserId,
        createdAt: tx.now,
        startStepNo: normaliseStartStepNo(input.startStepNo),
      };
      throwIssues([...validateLaunch(launch), ...launchPeriodIssues(launch.formType, period), ...startStepIssues(launch.startStepNo, stepsOf(tx, workflow.id)), ...launchTimingIssues(launch, clock)]);
      if (period && cycle && period.cycleId !== cycle.id) throw new KpiError('ERR-KPI-06', 'FormLaunch.periodId belongs to another cycle');
      const target = cycle ?? (period ? tx.get('PerformanceCycle', period.cycleId) : null);
      if (target) throwDecision(cycleAllowsLaunch(target, launch.formType), `cycle ${target.id} does not accept ${launch.formType} now`);
      const saved = tx.insert('FormLaunch', launch);
      return launch.timing === 'NOW' ? fireLaunch(tx, saved).launch : saved;
    }),
    cancelLaunch: rt.write('forms.cancelLaunch', { permission: 'form.launch' }, (tx, launchId: Id) => {
      const launch = tx.get('FormLaunch', launchId);
      throwDecision(canCancelLaunch(launch), `launch ${launchId} is ${launch.status}`);
      return tx.update('FormLaunch', { ...launch, status: 'Cancelled' });
    }),
    listLaunchRules: rt.read('forms.listLaunchRules', (tx) => tx.all('FormLaunchRule')),
    saveLaunchRule: rt.write('forms.saveLaunchRule', { permission: 'form.launch' }, (tx, input: Parameters<FormsGateway['saveLaunchRule']>[2]) => {
      if (input.id !== undefined) tx.get('FormLaunchRule', input.id);
      // An unknown workflow is answered by the integrity check, exactly as any missing id.
      const workflow = typeof input.workflowId === 'string' ? tx.find('WorkflowTemplate', input.workflowId) : undefined;
      if (workflow) throwIssues(validateLaunchRule(input, workflow.formType));
      return upsert(tx, 'FormLaunchRule', input, { create: () => ({}) });
    }),

    startForm: rt.write(
      'forms.startForm',
      {
        permission: 'form.start',
        resource: (tx, input) => {
          if (typeof input?.goalPlanId === 'string') return planIdResource(tx, input.goalPlanId);
          const subject = typeof input?.subjectEmployeeId === 'string' ? tx.find('Employee', input.subjectEmployeeId) : undefined;
          return subject ? resourceOfSubject(tx.tenantId, subject.id) : undefined;
        },
      },
      (tx, input: StartFormInput) => {
        const workflow = refOrInvalid(tx, 'WorkflowTemplate', input.workflowId, 'FormInstance.workflowId');
        refOrInvalid(tx, 'Employee', input.subjectEmployeeId, 'FormInstance.subjectEmployeeId');
        const plan = input.goalPlanId === null ? null : refOrInvalid(tx, 'GoalPlan', input.goalPlanId, 'FormInstance.goalPlanId');
        if (input.periodId !== null) refOrInvalid(tx, 'CyclePeriod', input.periodId, 'FormInstance.periodId');
        const steps = stepsOf(tx, workflow.id);
        // PEND-01 — the start step is checked before the rest (06 before 04).
        throwIssues(startStepIssues(input.startStepNo, steps));
        const first = initialStep(steps, input.startStepNo);
        if (!first) throw new KpiError('ERR-KPI-06', `workflow ${workflow.id} has no steps`);
        throwIssues(
          canStartForm(input, {
            formType: workflow.formType,
            plan,
            planOwnerEmployeeId: plan ? planOwnerEmployeeId(tx, plan) : null,
            cycle: plan ? (tx.find('PerformanceCycle', plan.cycleId) ?? null) : null,
            forms: tx.all('FormInstance'),
            clock: clockOf(tx),
          }),
        );
        const form = tx.insert('FormInstance', {
          id: newId(),
          tenantId: tx.tenantId,
          workflowId: workflow.id,
          formType: workflow.formType,
          subjectEmployeeId: input.subjectEmployeeId,
          goalPlanId: input.goalPlanId,
          workPlanId: null,
          periodId: input.periodId,
          currentStepId: first.id,
          currentStepEnteredAt: tx.now,
          overdueHandledAt: null,
          status: 'Open',
          dueDate: input.dueDate,
          launchedAt: tx.now,
          launchId: null,
        });
        if (workflow.formType === 'GOAL_SETTING' && plan) setPlanStatus(tx, plan, planStatusOnEnterStep(first.stepNo, steps, false));
        return form;
      },
    ),
    listForms: rt.read('forms.listForms', (tx, filter: FormFilter = {}, page?: PageRequest) =>
      paginate(
        tx
          .all('FormInstance')
          .filter(
            (f) =>
              eqOpt(filter.formType, f.formType) &&
              inList(filter.subjectEmployeeIds, f.subjectEmployeeId) &&
              (filter.launchId === undefined || f.launchId === filter.launchId) &&
              (filter.periodId === undefined || f.periodId === filter.periodId) &&
              (filter.goalPlanId === undefined || f.goalPlanId === filter.goalPlanId) &&
              eqOpt(filter.status, f.status),
          ),
        (f) => f.launchedAt,
        page,
      ),
    ),
    getForm: rt.read('forms.getForm', (tx, formId: Id) => tx.get('FormInstance', formId)),
    listInbox: rt.read('forms.listInbox', (tx, userId: Id) => {
      tx.get('UserAccount', userId);
      const clock = clockOf(tx);
      const dir = directoryOf(tx);
      const delegations = tx.all('Delegation');
      const steps = tx.all('WorkflowStep');
      const rows: { form: FormInstance; deadline: string }[] = [];
      for (const form of tx.all('FormInstance')) {
        const step = isTerminal(form) ? undefined : stepOf(form, steps);
        if (!step || !isInInbox(form, userId, resolveStepActors(step, form.subjectEmployeeId, dir, clock), delegations, clock)) continue;
        rows.push({ form, deadline: stepDeadline(form, step, clock.tz) });
      }
      // The most urgent first.
      return rows
        .sort((a, b) => (a.deadline === b.deadline ? (a.form.id < b.form.id ? -1 : 1) : a.deadline < b.deadline ? -1 : 1))
        .map((r) => r.form);
    }),
    listFormActions: rt.read('forms.listFormActions', (tx, formId: Id) => {
      tx.get('FormInstance', formId);
      return tx
        .all('FormStepAction')
        .filter((a) => a.formId === formId)
        // Stable on equal times: a move and the AUTO_APPROVE it triggered share `actedAt` (insertion order).
        .sort((a, b) => (a.actedAt === b.actedAt ? 0 : a.actedAt < b.actedAt ? -1 : 1));
    }),
    listEvaluationItems: rt.read('forms.listEvaluationItems', (tx, formId: Id) => {
      tx.get('FormInstance', formId);
      return tx.all('EvaluationItem').filter((i) => i.formId === formId);
    }),
    saveEvaluationItems: rt.write('forms.saveEvaluationItems', 'workflow', (tx, formId: Id, patches: readonly EvaluationItemPatch[]) => {
      const form = tx.get('FormInstance', formId);
      if (form.formType !== 'KPI_EVAL') throw new KpiError('ERR-KPI-06', `form ${formId} is not a KPI_EVAL form`);
      const step = assertMayEdit(tx, form);
      const column = editableColumn(step);
      if (column === null) throw new KpiError('ERR-KPI-04', 'NO_EDITABLE_COLUMN');
      const own = COLUMN_FIELDS[column];
      const actor = tx.ctx.actorUserId as Id;
      const period = form.periodId ? tx.get('CyclePeriod', form.periodId) : null;
      const plan = form.goalPlanId ? tx.get('GoalPlan', form.goalPlanId) : null;
      const issues: RuleIssue[] = [];
      for (const patch of patches) {
        const item = typeof patch?.itemId === 'string' ? tx.find('EvaluationItem', patch.itemId) : undefined;
        if (!item || item.formId !== form.id) throw new KpiError('ERR-KPI-06', `EvaluationItem ${String(patch?.itemId)} is not on form ${formId}`);
        const fields = patch as unknown as Record<string, unknown>;
        if (SNAPSHOT_FIELDS.some((f) => fields[f] !== undefined)) throw new KpiError('ERR-KPI-04', 'SNAPSHOT_READ_ONLY');
        // PEND-07 — the system's % is never typed, not even cleared.
        if (fields[COLUMN_FIELDS[SYSTEM_COLUMN].pct] !== undefined) throw new KpiError('ERR-KPI-04', 'SYSTEM_COLUMN');
        if (SCORE_FIELDS.some((f) => fields[f] !== undefined && f !== own.pct && f !== own.comment)) throw new KpiError('ERR-KPI-04', 'COLUMN_NOT_EDITABLE');
        const goal = tx.get('Goal', item.goalId);
        const calc = itemCalcContextOf(tx, goal.id);
        let next: EvaluationItem = { ...item };

        // PEND-06 — the actual on the form; a resent unchanged value is not a change.
        if (patch.actualValue !== undefined || patch.actualText !== undefined) {
          const actual = {
            actualValue: patch.actualValue !== undefined ? patch.actualValue : item.actualValue,
            actualText: patch.actualText !== undefined ? patch.actualText : item.actualText,
          };
          if (!sameActual(actual, item)) {
            if (!(ACTUAL_COLUMNS as readonly string[]).includes(column)) throw new KpiError('ERR-KPI-04', 'ACTUAL_NOT_EDITABLE');
            const found =
              period && plan
                ? formActualIssues(actual, {
                    goal,
                    goalCycleId: plan.cycleId,
                    period,
                    resultsFinalised: isResultFinalised(tx.all('PeriodResult'), plan.id, period.id),
                    asOf: todayOf(clockOf(tx)),
                  })
                : [];
            if (found.length) issues.push(...found.map((i) => ({ ...i, ref: item.id })));
            else next = withFormActual(next, actual, computedItemPct({ ...item, ...actual }, calc), actor);
          }
        }

        if (column !== SYSTEM_COLUMN) {
          const pct = patch[own.pct];
          if (pct !== undefined) {
            const issue = validateScoreInput(pct, calc.method, calc);
            if (issue) issues.push({ ...issue, ref: item.id });
            next[own.pct] = pct;
          }
        }
        const comment = patch[own.comment];
        if (comment !== undefined) next[own.comment] = comment;
        tx.update('EvaluationItem', next);
      }
      throwIssues(issues);
      // EDIT records no history row (BR-KPI-23): the audit log holds the change.
      return tx.all('EvaluationItem').filter((i) => i.formId === form.id);
    }),
    listGoalChangeItems: rt.read('forms.listGoalChangeItems', (tx, formId: Id) => {
      tx.get('FormInstance', formId);
      return tx.all('GoalChangeItem').filter((i) => i.formId === formId);
    }),
    saveGoalChangeItems: rt.write('forms.saveGoalChangeItems', 'workflow', (tx, formId: Id, items: readonly ChildInput<GoalChangeItem, 'formId'>[]) => {
      const form = tx.get('FormInstance', formId);
      if (form.formType !== 'GOAL_CHANGE') throw new KpiError('ERR-KPI-06', `form ${formId} is not a GOAL_CHANGE form`);
      assertMayEdit(tx, form);
      const planGoals = form.goalPlanId ? tx.all('Goal').filter((g) => g.goalPlanId === form.goalPlanId) : [];
      const planned: GoalChangeItem[] = items.map((item, i) => ({ ...item, id: item.id ?? `new:${i}`, tenantId: tx.tenantId, formId }));
      // A draft may still lack its reasons; a goal outside the form's plan is GOAL_NOT_ACTIVE.
      throwIssues(changeItemIssues(planGoals, planned, { draft: true }));
      return saveChildren(tx, 'GoalChangeItem', 'formId', formId, items);
    }),
    act: rt.write('forms.act', 'workflow', (tx, input: FormActionInput) => {
      const clock = clockOf(tx);
      const form = tx.get('FormInstance', input.formId);
      // Every id of the payload resolves in this tenant (contract rule 1) before a rule reads it.
      if (input.onBehalfOfUserId !== null) refOrInvalid(tx, 'UserAccount', input.onBehalfOfUserId, 'FormStepAction.onBehalfOfUserId');
      if (input.delegationId !== null) refOrInvalid(tx, 'Delegation', input.delegationId, 'FormStepAction.delegationId');
      const steps = stepsOf(tx, form.workflowId);
      const step = stepOf(form, steps);
      const plan = planOfForm(tx, form);
      const { clock: _clock, ...entitlement } = entitlementCtx(tx, form, step);
      const checked = checkAction({
        form,
        steps,
        plan,
        action: input.action,
        expectedStepId: input.expectedStepId,
        comment: input.comment,
        actor: { actorUserId: tx.ctx.actorUserId as Id, onBehalfOfUserId: input.onBehalfOfUserId, delegationId: input.delegationId },
        entitlement,
        submitCheck: step ? submitCheckOf(tx, form, step, steps) : null,
        clock,
      });
      if (!checked.ok) throwRefusal(checked);
      // Both people are named on every event and audit row of this write (BR-KPI-21).
      tx.onBehalfOfUserId = checked.record.onBehalfOfUserId;
      // PEND-02 — a step that approves itself is approved in this same write; everything is written once.
      const { mode: _mode, record: personRecord, ...move } = checked;
      const settled = settleAutoSteps(form, steps, { ...move, record: { formId: personRecord.formId, stepId: personRecord.stepId, action: personRecord.action, comment: personRecord.comment, actedAt: personRecord.actedAt } }, clock);
      if (!settled.ok) throwRefusal(settled);
      const auto = settled.passedSteps.length > 0;

      // A completed evaluation records the actuals entered on it (PEND-06); a skipped one is named on the audit row.
      if (settled.form.status === 'Completed') for (const passed of settled.passedSteps) applyColumnEntry(tx, form, passed, step, 'AUTO_APPROVE');
      const recorded = settled.form.status === 'Completed' ? recordFormActuals(tx, form) : null;
      const skipped = recorded && recorded.skipped.length > 0 ? `FORM_ACTUAL_SKIPPED: ${recorded.skipped.join(', ')}` : null;
      const reason = input.action === 'CANCEL' || input.action === 'RETURN' ? input.comment : (skipped ?? (auto ? 'AUTO_APPROVE' : null));
      const saved = tx.update('FormInstance', { ...form, ...settled.form }, { reason });
      const history: FormStepAction = { id: newId(), tenantId: tx.tenantId, ...personRecord };
      tx.insert('FormStepAction', history);
      // The system's approvals: nobody, on behalf of nobody.
      const autoRows = settled.records.slice(1).map((r) => tx.insert('FormStepAction', { id: newId(), tenantId: tx.tenantId, ...r, actorUserId: null, onBehalfOfUserId: null, delegationId: null }));

      if (settled.nextStep) applyColumnEntry(tx, saved, settled.nextStep, settled.passedSteps.at(-1) ?? step, 'STEP_ENTRY');
      if (settled.planStatus && plan) setPlanStatus(tx, plan, settled.planStatus, auto && settled.planStatus === 'Locked' ? 'AUTO_APPROVE' : reason);
      // A monthly plan follows the SETTLED move; an automatic approval locks it with no approver.
      syncWorkPlan(tx, form, settled.workPlanStatus, auto && settled.workPlanStatus === 'Locked' ? null : (tx.ctx.actorUserId as Id), auto && settled.workPlanStatus === 'Locked' ? 'AUTO_APPROVE' : reason);
      if (settled.applyGoalChanges && plan) {
        const goals = tx.all('Goal').filter((g) => g.goalPlanId === plan.id);
        const applied = applyGoalChanges(plan, goals, tx.all('GoalChangeItem').filter((i) => i.formId === form.id), newId);
        if (!applied.ok) throwIssues(applied.issues);
        else {
          for (const { goal, targetLevels } of applied.effects.creates) {
            tx.insert('Goal', goal);
            for (const level of targetLevels) tx.insert('GoalTargetLevel', { ...level, id: newId(), tenantId: tx.tenantId, goalId: goal.id });
          }
          for (const change of applied.effects.statusChanges) tx.update('Goal', { ...tx.get('Goal', change.goalId), status: change.status });
        }
      }
      // The person's move, as the form now stands (completed by an auto step → no next step, nobody to tell).
      tx.emit({
        type: 'form.stepActed',
        formId: form.id,
        stepId: history.stepId,
        action: history.action,
        nextStepId: settled.nextStep?.id ?? null,
        assigneeUserIds: assigneesFor(tx, saved),
        formStatus: saved.status,
      });
      for (const row of autoRows) {
        tx.emit({ type: 'form.stepActed', formId: form.id, stepId: row.stepId, action: row.action, nextStepId: settled.nextStep?.id ?? null, assigneeUserIds: assigneesFor(tx, saved), formStatus: saved.status });
      }
      return saved;
    }),

    listDelegations: rt.read('forms.listDelegations', (tx, userId?: Id) =>
      tx.all('Delegation').filter((d) => userId === undefined || d.fromUserId === userId || d.toUserId === userId),
    ),
    saveDelegation: rt.write('forms.saveDelegation', { permission: 'delegation.manage', resource: (tx) => userResource(tx, tx.ctx.actorUserId) }, (tx, input: Parameters<FormsGateway['saveDelegation']>[2]) => {
      const actor = tx.ctx.actorUserId as Id;
      const stored = input.id !== undefined ? tx.get('Delegation', input.id) : null;
      // A user delegates their OWN steps: `fromUserId` is the actor, never the payload.
      if (stored && stored.fromUserId !== actor) throw new KpiError('ERR-KPI-05', `delegation ${input.id} belongs to another user`);
      if (stored && stored.revokedAt !== null) throw new KpiError('ERR-KPI-04', `delegation ${input.id} is revoked`);
      throwIssues(
        delegationIssues(
          { fromUserId: actor, toUserId: input.toUserId, formType: input.formType, validFrom: input.validFrom, validTo: input.validTo },
          { existing: tx.all('Delegation'), users: tx.all('UserAccount'), editingId: stored?.id ?? null, clock: clockOf(tx) },
        ),
      );
      return upsert(tx, 'Delegation', input, { create: (): Partial<Delegation> => ({ fromUserId: actor, revokedAt: null }) });
    }),
    revokeDelegation: rt.write('forms.revokeDelegation', { permission: 'delegation.manage', resource: (tx, delegationId) => userResource(tx, tx.find('Delegation', delegationId)?.fromUserId ?? null) }, (tx, delegationId: Id) => {
      const delegation = tx.get('Delegation', delegationId);
      const decision = canRevokeDelegation(
        delegation,
        // Managing ANOTHER user's delegation is HR's: delegation.manage over the whole tenant.
        { actorUserId: tx.ctx.actorUserId as Id, actorMayManage: actorCan(tx, 'delegation.manage', { kind: 'Tenant', tenantId: tx.tenantId }) },
        clockOf(tx),
      );
      throwDecision(decision, `delegation ${delegationId} cannot be revoked by this user`);
      return tx.update('Delegation', { ...delegation, revokedAt: tx.now });
    }),
  };
}
