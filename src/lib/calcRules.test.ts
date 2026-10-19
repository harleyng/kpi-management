import { describe, expect, it } from 'vitest';
import type { CalcMethod } from '@/data/types';
import { calcMethod, goal, level, periodTarget, tier } from '@/test/builders';
import {
  achievement,
  achievementPct,
  applyFloorCap,
  evaluateFormula,
  goalAchievementInput,
  parseFormula,
  targetForPeriod,
  validateCalcMethod,
  validateTargetLevels,
  type AchievementInput,
} from './calcRules';

const numeric = (actualValue: number | null, targetValue: number | null, extra: Partial<AchievementInput> = {}): AchievementInput => ({
  targetType: 'NUMERIC', targetValue, targetText: null, actualValue, actualText: null, tiers: [], levels: [], ...extra,
});
const text = (actualText: string | null, targetText: string | null, extra: Partial<AchievementInput> = {}): AchievementInput => ({
  targetType: 'TEXT', targetValue: null, targetText, actualValue: null, actualText, tiers: [], levels: [], ...extra,
});
const method = (methodType: CalcMethod['methodType'], o: Partial<CalcMethod> = {}) => calcMethod({ methodType, ...o });

describe('applyFloorCap — floor first, then cap (BR-KPI-31)', () => {
  it.each([
    [80, null, 120, 80],
    [150, null, 120, 120],
    [-30, null, 120, 0], // implicit floor 0 when none is configured
    [10, 20, 120, 20],
    [10, 20, null, 20],
    [500, null, null, 500],
  ])('raw %s, floor %s, cap %s → %s', (raw, floor, cap, expected) => {
    expect(applyFloorCap(raw, floor, cap)).toBe(expected);
  });
});

describe('every method: a missing actual is NO_ACTUAL, never 0 (BR-KPI-32)', () => {
  it.each(['RATIO_UP', 'RATIO_DOWN', 'TIERED', 'BINARY', 'FORMULA', 'LEVELS'] as const)('%s', (type) => {
    expect(achievement(method(type, { formulaExpr: 'actual' }), numeric(null, 100))).toEqual({ status: 'NO_ACTUAL' });
    expect(achievementPct(method(type), numeric(null, 100))).toBeNull();
  });

  it.each([null, '', '   '])('a TEXT actual of %j is missing', (actualText) => {
    expect(achievement(method('BINARY'), text(actualText, 'Đạt'))).toEqual({ status: 'NO_ACTUAL' });
  });
});

describe('RATIO_UP — actual / target', () => {
  const m = method('RATIO_UP', { capPct: 120 });
  it.each([
    [80, 100, 80],
    [100, 100, 100],
    [0, 100, 0], // a real zero is scored, unlike a missing actual
    [150, 100, 120], // above the cap
    [-20, 100, 0], // a negative raw value meets the implicit floor
  ])('actual %s / target %s → %s', (actual, target, expected) => {
    expect(achievementPct(m, numeric(actual, target))).toBe(expected);
  });

  it('keeps the raw value beside the capped one', () => {
    expect(achievement(m, numeric(150, 100))).toEqual({ status: 'SCORED', pct: 120, rawPct: 150 });
  });

  it.each([
    [0, 'TARGET_ZERO'],
    [-10, 'TARGET_NEGATIVE'],
    [null, 'NO_TARGET'],
  ] as const)('target %s is NOT_COMPUTABLE (%s), never 0 or 100', (target, reason) => {
    expect(achievement(m, numeric(50, target))).toEqual({ status: 'NOT_COMPUTABLE', reason });
  });

  it('respects an explicit floor below target', () => {
    expect(achievementPct(method('RATIO_UP', { capPct: 120, floorPct: 20 }), numeric(0, 100))).toBe(20);
  });

  it('refuses NaN instead of scoring it', () => {
    expect(achievement(m, numeric(Number.NaN, 100))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'INVALID_VALUE' });
  });
});

