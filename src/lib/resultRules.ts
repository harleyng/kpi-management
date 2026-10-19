/**
 * Period results — BR-KPI-35, 40–43; WBS 4.6.2–4.6.3. The ONE pipeline that turns a period's data
 * into `PeriodResult` / `ResultDetail` rows, shared by the mock gateway (`results.*`) and the seed
 * (`src/data/fixtures/*results*`): both hand it plain arrays and persist the rows it returns, so the
 * two can never compute a result differently.
 *
 * Stored conventions (BR-KPI-40):
 * - `PeriodResult.totalScore` is the ADJUSTED score — a Draft stores `adjustedScore` unrounded; a
 *   Final / Locked result stores `ratedScore`, rounded ONCE when it was finalised. `adjustmentPct` is
 *   stored on its own. Rating and payout are `null` while the score is incomplete.
 * - `ResultDetail.achievementPct` is the raw per-goal % (floor and cap already applied by calcRules,
 *   or the FINAL column of the evaluation form); `weightedScore` = its points out of 100.
 * - `payoutPct` only for an Employee plan; a Company / OrgUnit plan is rated but carries no payout.
 */

import type {
  Aggregation,
  CalcMethod,
  CalcTier,
  CyclePeriod,
  Employee,
  EmployeeAssignment,
  EvaluationItem,
  FormInstance,
  Goal,
  GoalActual,
  GoalAlignment,
  GoalPeriodTarget,
  GoalPlan,
  GoalTargetLevel,
  Id,
  IsoDate,
  IsoDateTime,
  KpiDefinition,
  OrgUnit,
  PayoutRule,
  PerformanceCycle,
  PeriodResult,
  PeriodResultStatus,
  RatingLevel,
  ResultDetail,
} from '@/data/types';
import { achievement, goalAchievementInput, type NotComputableReason } from './calcRules';
import { ruleIssue, type ErrorCode, type RuleIssue } from './errorCatalog';
import { columnPct } from './formRules';
import { weightIssue } from './goalPlanRules';
import { latestFirst, primaryAssignmentOn, unitAncestry } from './orgRules';
import { payoutPctFor, ratingFor, type PayoutSubject } from './ratingRules';
import {
  adjustedScore,
  aggregatePeriodActuals,
  finalizeIssues,
  lineWeightedScore,
  ratedScore,
  rollUpActual,
  weightedScore,
  type ScoreLine,
  type WeightedScore,
} from './scoreRules';

// ─── Lines ─────────────────────────────────────────────────────────────────────────────────────

/** One goal's contribution to a result. `notComputable` says WHY a missing % is missing (ERR-KPI-12). */
export interface ResultLine extends ScoreLine {
  notComputable: NotComputableReason | null;
}

/**
 * An Employee plan's lines: the FINAL column of its completed evaluation form (BR-KPI-16). The form
 * is the snapshot of the goals that were Active when it opened (BR-KPI-17), so every goal on it counts
 * as Active here even if an adjustment has since marked it Changed or Cancelled (E026's T01 form). A
 * null FINAL % is missing, never 0. An item whose goal is unknown weighs 0 and is missing.
 */
export function evaluationLines(items: readonly EvaluationItem[], goals: readonly Goal[]): ResultLine[] {
  const byId = new Map(goals.map((g) => [g.id, g]));
  return items.map((item) => {
    const goal = byId.get(item.goalId);
    const pct = columnPct(item, 'FINAL');
    return {
      goalId: item.goalId,
      weight: goal ? goal.weight : 0,
      status: 'Active' as const,
      achievementPct: goal && pct !== null && Number.isFinite(pct) ? pct : null,
      notComputable: null,
    };
  });
}

/** What `actualLines` reads besides the plan's goals. Every list may hold other periods' / goals' rows. */
export interface ActualContext {
  period: CyclePeriod;
  /** The cycle's periods — a Quarter / Half / Year adds up its months. */
  periods: readonly CyclePeriod[];
  actuals: readonly GoalActual[];
  periodTargets: readonly GoalPeriodTarget[];
  methods: readonly CalcMethod[];
  tiers: readonly CalcTier[];
  levels: readonly GoalTargetLevel[];
  kpiDefinitions: readonly KpiDefinition[];
  /** Every goal of the tenant and the alignments — read only for `rollUpFromChildren` (ASSUMPTION Q8). */
  allGoals: readonly Goal[];
  alignments: readonly GoalAlignment[];
}

