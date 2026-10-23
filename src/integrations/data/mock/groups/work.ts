import type { Id, WorkPlan, WorkReview, WorkReviewItem, WorkScoringConfig, WorkTask } from '@/data/types';
import { WORK_TASK_INITIAL_STATUS } from '@/data/types';
import { KpiError, ruleIssue, type RuleIssue } from '@/lib/errorCatalog';
import { todayOf } from '@/lib/isoDate';
import { managerOf } from '@/lib/orgRules';
import { editRefusal, editStanding, editableColumn, isDelegationValid, isTerminal, userOfEmployee } from '@/lib/workflowRules';
import { resourceOfSubject } from '@/lib/permissionRules';
import {
  DEFAULT_WORK_SCORING,
  WORK_REVIEW_COLUMN_FIELDS,
  linkedGoalIssues,
  progressIssues,
  taskEditBlockers,
  workScoreIssue,
  workScoringIssues,
  type TaskEdit,
  type TaskEditContext,
  type WorkScoring,
} from '@/lib/workRules';
import type { WorkGateway, WorkPlanFilter, WorkResultFilter, WorkReviewPatch, WorkScoringInput, WorkTaskInput, WorkTaskProgressInput } from '../../types';
import { actorCan, authorizeActor, clockOf } from '../authorize';
import { removeRow } from '../integrity';
import { eqOpt, inList, newId, writableOf } from '../rows';
import type { Runtime } from '../runtime';
import type { Tx } from '../store';
import { assertMayEdit, entitlementCtx, refOrInvalid, stepOf, stepsOf, throwIssues } from '../workflowContext';

/**
 * Monthly work (PEND-14, Plan B step 8.1). Every decision is `workRules` / `workflowRules`; this file
 * only gathers their inputs from the transaction. Moving the forms is `forms.act` (8.2 / 8.3).
 */

/** The tenant's scoring settings as the rules read them. */
function scoringOf(tx: Tx): WorkScoring {
  return tx.all('WorkScoringConfig')[0] ?? DEFAULT_WORK_SCORING;
}

/** The plan's open WORK_PLAN form (at most one: one form per subject and period). */
const openPlanForm = (tx: Tx, plan: WorkPlan) =>
  tx.all('FormInstance').find((f) => f.formType === 'WORK_PLAN' && f.workPlanId === plan.id && !isTerminal(f));

/**
 * Everything `taskEditBlockers` needs about the actor and the plan. An EDIT allowed at the WORK_PLAN
 * form's step as a delegate or proxy names the person acted for on the write's events (BR-KPI-21);
 * so does a cancel or a progress update made for the manager (`mayActForManager`) — call
 * `actForManager` once the edit is allowed.
 */
function taskContext(tx: Tx, plan: WorkPlan): TaskEditContext & { managerUserId: Id | null } {
  const actor = authorizeActor(tx, tx.ctx.actorUserId as Id);
  const clock = clockOf(tx);
  const today = todayOf(clock);
  const managerId = managerOf(plan.employeeId, tx.all('EmployeeAssignment'), today);
  const managerUserId = userOfEmployee(managerId, tx.all('UserAccount'))?.id ?? null;
  const isManager = actor.employeeId !== null && managerId === actor.employeeId;
  const delegate =
    managerUserId !== null &&
    tx.all('Delegation').some((d) => d.fromUserId === managerUserId && d.toUserId === actor.id && isDelegationValid(d, 'WORK_PLAN', clock));
  const proxy = actor.employeeId !== plan.employeeId && actorCan(tx, 'form.proxy', resourceOfSubject(tx.tenantId, plan.employeeId));
  let editAtStep: RuleIssue | null = ruleIssue('ERR-KPI-04', null, 'NO_OPEN_FORM');
  const form = openPlanForm(tx, plan);
  if (form) {
    const steps = stepsOf(tx, form.workflowId);
    const ctx = entitlementCtx(tx, form, stepOf(form, steps));
    const standing = editStanding(form, actor.id, ctx);
    const refusal = editRefusal(form, steps, null, standing, ctx);
    editAtStep = refusal ? ruleIssue(refusal.code, null, refusal.detail) : null;
    if (!refusal) tx.onBehalfOfUserId = standing.onBehalfOfUserId;
  }
  const liveReviewForm = (formId: Id) => {
    const f = tx.find('FormInstance', formId);
    return f !== undefined && f.status !== 'Cancelled';
  };
  return {
    planStatus: plan.status,
    editAtStep,
    isSubject: actor.employeeId === plan.employeeId,
    isManager,
    mayActForManager: !isManager && (delegate || proxy),
    managerUserId,
    reviewLaunched: tx.all('WorkReview').some((r) => r.workPlanId === plan.id && liveReviewForm(r.formId)),
    resultRecorded: tx.all('WorkResult').some((r) => r.workPlanId === plan.id),
  };
}

