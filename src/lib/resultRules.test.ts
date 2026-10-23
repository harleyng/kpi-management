import { describe, expect, it } from 'vitest';
import type { GoalActual, PerformanceCycle, PeriodResult, ResultDetail } from '@/data/types';
import {
  TENANT,
  alignment,
  assignment,
  calcMethod,
  employee,
  evaluationItem,
  form,
  goal,
  months2027,
  orgUnit,
  payoutRule,
  period,
  periodTarget,
  plan,
  ratingLevel,
  sampleScale,
} from '@/test/builders';
import {
  actualLines,
  applyAdjustment,
  buildPeriodResults,
  canAdjust,
  canRecalculate,
  canTransition,
  computeResult,
  evaluationLines,
  finalizeCheck,
  finalizePeriodResults,
  isPaidPeriod,
  lockPeriodResults,
  RESULT_TRANSITIONS,
  type ActualContext,
  type ResultData,
  type ResultIds,
  type ResultLine,
} from './resultRules';

const scale = sampleScale(); // D [0,70) C [70,90) B [90,100) A [100,110) A+ [110,1000)
const level = (code: string) => scale.find((l) => l.code === code)?.id;
const line = (goalId: string, weight: number, achievementPct: number | null, notComputable: ResultLine['notComputable'] = null): ResultLine => ({
  goalId, weight, status: 'Active', achievementPct, notComputable,
});
const actual = (o: Partial<GoalActual> = {}): GoalActual => ({
  id: `a-${o.goalId ?? 'g1'}-${o.periodId ?? 'T01'}`, tenantId: TENANT, goalId: 'g1', periodId: 'T01', actualValue: 100, actualText: null,
  sourceType: 'MANUAL', batchId: null, syncRunId: null, enteredBy: null, note: null, recordedAt: '2027-02-01T01:00:00.000Z', isCurrent: true, ...o,
});
const cycle = (o: Partial<PerformanceCycle> = {}): PerformanceCycle => ({
  id: 'c2027', tenantId: TENANT, name: 'KPI 2027', startDate: '2027-01-01', endDate: '2027-12-31', ratingScaleId: 'rs1', status: 'Active', ...o,
});
const ids: ResultIds = { result: (p, g) => `r:${p}:${g}`, detail: (r, g) => `d:${r}:${g}` };
const NOW = '2027-02-13T02:00:00.000Z';

describe('evaluationLines — the FINAL column of the completed form (BR-KPI-16, 17)', () => {
  it('counts every goal on the form as Active — the form is the snapshot (E026 T01: goals since Changed / Cancelled)', () => {
    const goals = [goal({ id: 'g1', weight: 60, status: 'Changed' }), goal({ id: 'g2', weight: 40, status: 'Cancelled' })];
    const items = [evaluationItem({ goalId: 'g1', finalAchievementPct: 90 }), evaluationItem({ goalId: 'g2', finalAchievementPct: 100 })];
    const lines = evaluationLines(items, goals);
    expect(lines.map((l) => l.status)).toEqual(['Active', 'Active']);
    const calc = computeResult(lines, 0, scale, [], null, '2027-01-31');
    expect(calc.score).toMatchObject({ score: 94, complete: true, totalWeight: 100 });
    expect(finalizeCheck(lines, 'r1')).toEqual([]);
  });

  it('a null FINAL % is missing, never 0', () => {
    const lines = evaluationLines([evaluationItem({ goalId: 'g1', finalAchievementPct: null, managerAchievementPct: 80 })], [goal({ weight: 100 })]);
    expect(lines[0].achievementPct).toBeNull();
    expect(computeResult(lines, 0, scale, [], null, '2027-01-31').score.complete).toBe(false);
  });

  it('an item whose goal is unknown weighs 0 and is missing', () => {
    expect(evaluationLines([evaluationItem({ goalId: 'ghost', finalAchievementPct: 100 })], [])[0]).toMatchObject({ weight: 0, achievementPct: null });
  });
});

