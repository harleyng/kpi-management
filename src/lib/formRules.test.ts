import { describe, expect, it } from 'vitest';
import type { CalcMethod, CalcMethodType, CyclePeriod, GoalDraft, WorkReview, WorkReviewItem } from '@/data/types';
import { DEFAULT_WORK_SCORING } from './workRules';
import { calcMethod, evaluationItem, evaluationSteps, goal, goalChange, goals, kgi, level, registrationSteps, tier } from '@/test/builders';
import {
  canSubmit,
  computedItemAchievement,
  computedItemPct,
  evaluationTotal,
  finalOverrideIssues,
  formActualIssues,
  itemsOnEnterColumn,
  managerOverrideIssues,
  samePct,
  sameActual,
  scoreCeiling,
  validateScoreInput,
  withFormActual,
} from './formRules';

const threeKgis = [kgi({ id: 'k1' }), kgi({ id: 'k2' }), kgi({ id: 'k3' })];
const issues = (r: ReturnType<typeof canSubmit>) => (r.ok ? [] : r.issues.map((i) => [i.code, i.ref, i.detail]));

describe('canSubmit — KPI_EVAL (D6, BR-KPI-18)', () => {
  const [selfStep, managerStep, finalStep] = evaluationSteps();
  const planGoals = goals(5); // g1…g5 at 20
  const scored = (o = {}) => planGoals.map((g) => evaluationItem({ goalId: g.id, selfAchievementPct: 90, ...o }));

  it('passes when every item has the step\'s column', () => {
    expect(canSubmit({ formType: 'KPI_EVAL', step: selfStep, items: scored(), goals: planGoals })).toEqual({ ok: true });
  });

  it('points at each unscored item (ERR-KPI-09); 0 is a score, null is not', () => {
    const items = scored({ managerAchievementPct: 90 });
    items[1] = { ...items[1], managerAchievementPct: null };
    items[2] = { ...items[2], managerAchievementPct: 0, managerComment: 'Không đạt' };
    expect(issues(canSubmit({ formType: 'KPI_EVAL', step: { ...managerStep, requiresComment: false }, items, goals: planGoals }))).toEqual([['ERR-KPI-09', 'it-g2', 'SCORE_MISSING']]);
  });

  it('the SELF column is the system\'s: no actual → no %, and the employee still sends (PEND-07)', () => {
    const items = scored();
    items[1] = { ...items[1], selfAchievementPct: null };
    expect(canSubmit({ formType: 'KPI_EVAL', step: selfStep, items, goals: planGoals })).toEqual({ ok: true });
    // …but owes the explanation where the step requires it.
    expect(issues(canSubmit({ formType: 'KPI_EVAL', step: { ...selfStep, requiresComment: true }, items, goals: planGoals }))).toHaveLength(5);
  });

  it('reads the column the STEP names, not the step number', () => {
    // the self column is filled, the manager step needs the manager column
    const result = canSubmit({ formType: 'KPI_EVAL', step: managerStep, items: scored(), goals: planGoals });
    expect(issues(result)).toHaveLength(5);
  });

  it('requires a comment where the step says so', () => {
    const items = scored({ managerAchievementPct: 80, managerComment: '  ' });
    expect(issues(canSubmit({ formType: 'KPI_EVAL', step: managerStep, items, goals: planGoals }))[0]).toEqual(['ERR-KPI-09', 'it-g1', 'COMMENT_MISSING']);
    const commented = scored({ managerAchievementPct: 80, managerComment: 'Tốt' });
    expect(canSubmit({ formType: 'KPI_EVAL', step: managerStep, items: commented, goals: planGoals }).ok).toBe(true);
  });

  it('blocks on the weights of the goals on the form (99.99 passes)', () => {
    const off = goals(5, [20, 20, 20, 20, 10]);
    const items = off.map((g) => evaluationItem({ goalId: g.id, managerAchievementPct: 100, finalAchievementPct: 100 }));
    expect(issues(canSubmit({ formType: 'KPI_EVAL', step: finalStep, items, goals: off }))[0][0]).toBe('ERR-KPI-07');
    const near = goals(3, [33.33, 33.33, 33.33]);
    const nearItems = near.map((g) => evaluationItem({ goalId: g.id, managerAchievementPct: 100, finalAchievementPct: 100 }));
    expect(canSubmit({ formType: 'KPI_EVAL', step: finalStep, items: nearItems, goals: near }).ok).toBe(true);
  });

  it('a step that scores no column checks the weights only', () => {
    const items = planGoals.map((g) => evaluationItem({ goalId: g.id }));
    expect(canSubmit({ formType: 'KPI_EVAL', step: { ...selfStep, evaluationColumn: null }, items, goals: planGoals }).ok).toBe(true);
  });
});

