import type { Aggregation, CalcMethodType, Goal, GoalPeriodTarget, Id } from '@/data/types';

/**
 * The simulated ERP Sale connector (WBS 4.4.5) — what "the ERP" answers for one goal in one month.
 * DATA, not a calculation: a stand-in for a system Syntra does not have yet (Q16 — ERP Sale is an
 * invented sample). Deterministic in (goal, period), so the same sync twice reads the same numbers
 * and a test can rely on them.
 *
 * - TEXT goal → "Đạt".
 * - NUMERIC goal → a value between 85% and 115% of the MONTH's target: the goal's split for the
 *   month; without a split, the goal's target for a ratio / level KPI (AVG, LAST — a ratio's monthly
 *   target is its target) and nothing for a SUM KPI (its target is the year's; reading 115% of a
 *   year as one month would be nonsense). No numeric target → `null` (the sync skips the goal).
 * - RATIO_DOWN never reads below 1: an actual of 0 scores the cap (BR-KPI-32), which a simulated
 *   reading must not hand out by accident.
 */
export function simulatedErpReading(input: {
  goal: Pick<Goal, 'id' | 'targetType' | 'targetValue'>;
  periodId: Id;
  periodTargets: readonly GoalPeriodTarget[];
  aggregation: Aggregation | null;
  methodType: CalcMethodType;
}): { actualValue: number | null; actualText: string | null } | null {
  const { goal, periodId } = input;
  if (goal.targetType === 'TEXT') return { actualValue: null, actualText: 'Đạt' };
  const split = input.periodTargets.find((t) => t.goalId === goal.id && t.periodId === periodId);
  const target = split ? split.targetValue : input.aggregation === 'SUM' ? null : goal.targetValue;
  if (target === null || !Number.isFinite(target)) return null;
  const raw = target * (0.85 + 0.3 * unitHash(`${goal.id}|${periodId}`));
  const value = Math.abs(raw) >= 1000 ? Math.round(raw) : Math.round(raw * 100) / 100;
  return { actualValue: input.methodType === 'RATIO_DOWN' ? Math.max(1, value) : value, actualText: null };
}

/** A number in [0, 1) from a string — FNV-1a, so the reading is the same on every run. */
function unitHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}