describe('actualLines — calcRules on the current actuals (Company / OrgUnit plans)', () => {
  const ctx = (o: Partial<ActualContext> = {}): ActualContext => ({
    period: period(), periods: months2027(), actuals: [], periodTargets: [], methods: [calcMethod({ capPct: 120 })], tiers: [], levels: [],
    kpiDefinitions: [], allGoals: [], alignments: [], ...o,
  });

  it('NO_ACTUAL and NOT_COMPUTABLE are null, never 0; the reason is kept', () => {
    const goals = [goal({ id: 'g1', weight: 50 }), goal({ id: 'g2', weight: 50, targetValue: 0 })];
    const lines = actualLines(goals, ctx({ actuals: [actual({ goalId: 'g2', actualValue: 5 })] }));
    expect(lines).toEqual([line('g1', 50, null), line('g2', 50, null, 'TARGET_ZERO')]);
  });

  it('applies the cap above it and the floor below it; a real zero scores 0', () => {
    const goals = [goal({ id: 'g1' }), goal({ id: 'g2' }), goal({ id: 'g3' })];
    const lines = actualLines(goals, ctx({
      methods: [calcMethod({ capPct: 120, floorPct: 10 })],
      actuals: [actual({ goalId: 'g1', actualValue: 500 }), actual({ goalId: 'g2', actualValue: 2 }), actual({ goalId: 'g3', actualValue: 50 })],
    }));
    expect(lines.map((l) => l.achievementPct)).toEqual([120, 10, 50]);
    const zero = actualLines([goal()], ctx({ actuals: [actual({ actualValue: 0 })] }));
    expect(zero[0].achievementPct).toBe(0);
  });

  it('reads only the current snapshot and only Active goals', () => {
    const goals = [goal({ id: 'g1' }), goal({ id: 'gx', status: 'Cancelled' })];
    const lines = actualLines(goals, ctx({ actuals: [actual({ actualValue: 50, isCurrent: false, id: 'old' }), actual({ actualValue: 90 })] }));
    expect(lines).toEqual([line('g1', 20, 90)]);
  });

  it('uses the period split target (BR-KPI-11)', () => {
    const lines = actualLines([goal({ targetValue: 1200 })], ctx({ actuals: [actual({ actualValue: 90 })], periodTargets: [periodTarget({ targetValue: 100 })] }));
    expect(lines[0].achievementPct).toBe(90);
  });

  it('a quarter adds up its months by the KPI\'s aggregation, actuals and split targets alike', () => {
    const q1 = period({ id: 'Q1', periodType: 'Quarter', label: 'Q1', startDate: '2027-01-01', endDate: '2027-03-31' });
    const g = goal({ kpiDefId: 'kd1', targetValue: 1200 });
    const months = ['T01', 'T02', 'T03'];
    const base = ctx({
      period: q1,
      periods: [...months2027(), q1],
      kpiDefinitions: [{ id: 'kd1', aggregation: 'SUM' } as never],
      periodTargets: months.map((m) => periodTarget({ id: `pt-${m}`, periodId: m, targetValue: 100 })),
      actuals: months.map((m) => actual({ periodId: m, actualValue: 90 })),
    });
    expect(actualLines([g], base)[0].achievementPct).toBe(90); // 270 / 300
    const missingMonth = { ...base, actuals: base.actuals.slice(0, 2) };
    expect(actualLines([g], missingMonth)[0].achievementPct).toBeNull();
    const own = { ...base, actuals: [...base.actuals, actual({ periodId: 'Q1', actualValue: 300 })] };
    expect(actualLines([g], own)[0].achievementPct).toBe(100);
  });

  it('a goal flagged rollUpFromChildren sums its CASCADE children (ASSUMPTION Q8); one missing child → missing', () => {
    const parent = goal({ id: 'p', rollUpFromChildren: true, targetValue: 100 });
    const kids = [goal({ id: 'c1', goalPlanId: 'x' }), goal({ id: 'c2', goalPlanId: 'x' })];
    const base = ctx({
      allGoals: [parent, ...kids],
      alignments: [alignment({ childGoalId: 'c1', parentGoalId: 'p' }), alignment({ childGoalId: 'c2', parentGoalId: 'p' })],
      actuals: [actual({ goalId: 'p', actualValue: 1 }), actual({ goalId: 'c1', actualValue: 40 }), actual({ goalId: 'c2', actualValue: 45 })],
    });
    expect(actualLines([parent], base)[0].achievementPct).toBe(85);
    expect(actualLines([parent], { ...base, actuals: base.actuals.slice(0, 2) })[0].achievementPct).toBeNull();
  });
});