describe('canSubmit — GOAL_SETTING', () => {
  const steps = registrationSteps(); // the owner's step is 2
  const unfinished = goals(2, [30, 30]);

  it('lets the manager hand an unfinished plan to the employee at step 1', () => {
    expect(canSubmit({ formType: 'GOAL_SETTING', stepNo: 1, steps, goals: unfinished, kgis: [] }).ok).toBe(true);
  });

  it.each([2, 3, 4])('requires a complete plan from the owner\'s step on (step %s)', (stepNo) => {
    expect(issues(canSubmit({ formType: 'GOAL_SETTING', stepNo, steps, goals: unfinished, kgis: threeKgis })).map((i) => i[0])).toEqual(['ERR-KPI-07', 'ERR-KPI-08']);
    expect(canSubmit({ formType: 'GOAL_SETTING', stepNo, steps, goals: goals(5), kgis: threeKgis }).ok).toBe(true);
  });

  it('does not block on the KGI count (a warning only)', () => {
    expect(canSubmit({ formType: 'GOAL_SETTING', stepNo: 2, steps, goals: goals(5), kgis: [] }).ok).toBe(true);
  });
});

describe('canSubmit — GOAL_CHANGE', () => {
  const current = goals(6, [20, 20, 20, 20, 10, 10]);
  const draft = (weight: number): GoalDraft => {
    const { id: _i, tenantId: _t, goalPlanId: _p, status: _s, replacesGoalId: _r, sortOrder: _o, ...fields } = goal({ weight });
    return { ...fields, targetLevels: [] };
  };

  it('checks the plan AS IT WOULD BE after the proposal', () => {
    const balanced = [goalChange({ id: 'c1', goalId: 'g6', changeType: 'CANCEL' }), goalChange({ id: 'c2', goalId: 'g5', changeType: 'MODIFY', proposed: draft(20) })];
    expect(canSubmit({ formType: 'GOAL_CHANGE', goals: current, changeItems: balanced, kgis: threeKgis }).ok).toBe(true);
    const unbalanced = [goalChange({ id: 'c1', goalId: 'g6', changeType: 'CANCEL' })];
    expect(issues(canSubmit({ formType: 'GOAL_CHANGE', goals: current, changeItems: unbalanced, kgis: threeKgis }))[0][0]).toBe('ERR-KPI-07');
  });

  it('needs at least one change, each with a reason', () => {
    expect(issues(canSubmit({ formType: 'GOAL_CHANGE', goals: current, changeItems: [], kgis: threeKgis }))).toEqual([['ERR-KPI-06', null, 'NO_CHANGES']]);
    const noReason = [goalChange({ goalId: 'g6', reason: '' })];
    expect(issues(canSubmit({ formType: 'GOAL_CHANGE', goals: current, changeItems: noReason, kgis: threeKgis }))[0][2]).toBe('REASON_REQUIRED');
  });
});

