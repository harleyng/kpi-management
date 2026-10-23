import { describe, expect, it } from 'vitest';
import type { CyclePeriod, GoalActual } from '@/data/types';
import { TENANT, calcMethod, goal, months2027, period, periodTarget } from '@/test/builders';
import {
  cumulativeAchievement,
  cumulativeActual,
  cumulativeMonths,
  cumulativeTarget,
  runningFigure,
  type CumulativeContext,
} from './cumulativeRules';

const months = months2027();
const quarter = (n: 1 | 2 | 3 | 4): CyclePeriod => {
  const first = months[(n - 1) * 3];
  const last = months[n * 3 - 1];
  return period({ id: `Q${n}`, label: `Q${n}`, periodType: 'Quarter', startDate: first.startDate, endDate: last.endDate });
};
const year = period({ id: 'Y', label: '2027', periodType: 'Year', startDate: '2027-01-01', endDate: '2027-12-31' });
const otherCycleMonth = period({ id: 'T12-2026', cycleId: 'c2026', startDate: '2026-12-01', endDate: '2026-12-31' });
const periods = [...months, quarter(1), quarter(2), quarter(3), quarter(4), year, otherCycleMonth];
const T = (n: number) => months[n - 1];

const actual = (periodId: string, actualValue: number | null, o: Partial<GoalActual> = {}): GoalActual => ({
  id: `a-${periodId}-${o.recordedAt ?? 'x'}`, tenantId: TENANT, goalId: 'g1', periodId, actualValue, actualText: null,
  sourceType: 'MANUAL', batchId: null, syncRunId: null, enteredBy: null, note: null, recordedAt: '2027-02-01T01:00:00.000Z', isCurrent: true, ...o,
});
const method = calcMethod({ methodType: 'RATIO_UP', capPct: 150 });

describe('cumulativeMonths — the cycle’s months up to the end of a period', () => {
  it('up to a month, a quarter and the year', () => {
    expect(cumulativeMonths(T(2), periods).map((m) => m.id)).toEqual(['T01', 'T02']);
    expect(cumulativeMonths(quarter(2), periods).map((m) => m.id)).toEqual(['T01', 'T02', 'T03', 'T04', 'T05', 'T06']);
    expect(cumulativeMonths(year, periods)).toHaveLength(12);
  });

  it('leaves out another cycle’s months', () => {
    expect(cumulativeMonths(T(1), periods).map((m) => m.id)).toEqual(['T01']);
  });
});

describe('runningFigure — by aggregation; a missing month is never 0', () => {
  it('SUM — the running sum', () => {
    expect(runningFigure([10, 20, 30], 'SUM')).toEqual({ value: 60, monthsWithData: 3, monthsInWindow: 3, complete: true });
  });

  it('SUM with a month missing — the months that have a number, flagged incomplete', () => {
    expect(runningFigure([10, null, 30], 'SUM')).toEqual({ value: 40, monthsWithData: 2, monthsInWindow: 3, complete: false });
  });

  it('AVG — the mean of the months that have a number', () => {
    expect(runningFigure([90, null, 80], 'AVG')).toEqual({ value: 85, monthsWithData: 2, monthsInWindow: 3, complete: false });
    expect(runningFigure([90, 70, 80], 'AVG').value).toBe(80);
  });

  it('LAST — the latest number; complete only when the last month has one', () => {
    expect(runningFigure([5, 7, 9], 'LAST')).toMatchObject({ value: 9, complete: true });
    expect(runningFigure([5, 7, null], 'LAST')).toMatchObject({ value: 7, complete: false });
  });

  it('no month with a number → null, never 0', () => {
    expect(runningFigure([null, null], 'SUM')).toMatchObject({ value: null, monthsWithData: 0, complete: false });
    expect(runningFigure([], 'AVG').value).toBeNull();
  });
});