describe('RATIO_DOWN — target / actual', () => {
  const m = method('RATIO_DOWN', { capPct: 120 });
  it.each([
    [4, 5, 80],
    [5, 4, 120], // 125 capped
    [5, 5, 100],
    [5, 0, 120], // actual 0 with a positive target: the best possible result earns the cap
    [0, 0, 100], // target 0 met exactly
    [0, 3, 0], // target 0 missed
  ])('target %s, actual %s → %s', (target, actual, expected) => {
    expect(achievementPct(m, numeric(actual, target))).toBe(expected);
  });

  it('refuses to score an uncapped ratio or formula that slipped past validation', () => {
    for (const type of ['RATIO_UP', 'RATIO_DOWN', 'FORMULA'] as const) {
      expect(achievement(method(type, { capPct: null, formulaExpr: 'actual / target * 100' }), numeric(1000, 1))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'NO_CAP' });
    }
  });

  it('cannot answer actual 0 without a cap', () => {
    expect(achievement(method('RATIO_DOWN', { capPct: null }), numeric(0, 5))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'NO_CAP' });
  });

  it('refuses negative values', () => {
    expect(achievement(m, numeric(-1, 5))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'NEGATIVE_VALUE' });
  });
});

describe('TIERED — the tier whose [from, to) holds the actual', () => {
  const tiers = [
    tier({ id: 't0', fromValue: null, toValue: 1, achievementPct: 100 }),
    tier({ id: 't1', fromValue: 1, toValue: 2, achievementPct: 70 }), // "one stock-out = 70%"
    tier({ id: 't2', fromValue: 2, toValue: 4, achievementPct: 50 }),
    tier({ id: 't3', fromValue: 5, toValue: null, achievementPct: 0 }),
  ];
  const m = method('TIERED', { capPct: null });
  it.each([
    [0, 100],
    [0.9999, 100],
    [1, 70], // lower bound inclusive
    [1.9999, 70],
    [2, 50],
    [3.5, 50],
    [5, 0],
    [999, 0],
  ])('actual %s → %s', (actual, expected) => {
    expect(achievementPct(m, numeric(actual, null, { tiers }))).toBe(expected);
  });

  it('treats a gap between tiers as NOT_COMPUTABLE, not 0', () => {
    expect(achievement(m, numeric(4.5, null, { tiers }))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'NO_TIER' });
  });

  it('classifies a computed boundary value correctly (0.1 + 0.2 is just above 0.3)', () => {
    const fine = [tier({ fromValue: 0.3, toValue: null, achievementPct: 90 })];
    expect(achievementPct(m, numeric(0.1 + 0.2, null, { tiers: fine }))).toBe(90);
  });
});

describe('BINARY — Đạt / Không đạt', () => {
  const m = method('BINARY', { capPct: null });
  it.each([
    ['Đạt', 'Đạt', 100],
    ['dat', 'Đạt', 100], // typed without tone marks
    ['  ĐẠT ', 'Đạt', 100],
    ['Không đạt', 'Đạt', 0],
  ])('actual %j against %j → %s', (actual, target, expected) => {
    expect(achievementPct(m, text(actual, target))).toBe(expected);
  });

  it.each([
    [10, 10, 100],
    [9.99, 10, 0],
  ])('numeric: actual %s ≥ target %s → %s', (actual, target, expected) => {
    expect(achievementPct(m, numeric(actual, target))).toBe(expected);
  });

  it('a floor lifts "Không đạt"', () => {
    expect(achievementPct(method('BINARY', { floorPct: 30 }), text('Không đạt', 'Đạt'))).toBe(30);
  });

  it('a TEXT goal without a target text is NOT_COMPUTABLE', () => {
    expect(achievement(m, text('Đạt', null))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'NO_TARGET' });
  });
});