type ActualValue = { actualValue: number | null; actualText: string | null };

const isMonth = (p: Pick<CyclePeriod, 'periodType'>) => p.periodType === 'Month';

/** The months inside a longer period, in calendar order. */
function monthsOf(period: CyclePeriod, periods: readonly CyclePeriod[]): CyclePeriod[] {
  return periods
    .filter((p) => isMonth(p) && p.cycleId === period.cycleId && p.startDate >= period.startDate && p.endDate <= period.endDate)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
}

const aggregationOf = (goal: Goal, ctx: ActualContext): Aggregation | null =>
  ctx.kpiDefinitions.find((k) => k.id === goal.kpiDefId)?.aggregation ?? null;

const currentActual = (goalId: Id, periodId: Id, actuals: readonly GoalActual[]): GoalActual | null =>
  actuals.find((a) => a.isCurrent && a.goalId === goalId && a.periodId === periodId) ?? null;

const NO_ACTUAL: ActualValue | null = null;

/**
 * The actual of a goal for `period` (BR-KPI-52: only the CURRENT snapshot counts):
 * - a goal flagged `rollUpFromChildren` sums its CASCADE children (`scoreRules.rollUpActual`, Q8);
 * - its own current actual for the period;
 * - for a Quarter / Half / Year with none, its months added up by the KPI's aggregation
 *   (`scoreRules.aggregatePeriodActuals`). A TEXT goal is never aggregated; a goal not from the
 *   library has no aggregation, so it needs its own actual.
 */
function actualFor(goal: Goal, period: CyclePeriod, ctx: ActualContext, visiting: ReadonlySet<Id>): ActualValue | null {
  if (goal.rollUpFromChildren && goal.targetType === 'NUMERIC') {
    if (visiting.has(goal.id)) return NO_ACTUAL;
    const next = new Set(visiting).add(goal.id);
    const children = ctx.alignments
      .filter((a) => a.parentGoalId === goal.id && a.alignmentType === 'CASCADE')
      .map((a) => ctx.allGoals.find((g) => g.id === a.childGoalId))
      .filter((g): g is Goal => g !== undefined && g.status === 'Active');
    const value = rollUpActual(children.map((child) => actualFor(child, period, ctx, next)?.actualValue ?? null));
    return value === null ? NO_ACTUAL : { actualValue: value, actualText: null };
  }
  const own = currentActual(goal.id, period.id, ctx.actuals);
  if (own) return { actualValue: own.actualValue, actualText: own.actualText };
  if (isMonth(period) || goal.targetType === 'TEXT') return NO_ACTUAL;
  const aggregation = aggregationOf(goal, ctx);
  const months = monthsOf(period, ctx.periods);
  if (aggregation === null || months.length === 0) return NO_ACTUAL;
  const value = aggregatePeriodActuals(
    months.map((m) => currentActual(goal.id, m.id, ctx.actuals)?.actualValue ?? null),
    aggregation,
  );
  return value === null ? NO_ACTUAL : { actualValue: value, actualText: null };
}

/**
 * The target split for a longer period with no split of its own: its months' split targets added up
 * the same way as the actuals (a quarter of a SUM goal = Σ of its three months). `null` = use the
 * goal's own target (`calcRules.targetForPeriod`).
 */
function aggregatedTarget(goal: Goal, period: CyclePeriod, ctx: ActualContext): number | null {
  if (isMonth(period) || ctx.periodTargets.some((t) => t.goalId === goal.id && t.periodId === period.id)) return null;
  const aggregation = aggregationOf(goal, ctx);
  const months = monthsOf(period, ctx.periods);
  if (aggregation === null || months.length === 0) return null;
  const monthly = months.map((m) => ctx.periodTargets.find((t) => t.goalId === goal.id && t.periodId === m.id)?.targetValue ?? null);
  return monthly.some((v) => v === null) ? null : aggregatePeriodActuals(monthly, aggregation);
}

/**
 * A Company / OrgUnit plan's lines (no evaluation form): `calcRules.achievement` on the period's
 * current actuals, over the plan's ACTIVE goals. NO_ACTUAL and NOT_COMPUTABLE give `null` — never 0 —
 * and a not computable goal carries its reason.
 */
