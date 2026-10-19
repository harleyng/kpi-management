import {
  CYCLE_INITIAL_STATUS,
  GOAL_INITIAL_STATUS,
  GOAL_PLAN_INITIAL_STATUS,
  PERIOD_TYPES,
  type CyclePeriod,
  type GoalPeriodTarget,
  type GoalTargetLevel,
  type Id,
} from '@/data/types';
import type { AlignmentFilter, ChildInput, GoalFilter, GoalPlanFilter, GoalScope, GoalsGateway } from '../../types';
import { removeRow } from '../integrity';
import { eqOpt, inList, saveChildren, upsert } from '../rows';
import type { Runtime } from '../runtime';
import type { Tx } from '../store';

const CYCLE_RULE = 'Phase 1.5 cycleRules: a cycle and its periods are editable only while Planning';
const PLAN_EDIT_RULE = 'Phase 1.5 goalPlanRules: the plan is editable by this actor at its current step';
const ALIGNMENT_RULE = 'Phase 1.5 alignmentRules: no cycle (A → B → A), no allocation above the parent target';

/** Goal ids a `GoalScope` names; `{ goalPlanId }` must be a plan of this tenant (ERR-KPI-02). */
function goalIdsOf(tx: Tx, scope: GoalScope): Set<Id> {
  if ('goalPlanId' in scope) {
    tx.get('GoalPlan', scope.goalPlanId);
    return new Set(tx.all('Goal').filter((g) => g.goalPlanId === scope.goalPlanId).map((g) => g.id));
  }
  return new Set(scope.goalIds);
}

const periodOrder = (p: CyclePeriod) => `${p.startDate}|${PERIOD_TYPES.indexOf(p.periodType)}`;

export function goalsGroup(rt: Runtime): GoalsGateway {
  rt.pendingGuard('goals.saveCycle', CYCLE_RULE);
  rt.pendingGuard('goals.savePeriods', CYCLE_RULE);
  for (const m of ['saveKgi', 'deleteKgi', 'saveGoal', 'deleteGoal', 'setTargetLevels', 'setPeriodTargets']) {
    rt.pendingGuard(`goals.${m}`, PLAN_EDIT_RULE);
  }
  rt.pendingGuard('goals.saveAlignment', ALIGNMENT_RULE);
  rt.pendingGuard('goals.deleteAlignment', ALIGNMENT_RULE);

  return {
    listCycles: rt.read('goals.listCycles', (tx) => tx.all('PerformanceCycle')),
    getCycle: rt.read('goals.getCycle', (tx, cycleId: Id) => tx.get('PerformanceCycle', cycleId)),
    saveCycle: rt.write('goals.saveCycle', (tx, input: Parameters<GoalsGateway['saveCycle']>[2]) =>
      upsert(tx, 'PerformanceCycle', input, { create: () => ({ status: CYCLE_INITIAL_STATUS }) }),
    ),
    setCycleStatus: rt.deferred('goals.setCycleStatus', 'write', 'Phase 1.5 cycleRules (Planning → Active → Evaluating → Closed)'),
    listPeriods: rt.read('goals.listPeriods', (tx, cycleId: Id) => {
      tx.get('PerformanceCycle', cycleId);
      return tx
        .all('CyclePeriod')
        .filter((p) => p.cycleId === cycleId)
        .sort((a, b) => (periodOrder(a) < periodOrder(b) ? -1 : 1));
    }),
    savePeriods: rt.write('goals.savePeriods', (tx, cycleId: Id, periods: readonly ChildInput<CyclePeriod, 'cycleId'>[]) => {
      tx.get('PerformanceCycle', cycleId);
      return saveChildren(tx, 'CyclePeriod', 'cycleId', cycleId, periods);
    }),
    setPeriodLocked: rt.write('goals.setPeriodLocked', (tx, periodId: Id, locked: boolean) =>
      tx.update('CyclePeriod', { ...tx.get('CyclePeriod', periodId), isLocked: locked }),
    ),

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
    createGoalPlan: rt.write('goals.createGoalPlan', (tx, input: Parameters<GoalsGateway['createGoalPlan']>[2]) =>
      upsert(tx, 'GoalPlan', { ...input, id: undefined }, { create: () => ({ status: GOAL_PLAN_INITIAL_STATUS, lockedAt: null }) }),
    ),
    lockGoalPlan: rt.deferred('goals.lockGoalPlan', 'write', 'Phase 1.5 goalPlanRules + workflowRules (lock, BR-KPI-14)'),
    unlockGoalPlan: rt.deferred('goals.unlockGoalPlan', 'write', 'Phase 1.5 goalPlanRules + workflowRules (unlock and re-enter the frozen step)'),

    listKgis: rt.read('goals.listKgis', (tx, goalPlanId: Id) => {
      tx.get('GoalPlan', goalPlanId);
      return tx
        .all('Kgi')
        .filter((k) => k.goalPlanId === goalPlanId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    }),
    saveKgi: rt.write('goals.saveKgi', (tx, input: Parameters<GoalsGateway['saveKgi']>[2]) => upsert(tx, 'Kgi', input, { create: () => ({}) })),
    deleteKgi: rt.write('goals.deleteKgi', (tx, kgiId: Id) => {
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
    saveGoal: rt.write('goals.saveGoal', (tx, input: Parameters<GoalsGateway['saveGoal']>[2]) =>
      upsert(tx, 'Goal', input, { create: () => ({ status: GOAL_INITIAL_STATUS, replacesGoalId: null }) }),
    ),
    deleteGoal: rt.write('goals.deleteGoal', (tx, goalId: Id) => {
      removeRow(tx, 'Goal', goalId);
    }),

    listTargetLevels: rt.read('goals.listTargetLevels', (tx, scope: GoalScope) => {
      const ids = goalIdsOf(tx, scope);
      return tx.all('GoalTargetLevel').filter((l) => ids.has(l.goalId));
    }),
    setTargetLevels: rt.write('goals.setTargetLevels', (tx, goalId: Id, levels: readonly ChildInput<GoalTargetLevel, 'goalId'>[]) => {
      tx.get('Goal', goalId);
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
    saveAlignment: rt.write('goals.saveAlignment', (tx, input: Parameters<GoalsGateway['saveAlignment']>[2]) =>
      upsert(tx, 'GoalAlignment', input, { create: () => ({}) }),
    ),
    deleteAlignment: rt.write('goals.deleteAlignment', (tx, alignmentId: Id) => {
      removeRow(tx, 'GoalAlignment', alignmentId);
    }),

    listPeriodTargets: rt.read('goals.listPeriodTargets', (tx, scope: GoalScope) => {
      const ids = goalIdsOf(tx, scope);
      return tx.all('GoalPeriodTarget').filter((t) => ids.has(t.goalId));
    }),
    setPeriodTargets: rt.write('goals.setPeriodTargets', (tx, goalId: Id, targets: readonly ChildInput<GoalPeriodTarget, 'goalId'>[]) => {
      tx.get('Goal', goalId);
      return saveChildren(tx, 'GoalPeriodTarget', 'goalId', goalId, targets);
    }),
  };
}
