/**
 * What a form needs before it may move on — `canSubmit` (D6, BR-KPI-18) — and the evaluation form's
 * own arithmetic. The step's configuration (`evaluationColumn`, `requiresComment`) decides what is
 * required, never a hard-coded step number.
 *
 * The evaluation columns (BR-KPI-16, PEND-06/07/08): the SELF column is the SYSTEM's % —
 * `calcRules.achievement` on the actual entered on the form and the period's target — never typed;
 * the MANAGER column starts at it and the manager decides (a different % needs a comment); the FINAL
 * column starts at the manager's and HR records it (a different % needs a reason).
 */

import type { CalcMethod, CalcTier, CyclePeriod, EvaluationColumn, EvaluationItem, Goal, GoalChangeItem, GoalTargetLevel, Id, Kgi, WorkflowStep } from '@/data/types';
import { entryBlockers, type ActualEntryInput } from './actualRules';
import { achievement, type Achievement } from './calcRules';
import { ruleIssue, type RuleIssue } from './errorCatalog';
import { changeItemIssues, ownerStepNo, planAfterChanges, submitIssues, weightIssue } from './goalPlanRules';
import { weightedScore, type WeightedScore } from './scoreRules';
import { planSubmitIssues, type PlannedTask } from './workRules';

/** The two fields of an evaluation item one column owns. */
export const COLUMN_FIELDS = {
  SELF: { pct: 'selfAchievementPct', comment: 'selfComment' },
  MANAGER: { pct: 'managerAchievementPct', comment: 'managerComment' },
  FINAL: { pct: 'finalAchievementPct', comment: 'finalComment' },
} as const satisfies Record<EvaluationColumn, { pct: keyof EvaluationItem; comment: keyof EvaluationItem }>;

export const columnPct = (item: EvaluationItem, column: EvaluationColumn): number | null => item[COLUMN_FIELDS[column].pct];
export const columnComment = (item: EvaluationItem, column: EvaluationColumn): string | null => item[COLUMN_FIELDS[column].comment];

export type CanSubmitInput =
  | { formType: 'KPI_EVAL'; step: WorkflowStep; items: readonly EvaluationItem[]; goals: readonly Goal[] }
  | { formType: 'GOAL_SETTING'; stepNo: number; steps: readonly WorkflowStep[]; goals: readonly Goal[]; kgis: readonly Kgi[] }
  | { formType: 'GOAL_CHANGE'; goals: readonly Goal[]; changeItems: readonly GoalChangeItem[]; kgis: readonly Kgi[] }
  /** Monthly work plan (PEND-14, 8.2): the plan's tasks and its month. `period` null = the form names none. */
  | { formType: 'WORK_PLAN'; stepNo: number; steps: readonly WorkflowStep[]; tasks: readonly PlannedTask[]; period: Pick<CyclePeriod, 'startDate' | 'endDate'> | null }
  /** Monthly work review: `workRules.reviewSubmitIssues`, wired with `forms.act` in 8.3. */
  | { formType: 'WORK_REVIEW' };

export type CanSubmitResult = { ok: true } | { ok: false; issues: RuleIssue[] };

const result = (issues: RuleIssue[]): CanSubmitResult => (issues.length ? { ok: false, issues } : { ok: true });
const blank = (text: string | null) => text === null || text.trim() === '';

// ─── The system's % (PEND-07) ──────────────────────────────────────────────────────────────────

/** The column the system computes (`computedItemPct`); nobody types it (ERR-KPI-04 `SYSTEM_COLUMN`). */
export const SYSTEM_COLUMN: EvaluationColumn = 'SELF';

/** Two %s closer than this are the same score: a default copied unrounded, 83.33 typed for 83.3333. */
export const PCT_TOLERANCE = 0.005;

/** Whether two %s are the same score (`PCT_TOLERANCE`); `null` equals only `null`. */
export function samePct(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= PCT_TOLERANCE + 1e-9;
}

/** What the system's % of one item reads besides the item: its goal and the goal's method. */
export interface ItemCalcContext {
  goal: Pick<Goal, 'id' | 'targetType' | 'targetText' | 'calcMethodId'>;
  method: CalcMethod | null;
  /** May hold other methods' tiers / other goals' levels: filtered here. */
  tiers: readonly CalcTier[];
  levels: readonly GoalTargetLevel[];
}