describe('FORMULA — safe expressions over actual and target', () => {
  it.each([
    ['actual / target * 100', 80, 100, 80],
    ['(actual - 10) / (target - 10) * 100', 55, 100, 50],
    ['min(actual / target * 100, 110)', 200, 100, 110],
    ['max(0, 100 - (actual - target) * 10)', 12, 10, 80],
    ['-actual + 200', 50, 100, 150],
    ['2 + 3 * 4', 0, 0, 14],
  ])('%s with actual %s, target %s → %s', (expr, actual, target, expected) => {
    expect(evaluateFormula(expr, { actual, target })).toBe(expected);
  });

  it('scores through the method with its cap', () => {
    expect(achievementPct(method('FORMULA', { formulaExpr: 'actual / target * 100', capPct: 120 }), numeric(300, 100))).toBe(120);
  });

  it.each([
    ['actual / (target - 100)', 'divides by zero'],
    ['actual / target', 'reads a missing target'],
  ])('%s is NOT_COMPUTABLE when it %s', (expr) => {
    const m = method('FORMULA', { formulaExpr: expr });
    const target = expr.includes('- 100') ? 100 : null;
    expect(achievement(m, numeric(5, target))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'FORMULA_ERROR' });
  });

  it.each([
    '',
    'actual +',
    'alert(1)',
    'constructor',
    '__proto__',
    'actual.constructor',
    'this',
    '1e999',
    'actual ** 2',
    'min()',
    '(actual',
    'actual)',
    '('.repeat(200) + 'actual' + ')'.repeat(200),
    'x'.repeat(600),
  ])('refuses %j without throwing', (expr) => {
    expect(parseFormula(expr).ok).toBe(false);
    expect(evaluateFormula(expr, { actual: 1, target: 1 })).toBeNull();
  });

  it('parses deterministically', () => {
    expect(parseFormula('actual / target * 100')).toEqual(parseFormula('actual / target * 100'));
  });
});

describe('LEVELS — L1/L2/L3 per goal, interpolated (ASSUMPTION Q1)', () => {
  const m = method('LEVELS', { capPct: null });
  const up = [
    level({ levelCode: 'L1', targetValue: 50, scorePct: 60 }),
    level({ levelCode: 'L2', targetValue: 100, scorePct: 80 }),
    level({ levelCode: 'L3', targetValue: 150, scorePct: 120 }),
  ];
  it.each([
    [50, 60], // exactly on L1
    [75, 70], // halfway L1→L2
    [100, 80], // exactly on L2
    [125, 100], // halfway L2→L3
    [150, 120], // exactly on L3
    [400, 120], // above L3: capped at the top level
    [49.99, 0], // below L1 earns nothing
  ])('actual %s → %s', (actual, expected) => {
    expect(achievementPct(m, numeric(actual, null, { levels: up }))).toBeCloseTo(expected, 10);
  });

  it('reads lower-is-better levels from their order (L1 = 10 days, L2 = 5 days)', () => {
    const down = [
      level({ levelCode: 'L1', targetValue: 10, scorePct: 0 }),
      level({ levelCode: 'L2', targetValue: 5, scorePct: 100 }),
    ];
    expect(achievementPct(m, numeric(7.5, null, { levels: down }))).toBe(50);
    expect(achievementPct(m, numeric(2, null, { levels: down }))).toBe(100);
    expect(achievementPct(m, numeric(12, null, { levels: down }))).toBe(0);
  });

  it('accepts the levels in any order', () => {
    expect(achievementPct(m, numeric(75, null, { levels: [...up].reverse() }))).toBe(70);
  });

  it('needs at least two levels', () => {
    expect(achievement(m, numeric(75, null, { levels: [up[0]] }))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'NO_LEVELS' });
  });

  it('refuses levels whose targets are not monotonic', () => {
    const bad = [up[0], level({ levelCode: 'L2', targetValue: 50, scorePct: 80 })];
    expect(achievement(m, numeric(75, null, { levels: bad }))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'NO_LEVELS' });
  });

  it('TEXT levels: a matching result earns that level, a typo is NOT_COMPUTABLE', () => {
    const levels = [
      level({ levelCode: 'L1', targetText: 'Hoàn thành một phần', scorePct: 50 }),
      level({ levelCode: 'L2', targetText: 'Hoàn thành', scorePct: 100 }),
    ];
    expect(achievementPct(m, text('hoan thanh', null, { levels }))).toBe(100);
    expect(achievement(m, text('Hoàn thàn', null, { levels }))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'NO_LEVEL_MATCH' });
  });
});

