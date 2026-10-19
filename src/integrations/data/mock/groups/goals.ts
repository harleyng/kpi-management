import {
  CYCLE_INITIAL_STATUS,
  GOAL_INITIAL_STATUS,
  GOAL_PLAN_INITIAL_STATUS,
  PERIOD_TYPES,
  type CyclePeriod,
  type CycleStatus,
  type GoalPeriodTarget,
  type GoalTargetLevel,
  type Id,
  type IsoDate,
} from '@/data/types';
import { checkAlignment, goalAllocationIssues, type CascadeChild } from '@/lib/alignmentRules';
import { validateTargetLevels } from '@/lib/calcRules';
import { canEditCycle, canLockPeriod, cycleIssues, periodIssues, statusChangeIssues } from '@/lib/cycleRules';
import { KpiError } from '@/lib/errorCatalog';
import { canLock, canUnlock, statusAfterUnlock } from '@/lib/goalPlanRules';
import { todayOf } from '@/lib/isoDate';
import { onUnlock } from '@/lib/workflowRules';
import type { AlignmentFilter, ChildInput, GoalFilter, GoalPlanFilter, GoalScope, GoalsGateway } from '../../types';
import { removeRow } from '../integrity';
import { eqOpt, inList, saveChildren, upsert } from '../rows';
import { clockOf, goalResource, planIdResource, planResource } from '../authorize';
import type { Runtime } from '../runtime';
import type { Tx } from '../store';
import { assertPlanEditable, openFormOn, setPlanStatus, stepOf, stepsOf, throwDecision, throwIssues } from '../workflowContext';

/** Goal ids a `GoalScope` names; `{ goalPlanId }` must be a plan of this tenant (ERR-KPI-02). */
function goalIdsOf(tx: Tx, scope: GoalScope): Set<Id> {
  if ('goalPlanId' in scope) {
    tx.get('GoalPlan', scope.goalPlanId);
    return new Set(tx.all('Goal').filter((g) => g.goalPlanId === scope.goalPlanId).map((g) => g.id));
  }
  return new Set(scope.goalIds);
}

const periodOrder = (p: CyclePeriod) => `${p.startDate}|${PERIOD_TYPES.indexOf(p.periodType)}`;

/** The CASCADE children of `parentGoalId`, as the allocation rules read them (an edited alignment left out). */
function cascadeChildrenOf(tx: Tx, parentGoalId: Id, exceptAlignmentId?: Id): CascadeChild[] {
  return tx
    .all('GoalAlignment')
    .filter((a) => a.parentGoalId === parentGoalId && a.alignmentType === 'CASCADE' && a.id !== exceptAlignmentId)
    .flatMap((a) => {
      const goal = tx.find('Goal', a.childGoalId);
      const owner = goal?.ownerEmployeeId ? (tx.find('Employee', goal.ownerEmployeeId) ?? null) : null;
      return goal ? [{ alignment: a, childGoal: goal, childOwner: owner }] : [];
    });
}

/** An update may not move a row to another plan (the owner column) — said before any guard reads the plan. */
function samePlan(c: 'Goal' | 'Kgi', stored: { goalPlanId: Id } | null, input: { goalPlanId?: Id }): void {
  if (stored && input.goalPlanId !== stored.goalPlanId) throw new KpiError('ERR-KPI-06', `${c}.goalPlanId cannot change`);
}