export function actualLines(goals: readonly Goal[], ctx: ActualContext): ResultLine[] {
  return goals
    .filter((g) => g.status === 'Active')
    .map((goal) => {
      const method = ctx.methods.find((m) => m.id === goal.calcMethodId);
      const split = aggregatedTarget(goal, ctx.period, ctx);
      const periodTargets =
        split === null ? ctx.periodTargets : [...ctx.periodTargets, { id: '', tenantId: goal.tenantId, goalId: goal.id, periodId: ctx.period.id, targetValue: split }];
      const input = goalAchievementInput(goal, actualFor(goal, ctx.period, ctx, new Set()), {
        periodId: ctx.period.id,
        periodTargets,
        tiers: ctx.tiers,
        levels: ctx.levels,
      });
      const result = method ? achievement(method, input) : ({ status: 'NOT_COMPUTABLE', reason: 'INVALID_VALUE' } as const);
      return {
        goalId: goal.id,
        weight: goal.weight,
        status: 'Active' as const,
        achievementPct: result.status === 'SCORED' ? result.pct : null,
        notComputable: result.status === 'NOT_COMPUTABLE' ? result.reason : null,
      };
    });
}

// ─── Score → rating → payout ───────────────────────────────────────────────────────────────────

export interface ResultCalc {
  score: WeightedScore;
  /** The adjusted score, unrounded — what a Draft stores. `null` while no goal is scored. */
  adjusted: number | null;
  /** The adjusted score rounded once — what a rating reads and a Final result stores. */
  rated: number | null;
  /** `null` while the score is incomplete (a provisional score is never rated). */
  ratingLevelId: Id | null;
  /** `null` while incomplete, with no subject (a unit plan) or with no rule in force ("chưa có quy tắc"). */
  payoutPct: number | null;
  details: Pick<ResultDetail, 'goalId' | 'achievementPct' | 'weight' | 'weightedScore'>[];
}

/**
 * BR-KPI-35, 40–42 — the weighted score, the adjustment (points, never below 0), the rating of the
 * ROUNDED adjusted score on the cycle's scale and the payout % in force on `asOf` for `subject`.
 */
export function computeResult(
  lines: readonly ResultLine[],
  adjustmentPct: number,
  levels: readonly RatingLevel[],
  payoutRules: readonly PayoutRule[],
  subject: PayoutSubject | null,
  asOf: IsoDate,
): ResultCalc {
  const score = weightedScore(lines);
  const adjusted = adjustedScore(score.score, adjustmentPct);
  const rated = ratedScore(score.score, adjustmentPct);
  // A provisional score is never rated: every goal scored AND the weights total 100% (BR-KPI-07).
  const rating = score.complete && weightIssue(lines) === null ? ratingFor(rated, levels) : null;
  const payoutPct = rating && subject ? payoutPctFor(rating, payoutRules, subject, asOf) : null;
  return {
    score,
    adjusted,
    rated,
    ratingLevelId: rating?.id ?? null,
    payoutPct,
    details: lines
      .filter((l) => l.status === 'Active')
      .map((l) => ({ goalId: l.goalId, achievementPct: l.achievementPct, weight: l.weight, weightedScore: lineWeightedScore(l.achievementPct, l.weight) })),
  };
}

/**
 * What blocks finalising one result (BR-KPI-35, 43), most important first: the weights (ERR-KPI-07),
 * then each not computable goal (ERR-KPI-12, detail = the reason), then each goal with no
 * achievement (ERR-KPI-09) — over `scoreRules.finalizeIssues`. Every issue names the result in
 * `data.resultId`, so a screen finalising many results can mark each one.
 */
export function finalizeCheck(lines: readonly ResultLine[], resultId: Id): RuleIssue[] {
  const tag = (issue: RuleIssue): RuleIssue => ({ ...issue, data: { ...(issue.data ?? {}), resultId } });
  const base = finalizeIssues(lines);
  const blocked = new Map(lines.filter((l) => l.status === 'Active' && l.notComputable !== null).map((l) => [l.goalId, l.notComputable as string]));
  return [
    ...base.filter((i) => i.code === 'ERR-KPI-07'),
    ...[...blocked].map(([goalId, reason]) => ruleIssue('ERR-KPI-12', goalId, reason)),
    ...base.filter((i) => i.code !== 'ERR-KPI-07' && !(i.ref !== null && blocked.has(i.ref))),
  ].map(tag);
}

