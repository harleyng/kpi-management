import { describe, expect, it } from 'vitest';
import {
  adjustedScore,
  aggregatePeriodActuals,
  canFinalize,
  finalizeIssues,
  lineWeightedScore,
  ratedScore,
  rollUpActual,
  roundScore,
  weightedScore,
  type ScoreLine,
} from './scoreRules';

const line = (goalId: string, weight: number, achievementPct: number | null, status: ScoreLine['status'] = 'Active'): ScoreLine => ({
  goalId, weight, status, achievementPct,
});

describe('weightedScore — Σ(a × w) / Σw over active goals (BR-KPI-35)', () => {
  it('weights the achievements', () => {
    const result = weightedScore([line('a', 60, 100), line('b', 40, 50)]);
    expect(result).toMatchObject({ score: 80, complete: true, missingGoalIds: [], totalWeight: 100, scoredWeight: 100 });
  });

  it('excludes Cancelled and Changed goals entirely', () => {
    expect(weightedScore([line('a', 100, 90), line('x', 50, 0, 'Cancelled'), line('y', 50, 0, 'Changed')]).score).toBe(90);
  });

  it('a missing achievement is NOT zero: it is left out and marks the score incomplete', () => {
    const zero = weightedScore([line('a', 50, 100), line('b', 50, 0)]);
    const missing = weightedScore([line('a', 50, 100), line('b', 50, null)]);
    expect(zero).toMatchObject({ score: 50, complete: true });
    expect(missing).toMatchObject({ score: 100, complete: false, missingGoalIds: ['b'], scoredWeight: 50 });
  });

  it('has no score when nothing is scored', () => {
    expect(weightedScore([line('a', 100, null)]).score).toBeNull();
    expect(weightedScore([])).toMatchObject({ score: null, complete: false });
  });

  it('renormalises over a 99.99 total', () => {
    expect(weightedScore([line('a', 33.33, 90), line('b', 33.33, 90), line('c', 33.33, 90)]).score).toBeCloseTo(90, 10);
  });

  it('gives each goal its points — ResultDetail.weightedScore', () => {
    expect(lineWeightedScore(80, 25)).toBe(20);
    expect(lineWeightedScore(null, 25)).toBeNull();
  });
});

describe('finalizeIssues / canFinalize — a provisional score never reaches payroll', () => {
  it.each([
    [[line('a', 50, 100), line('b', 50, 80)], []],
    [[line('a', 50, 100), line('b', 50, null)], ['ERR-KPI-09']],
    [[line('a', 50, 100), line('b', 40, 80)], ['ERR-KPI-07']],
    [[line('a', 50, null), line('b', 40, null)], ['ERR-KPI-07', 'ERR-KPI-09', 'ERR-KPI-09']],
    [[], ['ERR-KPI-07', 'ERR-KPI-09']],
  ])('%# → %j', (lines, expected) => {
    expect(finalizeIssues(lines).map((i) => i.code)).toEqual(expected);
    expect(canFinalize(lines)).toBe(expected.length === 0);
  });

  it('points at each unscored goal', () => {
    expect(finalizeIssues([line('a', 50, null), line('b', 50, null)]).map((i) => i.ref)).toEqual(['a', 'b']);
  });
});

describe('roundScore — two decimals, half away from zero, without float error', () => {
  it.each([
    [89.995, 90],
    [1.005, 1.01],
    [2.675, 2.68],
    [89.994, 89.99],
    [-0.005, -0.01],
    [0, 0],
    [-0.001, 0],
    [123456.785, 123456.79],
    [1e-7, 0],
    [1e21, 1e21],
  ])('%s → %s', (value, expected) => {
    expect(roundScore(value)).toBe(expected);
  });
});

describe('adjustment and the rated score (BR-KPI-40, 41)', () => {
  it.each([
    [85, 5, 90],
    [85, -10, 75],
    [5, -10, 0], // never below 0
    [null, 5, null],
    [80, Number.NaN, null], // garbage in is "no score", not NaN on a payslip
  ])('%s + %s → %s', (total, adjustment, expected) => {
    expect(adjustedScore(total, adjustment)).toBe(expected);
  });

  it('rounds once, after the adjustment: 89.995 rates as 90.00', () => {
    expect(ratedScore(89.995, 0)).toBe(90);
    expect(ratedScore(86.4949, 3.5)).toBe(89.99);
    expect(ratedScore(null, 0)).toBeNull();
  });
});

describe('roll-up and period aggregation (BR-KPI-36, ASSUMPTION Q8)', () => {
  it.each([
    [[10, 20, 30], 60],
    [[10, null], null],
    [[0, null], null],
    [[0, 0], 0],
    [[], null],
  ])('rollUpActual(%j) → %s', (values, expected) => {
    expect(rollUpActual(values)).toBe(expected);
  });

  it.each([
    [[10, 20, 30], 'SUM', 60],
    [[10, 20, 30], 'AVG', 20],
    [[10, 20, 30], 'LAST', 30],
    [[10, null, 30], 'SUM', null],
    [[10, null, 30], 'AVG', null],
    [[10, 20, null], 'LAST', null],
    [[], 'SUM', null],
  ] as const)('%j by %s → %s', (values, aggregation, expected) => {
    expect(aggregatePeriodActuals(values, aggregation)).toBe(expected);
  });
});

describe('purity', () => {
  it('gives the same answer twice and does not mutate its input', () => {
    const lines = Object.freeze([line('a', 50, 100), line('b', 50, 60)]);
    expect(weightedScore(lines)).toEqual(weightedScore(lines));
    expect(weightedScore([line('a', 100, 10)]).score).toBe(10); // no state carried over from the call above
  });
});
