import type { Delegation, FormType, GoalChangeItem, Id, WorkflowStep } from '@/data/types';
import { KpiError } from '@/lib/errorCatalog';
import type { ChildInput, FormFilter, FormsGateway, PageRequest } from '../../types';
import { eqOpt, inList, saveChildren, upsert } from '../rows';
import type { Runtime } from '../runtime';
import { paginate } from './page';

const WORKFLOW_RULES = 'Phase 1.5 workflowRules';

export function formsGroup(rt: Runtime): FormsGateway {
  rt.pendingGuard('forms.saveWorkflow', `${WORKFLOW_RULES}: no RETURN on step 1, no AUTO_FORWARD on the last step, onOverdue needs a deadline, no LOCK on KPI_EVAL`);
  rt.pendingGuard('forms.saveLaunchRule', `${WORKFLOW_RULES}: a recurring rule launches KPI_EVAL only`);
  rt.pendingGuard('forms.saveGoalChangeItems', `${WORKFLOW_RULES}: only at a step that allows EDIT, by its actor`);
  rt.pendingGuard('forms.saveDelegation', `${WORKFLOW_RULES}: not to oneself, no delegation chains`);
  rt.pendingGuard('forms.revokeDelegation', `${WORKFLOW_RULES}: who may revoke (the delegator, HR)`);

  return {
    listWorkflows: rt.read('forms.listWorkflows', (tx, formType?: FormType) => tx.all('WorkflowTemplate').filter((w) => eqOpt(formType, w.formType))),
    listWorkflowSteps: rt.read('forms.listWorkflowSteps', (tx, workflowId?: Id) =>
      tx
        .all('WorkflowStep')
        .filter((s) => eqOpt(workflowId, s.workflowId))
        .sort((a, b) => (a.workflowId === b.workflowId ? a.stepNo - b.stepNo : a.workflowId < b.workflowId ? -1 : 1)),
    ),
    saveWorkflow: rt.write(
      'forms.saveWorkflow',
      (tx, input: Parameters<FormsGateway['saveWorkflow']>[2], steps: readonly ChildInput<WorkflowStep, 'workflowId' | 'stepNo'>[]) => {
        const parent = upsert(tx, 'WorkflowTemplate', input, { create: () => ({}) });
        // Steps are numbered 1…n in the order given.
        return { parent, children: saveChildren(tx, 'WorkflowStep', 'workflowId', parent.id, steps, (i) => ({ stepNo: i + 1 })) };
      },
    ),

    listLaunches: rt.read('forms.listLaunches', (tx) => tx.all('FormLaunch').sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1))),
    getLaunch: rt.read('forms.getLaunch', (tx, launchId: Id) => tx.get('FormLaunch', launchId)),
    createLaunch: rt.deferred('forms.createLaunch', 'write', `${WORKFLOW_RULES} (recipients, skip rules, registration plans)`),
    cancelLaunch: rt.deferred('forms.cancelLaunch', 'write', `${WORKFLOW_RULES} (only a Scheduled launch)`),
    listLaunchRules: rt.read('forms.listLaunchRules', (tx) => tx.all('FormLaunchRule')),
    saveLaunchRule: rt.write('forms.saveLaunchRule', (tx, input: Parameters<FormsGateway['saveLaunchRule']>[2]) =>
      upsert(tx, 'FormLaunchRule', input, { create: () => ({}) }),
    ),

    startForm: rt.deferred('forms.startForm', 'write', `${WORKFLOW_RULES} (first step, one open GOAL_CHANGE per plan)`),
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
    listInbox: rt.deferred('forms.listInbox', 'read', `${WORKFLOW_RULES} (the step's actor, valid delegations)`),
    listFormActions: rt.read('forms.listFormActions', (tx, formId: Id) => {
      tx.get('FormInstance', formId);
      return tx
        .all('FormStepAction')
        .filter((a) => a.formId === formId)
        .sort((a, b) => (a.actedAt < b.actedAt ? -1 : 1));
    }),
    listEvaluationItems: rt.read('forms.listEvaluationItems', (tx, formId: Id) => {
      tx.get('FormInstance', formId);
      return tx.all('EvaluationItem').filter((i) => i.formId === formId);
    }),
    saveEvaluationItems: rt.deferred('forms.saveEvaluationItems', 'write', `${WORKFLOW_RULES} (the current step's column)`),
    listGoalChangeItems: rt.read('forms.listGoalChangeItems', (tx, formId: Id) => {
      tx.get('FormInstance', formId);
      return tx.all('GoalChangeItem').filter((i) => i.formId === formId);
    }),
    saveGoalChangeItems: rt.write('forms.saveGoalChangeItems', (tx, formId: Id, items: readonly ChildInput<GoalChangeItem, 'formId'>[]) => {
      const form = tx.get('FormInstance', formId);
      if (form.formType !== 'GOAL_CHANGE') throw new KpiError('ERR-KPI-06', `form ${formId} is not a GOAL_CHANGE form`);
      return saveChildren(tx, 'GoalChangeItem', 'formId', formId, items);
    }),
    act: rt.deferred('forms.act', 'write', `${WORKFLOW_RULES} + formRules.canSubmit (transitions, BR-KPI-18/23)`),

    listDelegations: rt.read('forms.listDelegations', (tx, userId?: Id) =>
      tx.all('Delegation').filter((d) => userId === undefined || d.fromUserId === userId || d.toUserId === userId),
    ),
    saveDelegation: rt.write('forms.saveDelegation', (tx, input: Parameters<FormsGateway['saveDelegation']>[2]) => {
      const actor = tx.ctx.actorUserId as Id;
      // A user delegates their OWN steps: `fromUserId` is the actor, never the payload.
      if (input.id !== undefined && tx.get('Delegation', input.id).fromUserId !== actor) {
        throw new KpiError('ERR-KPI-05', `delegation ${input.id} belongs to another user`);
      }
      return upsert(tx, 'Delegation', input, { create: (): Partial<Delegation> => ({ fromUserId: actor, revokedAt: null }) });
    }),
    revokeDelegation: rt.write('forms.revokeDelegation', (tx, delegationId: Id) => {
      const delegation = tx.get('Delegation', delegationId);
      if (delegation.revokedAt !== null) throw new KpiError('ERR-KPI-04', `delegation ${delegationId} is already revoked`);
      return tx.update('Delegation', { ...delegation, revokedAt: tx.now });
    }),
  };
}