// ─── Lifecycle (BR-KPI-43) ─────────────────────────────────────────────────────────────────────

export const RESULT_TRANSITIONS: Readonly<Record<PeriodResultStatus, readonly PeriodResultStatus[]>> = {
  Draft: ['Final'],
  Final: ['Locked'],
  Locked: [],
};

/** A `goalPlanRules.Decision` with the reason a refusal carries. */
export type ResultDecision = { ok: true } | { ok: false; code: ErrorCode; detail: string };

const allow: ResultDecision = { ok: true };
const stateDetail = (status: PeriodResultStatus) => (status === 'Locked' ? 'RESULT_LOCKED' : status === 'Final' ? 'RESULT_FINAL' : 'NOT_FINAL');

/** Only a Draft is (re)computed — a Final or Locked result is a snapshot. */
export const canRecalculate = (status: PeriodResultStatus): boolean => status === 'Draft';

/** The adjustment is set on a Draft only (ERR-KPI-04 RESULT_FINAL / RESULT_LOCKED). */
export function canAdjust(status: PeriodResultStatus): ResultDecision {
  return status === 'Draft' ? allow : { ok: false, code: 'ERR-KPI-04', detail: stateDetail(status) };
}

/** Draft → Final → Locked, nothing else. Refused with ERR-KPI-04 and why. */
export function canTransition(from: PeriodResultStatus, to: PeriodResultStatus): ResultDecision {
  if (RESULT_TRANSITIONS[from].includes(to)) return allow;
  return { ok: false, code: 'ERR-KPI-04', detail: to === 'Final' ? 'NOT_DRAFT' : stateDetail(from) };
}

// ─── Orchestrators over plain rows ─────────────────────────────────────────────────────────────

/** The rows the pipeline reads — the mock passes `tx.all(...)`, the seed its own collections. */
export interface ResultData {
  PerformanceCycle: readonly PerformanceCycle[];
  CyclePeriod: readonly CyclePeriod[];
  GoalPlan: readonly GoalPlan[];
  Goal: readonly Goal[];
  GoalAlignment: readonly GoalAlignment[];
  GoalPeriodTarget: readonly GoalPeriodTarget[];
  GoalTargetLevel: readonly GoalTargetLevel[];
  GoalActual: readonly GoalActual[];
  FormInstance: readonly FormInstance[];
  EvaluationItem: readonly EvaluationItem[];
  CalcMethod: readonly CalcMethod[];
  CalcTier: readonly CalcTier[];
  KpiDefinition: readonly KpiDefinition[];
  RatingLevel: readonly RatingLevel[];
  PayoutRule: readonly PayoutRule[];
  Employee: readonly Employee[];
  EmployeeAssignment: readonly EmployeeAssignment[];
  OrgUnit: readonly OrgUnit[];
  PeriodResult: readonly PeriodResult[];
  ResultDetail: readonly ResultDetail[];
}

/** Where new row ids come from: the mock's random ids, the seed's `seedId`. */
export interface ResultIds {
  result(periodId: Id, goalPlanId: Id): Id;
  detail(resultId: Id, goalId: Id): Id;
}

/** What one orchestrator writes. Applying it is the caller's job (a transaction, or the seed's arrays). */
export interface ResultChanges {
  /** Results to insert (`created`) or update in place. */
  results: { row: PeriodResult; created: boolean }[];
  /** Detail rows to remove (a recomputed result's old lines). */
  removedDetailIds: Id[];
  addedDetails: ResultDetail[];
}

export type ResultOutcome = { ok: true; changes: ResultChanges } | { ok: false; issues: RuleIssue[] };

const refuse = (code: ErrorCode, ref: Id | null, detail: string, data: Record<string, string> | null = null): ResultOutcome => ({
  ok: false,
  issues: [ruleIssue(code, ref, detail, data)],
});

const ELIGIBLE_PLAN = new Set(['Approved', 'Locked']);