describe('a TEXT goal on a numeric method', () => {
  it('is NOT_COMPUTABLE, not a guess', () => {
    expect(achievement(method('RATIO_UP'), text('Đạt', 'Đạt'))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'TARGET_TYPE_MISMATCH' });
  });
});

describe('targetForPeriod / goalAchievementInput', () => {
  const g = goal({ id: 'g1', targetValue: 120 });
  it('uses the period split when there is one, the goal target otherwise (BR-KPI-11)', () => {
    const splits = [periodTarget({ goalId: 'g1', periodId: 'T01', targetValue: 10 })];
    expect(targetForPeriod(g, splits, 'T01')).toBe(10);
    expect(targetForPeriod(g, splits, 'T02')).toBe(120);
  });

  it('builds the input from the goal, its actual and only its own levels and tiers', () => {
    const input = goalAchievementInput(g, { actualValue: 8, actualText: null }, {
      periodId: 'T01',
      periodTargets: [periodTarget({ goalId: 'g1', periodId: 'T01', targetValue: 10 })],
      tiers: [tier({ calcMethodId: 'cm1' }), tier({ id: 'other', calcMethodId: 'cm2' })],
      levels: [level({ goalId: 'g1' }), level({ goalId: 'g2' })],
    });
    expect(input).toMatchObject({ targetValue: 10, actualValue: 8 });
    expect(input.tiers).toHaveLength(1);
    expect(input.levels).toHaveLength(1);
    expect(goalAchievementInput(g, null, { periodId: 'T01', periodTargets: [], tiers: [], levels: [] }).actualValue).toBeNull();
  });
});

describe('validateCalcMethod (ERR-KPI-13)', () => {
  const details = (m: CalcMethod, tiers = [tier({ fromValue: 0, toValue: null })]) =>
    validateCalcMethod(m, tiers).map((i) => i.detail);

  it('accepts a sound method', () => {
    expect(details(method('RATIO_UP', { capPct: 120, floorPct: 0 }))).toEqual([]);
  });

  it.each(['RATIO_UP', 'RATIO_DOWN', 'FORMULA'] as const)('%s requires a cap', (type) => {
    expect(details(method(type, { capPct: null, formulaExpr: 'actual' }))).toContain('CAP_REQUIRED');
  });

  it('accepts TIERED, BINARY and LEVELS without a cap', () => {
    for (const type of ['TIERED', 'BINARY', 'LEVELS'] as const) expect(details(method(type, { capPct: null }))).toEqual([]);
  });

  it.each([
    [{ floorPct: 130, capPct: 120 }, 'FLOOR_ABOVE_CAP'],
    [{ floorPct: -5 }, 'FLOOR_NEGATIVE'],
    [{ capPct: 0 }, 'CAP_NOT_POSITIVE'],
  ] as const)('%j → %s', (o, detail) => {
    expect(details(method('RATIO_UP', o))).toContain(detail);
  });

  it('checks the formula parses', () => {
    expect(details(method('FORMULA', { formulaExpr: 'actual +' }))).toContain('FORMULA_INVALID');
    expect(details(method('FORMULA', { formulaExpr: null }))).toContain('FORMULA_INVALID');
  });

  it('checks the tiers: present, non-empty, non-overlapping — pointing at the offending tier', () => {
    const tiered = method('TIERED', { capPct: null });
    expect(details(tiered, [])).toContain('TIERS_REQUIRED');
    const issues = validateCalcMethod(tiered, [
      tier({ id: 'a', fromValue: 0, toValue: 5 }),
      tier({ id: 'b', fromValue: 4, toValue: 10 }),
      tier({ id: 'c', fromValue: 10, toValue: 10 }),
    ]);
    expect(issues.map((i) => [i.ref, i.detail])).toEqual(
      expect.arrayContaining([
        ['b', 'TIERS_OVERLAP'],
        ['c', 'TIER_EMPTY'],
      ]),
    );
    expect(issues.every((i) => i.code === 'ERR-KPI-13')).toBe(true);
  });

  it('accepts adjacent tiers [0,1) [1,2)', () => {
    expect(details(method('TIERED', { capPct: null }), [tier({ fromValue: 0, toValue: 1 }), tier({ id: 't2', fromValue: 1, toValue: 2 })])).toEqual([]);
  });
});

