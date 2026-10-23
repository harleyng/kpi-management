import { describe, expect, it } from 'vitest';
import type { GoalActual, GoalDraft, KpiDefinition, WorkflowStep } from '@/data/types';
import { TENANT, calcMethod, evaluationSteps, goal, goalChange, goals, kgi, months2027, period, periodTarget, plan, registrationSteps, step } from '@/test/builders';
import {
  applyGoalChanges,
  canEditPlan,
  canLock,
  canUnlock,
  changeItemIssues,
  evenSplit,
  isWeightComplete,
  nextSortOrder,
  periodTargetIssues,
  splitPeriodType,
  planAfterChanges,
  planStatusOnEnterStep,
  planSummaries,
  planSummary,
  remainingWeight,
  statusAfterUnlock,
  submitIssues,
  totalWeight,
} from './goalPlanRules';
import { actualLines, type ActualContext } from './resultRules';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);
const threeKgis = [kgi({ id: 'k1' }), kgi({ id: 'k2' }), kgi({ id: 'k3' })];

describe('weights — BR-KPI-04, a tolerance of ±0.01, never === 100', () => {
  it.each([
    [100, true],
    [99.99, true],
    [100.01, true],
    [99.989, false],
    [100.011, false],
    [100.0100001, false],
    [99.98, false],
    [Number.NaN, false],
  ])('total %s → %s', (total, expected) => {
    expect(isWeightComplete(total)).toBe(expected);
  });

  it('adds computed weights with their float drift and still accepts them', () => {
    expect(isWeightComplete(totalWeight(goals(3, [33.33, 33.33, 33.34])))).toBe(true);
    expect(isWeightComplete(totalWeight(goals(10, Array(10).fill(10.001))))).toBe(true); // 100.01
    expect(isWeightComplete(totalWeight(goals(7, Array(7).fill(100 / 7))))).toBe(true);
  });

  it('counts only Active goals', () => {
    const list = [...goals(5), goal({ id: 'gone', weight: 30, status: 'Cancelled' }), goal({ id: 'old', weight: 30, status: 'Changed' })];
    expect(totalWeight(list)).toBeCloseTo(100);
  });
});

describe('submitIssues — what blocks "Gửi"', () => {
  it('passes 5 valid goals at 100% with 3 KGIs', () => {
    expect(submitIssues(goals(5), threeKgis)).toEqual({ blocking: [], warnings: [] });
  });

  it('reports the weight total for the screen (ERR-KPI-07)', () => {
    const { blocking } = submitIssues(goals(5, [20, 20, 20, 20, 10]), threeKgis);
    expect(blocking[0]).toMatchObject({ code: 'ERR-KPI-07', data: { totalWeight: 90 } });
  });

  it.each([
    [4, ['ERR-KPI-08']],
    [5, []],
    [8, []],
    [9, ['ERR-KPI-08']],
  ])('%s goals → %j', (count, expected) => {
    expect(codes(submitIssues(goals(count), threeKgis).blocking)).toEqual(expected);
  });

  it('flags each goal that cannot be measured or is incomplete, pointing at it (ERR-KPI-06)', () => {
    const list = [
      ...goals(4),
      goal({ id: 'bad', weight: 25, dataSourceId: '', targetValue: null, dueDate: '2026-12-31', name: ' ' }),
    ];
    const { blocking } = submitIssues(list, threeKgis);
    expect(blocking.filter((i) => i.ref === 'bad').map((i) => i.detail).sort()).toEqual(
      ['DATA_SOURCE_REQUIRED', 'DATES_INVALID', 'NAME_REQUIRED', 'TARGET_REQUIRED'].sort(),
    );
  });

  it('needs a target text on a TEXT goal', () => {
    const list = [...goals(4), goal({ id: 't', targetType: 'TEXT', targetValue: null, targetText: null })];
    expect(submitIssues(list, threeKgis).blocking.find((i) => i.ref === 't')?.detail).toBe('TARGET_REQUIRED');
  });

  it('only WARNS about a KGI count outside 3–5 (BR-KPI-02)', () => {
    const result = submitIssues(goals(5), []);
    expect(result.blocking).toEqual([]);
    expect(result.warnings[0]).toMatchObject({ detail: 'KGI_COUNT', data: { count: 0 } });
  });
});