describe('cumulativeActual — current snapshots only', () => {
  it('ignores a superseded snapshot', () => {
    const actuals = [actual('T01', 10), actual('T02', 999, { isCurrent: false, recordedAt: 'old' }), actual('T02', 20)];
    expect(cumulativeActual(goal(), [T(1), T(2)], actuals, 'SUM').value).toBe(30);
  });

  it('ignores another goal’s actuals', () => {
    expect(cumulativeActual(goal(), [T(1)], [actual('T01', 10, { goalId: 'g2' })], 'SUM').value).toBeNull();
  });
});

describe('cumulativeTarget — the same window, the same aggregation', () => {
  const g = goal({ targetValue: 120 });
  const monthly = months.map((m) => periodTarget({ id: `pt-${m.id}`, periodId: m.id, targetValue: 10 }));
  const target = (upTo: CyclePeriod, targets = monthly, agg: 'SUM' | 'AVG' | 'LAST' = 'SUM', gg = g) =>
    cumulativeTarget(gg, cumulativeMonths(upTo, periods), months, periods, targets, agg);

  it('SUM — the months’ splits', () => {
    expect(target(T(3))).toBe(30);
  });

  it('SUM — quarter splits when the months have none (PEND-04)', () => {
    const quarters = [periodTarget({ id: 'q1', periodId: 'Q1', targetValue: 25 }), periodTarget({ id: 'q2', periodId: 'Q2', targetValue: 35 })];
    expect(target(quarter(2), quarters)).toBe(60);
    // a window that ends mid-quarter cannot be tiled by quarters
    expect(target(T(4), quarters)).toBeNull();
  });

  it('SUM — the whole cycle falls back to the annual target; part of it is never prorated', () => {
    expect(target(year, [])).toBe(120);
    expect(target(T(6), [])).toBeNull();
  });

  it('AVG — the mean of each month’s target, the goal’s own where a month has none', () => {
    const someSplit = [periodTarget({ id: 'p1', periodId: 'T01', targetValue: 90 })];
    expect(target(T(2), someSplit, 'AVG', goal({ targetValue: 80 }))).toBe(85);
  });

  it('LAST — the last month’s target', () => {
    const last = [periodTarget({ id: 'p3', periodId: 'T03', targetValue: 7 })];
    expect(target(T(3), last, 'LAST')).toBe(7);
    expect(target(T(2), last, 'LAST')).toBe(120);
  });
});