/**
 * PEND-07 — the item's achievement by its goal's method (`calcRules.achievement`), on the actual
 * entered ON THE FORM and the period's target snapshotted when it opened (`targetSnapshot`, BR-KPI-11).
 * No actual → NO_ACTUAL; data that cannot give an answer → NOT_COMPUTABLE — never 0 (BR-KPI-32).
 */
export function computedItemAchievement(
  item: Pick<EvaluationItem, 'actualValue' | 'actualText' | 'targetSnapshot'>,
  ctx: ItemCalcContext,
): Achievement {
  if (!ctx.method) return { status: 'NOT_COMPUTABLE', reason: 'INVALID_VALUE' };
  const methodId = ctx.method.id;
  return achievement(ctx.method, {
    targetType: ctx.goal.targetType,
    targetValue: item.targetSnapshot,
    targetText: ctx.goal.targetText,
    actualValue: item.actualValue,
    actualText: item.actualText,
    tiers: ctx.tiers.filter((t) => t.calcMethodId === methodId),
    levels: ctx.levels.filter((l) => l.goalId === ctx.goal.id),
  });
}

/** The system's %, or `null` for both "no actual" and "not computable" (never 0). */
export function computedItemPct(item: Pick<EvaluationItem, 'actualValue' | 'actualText' | 'targetSnapshot'>, ctx: ItemCalcContext): number | null {
  const computed = computedItemAchievement(item, ctx);
  return computed.status === 'SCORED' ? computed.pct : null;
}

/**
 * The item after its actual changes (PEND-06): the system's % recomputed; the manager's % follows it
 * while it still equals the old system % (the default, not an override) — whatever the step, so a
 * form returned to the employee does not turn the old default into an override.
 */
export function withFormActual(
  item: EvaluationItem,
  actual: { actualValue: number | null; actualText: string | null },
  computedPct: number | null,
  enteredBy: Id,
): EvaluationItem {
  const follows = item.managerAchievementPct !== null && samePct(item.managerAchievementPct, item.selfAchievementPct);
  return {
    ...item,
    actualValue: actual.actualValue,
    actualText: actual.actualText,
    actualEnteredBy: enteredBy,
    selfAchievementPct: computedPct,
    managerAchievementPct: follows ? computedPct : item.managerAchievementPct,
  };
}

/** Whether the form's actual is the one already stored (a resent unchanged value is not a change). */
export function sameActual(
  a: { actualValue: number | null; actualText: string | null },
  b: { actualValue: number | null; actualText: string | null },
): boolean {
  const text = (t: string | null) => (t === null || t.trim() === '' ? null : t.trim());
  return a.actualValue === b.actualValue && text(a.actualText) === text(b.actualText);
}

/**
 * What entering a step does to the items (PEND-07/08), driven by the step's column, never its number:
 * - always: the system's % is recomputed (a method edited since the last save cannot leave it stale);
 * - leaving the SELF column: the form's actual is kept as the employee's submitted one;
 * - entering MANAGER: an empty manager % starts at the system's (one that followed it keeps following);
 * - entering FINAL from another column: FINAL = MANAGER and its reason is cleared — HR records the
 *   manager's result; an override HR made before a return is dropped.
 * Returns only the items that change.
 */
export function itemsOnEnterColumn(
  items: readonly EvaluationItem[],
  entered: EvaluationColumn,
  left: EvaluationColumn | null,
  computed: ReadonlyMap<Id, number | null>,
): EvaluationItem[] {
  const changed: EvaluationItem[] = [];
  for (const item of items) {
    const system = computed.has(item.id) ? (computed.get(item.id) as number | null) : item.selfAchievementPct;
    const follows = item.managerAchievementPct !== null && samePct(item.managerAchievementPct, item.selfAchievementPct);
    const next: EvaluationItem = { ...item, selfAchievementPct: system };
    if (follows) next.managerAchievementPct = system;
    if (left === 'SELF' && entered !== 'SELF') {
      next.submittedActualValue = item.actualValue;
      next.submittedActualText = item.actualText;
    }
    if (entered === 'MANAGER' && next.managerAchievementPct === null) next.managerAchievementPct = system;
    if (entered === 'FINAL' && left !== 'FINAL') {
      next.finalAchievementPct = next.managerAchievementPct;
      next.finalComment = null;
    }
    const keys = Object.keys(next) as (keyof EvaluationItem)[];
    if (keys.some((k) => next[k] !== item[k])) changed.push(next);
  }
  return changed;
}