describe('computeResult — score, adjustment, rating, payout (BR-KPI-35, 40–42)', () => {
  const subject = { unitAncestry: ['ou-kd', 'ou-root'], positionId: 'pos-staff' };
  const rules = scale.map((l, i) => payoutRule({ id: `all-${l.code}`, ratingLevelId: l.id, payoutPct: [0, 50, 80, 100, 120][i] }));

  it('a level boundary reads the rounded score: 90.00 and 89.995 are both B', () => {
    expect(computeResult([line('g', 100, 90)], 0, scale, rules, subject, '2027-01-31').ratingLevelId).toBe(level('B'));
    const calc = computeResult([line('g', 100, 89.995)], 0, scale, rules, subject, '2027-01-31');
    expect(calc).toMatchObject({ adjusted: 89.995, rated: 90, ratingLevelId: level('B'), payoutPct: 80 });
  });

  it('an adjustment re-rates across a boundary and the payout follows; it never goes below 0', () => {
    const up = computeResult([line('g', 100, 89.5)], 1, scale, rules, subject, '2027-01-31');
    expect(up).toMatchObject({ rated: 90.5, ratingLevelId: level('B'), payoutPct: 80 });
    const down = computeResult([line('g', 100, 101.75)], -2, scale, rules, subject, '2027-01-31');
    expect(down).toMatchObject({ rated: 99.75, ratingLevelId: level('B'), payoutPct: 80 });
    expect(computeResult([line('g', 100, 20)], -50, scale, rules, subject, '2027-01-31')).toMatchObject({ adjusted: 0, ratingLevelId: level('D'), payoutPct: 0 });
  });

  it('an incomplete score is provisional: no rating, no payout', () => {
    const calc = computeResult([line('a', 50, 100), line('b', 50, null)], 0, scale, rules, subject, '2027-01-31');
    expect(calc).toMatchObject({ adjusted: 100, ratingLevelId: null, payoutPct: null });
  });

  it('weights that do not total 100% are provisional too: scored, never rated (QA, Gate 1)', () => {
    const short = computeResult([line('a', 50, 100), line('b', 25, 80)], 0, scale, rules, subject, '2027-01-31');
    expect(short.adjusted).not.toBeNull();
    expect(short).toMatchObject({ ratingLevelId: null, payoutPct: null });
    // 99.99 is within the tolerance (BR-KPI-07).
    const third = computeResult([line('a', 33.33, 95), line('b', 33.33, 95), line('c', 33.33, 95)], 0, scale, rules, subject, '2027-01-31');
    expect(third.ratingLevelId).toBe(level('B'));
  });

  it('payout: Position > nearest OrgUnit > All, the latest effectiveFrom, no rule → null', () => {
    const b = level('B') as string;
    const lines = [line('g', 100, 95)];
    const at = (r: typeof rules) => computeResult(lines, 0, scale, r, subject, '2027-01-31').payoutPct;
    const all = payoutRule({ id: 'all', ratingLevelId: b, payoutPct: 80 });
    const root = payoutRule({ id: 'root', ratingLevelId: b, appliesTo: 'OrgUnit', orgUnitId: 'ou-root', payoutPct: 85 });
    const kd = payoutRule({ id: 'kd', ratingLevelId: b, appliesTo: 'OrgUnit', orgUnitId: 'ou-kd', payoutPct: 90 });
    const pos = payoutRule({ id: 'pos', ratingLevelId: b, appliesTo: 'Position', positionId: 'pos-staff', payoutPct: 95 });
    expect(at([all, root, kd, pos])).toBe(95);
    expect(at([all, root, kd])).toBe(90);
    expect(at([all, root])).toBe(85);
    expect(at([all, payoutRule({ id: 'all-new', ratingLevelId: b, payoutPct: 82, effectiveFrom: '2027-01-15' })])).toBe(82);
    expect(at([payoutRule({ id: 'future', ratingLevelId: b, effectiveFrom: '2027-02-01' })])).toBeNull();
    expect(at([])).toBeNull();
    expect(computeResult(lines, 0, scale, [all], null, '2027-01-31').payoutPct).toBeNull(); // a unit plan
  });

  it('gives each goal its points (ResultDetail.weightedScore), null for a missing one', () => {
    expect(computeResult([line('a', 30, 80), line('b', 70, null)], 0, scale, [], null, '2027-01-31').details).toEqual([
      { goalId: 'a', achievementPct: 80, weight: 30, weightedScore: 24 },
      { goalId: 'b', achievementPct: null, weight: 70, weightedScore: null },
    ]);
  });
});