describe('validateTargetLevels (ERR-KPI-13)', () => {
  const details = (...args: Parameters<typeof validateTargetLevels>) => validateTargetLevels(...args).map((i) => i.detail);

  it('accepts no levels, and two or three ordered ones', () => {
    expect(details('NUMERIC', [])).toEqual([]);
    expect(details('NUMERIC', [level({ levelCode: 'L1', targetValue: 50, scorePct: 0 }), level({ levelCode: 'L2', targetValue: 100, scorePct: 100 })])).toEqual([]);
    expect(details('NUMERIC', [level({ levelCode: 'L1', targetValue: 10, scorePct: 0 }), level({ levelCode: 'L2', targetValue: 5, scorePct: 100 })])).toEqual([]);
  });

  it.each([
    [[level({ levelCode: 'L1', targetValue: 50, scorePct: 0 })], 'LEVELS_MIN_TWO'],
    [[level({ levelCode: 'L1', targetValue: 50, scorePct: 100 }), level({ levelCode: 'L2', targetValue: 100, scorePct: 100 })], 'LEVEL_SCORES_ORDER'],
    [[level({ levelCode: 'L1', targetValue: 50, scorePct: 0 }), level({ levelCode: 'L2', targetValue: 50, scorePct: 100 })], 'LEVEL_TARGETS_ORDER'],
    [
      [
        level({ levelCode: 'L1', targetValue: 50, scorePct: 0 }),
        level({ levelCode: 'L2', targetValue: 100, scorePct: 50 }),
        level({ levelCode: 'L3', targetValue: 80, scorePct: 100 }),
      ],
      'LEVEL_TARGETS_ORDER',
    ],
    [[level({ levelCode: 'L1', targetValue: null, scorePct: 0 }), level({ levelCode: 'L2', targetValue: 100, scorePct: 100 })], 'LEVEL_TARGET_MISSING'],
  ])('%# → %s', (levels, detail) => {
    expect(details('NUMERIC', levels)).toContain(detail);
  });

  it('TEXT levels need distinct texts', () => {
    const levels = [level({ levelCode: 'L1', targetText: 'Đạt', scorePct: 0 }), level({ levelCode: 'L2', targetText: 'dat', scorePct: 100 })];
    expect(details('TEXT', levels)).toContain('LEVEL_TEXT_DUPLICATE');
  });
});

describe('levelsMissingIssue — LEVELS needs at least two levels', () => {
  it('only for a LEVELS method under two levels', async () => {
    const { levelsMissingIssue } = await import('./calcRules');
    expect(levelsMissingIssue('LEVELS', 1, 'g1')).toEqual({ code: 'ERR-KPI-13', ref: 'g1', detail: 'LEVELS_MISSING', data: null });
    expect(levelsMissingIssue('LEVELS', 2, 'g1')).toBeNull();
    expect(levelsMissingIssue('RATIO_UP', 0, 'g1')).toBeNull();
    expect(levelsMissingIssue(undefined, 0, null)).toBeNull();
  });
});