describe('canSubmit — WORK_PLAN (PEND-14, 8.2)', () => {
  const steps = registrationSteps().slice(0, 3); // top-down: manager → employee (2) → manager
  const march = { startDate: '2027-03-01', endDate: '2027-03-31' };
  const task = (id: string, weight: number) => ({ id, weight, cancelledAt: null, name: `Việc ${id}`, startDate: '2027-03-01', dueDate: '2027-03-31' });

  it('before the employee\'s step (a manager assigning first) the list may be unfinished', () => {
    expect(canSubmit({ formType: 'WORK_PLAN', stepNo: 1, steps, tasks: [], period: march }).ok).toBe(true);
  });

  it.each([2, 3])('from the employee\'s step on: at least one task, weights at 100%% (step %s)', (stepNo) => {
    expect(issues(canSubmit({ formType: 'WORK_PLAN', stepNo, steps, tasks: [], period: march }))).toEqual([['ERR-KPI-06', null, 'PLAN_EMPTY']]);
    expect(issues(canSubmit({ formType: 'WORK_PLAN', stepNo, steps, tasks: [task('a', 60)], period: march })).map((i) => i[0])).toEqual(['ERR-KPI-07']);
    expect(canSubmit({ formType: 'WORK_PLAN', stepNo, steps, tasks: [task('a', 60), task('b', 40)], period: march }).ok).toBe(true);
  });

  it('a form with no month cannot be checked', () => {
    expect(issues(canSubmit({ formType: 'WORK_PLAN', stepNo: 2, steps, tasks: [task('a', 100)], period: null }))).toEqual([['ERR-KPI-06', 'periodId', 'PERIOD_REQUIRED']]);
  });

});

describe('canSubmit — WORK_REVIEW (PEND-14, 8.3)', () => {
  const [selfStep, managerStep, finalStep] = evaluationSteps();
  const tasks = [{ id: 'a', weight: 50, cancelledAt: null }, { id: 'b', weight: 50, cancelledAt: null }];
  const review = (o: Partial<WorkReview> = {}): WorkReview => ({
    id: 'r', tenantId: 't', formId: 'f', workPlanId: 'p', selfDisciplineScore: null, selfComment: null, managerDisciplineScore: null, managerComment: null,
    managerHsnv: null, managerHsnvReason: null, finalDisciplineScore: null, finalComment: null, finalHsnv: null, finalHsnvReason: null, ...o,
  });
  const item = (taskId: string, o: Partial<WorkReviewItem> = {}): WorkReviewItem => ({
    id: `i-${taskId}`, tenantId: 't', formId: 'f', taskId, selfScore: null, selfComment: null, managerScore: null, managerComment: null, finalScore: null, finalComment: null, ...o,
  });
  const check = (step: typeof selfStep, r: WorkReview | null, items: WorkReviewItem[]) =>
    issues(canSubmit({ formType: 'WORK_REVIEW', step, review: r, items, tasks, config: DEFAULT_WORK_SCORING }));

  it('SELF: every task and KLcv scored — 0 is a score', () => {
    expect(check(selfStep, review({ selfDisciplineScore: 0 }), [item('a', { selfScore: 0 }), item('b', { selfScore: 100 })])).toEqual([]);
    expect(check(selfStep, review(), [item('a', { selfScore: 90 }), item('b')]).map((i) => i[2])).toEqual(['TASK_SCORE_REQUIRED', 'DISCIPLINE_REQUIRED']);
  });

  it('MANAGER: Hsht 79.99 needs Hsnv and its reason; 80 does not', () => {
    const low = [item('a', { managerScore: 79.99 }), item('b', { managerScore: 79.99 })];
    expect(check(managerStep, review({ managerDisciplineScore: 79.99 }), low).map((i) => i[2])).toEqual(['HSNV_REQUIRED', 'HSNV_REASON_REQUIRED']);
    expect(check(managerStep, review({ managerDisciplineScore: 79.99, managerHsnv: 85, managerHsnvReason: 'Lý do' }), low)).toEqual([]);
    const ok = [item('a', { managerScore: 80 }), item('b', { managerScore: 80 })];
    expect(check(managerStep, review({ managerDisciplineScore: 80 }), ok)).toEqual([]);
  });

  it('FINAL: what HR changed carries a reason', () => {
    const items = [item('a', { managerScore: 90, finalScore: 90 }), item('b', { managerScore: 90, finalScore: 85 })];
    expect(check(finalStep, review({ managerDisciplineScore: 90, finalDisciplineScore: 90 }), items)).toEqual([['ERR-KPI-06', 'b', 'FINAL_REASON_REQUIRED']]);
  });

  it('a step without a column passes; a form without its review row does not', () => {
    expect(check({ ...selfStep, evaluationColumn: null }, null, [])).toEqual([]);
    expect(check(selfStep, null, [])).toEqual([['ERR-KPI-06', null, 'REVIEW_MISSING']]);
  });
});