describe('finalizeCheck — what blocks Draft → Final', () => {
  it('weights 99.99 pass, 98 block (ERR-KPI-07, with the total)', () => {
    expect(finalizeCheck([line('a', 33.33, 90), line('b', 33.33, 90), line('c', 33.33, 90)], 'r')).toEqual([]);
    const issues = finalizeCheck([line('a', 49, 90), line('b', 49, 90)], 'r');
    expect(issues).toEqual([{ code: 'ERR-KPI-07', ref: null, detail: null, data: { totalWeight: 98, resultId: 'r' } }]);
  });

  it('one not computable goal blocks: weights first, then ERR-KPI-12 (with the reason), then ERR-KPI-09', () => {
    const issues = finalizeCheck([line('a', 40, null), line('b', 40, null, 'TARGET_ZERO'), line('c', 10, 90)], 'r1');
    expect(issues.map((i) => [i.code, i.ref, i.detail])).toEqual([
      ['ERR-KPI-07', null, null],
      ['ERR-KPI-12', 'b', 'TARGET_ZERO'],
      ['ERR-KPI-09', 'a', 'NOT_SCORED'],
    ]);
    expect(issues.every((i) => i.data?.resultId === 'r1')).toBe(true);
  });

  it('no goals at all cannot be finalised', () => {
    expect(finalizeCheck([], 'r').map((i) => i.code)).toEqual(['ERR-KPI-07', 'ERR-KPI-09']);
  });
});

describe('the result lifecycle — Draft → Final → Locked (BR-KPI-43)', () => {
  it('allows exactly Draft → Final and Final → Locked', () => {
    expect(RESULT_TRANSITIONS).toEqual({ Draft: ['Final'], Final: ['Locked'], Locked: [] });
    expect(canTransition('Draft', 'Final')).toEqual({ ok: true });
    expect(canTransition('Final', 'Locked')).toEqual({ ok: true });
    expect(canTransition('Draft', 'Locked')).toEqual({ ok: false, code: 'ERR-KPI-04', detail: 'NOT_FINAL' });
    expect(canTransition('Final', 'Final')).toEqual({ ok: false, code: 'ERR-KPI-04', detail: 'NOT_DRAFT' });
    expect(canTransition('Locked', 'Final')).toEqual({ ok: false, code: 'ERR-KPI-04', detail: 'NOT_DRAFT' });
    expect(canTransition('Locked', 'Draft')).toEqual({ ok: false, code: 'ERR-KPI-04', detail: 'RESULT_LOCKED' });
  });

  it('only a Draft is recalculated or adjusted', () => {
    expect([canRecalculate('Draft'), canRecalculate('Final'), canRecalculate('Locked')]).toEqual([true, false, false]);
    expect(canAdjust('Draft')).toEqual({ ok: true });
    expect(canAdjust('Final')).toEqual({ ok: false, code: 'ERR-KPI-04', detail: 'RESULT_FINAL' });
    expect(canAdjust('Locked')).toEqual({ ok: false, code: 'ERR-KPI-04', detail: 'RESULT_LOCKED' });
  });
});

// ─── The orchestrators over plain rows ────────────────────────────────────────────────────────