/** A cancel or progress update allowed through `mayActForManager` names the manager as the person acted for. */
function actForManager(tx: Tx, ctx: ReturnType<typeof taskContext>): void {
  if (!ctx.isSubject && !ctx.isManager && ctx.mayActForManager) tx.onBehalfOfUserId = ctx.managerUserId;
}

const tasksOf = (tx: Tx, workPlanId: Id) =>
  tx
    .all('WorkTask')
    .filter((t) => t.workPlanId === workPlanId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

/** A task's KPI link resolves in this tenant (06 like any missing id) and passes `linkedGoalIssues`. */
function linkIssues(tx: Tx, plan: WorkPlan, linkedGoalId: Id | null): RuleIssue[] {
  if (linkedGoalId === null) return [];
  const goal = refOrInvalid(tx, 'Goal', linkedGoalId, 'WorkTask.linkedGoalId');
  const goalPlan = tx.find('GoalPlan', goal.goalPlanId) ?? null;
  return linkedGoalIssues(goal, goalPlan, plan.employeeId, tx.get('CyclePeriod', plan.periodId));
}

const TASK_COLUMNS = ['name', 'product', 'description', 'unitText', 'weight', 'startDate', 'dueDate', 'visibility', 'linkedGoalId'] as const;
const changed = (stored: WorkTask, fields: Record<string, unknown>) => TASK_COLUMNS.some((c) => stored[c] !== fields[c]);

export function workGroup(rt: Runtime): WorkGateway {
  return {
    listWorkPlans: rt.read('work.listWorkPlans', (tx, filter: WorkPlanFilter = {}) =>
      tx
        .all('WorkPlan')
        .filter((p) => eqOpt(filter.periodId, p.periodId) && inList(filter.employeeIds, p.employeeId) && eqOpt(filter.status, p.status)),
    ),
    getWorkPlan: rt.read('work.getWorkPlan', (tx, workPlanId: Id) => tx.get('WorkPlan', workPlanId)),
    listWorkTasks: rt.read('work.listWorkTasks', (tx, workPlanId: Id) => {
      tx.get('WorkPlan', workPlanId);
      return tasksOf(tx, workPlanId);
    }),
    listWorkTasksOfPlans: rt.read('work.listWorkTasksOfPlans', (tx, workPlanIds: readonly Id[]) => {
      const wanted = new Set(workPlanIds);
      // Another tenant's plan id simply matches nothing — like a filter, never an error.
      return tx
        .all('WorkTask')
        .filter((t) => wanted.has(t.workPlanId))
        .sort((a, b) => (a.workPlanId === b.workPlanId ? a.sortOrder - b.sortOrder : a.workPlanId < b.workPlanId ? -1 : 1));
    }),
    getWorkReview: rt.read('work.getWorkReview', (tx, formId: Id) => {
      tx.get('FormInstance', formId);
      const review = tx.all('WorkReview').find((r) => r.formId === formId);
      if (!review) throw new KpiError('ERR-KPI-02', `WorkReview of form ${formId} not found`);
      return review;
    }),
    listWorkReviewItems: rt.read('work.listWorkReviewItems', (tx, formId: Id) => {
      tx.get('FormInstance', formId);
      return tx.all('WorkReviewItem').filter((i) => i.formId === formId);
    }),
    listWorkResults: rt.read('work.listWorkResults', (tx, filter: WorkResultFilter = {}) =>
      tx.all('WorkResult').filter((r) => inList(filter.periodIds, r.periodId) && inList(filter.employeeIds, r.employeeId)),
    ),
    getWorkScoringConfig: rt.read('work.getWorkScoringConfig', (tx): WorkScoringConfig | null => tx.all('WorkScoringConfig')[0] ?? null),

    saveWorkTasks: rt.write('work.saveWorkTasks', 'workflow', (tx, workPlanId: Id, inputs: readonly WorkTaskInput[]) => {
      const plan = tx.get('WorkPlan', workPlanId);
      const stored = new Map(tasksOf(tx, plan.id).map((t) => [t.id, t]));
      const ctx = taskContext(tx, plan);
      const issues: RuleIssue[] = [];
      const seen = new Set<Id>();
      const planned: { stored: WorkTask | null; fields: Record<string, unknown> }[] = [];
      for (const input of inputs) {
        const fields = writableOf('WorkTask', input);
        const prior = input.id === undefined ? null : (stored.get(input.id) ?? null);
        // Another plan's task, another tenant's, or none: the same answer (contract rule 1).
        if (input.id !== undefined && (!prior || seen.has(input.id))) throw new KpiError('ERR-KPI-06', `WorkTask ${String(input.id)} is not a task of plan ${plan.id}`);
        if (prior) seen.add(prior.id);
        const edit: TaskEdit | null = prior === null ? 'ADD' : changed(prior, fields) ? 'UPDATE' : null;
        if (edit) {
          issues.push(...taskEditBlockers(ctx, edit, prior));
          issues.push(...linkIssues(tx, plan, fields.linkedGoalId as Id | null));
        }
        planned.push({ stored: prior, fields });
      }
      const removed = [...stored.values()].filter((t) => !seen.has(t.id));
      for (const t of removed) issues.push(...taskEditBlockers(ctx, 'REMOVE', t));
      throwIssues(issues);

      for (const t of removed) removeRow(tx, 'WorkTask', t.id);
      return planned.map(({ stored: prior, fields }, sortOrder) => {
        if (prior) return prior.sortOrder === sortOrder && !changed(prior, fields) ? prior : tx.update('WorkTask', { ...prior, ...fields, sortOrder } as WorkTask);
        return tx.insert('WorkTask', {
          ...(fields as Pick<WorkTask, (typeof TASK_COLUMNS)[number]>),
          id: newId(),
          tenantId: tx.tenantId,
          workPlanId: plan.id,
          sortOrder,
          progressPct: 0,
          progressStatus: WORK_TASK_INITIAL_STATUS,
          note: null,
          createdBy: tx.ctx.actorUserId as Id,
          cancelledAt: null,
          cancelledBy: null,
          cancelReason: null,
        });
      });
    }),
    cancelWorkTask: rt.write('work.cancelWorkTask', 'workflow', (tx, taskId: Id, reason: string) => {
      const task = tx.get('WorkTask', taskId);
      const plan = tx.get('WorkPlan', task.workPlanId);
      const ctx = taskContext(tx, plan);
      throwIssues(taskEditBlockers(ctx, 'CANCEL', task, reason));
      actForManager(tx, ctx);
      return tx.update(
        'WorkTask',
        { ...task, progressStatus: 'Cancelled', cancelledAt: tx.now, cancelledBy: tx.ctx.actorUserId, cancelReason: reason },
        { reason },
      );
    }),
    updateTaskProgress: rt.write('work.updateTaskProgress', 'workflow', (tx, taskId: Id, input: WorkTaskProgressInput) => {
      const task = tx.get('WorkTask', taskId);
      const plan = tx.get('WorkPlan', task.workPlanId);
      const ctx = taskContext(tx, plan);
      throwIssues(taskEditBlockers(ctx, 'PROGRESS', task));
      throwIssues(progressIssues(input.progressPct, input.progressStatus));
      actForManager(tx, ctx);
      return tx.update('WorkTask', { ...task, progressPct: input.progressPct, progressStatus: input.progressStatus, note: input.note });
    }),
    saveWorkReview: rt.write('work.saveWorkReview', 'workflow', (tx, formId: Id, patch: WorkReviewPatch) => {
      const form = tx.get('FormInstance', formId);
      if (form.formType !== 'WORK_REVIEW') throw new KpiError('ERR-KPI-06', `form ${formId} is not a WORK_REVIEW form`);
      const step = assertMayEdit(tx, form);
      const column = editableColumn(step);
      if (column === null) throw new KpiError('ERR-KPI-04', 'NO_EDITABLE_COLUMN');
      const own = WORK_REVIEW_COLUMN_FIELDS[column];
      if ((patch.hsnv !== undefined || patch.hsnvReason !== undefined) && own.hsnv === null) throw new KpiError('ERR-KPI-04', 'COLUMN_NOT_EDITABLE');
      const config = scoringOf(tx);
      const issues: RuleIssue[] = [];
      const score = (value: number | null | undefined, ref: string) => {
        if (value === undefined) return;
        const issue = workScoreIssue(value, config, ref);
        if (issue) issues.push(issue);
      };

      const review = tx.all('WorkReview').find((r) => r.formId === form.id);
      if (!review) throw new KpiError('ERR-KPI-02', `WorkReview of form ${formId} not found`);
      const next: WorkReview = { ...review };
      if (patch.disciplineScore !== undefined) {
        score(patch.disciplineScore, own.discipline);
        next[own.discipline] = patch.disciplineScore;
      }
      if (patch.comment !== undefined) next[own.comment] = patch.comment;
      if (own.hsnv !== null && own.hsnvReason !== null) {
        if (patch.hsnv !== undefined) {
          score(patch.hsnv, own.hsnv);
          next[own.hsnv] = patch.hsnv;
        }
        if (patch.hsnvReason !== undefined) next[own.hsnvReason] = patch.hsnvReason;
      }

      const updates: WorkReviewItem[] = [];
      const patched = new Set<Id>();
      for (const p of patch.items ?? []) {
        const item = typeof p?.itemId === 'string' ? tx.find('WorkReviewItem', p.itemId) : undefined;
        // One patch per item: a second one would silently overwrite the first.
        if (item && patched.has(item.id)) throw new KpiError('ERR-KPI-06', `WorkReviewItem ${item.id} is patched twice`);
        if (item) patched.add(item.id);
        if (!item || item.formId !== form.id) throw new KpiError('ERR-KPI-06', `WorkReviewItem ${String(p?.itemId)} is not on form ${formId}`);
        const row: WorkReviewItem = { ...item };
        if (p.score !== undefined) {
          score(p.score, item.id);
          row[own.score] = p.score;
        }
        if (p.comment !== undefined) row[own.itemComment] = p.comment;
        updates.push(row);
      }
      throwIssues(issues);
      tx.update('WorkReview', next);
      for (const row of updates) tx.update('WorkReviewItem', row);
      // EDIT records no history row (BR-KPI-23): the audit log holds the change.
      return { review: next, items: tx.all('WorkReviewItem').filter((i) => i.formId === form.id) };
    }),
    saveWorkScoringConfig: rt.write('work.saveWorkScoringConfig', { permission: 'cycle.manage' }, (tx, input: WorkScoringInput) => {
      const fields = writableOf('WorkScoringConfig', input) as unknown as WorkScoringInput;
      throwIssues(workScoringIssues(fields));
      const stored = tx.all('WorkScoringConfig')[0];
      return stored ? tx.update('WorkScoringConfig', { ...stored, ...fields }) : tx.insert('WorkScoringConfig', { id: newId(), tenantId: tx.tenantId, ...fields });
    }),
  };
}
