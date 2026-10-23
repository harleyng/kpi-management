/**
 * Cumulative (lũy kế) tracking — PEND-05, `ASSUMPTION Q51`; plan `KPI_update_plan_2210.md` §6.
 *
 * "Lũy kế đến kỳ P" = the goal's monthly figures from the cycle's first month to the last month of P,
 * added up by the KPI's aggregation: SUM → running sum, AVG → mean of the months that have a number,
 * LAST → the latest number. A month with no actual is never 0: the figure is computed from the months
 * that have one and flagged incomplete. Two comparisons, both through `calcRules.achievement`:
 * - on track — cumulative actual against the cumulative target (the splits of the same months);
 * - year progress — cumulative actual against the annual target (the goal's own target).
 *
 * Actuals are monthly only (Q36), so the window is always a run of months. A goal that rolls up from
 * its children (Q8), a TEXT goal and a goal typed in without a library aggregation are not cumulated.
 */

import type { Aggregation, CalcMethod, CalcTier, CyclePeriod, Goal, GoalActual, GoalPeriodTarget, GoalTargetLevel, Id, PeriodType } from '@/data/types';
import { achievement, targetForPeriod, type Achievement } from './calcRules';

// ─── The window ────────────────────────────────────────────────────────────────────────────────

const byStart = (a: CyclePeriod, b: CyclePeriod) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0);

/** The cycle's months from its start up to the end of `upTo`, in calendar order. Other cycles' months are left out. */
export function cumulativeMonths(upTo: CyclePeriod, periods: readonly CyclePeriod[]): CyclePeriod[] {
  return periods.filter((p) => p.periodType === 'Month' && p.cycleId === upTo.cycleId && p.endDate <= upTo.endDate).sort(byStart);
}

// ─── Running figures ───────────────────────────────────────────────────────────────────────────

export interface RunningFigure {
  /** `null` when no month in the window has a number. */
  value: number | null;
  /** Months in the window with a number / months in the window. */
  monthsWithData: number;
  monthsInWindow: number;
  /** SUM / AVG: every month has a number. LAST: the window's last month has one. */
  complete: boolean;
}

/**
 * The running figure of monthly values (in calendar order) by `aggregation`; `null` entries are missing months.
 * Deliberately NOT `scoreRules.aggregatePeriodActuals`, which gives `null` on any gap: a period result needs
 * every month, while a running figure is shown from the months that have a number, flagged incomplete (Q51).
 */
export function runningFigure(values: readonly (number | null)[], aggregation: Aggregation): RunningFigure {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const base = { monthsWithData: present.length, monthsInWindow: values.length };
  if (present.length === 0) return { value: null, ...base, complete: false };
  if (aggregation === 'LAST') {
    const last = values[values.length - 1];
    return { value: present[present.length - 1], ...base, complete: last !== null && Number.isFinite(last) };
  }
  const sum = present.reduce((s, v) => s + v, 0);
  return { value: aggregation === 'SUM' ? sum : sum / present.length, ...base, complete: present.length === values.length };
}

const currentValue = (goalId: Id, periodId: Id, actuals: readonly GoalActual[]): number | null =>
  actuals.find((a) => a.isCurrent && a.goalId === goalId && a.periodId === periodId)?.actualValue ?? null;

/** The cumulative actual of a NUMERIC goal over `months` (BR-KPI-52: only the current snapshot counts). */
export function cumulativeActual(goal: Goal, months: readonly CyclePeriod[], actuals: readonly GoalActual[], aggregation: Aggregation): RunningFigure {
  return runningFigure(
    months.map((m) => currentValue(goal.id, m.id, actuals)),
    aggregation,
  );
}

// ─── Cumulative target ─────────────────────────────────────────────────────────────────────────

const splitOf = (goalId: Id, periodId: Id, periodTargets: readonly GoalPeriodTarget[]) =>
  periodTargets.find((t) => t.goalId === goalId && t.periodId === periodId)?.targetValue ?? null;

/** Periods of `type` in the cycle that tile `months` exactly, in order — or `null` when they do not. */
function tiling(type: PeriodType, months: readonly CyclePeriod[], periods: readonly CyclePeriod[]): CyclePeriod[] | null {
  const first = months[0];
  const last = months[months.length - 1];
  const tiles = periods
    .filter((p) => p.periodType === type && p.cycleId === first.cycleId && p.startDate >= first.startDate && p.endDate <= last.endDate)
    .sort(byStart);
  if (tiles.length === 0) return null;
  // Every window month must sit inside exactly one tile.
  const covered = months.every((m) => tiles.filter((t) => m.startDate >= t.startDate && m.endDate <= t.endDate).length === 1);
  return covered ? tiles : null;
}