function data(o: Partial<ResultData> = {}): ResultData {
  const goals = [goal({ id: 'g1', weight: 60 }), goal({ id: 'g2', weight: 40 })];
  return {
    PerformanceCycle: [cycle()],
    CyclePeriod: months2027(),
    GoalPlan: [plan({ status: 'Locked' }), plan({ id: 'unit', ownerType: 'OrgUnit', ownerOrgUnitId: 'ou-root', ownerEmployeeId: null, status: 'Locked' })],
    Goal: [...goals, goal({ id: 'u1', goalPlanId: 'unit', weight: 100 })],
    GoalAlignment: [],
    GoalPeriodTarget: [],
    GoalTargetLevel: [],
    GoalActual: [actual({ goalId: 'u1', actualValue: 95 })],
    FormInstance: [form({ status: 'Completed', currentStepId: null })],
    EvaluationItem: [evaluationItem({ goalId: 'g1', finalAchievementPct: 100 }), evaluationItem({ goalId: 'g2', finalAchievementPct: 80 })],
    CalcMethod: [calcMethod()],
    CalcTier: [],
    KpiDefinition: [],
    RatingLevel: [...scale, ratingLevel({ id: 'other', ratingScaleId: 'rs-old', code: 'X', minScore: 0, maxScore: 1000 })],
    PayoutRule: scale.map((l, i) => payoutRule({ id: `p-${l.code}`, ratingLevelId: l.id, payoutPct: [0, 50, 80, 100, 120][i] })),
    Employee: [employee()],
    EmployeeAssignment: [assignment()],
    OrgUnit: [orgUnit()],
    PeriodResult: [],
    ResultDetail: [],
    ...o,
  };
}

/** Applies a rule's changes to plain rows, as the seed does. */
function applied(d: ResultData, outcome: ReturnType<typeof buildPeriodResults>): ResultData {
  if (!outcome.ok) throw new Error(outcome.issues.map((i) => i.detail).join());
  const { changes } = outcome;
  const results: PeriodResult[] = [...d.PeriodResult];
  for (const { row, created } of changes.results) {
    if (created) results.push(row);
    else results[results.findIndex((r) => r.id === row.id)] = row;
  }
  const details: ResultDetail[] = [...d.ResultDetail.filter((x) => !changes.removedDetailIds.includes(x.id)), ...changes.addedDetails];
  return { ...d, PeriodResult: results, ResultDetail: details };
}

/** `data()` with a quarter, a half and the year, and the employee's completed form for `periodId`. */
function paidData(periodId: string): ResultData {
  const extra = [
    period({ id: 'Q1', periodType: 'Quarter', label: 'Q1', startDate: '2027-01-01', endDate: '2027-03-31' }),
    period({ id: 'H1', periodType: 'Half', label: 'H1', startDate: '2027-01-01', endDate: '2027-06-30' }),
    period({ id: 'Y', periodType: 'Year', label: 'Năm 2027', startDate: '2027-01-01', endDate: '2027-12-31' }),
  ];
  return data({ CyclePeriod: [...months2027(), ...extra], FormInstance: [form({ status: 'Completed', currentStepId: null, periodId })] });
}

describe('PEND-09 — which periods are paid (ASSUMPTION Q52)', () => {
  it.each([
    ['Month', false],
    ['Quarter', true],
    ['Half', false],
    ['Year', true],
  ] as const)('%s → paid %s', (periodType, paid) => {
    expect(isPaidPeriod({ periodType })).toBe(paid);
  });

  it.each([
    ['Q1', 80],
    ['Y', 80],
    ['H1', null],
    ['T01', null],
  ] as const)('the same B (92) employee result in %s carries payout %s; it is rated either way', (periodId, payout) => {
    const d = paidData(periodId);
    const built = applied(d, buildPeriodResults(d, periodId, ids));
    const mine = built.PeriodResult.find((r) => r.goalPlanId === 'plan1');
    expect(mine).toMatchObject({ totalScore: 92, ratingLevelId: level('B'), payoutPct: payout });
  });

  it('a unit plan has no payout in a paid period either', () => {
    const d = paidData('Q1');
    const unit = applied(d, buildPeriodResults(d, 'Q1', ids)).PeriodResult.find((r) => r.goalPlanId === 'unit');
    expect(unit?.payoutPct ?? null).toBeNull();
  });
});