describe('validateScoreInput', () => {
  const capped = calcMethod({ capPct: 120 });
  it.each([
    [null, capped, null],
    [0, capped, null],
    [120, capped, null],
    [120.01, capped, 'SCORE_OUT_OF_RANGE'],
    [-1, capped, 'SCORE_OUT_OF_RANGE'],
    [Number.NaN, capped, 'SCORE_OUT_OF_RANGE'],
    [500, calcMethod({ methodType: 'TIERED', capPct: null }), null],
  ])('%s → %s', (pct, method, detail) => {
    expect(validateScoreInput(pct, method)?.detail ?? null).toBe(detail);
  });
});

describe('evaluationTotal — the form footer', () => {
  it('weights one column, leaving unscored goals out and marking the total incomplete', () => {
    const planGoals = goals(2, [60, 40]);
    const items = [evaluationItem({ goalId: 'g1', managerAchievementPct: 100 }), evaluationItem({ goalId: 'g2', managerAchievementPct: 50 })];
    expect(evaluationTotal(items, planGoals, 'MANAGER')).toMatchObject({ score: 80, complete: true });
    expect(evaluationTotal(items, planGoals, 'FINAL')).toMatchObject({ score: null, complete: false });
  });

  it('counts an item whose goal is unknown as missing, never drops it', () => {
    const planGoals = goals(1, [100]);
    const items = [evaluationItem({ goalId: 'g1', managerAchievementPct: 90 }), evaluationItem({ goalId: 'ghost', managerAchievementPct: 50 })];
    expect(evaluationTotal(items, planGoals, 'MANAGER')).toMatchObject({ score: 90, complete: false, missingGoalIds: ['ghost'] });
  });
});

// ─── PEND-06 / 07 / 08 — the system's %, the form's actual, the manager's and HR's decisions ─────

describe('computedItemPct — the system\'s % on the form (PEND-07)', () => {
  const on = (actualValue: number | null, targetSnapshot: number | null, actualText: string | null = null) => ({ actualValue, actualText, targetSnapshot });
  const ctx = (methodType: CalcMethodType, o: Partial<CalcMethod> = {}, extra = {}) => ({
    goal: goal(),
    method: calcMethod({ methodType, ...o }),
    tiers: [],
    levels: [],
    ...extra,
  });

  it.each([
    ['RATIO_UP', on(90, 100), 90],
    ['RATIO_UP over the cap', on(200, 100), 120],
    ['RATIO_UP actual 0 is a score', on(0, 100), 0],
    ['RATIO_DOWN', on(80, 100), 120], // 125% capped at 120
    ['RATIO_DOWN exact', on(100, 100), 100],
  ] as const)('%s', (name, item, pct) => {
    const methodType = name.startsWith('RATIO_DOWN') ? 'RATIO_DOWN' : 'RATIO_UP';
    expect(computedItemPct(item, ctx(methodType))).toBe(pct);
  });

  it('reads the TARGET SNAPSHOT of the period, not the goal\'s annual target (a quarter form)', () => {
    // Annual 15 tỷ, the quarter's 3,75 tỷ: 3 tỷ is 80% of the quarter, not 20% of the year.
    const yearly = { ...ctx('RATIO_UP'), goal: goal({ targetValue: 15_000 }) };
    expect(computedItemPct(on(3_000, 3_750), yearly)).toBe(80);
  });

  it('no actual → null (NO_ACTUAL), never 0; target 0 → not computable (ERR-KPI-12)', () => {
    expect(computedItemPct(on(null, 100), ctx('RATIO_UP'))).toBeNull();
    expect(computedItemAchievement(on(null, 100), ctx('RATIO_UP')).status).toBe('NO_ACTUAL');
    expect(computedItemAchievement(on(10, 0), ctx('RATIO_UP'))).toEqual({ status: 'NOT_COMPUTABLE', reason: 'TARGET_ZERO' });
    expect(computedItemPct(on(10, null), ctx('RATIO_UP'))).toBeNull();
    expect(computedItemAchievement(on(10, 100), { ...ctx('RATIO_UP'), method: null }).status).toBe('NOT_COMPUTABLE');
  });

  it('TIERED reads the method\'s tiers only', () => {
    const tiers = [tier({ id: 'a', fromValue: null, toValue: 1, achievementPct: 100 }), tier({ id: 'b', fromValue: 1, toValue: null, achievementPct: 70 }), tier({ id: 'x', calcMethodId: 'other', fromValue: null, toValue: null, achievementPct: 5 })];
    expect(computedItemPct(on(2, 0), ctx('TIERED', { capPct: null }, { tiers }))).toBe(70);
  });

  it('BINARY on a TEXT goal reads the actual text against the goal\'s target text', () => {
    const binary = { ...ctx('BINARY', { capPct: null }), goal: goal({ targetType: 'TEXT', targetValue: null, targetText: 'Đạt' }) };
    expect(computedItemPct(on(null, null, 'Đạt'), binary)).toBe(100);
    expect(computedItemPct(on(null, null, 'Không đạt'), binary)).toBe(0);
  });

  it('LEVELS reads the goal\'s levels (interpolated, ASSUMPTION Q1)', () => {
    const levels = [level({ levelCode: 'L1', targetValue: 20, scorePct: 0 }), level({ levelCode: 'L2', targetValue: 30, scorePct: 100 }), level({ goalId: 'other', levelCode: 'L3', targetValue: 40, scorePct: 120 })];
    expect(computedItemPct(on(25, 30), ctx('LEVELS', { capPct: null }, { levels }))).toBe(50);
  });

  it('FORMULA runs its expression', () => {
    expect(computedItemPct(on(50, 100), ctx('FORMULA', { formulaExpr: 'actual / target * 100' }))).toBe(50);
  });
});