export function goalsGroup(rt: Runtime): GoalsGateway {
  return {
    listCycles: rt.read('goals.listCycles', (tx) => tx.all('PerformanceCycle')),
    getCycle: rt.read('goals.getCycle', (tx, cycleId: Id) => tx.get('PerformanceCycle', cycleId)),
    saveCycle: rt.write('goals.saveCycle', { permission: 'cycle.manage' }, (tx, input: Parameters<GoalsGateway['saveCycle']>[2]) => {
      if (input.id !== undefined) {
        const stored = tx.get('PerformanceCycle', input.id);
        throwDecision(canEditCycle(stored), `cycle ${stored.id} is ${stored.status}`);
      }
      throwIssues(cycleIssues(input));
      return upsert(tx, 'PerformanceCycle', input, { create: () => ({ status: CYCLE_INITIAL_STATUS }) });
    }),
    setCycleStatus: rt.write('goals.setCycleStatus', { permission: 'cycle.manage' }, (tx, cycleId: Id, status: CycleStatus) => {
      const cycle = tx.get('PerformanceCycle', cycleId);
      const periods = tx.all('CyclePeriod').filter((p) => p.cycleId === cycleId);
      throwIssues(statusChangeIssues(cycle, status, periods));
      // Closing a cycle locks every period's actuals.
      if (status === 'Closed') for (const p of periods) if (!p.isLocked) tx.update('CyclePeriod', { ...p, isLocked: true });
      return tx.update('PerformanceCycle', { ...cycle, status });
    }),
    listPeriods: rt.read('goals.listPeriods', (tx, cycleId: Id) => {
      tx.get('PerformanceCycle', cycleId);
      return tx
        .all('CyclePeriod')
        .filter((p) => p.cycleId === cycleId)
        .sort((a, b) => (periodOrder(a) < periodOrder(b) ? -1 : 1));
    }),
    savePeriods: rt.write('goals.savePeriods', { permission: 'cycle.manage' }, (tx, cycleId: Id, periods: readonly ChildInput<CyclePeriod, 'cycleId'>[]) => {
      const cycle = tx.get('PerformanceCycle', cycleId);
      throwDecision(canEditCycle(cycle), `cycle ${cycleId} is ${cycle.status}`);
      throwIssues(periodIssues(cycle, periods));
      return saveChildren(tx, 'CyclePeriod', 'cycleId', cycleId, periods);
    }),
    setPeriodLocked: rt.write('goals.setPeriodLocked', { permission: 'cycle.manage' }, (tx, periodId: Id, locked: boolean) => {
      const period = tx.get('CyclePeriod', periodId);
      const cycle = tx.get('PerformanceCycle', period.cycleId);
      throwDecision(canLockPeriod(cycle), `cycle ${cycle.id} is ${cycle.status}`);
      return tx.update('CyclePeriod', { ...period, isLocked: locked });
    }),

    listGoalPlans: rt.read('goals.listGoalPlans', (tx, filter: GoalPlanFilter = {}) =>
      tx
        .all('GoalPlan')
        .filter(
          (p) =>
            eqOpt(filter.cycleId, p.cycleId) &&
            eqOpt(filter.ownerType, p.ownerType) &&
            (filter.ownerOrgUnitId === undefined || p.ownerOrgUnitId === filter.ownerOrgUnitId) &&
            (filter.ownerEmployeeIds === undefined || inList(filter.ownerEmployeeIds, p.ownerEmployeeId)) &&
            eqOpt(filter.status, p.status),
        ),
    ),
    getGoalPlan: rt.read('goals.getGoalPlan', (tx, goalPlanId: Id) => tx.get('GoalPlan', goalPlanId)),
    createGoalPlan: rt.write('goals.createGoalPlan', { permission: 'goalplan.edit', resource: (tx, input) => planResource(tx, input) }, (tx, input: Parameters<GoalsGateway['createGoalPlan']>[2]) =>
      upsert(tx, 'GoalPlan', { ...input, id: undefined }, { create: () => ({ status: GOAL_PLAN_INITIAL_STATUS, lockedAt: null }) }),
    ),
    lockGoalPlan: rt.write('goals.lockGoalPlan', { permission: 'goalplan.lock', resource: (tx, goalPlanId) => planIdResource(tx, goalPlanId) }, (tx, goalPlanId: Id) => {
      const plan = tx.get('GoalPlan', goalPlanId);
      throwDecision(canLock(plan), `goal plan ${goalPlanId} is already Locked`);
      // An open registration form on it is frozen from now on (`isFrozen`), until HR unlocks.
      return setPlanStatus(tx, plan, 'Locked');
    }),
    unlockGoalPlan: rt.write('goals.unlockGoalPlan', { permission: 'goalplan.lock', resource: (tx, goalPlanId) => planIdResource(tx, goalPlanId) }, (tx, goalPlanId: Id, reason: string, newDueDate: IsoDate) => {
      const clock = clockOf(tx);
      const plan = tx.get('GoalPlan', goalPlanId);
      const allowed = canUnlock(plan, { reason, newDueDate }, clock);
      if (!allowed.ok) throwIssues(allowed.issues);
      const open = openFormOn(tx, plan.id, 'GOAL_SETTING');
      const steps = open ? stepsOf(tx, open.workflowId) : [];
      const step = open ? stepOf(open, steps) : undefined;
      const saved = setPlanStatus(tx, plan, statusAfterUnlock(open && step ? { stepNo: step.stepNo, steps } : null), reason);
      // The frozen form re-enters its step with the new due date, so the next tick does not lock it again.
      const patch = open ? onUnlock(open, newDueDate, clock) : null;
      if (open && patch) tx.update('FormInstance', { ...open, ...patch }, { reason });
      return saved;
    }),

    listKgis: rt.read('goals.listKgis', (tx, goalPlanId: Id) => {
      tx.get('GoalPlan', goalPlanId);
      return tx
        .all('Kgi')
        .filter((k) => k.goalPlanId === goalPlanId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    }),
    saveKgi: rt.write('goals.saveKgi', { permission: 'goalplan.edit', resource: (tx, input) => planIdResource(tx, input.goalPlanId) }, (tx, input: Parameters<GoalsGateway['saveKgi']>[2]) => {
      const stored = input.id !== undefined ? tx.get('Kgi', input.id) : null;
      samePlan('Kgi', stored, input);
      assertPlanEditable(tx, stored?.goalPlanId ?? input.goalPlanId);
      return upsert(tx, 'Kgi', input, { create: () => ({}) });
    }),
    deleteKgi: rt.write('goals.deleteKgi', { permission: 'goalplan.edit', resource: (tx, kgiId) => planIdResource(tx, tx.find('Kgi', kgiId)?.goalPlanId) }, (tx, kgiId: Id) => {
      assertPlanEditable(tx, tx.get('Kgi', kgiId).goalPlanId);
      removeRow(tx, 'Kgi', kgiId);
    }),

    listGoals: rt.read('goals.listGoals', (tx, filter: GoalFilter = {}) =>
      tx
        .all('Goal')
        .filter(
          (g) =>
            inList(filter.goalPlanIds, g.goalPlanId) &&
            (filter.ownerEmployeeId === undefined || g.ownerEmployeeId === filter.ownerEmployeeId) &&
            (filter.kpiDefId === undefined || g.kpiDefId === filter.kpiDefId) &&
            eqOpt(filter.status, g.status),
        )
        .sort((a, b) => a.sortOrder - b.sortOrder),
    ),
    getGoal: rt.read('goals.getGoal', (tx, goalId: Id) => tx.get('Goal', goalId)),
    saveGoal: rt.write('goals.saveGoal', { permission: 'goalplan.edit', resource: (tx, input) => planIdResource(tx, input.goalPlanId) }, (tx, input: Parameters<GoalsGateway['saveGoal']>[2]) => {
      const stored = input.id !== undefined ? tx.get('Goal', input.id) : null;
      samePlan('Goal', stored, input);
      assertPlanEditable(tx, stored?.goalPlanId ?? input.goalPlanId);
      // A parent's target / "tự giao" may not drop below what it already handed down (BR-KPI-07, T3).
      const children = stored ? cascadeChildrenOf(tx, stored.id) : [];
      throwIssues(goalAllocationIssues(stored, { ...input, id: stored?.id ?? 'new' }, children, todayOf(clockOf(tx))));
      return upsert(tx, 'Goal', input, { create: () => ({ status: GOAL_INITIAL_STATUS, replacesGoalId: null }) });
    }),
    deleteGoal: rt.write('goals.deleteGoal', { permission: 'goalplan.edit', resource: (tx, goalId) => goalResource(tx, goalId) }, (tx, goalId: Id) => {
      assertPlanEditable(tx, tx.get('Goal', goalId).goalPlanId);
      removeRow(tx, 'Goal', goalId);
    }),

    listTargetLevels: rt.read('goals.listTargetLevels', (tx, scope: GoalScope) => {
      const ids = goalIdsOf(tx, scope);
      return tx.all('GoalTargetLevel').filter((l) => ids.has(l.goalId));
    }),
    setTargetLevels: rt.write('goals.setTargetLevels', { permission: 'goalplan.edit', resource: (tx, goalId) => goalResource(tx, goalId) }, (tx, goalId: Id, levels: readonly ChildInput<GoalTargetLevel, 'goalId'>[]) => {
      const goal = tx.get('Goal', goalId);
      assertPlanEditable(tx, goal.goalPlanId);
      const planned: GoalTargetLevel[] = levels.map((l, i) => ({ ...l, id: l.id ?? `new:${i}`, tenantId: tx.tenantId, goalId }));
      throwIssues(validateTargetLevels(goal.targetType, planned));
      return saveChildren(tx, 'GoalTargetLevel', 'goalId', goalId, levels);
    }),

    listAlignments: rt.read('goals.listAlignments', (tx, filter: AlignmentFilter = {}) =>
      tx
        .all('GoalAlignment')
        .filter(
          (a) =>
            (filter.goalId === undefined || a.childGoalId === filter.goalId || a.parentGoalId === filter.goalId) &&
            eqOpt(filter.parentGoalId, a.parentGoalId) &&
            eqOpt(filter.childGoalId, a.childGoalId) &&
            eqOpt(filter.alignmentType, a.alignmentType),
        ),
    ),
    saveAlignment: rt.write('goals.saveAlignment', { permission: 'goalplan.edit', resource: (tx, input) => goalResource(tx, input.childGoalId) }, (tx, input: Parameters<GoalsGateway['saveAlignment']>[2]) => {
      const stored = input.id !== undefined ? tx.get('GoalAlignment', input.id) : null;
      // The child's plan is the one being changed (the parent's plan only lends its target).
      const child = tx.find('Goal', stored?.childGoalId ?? input.childGoalId);
      if (child) assertPlanEditable(tx, child.goalPlanId);
      const parent = tx.find('Goal', input.parentGoalId);
      // Unknown goals are answered by the integrity check, exactly as any missing id.
      if (child && parent) {
        const alignments = tx.all('GoalAlignment');
        const existingChildren = cascadeChildrenOf(tx, parent.id, input.id);
        throwIssues(checkAlignment({ ...input, id: input.id }, { alignments, parentGoal: parent, existingChildren, asOf: todayOf(clockOf(tx)) }));
      }
      return upsert(tx, 'GoalAlignment', input, { create: () => ({}) });
    }),
    deleteAlignment: rt.write('goals.deleteAlignment', { permission: 'goalplan.edit', resource: (tx, alignmentId) => goalResource(tx, tx.find('GoalAlignment', alignmentId)?.childGoalId) }, (tx, alignmentId: Id) => {
      const child = tx.find('Goal', tx.get('GoalAlignment', alignmentId).childGoalId);
      if (child) assertPlanEditable(tx, child.goalPlanId);
      removeRow(tx, 'GoalAlignment', alignmentId);
    }),

    listPeriodTargets: rt.read('goals.listPeriodTargets', (tx, scope: GoalScope) => {
      const ids = goalIdsOf(tx, scope);
      return tx.all('GoalPeriodTarget').filter((t) => ids.has(t.goalId));
    }),
    setPeriodTargets: rt.write('goals.setPeriodTargets', { permission: 'goalplan.edit', resource: (tx, goalId) => goalResource(tx, goalId) }, (tx, goalId: Id, targets: readonly ChildInput<GoalPeriodTarget, 'goalId'>[]) => {
      assertPlanEditable(tx, tx.get('Goal', goalId).goalPlanId);
      // Every period belongs to the plan's cycle: the schema's CHECK answers it (ERR-KPI-06) at commit.
      return saveChildren(tx, 'GoalPeriodTarget', 'goalId', goalId, targets);
    }),
  };
}