describe('canEditPlan', () => {
  const base = { cycleClosed: false, openRegistrationForm: null, actorIsOwner: false, actorIsPlanAdmin: false };
  it.each([
    ['Locked', { ...base, actorIsPlanAdmin: true }, 'ERR-KPI-04'],
    ['Draft', { ...base, cycleClosed: true, actorIsOwner: true }, 'ERR-KPI-04'],
    ['Draft', { ...base, openRegistrationForm: { actorMayEditNow: true } }, null],
    ['Submitted', { ...base, openRegistrationForm: { actorMayEditNow: false }, actorIsOwner: true }, 'ERR-KPI-05'],
    ['Draft', { ...base, actorIsOwner: true }, null],
    ['Returned', { ...base, actorIsOwner: true }, null],
    ['Draft', { ...base, actorIsPlanAdmin: true }, null],
    ['Draft', base, 'ERR-KPI-05'],
    ['Approved', { ...base, actorIsOwner: true }, 'ERR-KPI-04'],
    ['Approved', { ...base, actorIsPlanAdmin: true }, null],
  ] as const)('%s plan, %j → %s', (status, ctx, code) => {
    const decision = canEditPlan(plan({ status }), ctx);
    expect(decision.ok ? null : decision.code).toBe(code);
  });
});

describe('planStatusOnEnterStep — the plan along registration (BR-KPI-12)', () => {
  const four = registrationSteps(); // manager → employee (SELF) → manager → HR
  it.each([
    [1, false, 'Draft'],
    [2, false, 'Draft'],
    [2, true, 'Returned'], // the manager returned it to the employee
    [3, false, 'Submitted'],
    [3, true, 'Submitted'], // HR returned it to the manager
    [4, false, 'Approved'],
  ] as const)('4 steps: entering %s (return: %s) → %s', (stepNo, viaReturn, expected) => {
    expect(planStatusOnEnterStep(stepNo, four, viaReturn)).toBe(expected);
  });

  const steps = (...rules: WorkflowStep['actorRule'][]) => rules.map((actorRule, i) => step({ stepNo: i + 1, actorRule }));
  it.each([
    [steps('SELF', 'DIRECT_MANAGER'), 2, 'Submitted'], // employee → manager (final)
    [steps('SELF', 'DIRECT_MANAGER', 'HR'), 2, 'Submitted'],
    [steps('SELF', 'DIRECT_MANAGER', 'HR'), 3, 'Approved'],
    [steps('SELF', 'DIRECT_MANAGER', 'MANAGER_L2', 'HR', 'CNB'), 4, 'Submitted'],
    [steps('SELF', 'DIRECT_MANAGER', 'MANAGER_L2', 'HR', 'CNB'), 5, 'Approved'],
    [steps('DIRECT_MANAGER', 'HR'), 1, 'Draft'], // no SELF step: step 1 stands in for the owner
    [steps('DIRECT_MANAGER', 'HR'), 2, 'Submitted'],
  ])('%# entering %s → %s', (s, stepNo, expected) => {
    expect(planStatusOnEnterStep(stepNo, s, false)).toBe(expected);
  });
});

describe('lock and unlock (BR-KPI-13, 14)', () => {
  const clock = { now: '2027-02-10T03:00:00.000Z', tz: 'Asia/Ho_Chi_Minh' };

  it('locks anything not already locked', () => {
    expect(canLock(plan({ status: 'Draft' })).ok).toBe(true);
    expect(canLock(plan({ status: 'Locked' }))).toEqual({ ok: false, code: 'ERR-KPI-04' });
  });

  it('unlocks with a reason and a due date from today on', () => {
    expect(canUnlock(plan({ status: 'Locked' }), { reason: 'Gia hạn', newDueDate: '2027-02-10' }, clock)).toEqual({ ok: true });
    const refused = canUnlock(plan({ status: 'Locked' }), { reason: ' ', newDueDate: '2027-02-09' }, clock);
    expect(refused.ok ? [] : refused.issues.map((i) => i.detail)).toEqual(['REASON_REQUIRED', 'DUE_DATE_INVALID']);
    expect(canUnlock(plan({ status: 'Approved' }), { reason: 'x', newDueDate: '2027-03-01' }, clock).ok).toBe(false);
  });

  it('returns the plan to where its open registration form stands, or Approved', () => {
    expect(statusAfterUnlock({ stepNo: 2, steps: registrationSteps() })).toBe('Draft');
    expect(statusAfterUnlock({ stepNo: 4, steps: registrationSteps() })).toBe('Approved');
    expect(statusAfterUnlock(null)).toBe('Approved');
  });

  it('is unaffected by the evaluation workflow shape', () => {
    expect(statusAfterUnlock({ stepNo: 1, steps: evaluationSteps() })).toBe('Draft');
  });
});