describe('samePct — one tolerance for every "is it the same score" (0.005)', () => {
  it.each([
    [80, 80.004, true],
    [80, 80.005, true],
    [80, 80.006, false],
    [83.3333, 83.33, true],
    [null, null, true],
    [null, 0, false],
  ])('%s vs %s → %s', (a, b, same) => expect(samePct(a, b)).toBe(same));
});

describe('withFormActual — the employee or the manager changes the actual (PEND-06)', () => {
  const item = evaluationItem({ actualSnapshot: 90, selfAchievementPct: 90, managerAchievementPct: 90 });

  it('recomputes the SELF %, records who entered it, and the manager\'s default follows', () => {
    const next = withFormActual(item, { actualValue: 95, actualText: null }, 95, 'u-e1');
    expect(next).toMatchObject({ actualValue: 95, actualEnteredBy: 'u-e1', selfAchievementPct: 95, managerAchievementPct: 95 });
  });

  it('a manager\'s override stays put', () => {
    const overridden = { ...item, managerAchievementPct: 70 };
    expect(withFormActual(overridden, { actualValue: 95, actualText: null }, 95, 'u-m1').managerAchievementPct).toBe(70);
  });

  it('an empty manager % stays empty (the default comes when the step is entered)', () => {
    expect(withFormActual({ ...item, managerAchievementPct: null }, { actualValue: 95, actualText: null }, 95, 'u-e1').managerAchievementPct).toBeNull();
  });

  it('sameActual: blank text is no text; an unchanged value is not a change', () => {
    expect(sameActual({ actualValue: 1, actualText: null }, { actualValue: 1, actualText: '  ' })).toBe(true);
    expect(sameActual({ actualValue: 1, actualText: null }, { actualValue: 2, actualText: null })).toBe(false);
  });
});