/**
 * The manager's decisions that need a comment (Q49): a % that is not the system's (also when the
 * system has none), and an actual changed after the employee submitted it. ERR-KPI-06, ref = item.
 */
export function managerOverrideIssues(items: readonly EvaluationItem[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  for (const item of items) {
    if (!blank(item.managerComment)) continue;
    if (item.managerAchievementPct !== null && !samePct(item.managerAchievementPct, item.selfAchievementPct)) {
      issues.push(ruleIssue('ERR-KPI-06', item.id, 'OVERRIDE_COMMENT_REQUIRED'));
    } else if (!sameActual(item, { actualValue: item.submittedActualValue, actualText: item.submittedActualText })) {
      issues.push(ruleIssue('ERR-KPI-06', item.id, 'ACTUAL_CHANGE_COMMENT_REQUIRED'));
    }
  }
  return issues;
}

/** HR's FINAL % that is not the manager's needs a reason (Q47, PEND-08). ERR-KPI-06, ref = item. */
export function finalOverrideIssues(items: readonly EvaluationItem[]): RuleIssue[] {
  return items
    .filter((i) => i.finalAchievementPct !== null && !samePct(i.finalAchievementPct, i.managerAchievementPct) && blank(i.finalComment))
    .map((i) => ruleIssue('ERR-KPI-06', i.id, 'OVERRIDE_REASON_REQUIRED'));
}

/** The details of `actualRules.entryBlockers` that also stop an actual being entered ON A FORM. */
const FORM_ACTUAL_BLOCKERS = ['PERIOD_LOCKED', 'RESULT_FINAL', 'PERIOD_NOT_IN_CYCLE', 'PERIOD_NOT_STARTED'];

/**
 * Why the actual on the form cannot change (PEND-06): the period is locked, its result already Final
 * (04), outside the cycle, not started (06) — `actualRules.entryBlockers`, minus what the form already
 * settles (its plan was agreed, its goals were Active when it opened, a quarter form takes a quarter's
 * figure); then the type: a NUMERIC goal takes a finite number, a TEXT goal text (06
 * ACTUAL_TYPE_MISMATCH). Clearing it (`null`, blank) is allowed: no actual, never 0.
 */
export function formActualIssues(
  actual: { actualValue: number | null; actualText: string | null },
  input: Omit<ActualEntryInput, 'actual' | 'planStatus'>,
): RuleIssue[] {
  const issues = entryBlockers({ ...input, planStatus: 'Locked' }).filter((i) => FORM_ACTUAL_BLOCKERS.includes(i.detail ?? ''));
  const hasNumber = actual.actualValue !== null;
  const hasText = !blank(actual.actualText);
  const fits =
    input.goal.targetType === 'NUMERIC'
      ? !hasText && (!hasNumber || (typeof actual.actualValue === 'number' && Number.isFinite(actual.actualValue)))
      : !hasNumber;
  if (!fits) issues.push(ruleIssue('ERR-KPI-06', 'actual', 'ACTUAL_TYPE_MISMATCH', { targetType: input.goal.targetType }));
  return issues;
}

/**
 * Whether SUBMIT / APPROVE may go ahead (RETURN and CANCEL never need it):
 * - KPI_EVAL — the goals on the form weigh 100% (ERR-KPI-07); every item has, when the step requires
 *   one, a comment; at a MANAGER / FINAL step every item has the column's % (ERR-KPI-09, `ref` = item)
 *   and each override is explained (`managerOverrideIssues`, `finalOverrideIssues`). The SELF column
 *   is the system's: an item with no actual has no %, and the form still goes on (its total "tạm tính").
 * - GOAL_SETTING — from the owner's step on, the plan passes `submitIssues` (100%, 5–8 goals, every
 *   goal measurable). Before it (the manager cascading at step 1) the plan is still being built.
 * - GOAL_CHANGE — the proposal is well-formed and the plan AFTER it still passes `submitIssues`.
 * - WORK_PLAN — from the employee's step on, `workRules.planSubmitIssues` (a task, weights at 100%, dates
 *   that touch the month). Before it (a manager assigning first, top-down) the list is still being built.
 * - WORK_REVIEW — not wired yet (ERR-KPI-04 `WORK_FORM_NOT_BUILT`, step 8.3).
 */
export function canSubmit(input: CanSubmitInput): CanSubmitResult {
  switch (input.formType) {
    case 'KPI_EVAL': {
      const issues: RuleIssue[] = [];
      const goalIds = new Set(input.items.map((i) => i.goalId));
      const weight = weightIssue(input.goals.filter((g) => goalIds.has(g.id)));
      if (weight) issues.push(weight);
      const column = input.step.evaluationColumn;
      if (column) {
        for (const item of input.items) {
          const pct = columnPct(item, column);
          if (column !== SYSTEM_COLUMN && (pct === null || !Number.isFinite(pct))) {
            issues.push(ruleIssue('ERR-KPI-09', item.id, 'SCORE_MISSING', { column }));
          } else if (input.step.requiresComment && blank(columnComment(item, column))) {
            issues.push(ruleIssue('ERR-KPI-09', item.id, 'COMMENT_MISSING', { column }));
          }
        }
        if (column === 'MANAGER') issues.push(...managerOverrideIssues(input.items));
        if (column === 'FINAL') issues.push(...finalOverrideIssues(input.items));
      }
      return result(issues);
    }
    case 'GOAL_SETTING':
      if (input.stepNo < ownerStepNo(input.steps)) return { ok: true };
      return result(submitIssues(input.goals, input.kgis).blocking);
    case 'GOAL_CHANGE': {
      if (input.changeItems.length === 0) return result([ruleIssue('ERR-KPI-06', null, 'NO_CHANGES')]);
      const itemIssues = changeItemIssues(input.goals, input.changeItems);
      if (itemIssues.length) return result(itemIssues);
      return result(submitIssues(planAfterChanges([...input.goals], input.changeItems), input.kgis).blocking);
    }
    case 'WORK_PLAN':
      if (input.stepNo < ownerStepNo(input.steps)) return { ok: true };
      if (input.period === null) return result([ruleIssue('ERR-KPI-06', 'periodId', 'PERIOD_REQUIRED')]);
      return result(planSubmitIssues(input.tasks, input.period));
    case 'WORK_REVIEW':
      return result([ruleIssue('ERR-KPI-04', null, 'WORK_FORM_NOT_BUILT')]);
  }
}

/**
 * The highest % a person may type for a goal: the method's cap; without one (LEVELS, TIERED, BINARY)
 * the most the method can award — its top tier, the goal's top level — and never less than 100.
 */
export function scoreCeiling(method: Pick<CalcMethod, 'id' | 'capPct'> | null, tiers: readonly CalcTier[], levels: readonly GoalTargetLevel[]): number {
  if (method?.capPct != null) return method.capPct;
  const awards = [
    ...tiers.filter((t) => method !== null && t.calcMethodId === method.id).map((t) => t.achievementPct),
    ...levels.map((l) => l.scorePct),
  ];
  return Math.max(100, ...awards);
}

/**
 * A % typed into an evaluation column: a finite number from 0 up to the goal's method cap — or, given
 * the goal's `limits`, up to `scoreCeiling` when the method has no cap. `null` clears the cell and is
 * always accepted while saving a draft.
 */
export function validateScoreInput(
  pct: number | null,
  method: Pick<CalcMethod, 'id' | 'capPct'> | null,
  limits?: { tiers: readonly CalcTier[]; levels: readonly GoalTargetLevel[] },
): RuleIssue | null {
  if (pct === null) return null;
  const cap = method?.capPct ?? (limits ? scoreCeiling(method, limits.tiers, limits.levels) : null);
  if (!Number.isFinite(pct) || pct < 0 || (cap !== null && pct > cap)) {
    return ruleIssue('ERR-KPI-06', null, 'SCORE_OUT_OF_RANGE', cap === null ? { min: 0 } : { min: 0, max: cap });
  }
  return null;
}

/**
 * The evaluation form's footer total for one column (plan §5.5) — the same arithmetic as the result.
 * An item whose goal is not in `goals` counts as missing (never silently dropped).
 */
export function evaluationTotal(items: readonly EvaluationItem[], goals: readonly Goal[], column: EvaluationColumn): WeightedScore {
  const byId = new Map(goals.map((g) => [g.id, g]));
  return weightedScore(
    items.flatMap((item) => {
      const goal = byId.get(item.goalId);
      return goal
        ? [{ goalId: goal.id, weight: goal.weight, status: goal.status, achievementPct: columnPct(item, column) }]
        : [{ goalId: item.goalId, weight: 0, status: 'Active' as const, achievementPct: null }];
    }),
  );
}