/** The period and its cycle, or why there is nothing to compute. */
function periodContext(data: ResultData, periodId: Id): { period: CyclePeriod; cycle: PerformanceCycle } | null {
  const period = data.CyclePeriod.find((p) => p.id === periodId);
  const cycle = period && data.PerformanceCycle.find((c) => c.id === period.cycleId);
  return period && cycle ? { period, cycle } : null;
}

/**
 * The primary assignment an Employee plan's payout is read for (BR-KPI-24, 42): the one in force on
 * their last working day in the period (`leftOn` when earlier than the period end), else the latest
 * primary one that started by the period end. The payroll file prints the same unit and position
 * (BR-KPI-45), read from the current assignment rows. `null` = not an Employee plan, or no assignment.
 */
export function subjectAssignment(
  plan: Pick<GoalPlan, 'ownerType' | 'ownerEmployeeId'>,
  period: Pick<CyclePeriod, 'endDate'>,
  data: Pick<ResultData, 'Employee' | 'EmployeeAssignment'>,
): EmployeeAssignment | null {
  if (plan.ownerType !== 'Employee' || plan.ownerEmployeeId === null) return null;
  const employeeId = plan.ownerEmployeeId;
  const employee = data.Employee.find((e) => e.id === employeeId);
  const asOf = employee?.leftOn && employee.leftOn < period.endDate ? employee.leftOn : period.endDate;
  return (
    primaryAssignmentOn(employeeId, data.EmployeeAssignment, asOf) ??
    data.EmployeeAssignment.filter((a) => a.employeeId === employeeId && a.isPrimary && a.effectiveFrom <= period.endDate).sort(latestFirst)[0] ??
    null
  );
}

/** The payout subject of an Employee plan — its `subjectAssignment`'s unit chain and position. */
function payoutSubject(plan: GoalPlan, period: CyclePeriod, data: ResultData): PayoutSubject | null {
  if (plan.ownerType !== 'Employee' || plan.ownerEmployeeId === null) return null;
  const assignment = subjectAssignment(plan, period, data);
  return assignment ? { unitAncestry: unitAncestry(assignment.orgUnitId, data.OrgUnit), positionId: assignment.positionId } : { unitAncestry: [], positionId: null };
}

/** The completed evaluation of an Employee plan for the period, if any (ASSUMPTION Q17). */
function completedEvaluation(plan: GoalPlan, periodId: Id, data: ResultData): FormInstance | null {
  return (
    data.FormInstance.filter(
      (f) =>
        f.formType === 'KPI_EVAL' &&
        f.status === 'Completed' &&
        f.goalPlanId === plan.id &&
        f.periodId === periodId &&
        f.subjectEmployeeId === plan.ownerEmployeeId,
    ).sort((a, b) => (a.launchedAt < b.launchedAt ? 1 : -1))[0] ?? null
  );
}

/**
 * The lines of one plan for the period from the CURRENT data, or `null` when the plan has no result
 * this period. `ASSUMPTION Q17`: an Employee plan is scored only from a COMPLETED evaluation form
 * (subject, plan, period) — no completed form, no result; Company / OrgUnit plans have no form and
 * are scored from the actuals.
 */
export function planLines(plan: GoalPlan, period: CyclePeriod, data: ResultData): ResultLine[] | null {
  const goals = data.Goal.filter((g) => g.goalPlanId === plan.id);
  if (plan.ownerType === 'Employee') {
    const form = completedEvaluation(plan, period.id, data);
    return form ? evaluationLines(data.EvaluationItem.filter((i) => i.formId === form.id), goals) : null;
  }
  return actualLines(goals, {
    period,
    periods: data.CyclePeriod,
    actuals: data.GoalActual,
    periodTargets: data.GoalPeriodTarget,
    methods: data.CalcMethod,
    tiers: data.CalcTier,
    levels: data.GoalTargetLevel,
    kpiDefinitions: data.KpiDefinition,
    allGoals: data.Goal,
    alignments: data.GoalAlignment,
  });
}

/** `computeResult` for one plan in its cycle's scale, with its payout subject. */
function calcFor(plan: GoalPlan, period: CyclePeriod, cycle: PerformanceCycle, lines: readonly ResultLine[], adjustmentPct: number, data: ResultData): ResultCalc {
  const levels = cycle.ratingScaleId === null ? [] : data.RatingLevel.filter((l) => l.ratingScaleId === cycle.ratingScaleId);
  return computeResult(lines, adjustmentPct, levels, data.PayoutRule, payoutSubject(plan, period, data), period.endDate);
}

