import { describe, expect, it } from 'vitest';
import type { GoalDraft, WorkflowStep } from '@/data/types';
import { evaluationSteps, goal, goalChange, goals, kgi, plan, registrationSteps, step } from '@/test/builders';
import {
  applyGoalChanges,
  canEditPlan,
  canLock,
  canUnlock,
  changeItemIssues,
  isWeightComplete,
  planAfterChanges,
  planStatusOnEnterStep,
  statusAfterUnlock,
  submitIssues,
  totalWeight,
} from './goalPlanRules';

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
});