describe('buildPeriodResults — calculateResults', () => {
  it('a Draft per eligible plan: the employee from the form, the unit from the actuals (rated; a month is tracked — no payout)', () => {
    const d = applied(data(), buildPeriodResults(data(), 'T01', ids));
    expect(d.PeriodResult).toEqual([
      { id: 'r:T01:plan1', tenantId: TENANT, periodId: 'T01', goalPlanId: 'plan1', ownerType: 'Employee', totalScore: 92, ratingLevelId: level('B'), payoutPct: null, adjustmentPct: 0, status: 'Draft', finalizedAt: null },
      { id: 'r:T01:unit', tenantId: TENANT, periodId: 'T01', goalPlanId: 'unit', ownerType: 'OrgUnit', totalScore: 95, ratingLevelId: level('B'), payoutPct: null, adjustmentPct: 0, status: 'Draft', finalizedAt: null },
    ]);
    expect(d.ResultDetail.filter((x) => x.resultId === 'r:T01:plan1').map((x) => x.weightedScore)).toEqual([60, 32]);
  });

  it('ASSUMPTION Q17: no completed evaluation form → no employee result; a Draft plan has none either', () => {
    const open = data({ FormInstance: [form({ status: 'InProgress' })] });
    expect(applied(open, buildPeriodResults(open, 'T01', ids)).PeriodResult.map((r) => r.goalPlanId)).toEqual(['unit']);
    const draft = data({ GoalPlan: [plan({ status: 'Draft' })] });
    expect(applied(draft, buildPeriodResults(draft, 'T01', ids)).PeriodResult).toEqual([]);
  });

  it('recalculating a Draft keeps its id and adjustment and replaces its details; Final / Locked are left alone', () => {
    const first = applied(data(), buildPeriodResults(data(), 'T01', ids));
    const adjusted = applied(first, applyAdjustment(first, 'r:T01:plan1', 3));
    const changed = { ...adjusted, EvaluationItem: [evaluationItem({ goalId: 'g1', finalAchievementPct: 50 }), evaluationItem({ goalId: 'g2', finalAchievementPct: 50 })] };
    const again = applied(changed, buildPeriodResults(changed, 'T01', { result: () => 'NEW', detail: (r, g) => `d2:${g}` }));
    expect(again.PeriodResult.find((r) => r.goalPlanId === 'plan1')).toMatchObject({ id: 'r:T01:plan1', adjustmentPct: 3, totalScore: 53 });
    expect(again.ResultDetail.filter((x) => x.resultId === 'r:T01:plan1').map((x) => x.id)).toEqual(['d2:g1', 'd2:g2']);

    const final = { ...first, PeriodResult: first.PeriodResult.map((r) => ({ ...r, status: 'Final' as const })) };
    const outcome = buildPeriodResults({ ...final, EvaluationItem: changed.EvaluationItem }, 'T01', ids);
    expect(outcome.ok && outcome.changes).toEqual({ results: [], removedDetailIds: [], addedDetails: [] });
  });

  it('is refused once the cycle is Closed', () => {
    const outcome = buildPeriodResults(data({ PerformanceCycle: [cycle({ status: 'Closed' })] }), 'T01', ids);
    expect(outcome).toEqual({ ok: false, issues: [expect.objectContaining({ code: 'ERR-KPI-04', detail: 'CYCLE_CLOSED' })] });
  });
});

describe('applyAdjustment — setAdjustment', () => {
  const built = applied(data(), buildPeriodResults(data(), 'T01', ids));

  it('re-scores from the STORED details, not live data', () => {
    const live = { ...built, EvaluationItem: [] };
    const after = applied(live, applyAdjustment(live, 'r:T01:plan1', 10));
    expect(after.PeriodResult[0]).toMatchObject({ adjustmentPct: 10, totalScore: 102, ratingLevelId: level('A'), payoutPct: null });
  });

  it('in a paid period the re-rating moves the payout too (B 80% → A 100%)', () => {
    const d = paidData('Q1');
    const q1 = applied(d, buildPeriodResults(d, 'Q1', ids));
    expect(q1.PeriodResult[0]).toMatchObject({ ratingLevelId: level('B'), payoutPct: 80 });
    const after = applied(q1, applyAdjustment(q1, 'r:Q1:plan1', 10));
    expect(after.PeriodResult[0]).toMatchObject({ totalScore: 102, ratingLevelId: level('A'), payoutPct: 100 });
  });

  it('refuses a non-finite number (06) and a non-Draft result (04)', () => {
    expect(applyAdjustment(built, 'r:T01:plan1', Number.NaN)).toMatchObject({ ok: false, issues: [{ code: 'ERR-KPI-06', detail: 'ADJUSTMENT_INVALID' }] });
    const final = { ...built, PeriodResult: built.PeriodResult.map((r) => ({ ...r, status: 'Final' as const })) };
    expect(applyAdjustment(final, 'r:T01:plan1', 1)).toMatchObject({ ok: false, issues: [{ code: 'ERR-KPI-04', detail: 'RESULT_FINAL' }] });
  });

  it('refuses a Draft left in a Closed cycle (04 CYCLE_CLOSED)', () => {
    const closed = { ...built, PerformanceCycle: [cycle({ status: 'Closed' })] };
    expect(applyAdjustment(closed, 'r:T01:plan1', 1)).toMatchObject({ ok: false, issues: [{ code: 'ERR-KPI-04', detail: 'CYCLE_CLOSED' }] });
  });
});

