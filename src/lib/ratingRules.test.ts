import { describe, expect, it } from 'vitest';
import { payoutRule, ratingLevel, sampleScale } from '@/test/builders';
import { roundScore } from './scoreRules';
import { payoutPctFor, ratingFor, validatePayoutRule, validateRatingScale } from './ratingRules';

const scale = sampleScale(); // D [0,70) C [70,90) B [90,100) A [100,110) A+ [110,1000)

describe('ratingFor — [min, max), the top level open above (BR-KPI-41)', () => {
  it.each([
    [0, 'D'],
    [69.99, 'D'],
    [70, 'C'],
    [89.99, 'C'],
    [90, 'B'],
    [99.99, 'B'],
    [100, 'A'],
    [110, 'A+'],
    [1000, 'A+'],
    [5000, 'A+'],
  ])('%s → %s', (score, code) => {
    expect(ratingFor(score, scale)?.code).toBe(code);
  });

  it('rates the rounded score, so 89.995 is B, as the screen shows 90.00', () => {
    expect(ratingFor(roundScore(89.995), scale)?.code).toBe('B');
    expect(ratingFor(89.995, scale)?.code).toBe('C'); // why the caller must round first
  });

  it('has no rating for no score, a negative score, or no scale', () => {
    expect(ratingFor(null, scale)).toBeNull();
    expect(ratingFor(-1, scale)).toBeNull();
    expect(ratingFor(50, [])).toBeNull();
  });

  it('never goes down as the score goes up', () => {
    const rank = (s: number) => scale.findIndex((l) => l.id === ratingFor(s, scale)?.id);
    for (let s = 0; s < 200; s += 0.37) expect(rank(s + 0.37)).toBeGreaterThanOrEqual(rank(s));
  });
});

describe('validateRatingScale (ERR-KPI-13)', () => {
  it('accepts the sample scale', () => {
    expect(validateRatingScale(scale)).toEqual([]);
  });

  it.each([
    [[ratingLevel({ code: 'X', minScore: 10, maxScore: 100 })], 'LOWEST_NOT_ZERO'],
    [[ratingLevel({ id: 'a', code: 'A', minScore: 0, maxScore: 50 }), ratingLevel({ id: 'b', code: 'B', minScore: 60, maxScore: 100 })], 'GAP_OR_OVERLAP'],
    [[ratingLevel({ id: 'a', code: 'A', minScore: 0, maxScore: 60 }), ratingLevel({ id: 'b', code: 'B', minScore: 50, maxScore: 100 })], 'GAP_OR_OVERLAP'],
    [[ratingLevel({ code: 'A', minScore: 0, maxScore: 0 })], 'LEVEL_EMPTY'],
    [[ratingLevel({ id: 'a', code: 'A', minScore: 0, maxScore: 50 }), ratingLevel({ id: 'b', code: 'A', minScore: 50, maxScore: 100 })], 'CODE_DUPLICATE'],
    [[], 'LEVELS_REQUIRED'],
  ])('%# → %s', (levels, detail) => {
    expect(validateRatingScale(levels).map((i) => i.detail)).toContain(detail);
  });
});

describe('payoutPctFor — the most specific rule in force (BR-KPI-42)', () => {
  const B = ratingLevel({ id: 'rl-B', ratingScaleId: 'rs1' });
  const subject = { unitAncestry: ['team', 'sale', 'div', 'root'], positionId: 'pos-sale' };
  const all = payoutRule({ id: 'all', payoutPct: 80 });
  const division = payoutRule({ id: 'div', appliesTo: 'OrgUnit', orgUnitId: 'div', payoutPct: 85 });
  const dept = payoutRule({ id: 'sale', appliesTo: 'OrgUnit', orgUnitId: 'sale', payoutPct: 90 });
  const position = payoutRule({ id: 'pos', appliesTo: 'Position', positionId: 'pos-sale', payoutPct: 95 });

  it.each([
    [[all], 80],
    [[all, division], 85],
    [[all, division, dept], 90], // the nearest unit wins
    [[all, division, dept, position], 95], // a position rule beats any unit
    [[payoutRule({ appliesTo: 'OrgUnit', orgUnitId: 'hr', payoutPct: 70 })], null], // another unit's rule
    [[payoutRule({ appliesTo: 'Position', positionId: 'pos-hr', payoutPct: 70 })], null],
  ])('%# → %s', (rules, expected) => {
    expect(payoutPctFor(B, rules, subject, '2027-02-01')).toBe(expected);
  });

  it('takes the latest rule already in force', () => {
    const rules = [
      payoutRule({ id: 'old', payoutPct: 80, effectiveFrom: '2026-01-01' }),
      payoutRule({ id: 'new', payoutPct: 75, effectiveFrom: '2027-01-01' }),
      payoutRule({ id: 'future', payoutPct: 60, effectiveFrom: '2027-06-01' }),
    ];
    expect(payoutPctFor(B, rules, subject, '2027-02-01')).toBe(75);
    expect(payoutPctFor(B, rules, subject, '2026-06-01')).toBe(80);
  });

  it('reads only the rating\'s own scale and level, and answers null — never 0 — when nothing applies', () => {
    expect(payoutPctFor(B, [payoutRule({ ratingScaleId: 'other' })], subject, '2027-02-01')).toBeNull();
    expect(payoutPctFor(B, [payoutRule({ ratingLevelId: 'rl-A' })], subject, '2027-02-01')).toBeNull();
    expect(payoutPctFor(B, [], subject, '2027-02-01')).toBeNull();
  });

  it('skips a malformed rule (scope says All but names a unit)', () => {
    const bad = payoutRule({ appliesTo: 'All', orgUnitId: 'sale', payoutPct: 999 });
    expect(validatePayoutRule(bad).map((i) => i.detail)).toEqual(['SCOPE_MISMATCH']);
    expect(payoutPctFor(B, [bad, all], subject, '2027-02-01')).toBe(80);
  });

  it.each([
    [payoutRule({ appliesTo: 'OrgUnit', orgUnitId: 'sale', positionId: 'pos-sale' }), 'SCOPE_MISMATCH'],
    [payoutRule({ appliesTo: 'Position', positionId: null }), 'SCOPE_MISMATCH'],
    [payoutRule({ payoutPct: -1 }), 'PAYOUT_INVALID'],
  ])('validatePayoutRule %# → %s', (rule, detail) => {
    expect(validatePayoutRule(rule).map((i) => i.detail)).toContain(detail);
  });
});