describe('itemsOnEnterColumn — what entering a step does (PEND-07/08)', () => {
  const base = evaluationItem({ id: 'i1', actualSnapshot: 90, selfAchievementPct: 90 });
  const computed = (pct: number | null) => new Map([['i1', pct]]);

  it('leaving SELF keeps the submitted actual; entering MANAGER starts the manager at the system\'s %', () => {
    const [next] = itemsOnEnterColumn([base], 'MANAGER', 'SELF', computed(90));
    expect(next).toMatchObject({ submittedActualValue: 90, managerAchievementPct: 90 });
  });

  it('no system % → the manager starts empty and must decide (with a comment)', () => {
    // Nothing to keep, nothing to default: the item is unchanged and the manager % stays empty.
    expect(itemsOnEnterColumn([{ ...base, actualValue: null, selfAchievementPct: null }], 'MANAGER', 'SELF', computed(null))).toEqual([]);
  });

  it('recomputes the system % on entry (a method edited since), and a following manager % moves with it', () => {
    const [next] = itemsOnEnterColumn([{ ...base, managerAchievementPct: 90 }], 'MANAGER', 'SELF', computed(85));
    expect(next).toMatchObject({ selfAchievementPct: 85, managerAchievementPct: 85 });
  });

  it('a return to SELF and back: the non-overridden default is still the system\'s, not an override', () => {
    const returned = { ...base, managerAchievementPct: 90 };
    const edited = withFormActual(returned, { actualValue: 80, actualText: null }, 80, 'u-e1');
    const [back] = itemsOnEnterColumn([edited], 'MANAGER', 'SELF', computed(80));
    expect(back.managerAchievementPct).toBe(80);
    expect(managerOverrideIssues([back])).toEqual([]);
  });

  it('entering FINAL copies MANAGER and clears HR\'s reason; a second FINAL step keeps HR\'s edit', () => {
    const scored = { ...base, managerAchievementPct: 85, finalAchievementPct: 70, finalComment: 'cũ' };
    const [next] = itemsOnEnterColumn([scored], 'FINAL', 'MANAGER', computed(90));
    expect(next).toMatchObject({ finalAchievementPct: 85, finalComment: null });
    const kept = itemsOnEnterColumn([scored], 'FINAL', 'FINAL', computed(90));
    expect(kept).toEqual([]);
  });

  it('returns only the items that change', () => {
    const done = { ...base, managerAchievementPct: 90, submittedActualValue: 90 };
    expect(itemsOnEnterColumn([done], 'MANAGER', 'MANAGER', computed(90))).toEqual([]);
  });
});

describe('override rules — the manager decides, HR records (Q47, Q49)', () => {
  const item = (o = {}) => evaluationItem({ id: 'i1', actualValue: 90, submittedActualValue: 90, selfAchievementPct: 90, managerAchievementPct: 90, ...o });
  const details = (issues: ReturnType<typeof managerOverrideIssues>) => issues.map((i) => [i.code, i.ref, i.detail]);

  it('the manager keeping the system\'s % needs no comment; a different % does (ERR-KPI-06)', () => {
    expect(managerOverrideIssues([item()])).toEqual([]);
    expect(details(managerOverrideIssues([item({ managerAchievementPct: 80 })]))).toEqual([['ERR-KPI-06', 'i1', 'OVERRIDE_COMMENT_REQUIRED']]);
    expect(managerOverrideIssues([item({ managerAchievementPct: 80, managerComment: 'Theo đối soát' })])).toEqual([]);
    expect(managerOverrideIssues([item({ managerAchievementPct: 90.004 })])).toEqual([]);
  });

  it('a % where the system has none needs a comment', () => {
    expect(details(managerOverrideIssues([item({ actualValue: null, submittedActualValue: null, selfAchievementPct: null, managerAchievementPct: 80 })]))).toEqual([['ERR-KPI-06', 'i1', 'OVERRIDE_COMMENT_REQUIRED']]);
  });

  it('a manager who corrected the employee\'s actual says why', () => {
    const corrected = item({ actualValue: 85, selfAchievementPct: 85, managerAchievementPct: 85 });
    expect(details(managerOverrideIssues([corrected]))).toEqual([['ERR-KPI-06', 'i1', 'ACTUAL_CHANGE_COMMENT_REQUIRED']]);
    expect(managerOverrideIssues([{ ...corrected, managerComment: 'Số đối soát' }])).toEqual([]);
  });

  it('HR\'s FINAL equal to the manager\'s passes; a different one needs a reason', () => {
    expect(finalOverrideIssues([item({ finalAchievementPct: 90 })])).toEqual([]);
    expect(finalOverrideIssues([item({ finalAchievementPct: 85 })]).map((i) => i.detail)).toEqual(['OVERRIDE_REASON_REQUIRED']);
    expect(finalOverrideIssues([item({ finalAchievementPct: 85, finalComment: 'Đặc biệt' })])).toEqual([]);
  });

  it('canSubmit at MANAGER and FINAL runs the override rules', () => {
    const [, managerStep, finalStep] = evaluationSteps();
    const g = [goal({ id: 'g1', weight: 100 })];
    const plain = { ...managerStep, requiresComment: false };
    expect(canSubmit({ formType: 'KPI_EVAL', step: plain, items: [item({ managerAchievementPct: 70 })], goals: g }).ok).toBe(false);
    expect(canSubmit({ formType: 'KPI_EVAL', step: plain, items: [item()], goals: g }).ok).toBe(true);
    expect(canSubmit({ formType: 'KPI_EVAL', step: finalStep, items: [item({ finalAchievementPct: 50 })], goals: g }).ok).toBe(false);
    expect(canSubmit({ formType: 'KPI_EVAL', step: finalStep, items: [item({ finalAchievementPct: 90 })], goals: g }).ok).toBe(true);
  });
});