/** Replace a result's detail rows with `calc`'s. */
function replaceDetails(changes: ResultChanges, result: PeriodResult, calc: ResultCalc, data: ResultData, ids: ResultIds): void {
  changes.removedDetailIds.push(...data.ResultDetail.filter((d) => d.resultId === result.id).map((d) => d.id));
  changes.addedDetails.push(...calc.details.map((d) => ({ id: ids.detail(result.id, d.goalId), tenantId: result.tenantId, resultId: result.id, ...d })));
}

const emptyChanges = (): ResultChanges => ({ results: [], removedDetailIds: [], addedDetails: [] });

/**
 * `calculateResults` — a Draft per eligible plan of the period's cycle (Approved / Locked): an
 * existing Draft keeps its id and adjustment and gets fresh details; a Final / Locked one is left
 * as it is. Refused with ERR-KPI-04 once the cycle is Closed.
 */
export function buildPeriodResults(data: ResultData, periodId: Id, ids: ResultIds): ResultOutcome {
  const ctx = periodContext(data, periodId);
  if (!ctx) return refuse('ERR-KPI-06', periodId, 'PERIOD_NOT_FOUND');
  const { period, cycle } = ctx;
  if (cycle.status === 'Closed') return refuse('ERR-KPI-04', cycle.id, 'CYCLE_CLOSED');
  const changes = emptyChanges();
  for (const plan of data.GoalPlan.filter((p) => p.cycleId === cycle.id && ELIGIBLE_PLAN.has(p.status))) {
    const existing = data.PeriodResult.find((r) => r.periodId === period.id && r.goalPlanId === plan.id) ?? null;
    if (existing && !canRecalculate(existing.status)) continue;
    const lines = planLines(plan, period, data);
    if (lines === null) continue;
    const adjustmentPct = existing?.adjustmentPct ?? 0;
    const calc = calcFor(plan, period, cycle, lines, adjustmentPct, data);
    const row: PeriodResult = {
      id: existing?.id ?? ids.result(period.id, plan.id),
      tenantId: plan.tenantId,
      periodId: period.id,
      goalPlanId: plan.id,
      ownerType: plan.ownerType,
      totalScore: calc.adjusted,
      ratingLevelId: calc.ratingLevelId,
      payoutPct: calc.payoutPct,
      adjustmentPct,
      status: 'Draft',
      finalizedAt: null,
    };
    changes.results.push({ row, created: existing === null });
    replaceDetails(changes, row, calc, data, ids);
  }
  return { ok: true, changes };
}

/** The plan, period and cycle of a stored result. */
function resultContext(result: PeriodResult, data: ResultData) {
  const plan = data.GoalPlan.find((p) => p.id === result.goalPlanId);
  const ctx = periodContext(data, result.periodId);
  return plan && ctx ? { plan, ...ctx } : null;
}

/**
 * `setAdjustment` — the adjustment re-scores the result from its STORED details (what HR is looking
 * at, not live actuals): the new total, and the rating and payout it now earns (an adjustment that
 * crosses a level boundary re-rates). Draft only (ERR-KPI-04); a non-finite number is ERR-KPI-06.
 */
export function applyAdjustment(data: ResultData, resultId: Id, adjustmentPct: number): ResultOutcome {
  const result = data.PeriodResult.find((r) => r.id === resultId);
  if (!result) return refuse('ERR-KPI-02', resultId, 'RESULT_NOT_FOUND');
  const decision = canAdjust(result.status);
  if (!decision.ok) return refuse(decision.code, resultId, decision.detail);
  if (typeof adjustmentPct !== 'number' || !Number.isFinite(adjustmentPct)) return refuse('ERR-KPI-06', resultId, 'ADJUSTMENT_INVALID');
  const ctx = resultContext(result, data);
  if (!ctx) return refuse('ERR-KPI-02', resultId, 'RESULT_NOT_FOUND');
  if (ctx.cycle.status === 'Closed') return refuse('ERR-KPI-04', ctx.cycle.id, 'CYCLE_CLOSED');
  const lines: ResultLine[] = data.ResultDetail.filter((d) => d.resultId === resultId).map((d) => ({
    goalId: d.goalId,
    weight: d.weight,
    status: 'Active',
    achievementPct: d.achievementPct,
    notComputable: null,
  }));
  const calc = calcFor(ctx.plan, ctx.period, ctx.cycle, lines, adjustmentPct, data);
  const row: PeriodResult = { ...result, adjustmentPct, totalScore: calc.adjusted, ratingLevelId: calc.ratingLevelId, payoutPct: calc.payoutPct };
  return { ok: true, changes: { results: [{ row, created: false }], removedDetailIds: [], addedDetails: [] } };
}