describe('adjustment — GOAL_CHANGE (BR-KPI-15)', () => {
  const current = goals(5); // g1…g5 at 20
  const draft = (o: Partial<GoalDraft> = {}): GoalDraft => {
    const { id: _id, tenantId: _t, goalPlanId: _p, status: _s, replacesGoalId: _r, sortOrder: _o, ...fields } = goal({ weight: 20, name: 'Mới' });
    return { ...fields, targetLevels: [], ...o };
  };

  it('previews the plan after the proposal for the 100% / 5–8 check', () => {
    const items = [
      goalChange({ id: 'c1', goalId: 'g1', changeType: 'CANCEL' }),
      goalChange({ id: 'c2', goalId: 'g2', changeType: 'MODIFY', proposed: draft({ weight: 40 }) }),
    ];
    const planned = planAfterChanges(current, items);
    expect(planned.find((g) => g.id === 'g1')?.status).toBe('Cancelled');
    expect(planned.find((g) => g.id === 'g2')?.status).toBe('Changed');
    expect(planned.find((g) => g.id === 'planned:c2')).toMatchObject({ status: 'Active', weight: 40 });
    expect(totalWeight(planned)).toBeCloseTo(100); // 20×3 + 40
    expect(codes(submitIssues(planned, threeKgis).blocking)).toEqual(['ERR-KPI-08']); // only 4 active goals left
  });

  it('applies MODIFY as a new Active goal replacing the old one, CANCEL and ADD', () => {
    let n = 0;
    const result = applyGoalChanges(plan(), current, [
      goalChange({ id: 'c1', goalId: 'g1', changeType: 'MODIFY', proposed: draft({ name: 'Doanh số mới' }) }),
      goalChange({ id: 'c2', goalId: 'g2', changeType: 'CANCEL' }),
      goalChange({ id: 'c3', goalId: null, changeType: 'ADD', proposed: draft({ name: 'Thêm' }) }),
    ], () => `new${++n}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects.statusChanges).toEqual([
      { goalId: 'g1', status: 'Changed' },
      { goalId: 'g2', status: 'Cancelled' },
    ]);
    expect(result.effects.creates.map((c) => [c.goal.id, c.goal.replacesGoalId, c.goal.status, c.goal.sortOrder])).toEqual([
      ['new1', 'g1', 'Active', 0],
      ['new2', null, 'Active', 5],
    ]);
  });

  it.each([
    [goalChange({ goalId: 'missing', changeType: 'CANCEL' }), 'GOAL_NOT_ACTIVE'],
    [goalChange({ goalId: 'g1', changeType: 'CANCEL', reason: '' }), 'REASON_REQUIRED'],
    [goalChange({ goalId: 'g1', changeType: 'MODIFY', proposed: null }), 'PROPOSAL_MISMATCH'],
    [goalChange({ goalId: 'g1', changeType: 'ADD', proposed: null }), 'ADD_HAS_GOAL'],
  ])('refuses %# → %s', (item, detail) => {
    expect(changeItemIssues(current, [item]).map((i) => i.detail)).toContain(detail);
    expect(applyGoalChanges(plan(), current, [item], () => 'x').ok).toBe(false);
  });

  it('refuses touching one goal twice', () => {
    const items = [goalChange({ id: 'a', goalId: 'g1' }), goalChange({ id: 'b', goalId: 'g1' })];
    expect(changeItemIssues(current, items).map((i) => [i.ref, i.detail])).toEqual([['b', 'GOAL_CHANGED_TWICE']]);
  });

  it('a draft ("Lưu nháp") may still lack its reason — only the submit requires it', () => {
    const noReason = goalChange({ goalId: 'g1', changeType: 'CANCEL', reason: '' });
    expect(changeItemIssues(current, [noReason], { draft: true })).toEqual([]);
    expect(changeItemIssues(current, [{ ...noReason, goalId: 'missing' }], { draft: true }).map((i) => i.detail)).toEqual(['GOAL_NOT_ACTIVE']);
    expect(changeItemIssues(current, [noReason]).map((i) => i.detail)).toEqual(['REASON_REQUIRED']);
  });
});

// ─── Period split and plan summaries (T3) ─────────────────────────────────────────────────────

const months = months2027();
const quarters = [1, 2, 3, 4].map((q) =>
  period({ id: `Q${q}`, periodType: 'Quarter', label: `Q${q}`, startDate: months[(q - 1) * 3].startDate, endDate: months[q * 3 - 1].endDate }),
);
const cyclePeriods = [...months, ...quarters];
const split = (values: number[], ids = months.map((m) => m.id)) => values.map((v, i) => periodTarget({ id: `pt${i}`, periodId: ids[i], targetValue: v }));
const sum = (xs: { targetValue: number }[]) => xs.reduce((a, x) => a + x.targetValue, 0);
const splitDetails = (issues: { detail: string | null }[]) => issues.map((i) => i.detail);

describe('evenSplit — "Chia đều" (BR-KPI-11, ASSUMPTION Q15)', () => {
  it('SUM 100 over 3 periods → 33.3333 ×2 + 33.3334, Σ exactly 100', () => {
    const shares = evenSplit(goal({ targetValue: 100 }), 'SUM', months.slice(0, 3));
    expect(shares.map((s) => s.targetValue)).toEqual([33.3333, 33.3333, 33.3334]);
    expect(sum(shares)).toBe(100);
  });

  it('SUM 9,6 tỷ over 12 months → 800 triệu each', () => {
    const shares = evenSplit(goal({ targetValue: 9_600_000_000 }), 'SUM', months);
    expect(new Set(shares.map((s) => s.targetValue))).toEqual(new Set([800_000_000]));
  });

  it('SUM 0.01 over 12 → the remainder on the last period', () => {
    const shares = evenSplit(goal({ targetValue: 0.01 }), 'SUM', months);
    expect(shares.slice(0, 11).every((s) => s.targetValue === 0.0008)).toBe(true);
    expect(shares[11].targetValue).toBe(0.0012);
    expect(sum(shares)).toBeCloseTo(0.01, 10);
  });

  it('target 0 and a single period', () => {
    expect(evenSplit(goal({ targetValue: 0 }), 'SUM', months).every((s) => s.targetValue === 0)).toBe(true);
    expect(evenSplit(goal({ targetValue: 7 }), 'SUM', [months[0]])).toEqual([{ periodId: 'T01', targetValue: 7 }]);
  });

  it('AVG and LAST repeat the target', () => {
    for (const agg of ['AVG', 'LAST'] as const) {
      expect(evenSplit(goal({ targetValue: 95 }), agg, months.slice(0, 4)).map((s) => s.targetValue)).toEqual([95, 95, 95, 95]);
    }
  });

  it('orders by date whatever the input order', () => {
    expect(evenSplit(goal({ targetValue: 10 }), 'SUM', [months[2], months[0], months[1]]).map((s) => s.periodId)).toEqual(['T01', 'T02', 'T03']);
  });

  it('TEXT, no target, no aggregation → nothing to spread', () => {
    expect(evenSplit(goal({ targetType: 'TEXT', targetValue: null, targetText: 'Đạt' }), 'SUM', months)).toEqual([]);
    expect(evenSplit(goal({ targetValue: null }), 'SUM', months)).toEqual([]);
    expect(evenSplit(goal(), null, months)).toEqual([]);
  });
});

describe('periodTargetIssues — warnings, never a block (BR-KPI-11)', () => {
  const g = goal({ targetValue: 120 });

  it('a correct split per aggregation → no warning', () => {
    expect(periodTargetIssues(g, 'SUM', split(Array(12).fill(10)), cyclePeriods)).toEqual([]);
    expect(periodTargetIssues(g, 'AVG', split([100, 140, ...Array(10).fill(120)]), cyclePeriods)).toEqual([]);
    expect(periodTargetIssues(g, 'LAST', split([...Array(11).fill(1), 120]), cyclePeriods)).toEqual([]);
  });

  it.each([
    ['SUM', Array(12).fill(9), 108],
    ['AVG', Array(12).fill(100), 100],
    ['LAST', [...Array(11).fill(120), 110], 110],
  ] as const)('%s mismatch → SPLIT_MISMATCH with the numbers', (agg, values, actual) => {
    expect(periodTargetIssues(g, agg, split([...values]), cyclePeriods)).toEqual([
      { code: 'ERR-KPI-06', ref: 'g1', detail: 'SPLIT_MISMATCH', data: { expected: 120, actual, aggregation: agg } },
    ]);
  });

  it('LAST reads the last period BY DATE, not by list order', () => {
    const targets = split([...Array(11).fill(1), 120]).reverse();
    expect(periodTargetIssues(g, 'LAST', targets, [...cyclePeriods].reverse())).toEqual([]);
  });

  it('tolerance: relative 1e-6 — 99.995 and 100.01 against 100 are mismatches; float drift is not', () => {
    const hundred = goal({ targetValue: 100 });
    const quarterSplit = (vs: number[]) => split(vs, quarters.map((q) => q.id));
    expect(splitDetails(periodTargetIssues(hundred, 'SUM', quarterSplit([25, 25, 25, 24.995]), cyclePeriods))).toEqual(['SPLIT_MISMATCH']);
    expect(splitDetails(periodTargetIssues(hundred, 'SUM', quarterSplit([25, 25, 25, 25.01]), cyclePeriods))).toEqual(['SPLIT_MISMATCH']);
    expect(periodTargetIssues(hundred, 'SUM', split(Array(12).fill(100 / 12)), cyclePeriods)).toEqual([]);
  });

  it('a large VND target tolerates sub-unit drift but not a missing million', () => {
    const big = goal({ targetValue: 96_000_000_000 });
    expect(periodTargetIssues(big, 'SUM', split([...Array(11).fill(8_000_000_000), 8_000_000_000.5]), cyclePeriods)).toEqual([]);
    expect(splitDetails(periodTargetIssues(big, 'SUM', split([...Array(11).fill(8_000_000_000), 7_999_000_000]), cyclePeriods))).toEqual(['SPLIT_MISMATCH']);
  });

  it('a target below 1 uses the absolute 0.005 floor', () => {
    const ratio = goal({ targetValue: 0.6 });
    expect(periodTargetIssues(ratio, 'AVG', split(Array(12).fill(0.604)), cyclePeriods)).toEqual([]);
    expect(splitDetails(periodTargetIssues(ratio, 'AVG', split(Array(12).fill(0.61)), cyclePeriods))).toEqual(['SPLIT_MISMATCH']);
  });

  it('a partial split → SPLIT_INCOMPLETE (covered / total)', () => {
    expect(periodTargetIssues(g, 'SUM', split(Array(11).fill(10)), cyclePeriods)).toEqual([
      { code: 'ERR-KPI-06', ref: 'g1', detail: 'SPLIT_INCOMPLETE', data: { covered: 11, total: 12 } },
    ]);
  });

  it('months and quarters mixed → SPLIT_MIXED_TYPES', () => {
    const mixed = [...split([10]), periodTarget({ id: 'q', periodId: 'Q2', targetValue: 30 })];
    expect(splitDetails(periodTargetIssues(g, 'SUM', mixed, cyclePeriods))).toEqual(['SPLIT_MIXED_TYPES']);
  });

  it('no aggregation (typed-in KPI) → SPLIT_NO_AGGREGATION, informational', () => {
    expect(splitDetails(periodTargetIssues(g, null, split(Array(12).fill(10)), cyclePeriods))).toEqual(['SPLIT_NO_AGGREGATION']);
  });

  it('nothing split, a TEXT goal, a null target → no issue', () => {
    expect(periodTargetIssues(g, 'SUM', [], cyclePeriods)).toEqual([]);
    expect(periodTargetIssues(goal({ targetType: 'TEXT', targetValue: null, targetText: 'Đạt' }), 'SUM', split([1]), cyclePeriods)).toEqual([]);
    expect(periodTargetIssues(goal({ targetValue: null }), 'SUM', split([1]), cyclePeriods)).toEqual([]);
  });

  it('only the goal\'s own rows count', () => {
    const others = split(Array(12).fill(10)).map((t) => ({ ...t, goalId: 'other' }));
    expect(periodTargetIssues(g, 'SUM', others, cyclePeriods)).toEqual([]);
  });
});

describe('splitPeriodType — the "Phân bổ theo quý / tháng" label (PEND-04)', () => {
  const row = (periodId: string, goalId = 'g1') => ({ goalId, periodId });
  it('names the type of the goal\'s own split; nothing split → null', () => {
    expect(splitPeriodType('g1', [row('T01'), row('T02')], cyclePeriods)).toBe('Month');
    expect(splitPeriodType('g1', [row(quarters[1].id), row(quarters[0].id)], cyclePeriods)).toBe('Quarter');
    expect(splitPeriodType('g1', [row('T01', 'other')], cyclePeriods)).toBeNull();
    expect(splitPeriodType('g1', [], cyclePeriods)).toBeNull();
  });
  it('mixed types: the earliest period\'s; a row of an unknown period is ignored', () => {
    expect(splitPeriodType('g1', [row('T05'), row(quarters[0].id)], cyclePeriods)).toBe('Quarter');
    expect(splitPeriodType('g1', [row('gone')], cyclePeriods)).toBeNull();
  });
});

describe('why the warning matters — a split feeds quarter results (resultRules)', () => {
  const kpi = { id: 'k1', aggregation: 'SUM' } as KpiDefinition;
  const g = goal({ kpiDefId: 'k1', targetValue: 120, weight: 100 });
  const actuals: GoalActual[] = ['T01', 'T02', 'T03'].map((p) => ({
    id: `a-${p}`, tenantId: TENANT, goalId: 'g1', periodId: p, actualValue: 10, actualText: null, sourceType: 'MANUAL',
    batchId: null, syncRunId: null, enteredBy: null, note: null, recordedAt: '2027-04-01T01:00:00.000Z', isCurrent: true,
  }));
  const q1 = (periodTargets: ActualContext['periodTargets']) =>
    actualLines([g], {
      period: quarters[0], periods: cyclePeriods, actuals, periodTargets, methods: [calcMethod({ capPct: 120 })], tiers: [], levels: [],
      kpiDefinitions: [kpi], allGoals: [g], alignments: [],
    })[0].achievementPct;

  it('a correct SUM split gives Q1 = Σ its months; a mismatched one changes the score', () => {
    expect(q1(split(Array(12).fill(10)))).toBe(100);
    expect(q1(split([20, 20, 20, ...Array(9).fill(10)]))).toBe(50);
  });

  it('a split missing one month of the quarter leaves Q1 with no target — not computable, never the annual one (PEND-04)', () => {
    const partial = split(Array(12).fill(10)).filter((t) => t.periodId !== 'T02');
    // Before A3 this scored 30 / 120 = 25%; what SPLIT_INCOMPLETE warns about now is a quarter with no %.
    expect(q1(partial)).toBeNull();
  });

  it('a quarter-only split: Q1 uses its own split, never the months', () => {
    const quarterOnly = [{ id: 'q', tenantId: TENANT, goalId: 'g1', periodId: quarters[0].id, targetValue: 30 }];
    expect(q1(quarterOnly)).toBe(100);
  });
});

describe('plan summaries — the header and HR\'s plan table', () => {
  it('per plan, from one goals list; Changed / Cancelled excluded; a plan with no goals is zero', () => {
    const list = [
      goal({ id: 'a', goalPlanId: 'p1', weight: 60 }),
      goal({ id: 'b', goalPlanId: 'p1', weight: 40 }),
      goal({ id: 'c', goalPlanId: 'p1', weight: 30, status: 'Cancelled' }),
      goal({ id: 'd', goalPlanId: 'p2', weight: 99.99 }),
      goal({ id: 'e', goalPlanId: 'elsewhere', weight: 5 }),
    ];
    const map = planSummaries(['p1', 'p2', 'p3'], list);
    expect(map.get('p1')).toEqual({ totalWeight: 100, weightComplete: true, goalCount: 2, goalCountOk: false });
    expect(map.get('p2')).toMatchObject({ totalWeight: 99.99, weightComplete: true, goalCount: 1 });
    expect(map.get('p3')).toEqual({ totalWeight: 0, weightComplete: false, goalCount: 0, goalCountOk: false });
    expect(map.has('elsewhere')).toBe(false);
  });

  it('goal count 5–8 is ok', () => {
    expect(planSummary(Array.from({ length: 5 }, (_, i) => goal({ id: `${i}`, weight: 20 }))).goalCountOk).toBe(true);
    expect(planSummary(Array.from({ length: 9 }, (_, i) => goal({ id: `${i}`, weight: 10 }))).goalCountOk).toBe(false);
  });

  it('remainingWeight never goes negative and rounds to 2 decimals', () => {
    expect(remainingWeight([goal({ weight: 62.5 })])).toBe(37.5);
    expect(remainingWeight([goal({ weight: 33.33 }), goal({ weight: 33.33 })])).toBe(33.34);
    expect(remainingWeight([goal({ weight: 120 })])).toBe(0);
    expect(remainingWeight([])).toBe(100);
  });

  it('nextSortOrder comes after the last goal', () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([goal({ sortOrder: 3 }), goal({ sortOrder: 1 })])).toBe(4);
  });
});