describe('cumulativeAchievement — on track and year progress', () => {
  const ctx = (o: Partial<CumulativeContext> = {}): CumulativeContext => ({
    upTo: T(3), periods, actuals: [], periodTargets: [], aggregation: 'SUM', tiers: [], levels: [], ...o,
  });
  const monthlyTargets = months.map((m) => periodTarget({ id: `pt-${m.id}`, periodId: m.id, targetValue: 10 }));

  it('SUM over 3 months: 36 against 30 cumulative and 120 annual', () => {
    const result = cumulativeAchievement(goal({ targetValue: 120 }), method, ctx({
      actuals: [actual('T01', 10), actual('T02', 12), actual('T03', 14)], periodTargets: monthlyTargets,
    }));
    expect(result).toMatchObject({
      status: 'COMPUTED',
      actual: { value: 36, complete: true },
      target: 30,
      annualTarget: 120,
      onTrack: { status: 'SCORED', pct: 120 },
      yearProgress: { status: 'SCORED', pct: 30 },
      provisional: false,
    });
  });

  it('AVG with a month missing: the mean of the months that have a number, flagged incomplete', () => {
    const result = cumulativeAchievement(goal({ targetValue: 90 }), method, ctx({
      aggregation: 'AVG', actuals: [actual('T01', 90), actual('T03', 72)],
    }));
    expect(result).toMatchObject({ status: 'COMPUTED', actual: { value: 81, monthsWithData: 2, complete: false }, target: 90, onTrack: { pct: 90 } });
  });

  it('LAST: the latest stock against the last month’s target', () => {
    const result = cumulativeAchievement(goal({ targetValue: 50 }), method, ctx({ aggregation: 'LAST', actuals: [actual('T01', 80), actual('T03', 40)] }));
    expect(result).toMatchObject({ status: 'COMPUTED', actual: { value: 40, complete: true }, onTrack: { pct: 80 } });
  });

  it('SUM with a month missing: partial figure against the whole window, flagged provisional', () => {
    const result = cumulativeAchievement(goal({ targetValue: 120 }), method, ctx({ actuals: [actual('T01', 10)], periodTargets: monthlyTargets }));
    expect(result).toMatchObject({ actual: { value: 10, complete: false }, target: 30, provisional: true });
  });

  it('only superseded snapshots → no actual', () => {
    const result = cumulativeAchievement(goal(), method, ctx({ actuals: [actual('T01', 10, { isCurrent: false })], periodTargets: monthlyTargets }));
    expect(result).toMatchObject({ actual: { value: null }, onTrack: { status: 'NO_ACTUAL' }, provisional: true });
  });

  it('no actual yet → NO_ACTUAL, never 0', () => {
    const result = cumulativeAchievement(goal(), method, ctx({ periodTargets: monthlyTargets }));
    expect(result).toMatchObject({ status: 'COMPUTED', actual: { value: null }, onTrack: { status: 'NO_ACTUAL' }, yearProgress: { status: 'NO_ACTUAL' } });
  });

  it('no cumulative target → on track not computable, year progress still shown', () => {
    const result = cumulativeAchievement(goal({ targetValue: 120 }), method, ctx({ actuals: [actual('T01', 12)] }));
    expect(result).toMatchObject({ target: null, onTrack: { status: 'NOT_COMPUTABLE', reason: 'NO_TARGET' }, yearProgress: { pct: 10 } });
  });

  it('an annual target of 0 → year progress not computable', () => {
    const result = cumulativeAchievement(goal({ targetValue: 0 }), method, ctx({ actuals: [actual('T01', 12)], periodTargets: monthlyTargets }));
    expect(result).toMatchObject({ yearProgress: { status: 'NOT_COMPUTABLE', reason: 'TARGET_ZERO' } });
  });

  it('the method’s cap applies', () => {
    const result = cumulativeAchievement(goal({ targetValue: 120 }), calcMethod({ capPct: 120 }), ctx({
      actuals: [actual('T01', 30), actual('T02', 30), actual('T03', 30)], periodTargets: monthlyTargets,
    }));
    expect(result).toMatchObject({ onTrack: { pct: 120, rawPct: 300 } });
  });

  it('a month of another cycle never counts', () => {
    const result = cumulativeAchievement(goal({ targetValue: 120 }), method, ctx({
      upTo: T(1), actuals: [actual('T01', 10), actual('T12-2026', 500)], periodTargets: monthlyTargets,
    }));
    expect(result).toMatchObject({ actual: { value: 10, monthsInWindow: 1 } });
  });

  it.each([
    ['TEXT_GOAL', goal({ targetType: 'TEXT', targetValue: null, targetText: 'Đạt' }), 'SUM'],
    ['ROLL_UP', goal({ rollUpFromChildren: true }), 'SUM'],
    ['NO_AGGREGATION', goal(), null],
  ] as const)('skipped: %s', (reason, g, aggregation) => {
    expect(cumulativeAchievement(g, method, ctx({ aggregation }))).toEqual({ status: 'SKIPPED', reason });
  });

  it('skipped: a period whose cycle has no month', () => {
    const unknownCycle = period({ id: 'Q1-2028', cycleId: 'c2028', periodType: 'Quarter', startDate: '2028-01-01', endDate: '2028-03-31' });
    expect(cumulativeAchievement(goal(), method, ctx({ upTo: unknownCycle }))).toEqual({ status: 'SKIPPED', reason: 'NO_MONTHS' });
  });
});