describe('finalizePeriodResults / lockPeriodResults', () => {
  const built = applied(data(), buildPeriodResults(data(), 'T01', ids));

  it('Final at `now`, rounded once, the adjustment kept; then Locked', () => {
    const adjusted = applied(built, applyAdjustment(built, 'r:T01:plan1', 0.005));
    const final = applied(adjusted, finalizePeriodResults(adjusted, 'T01', undefined, NOW, ids));
    expect(final.PeriodResult.map((r) => [r.status, r.totalScore, r.finalizedAt])).toEqual([['Final', 92.01, NOW], ['Final', 95, NOW]]);
    const locked = applied(final, lockPeriodResults(final, 'T01'));
    expect(locked.PeriodResult.map((r) => r.status)).toEqual(['Locked', 'Locked']);
  });

  it('all or none: one result with an issue writes nothing and lists every issue', () => {
    const broken = { ...built, GoalActual: [actual({ goalId: 'u1', actualValue: null })], EvaluationItem: [evaluationItem({ goalId: 'g1', finalAchievementPct: 100 })] };
    const outcome = finalizePeriodResults(broken, 'T01', undefined, NOW, ids);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.issues.map((i) => [i.code, i.data?.resultId])).toEqual([
        ['ERR-KPI-07', 'r:T01:plan1'],
        ['ERR-KPI-09', 'r:T01:unit'],
      ]);
    }
  });

  it('refuses a Closed cycle (04 CYCLE_CLOSED) and a plan sent back to Draft since it was calculated (04 NOT_ELIGIBLE)', () => {
    const closed = { ...built, PerformanceCycle: [cycle({ status: 'Closed' })] };
    expect(finalizePeriodResults(closed, 'T01', undefined, NOW, ids)).toMatchObject({ ok: false, issues: [{ code: 'ERR-KPI-04', detail: 'CYCLE_CLOSED' }] });
    const reopened = { ...built, GoalPlan: built.GoalPlan.map((p) => (p.id === 'plan1' ? { ...p, status: 'Draft' as const } : p)) };
    const outcome = finalizePeriodResults(reopened, 'T01', ['r:T01:plan1'], NOW, ids);
    expect(outcome).toMatchObject({ ok: false, issues: [{ code: 'ERR-KPI-04', detail: 'NOT_ELIGIBLE' }] });
  });

  it('refuses: a listed result not Draft (04), of another period (06), nothing Draft (04); lock with no Final (04)', () => {
    const final = applied(built, finalizePeriodResults(built, 'T01', ['r:T01:unit'], NOW, ids));
    expect(finalizePeriodResults(final, 'T01', ['r:T01:unit'], NOW, ids)).toMatchObject({ ok: false, issues: [{ code: 'ERR-KPI-04', detail: 'NOT_DRAFT' }] });
    expect(finalizePeriodResults(final, 'T02', ['r:T01:plan1'], NOW, ids)).toMatchObject({ ok: false, issues: [{ code: 'ERR-KPI-06', detail: 'RESULT_OTHER_PERIOD' }] });
    expect(finalizePeriodResults(final, 'T02', undefined, NOW, ids)).toMatchObject({ ok: false, issues: [{ code: 'ERR-KPI-04', detail: 'NO_DRAFT' }] });
    expect(lockPeriodResults(built, 'T01')).toMatchObject({ ok: false, issues: [{ code: 'ERR-KPI-04', detail: 'NO_FINAL' }] });
    // Lock leaves Drafts as they are.
    const locked = applied(final, lockPeriodResults(final, 'T01'));
    expect(locked.PeriodResult.map((r) => [r.goalPlanId, r.status])).toEqual([['plan1', 'Draft'], ['unit', 'Locked']]);
  });
});