/**
 * The target for the same window, added up the same way:
 * - SUM — the splits of the window's months; else the splits of the quarters (then halves) that tile
 *   the window exactly (PEND-04 splits a year into quarters); else, for a window that is the whole
 *   cycle, the annual target. Otherwise `null` — a SUM target is never prorated by guesswork.
 * - AVG — the mean of each month's target (its split, else the goal's own, as `targetForPeriod`).
 * - LAST — the target of the window's last month.
 * `allMonths` = every month of the cycle, to recognise the whole-cycle window.
 */
export function cumulativeTarget(
  goal: Goal,
  months: readonly CyclePeriod[],
  allMonths: readonly CyclePeriod[],
  periods: readonly CyclePeriod[],
  periodTargets: readonly GoalPeriodTarget[],
  aggregation: Aggregation,
): number | null {
  if (months.length === 0) return null;
  if (aggregation === 'LAST') return targetForPeriod(goal, periodTargets, months[months.length - 1].id);
  if (aggregation === 'AVG') {
    const targets = months.map((m) => targetForPeriod(goal, periodTargets, m.id));
    if (targets.some((t) => t === null)) return null;
    return (targets as number[]).reduce((s, t) => s + t, 0) / targets.length;
  }
  for (const type of ['Month', 'Quarter', 'Half'] as const) {
    const tiles = type === 'Month' ? [...months] : tiling(type, months, periods);
    if (!tiles) continue;
    const splits = tiles.map((t) => splitOf(goal.id, t.id, periodTargets));
    if (splits.every((s) => s !== null)) return (splits as number[]).reduce((s, t) => s + t, 0);
  }
  return months.length === allMonths.length ? goal.targetValue : null;
}

// ─── Cumulative achievement ────────────────────────────────────────────────────────────────────

/** Why a goal has no cumulative figure at all. */
export type CumulativeSkip = 'TEXT_GOAL' | 'NO_AGGREGATION' | 'ROLL_UP' | 'NO_MONTHS';

export interface CumulativeContext {
  /** The period the window ends with — a month, quarter, half or the year. */
  upTo: CyclePeriod;
  /** The cycle's periods (other cycles' are ignored). */
  periods: readonly CyclePeriod[];
  actuals: readonly GoalActual[];
  periodTargets: readonly GoalPeriodTarget[];
  /** The KPI's aggregation (`KpiDefinition.aggregation`); `null` for a goal typed in without one. */
  aggregation: Aggregation | null;
  tiers: readonly CalcTier[];
  levels: readonly GoalTargetLevel[];
}

export type CumulativeResult =
  | { status: 'SKIPPED'; reason: CumulativeSkip }
  | {
      status: 'COMPUTED';
      actual: RunningFigure;
      /** The cumulative target; `null` when the splits do not cover the window. */
      target: number | null;
      annualTarget: number | null;
      /** Cumulative actual vs cumulative target. */
      onTrack: Achievement;
      /** Cumulative actual vs the annual target. */
      yearProgress: Achievement;
      /**
       * A month of the window has no actual (`actual.complete` false): both achievements compare a partial
       * figure with the whole window's target, so the screen must label them "tạm tính" — never as final.
       */
      provisional: boolean;
    };

/**
 * The cumulative actual, target and both achievements of one goal up to `ctx.upTo`. The method's
 * floor and cap apply as for any period (BR-KPI-31). TIERED and LEVELS read their bands as they are —
 * for a SUM KPI that is a running sum against annual bands, so read their "on track" with care.
 */
export function cumulativeAchievement(goal: Goal, method: CalcMethod, ctx: CumulativeContext): CumulativeResult {
  if (goal.targetType === 'TEXT') return { status: 'SKIPPED', reason: 'TEXT_GOAL' };
  if (goal.rollUpFromChildren) return { status: 'SKIPPED', reason: 'ROLL_UP' };
  if (ctx.aggregation === null) return { status: 'SKIPPED', reason: 'NO_AGGREGATION' };
  const months = cumulativeMonths(ctx.upTo, ctx.periods);
  if (months.length === 0) return { status: 'SKIPPED', reason: 'NO_MONTHS' };

  const allMonths = ctx.periods.filter((p) => p.periodType === 'Month' && p.cycleId === ctx.upTo.cycleId);
  const actual = cumulativeActual(goal, months, ctx.actuals, ctx.aggregation);
  const target = cumulativeTarget(goal, months, allMonths, ctx.periods, ctx.periodTargets, ctx.aggregation);
  const against = (targetValue: number | null): Achievement =>
    achievement(method, {
      targetType: goal.targetType,
      targetValue,
      targetText: null,
      actualValue: actual.value,
      actualText: null,
      tiers: ctx.tiers.filter((t) => t.calcMethodId === goal.calcMethodId),
      levels: ctx.levels.filter((l) => l.goalId === goal.id),
    });
  return {
    status: 'COMPUTED',
    actual,
    target,
    annualTarget: goal.targetValue,
    onTrack: against(target),
    yearProgress: against(goal.targetValue),
    provisional: !actual.complete,
  };
}