describe('formActualIssues — the actual on the form (PEND-06)', () => {
  const month: Pick<CyclePeriod, 'cycleId' | 'isLocked' | 'startDate' | 'periodType'> = { cycleId: 'c2027', isLocked: false, startDate: '2027-01-01', periodType: 'Month' };
  const input = (o = {}) => ({ goal: goal(), goalCycleId: 'c2027', period: month, resultsFinalised: false, asOf: '2027-02-02', ...o });
  const details = (issues: ReturnType<typeof formActualIssues>) => issues.map((i) => i.detail);

  it('a number on a NUMERIC goal, a negative one too; clearing is allowed (no actual, never 0)', () => {
    expect(formActualIssues({ actualValue: 5, actualText: null }, input())).toEqual([]);
    expect(formActualIssues({ actualValue: -5, actualText: null }, input())).toEqual([]);
    expect(formActualIssues({ actualValue: null, actualText: null }, input())).toEqual([]);
  });

  it('the wrong kind of value → 06 ACTUAL_TYPE_MISMATCH', () => {
    expect(details(formActualIssues({ actualValue: null, actualText: 'Đạt' }, input()))).toEqual(['ACTUAL_TYPE_MISMATCH']);
    expect(details(formActualIssues({ actualValue: 1, actualText: null }, input({ goal: goal({ targetType: 'TEXT' }) })))).toEqual(['ACTUAL_TYPE_MISMATCH']);
    expect(details(formActualIssues({ actualValue: Number.NaN, actualText: null }, input()))).toEqual(['ACTUAL_TYPE_MISMATCH']);
  });

  it('a Final result or a locked period → 04; a quarter form takes its figure; a later-changed goal still does', () => {
    expect(formActualIssues({ actualValue: 1, actualText: null }, input({ resultsFinalised: true })).map((i) => [i.code, i.detail])).toEqual([['ERR-KPI-04', 'RESULT_FINAL']]);
    expect(details(formActualIssues({ actualValue: 1, actualText: null }, input({ period: { ...month, isLocked: true } })))).toEqual(['PERIOD_LOCKED']);
    expect(formActualIssues({ actualValue: 1, actualText: null }, input({ period: { ...month, periodType: 'Quarter' } }))).toEqual([]);
    expect(formActualIssues({ actualValue: 1, actualText: null }, input({ goal: goal({ status: 'Changed' }) }))).toEqual([]);
  });
});

describe('scoreCeiling / validateScoreInput — a typed % has a top even without a cap', () => {
  it('the cap; else the top tier or level; never below 100', () => {
    expect(scoreCeiling(calcMethod({ capPct: 120 }), [], [])).toBe(120);
    expect(scoreCeiling(calcMethod({ methodType: 'TIERED', capPct: null }), [tier({ achievementPct: 70 })], [])).toBe(100);
    expect(scoreCeiling(calcMethod({ methodType: 'LEVELS', capPct: null }), [], [level({ scorePct: 130 })])).toBe(130);
    const limits = { tiers: [], levels: [level({ scorePct: 110 })] };
    expect(validateScoreInput(500, calcMethod({ methodType: 'LEVELS', capPct: null }), limits)?.detail).toBe('SCORE_OUT_OF_RANGE');
    expect(validateScoreInput(110, calcMethod({ methodType: 'LEVELS', capPct: null }), limits)).toBeNull();
  });
});