/**
 * `finalizeResults` — the selected Drafts (all of the period's when `resultIds` is omitted) are
 * recomputed from the CURRENT data, keeping their adjustment, and checked with `finalizeCheck`. ALL
 * OR NONE: if any has an issue, nothing is written and every issue of every result is returned.
 * Otherwise each becomes Final at `now` with its score rounded once.
 */
export function finalizePeriodResults(
  data: ResultData,
  periodId: Id,
  resultIds: readonly Id[] | undefined,
  now: IsoDateTime,
  ids: ResultIds,
): ResultOutcome {
  const ctx = periodContext(data, periodId);
  if (!ctx) return refuse('ERR-KPI-06', periodId, 'PERIOD_NOT_FOUND');
  if (ctx.cycle.status === 'Closed') return refuse('ERR-KPI-04', ctx.cycle.id, 'CYCLE_CLOSED');
  let selected: PeriodResult[];
  if (resultIds === undefined) {
    selected = data.PeriodResult.filter((r) => r.periodId === periodId && r.status === 'Draft');
  } else {
    selected = [];
    for (const id of new Set(resultIds)) {
      const result = data.PeriodResult.find((r) => r.id === id);
      if (!result) return refuse('ERR-KPI-02', id, 'RESULT_NOT_FOUND');
      if (result.periodId !== periodId) return refuse('ERR-KPI-06', id, 'RESULT_OTHER_PERIOD');
      const decision = canTransition(result.status, 'Final');
      if (!decision.ok) return refuse(decision.code, id, decision.detail);
      selected.push(result);
    }
  }
  if (selected.length === 0) return refuse('ERR-KPI-04', periodId, 'NO_DRAFT');

  const issues: RuleIssue[] = [];
  const changes = emptyChanges();
  for (const result of selected) {
    const plan = data.GoalPlan.find((p) => p.id === result.goalPlanId) as GoalPlan;
    // A plan sent back to Draft since the Draft result was calculated is no longer eligible.
    const lines = ELIGIBLE_PLAN.has(plan.status) ? planLines(plan, ctx.period, data) : null;
    if (lines === null) {
      issues.push(ruleIssue('ERR-KPI-04', plan.id, 'NOT_ELIGIBLE', { resultId: result.id }));
      continue;
    }
    issues.push(...finalizeCheck(lines, result.id));
    const calc = calcFor(plan, ctx.period, ctx.cycle, lines, result.adjustmentPct, data);
    const row: PeriodResult = {
      ...result,
      totalScore: calc.rated,
      ratingLevelId: calc.ratingLevelId,
      payoutPct: calc.payoutPct,
      status: 'Final',
      finalizedAt: now,
    };
    changes.results.push({ row, created: false });
    replaceDetails(changes, row, calc, data, ids);
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, changes };
}

/** `lockResults` — the period's Final results become Locked; Drafts stay. None Final → ERR-KPI-04. */
export function lockPeriodResults(data: ResultData, periodId: Id): ResultOutcome {
  const finals = data.PeriodResult.filter((r) => r.periodId === periodId && r.status === 'Final');
  if (finals.length === 0) return refuse('ERR-KPI-04', periodId, 'NO_FINAL');
  return {
    ok: true,
    changes: { results: finals.map((r) => ({ row: { ...r, status: 'Locked' as const }, created: false })), removedDetailIds: [], addedDetails: [] },
  };
}

/** The lines of a stored result's plan right now — what `finalizeCheck` will see (screens, seed). */
export function currentLinesOf(data: ResultData, result: PeriodResult): ResultLine[] | null {
  const ctx = resultContext(result, data);
  return ctx ? planLines(ctx.plan, ctx.period, data) : null;
}
