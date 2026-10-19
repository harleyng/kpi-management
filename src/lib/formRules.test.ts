import { describe, expect, it } from 'vitest';
import type { GoalDraft } from '@/data/types';
import { calcMethod, evaluationItem, evaluationSteps, goal, goalChange, goals, kgi, registrationSteps } from '@/test/builders';
import { canSubmit, evaluationTotal, validateScoreInput } from './formRules';

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
    const items = scored();
    items[1] = { ...items[1], selfAchievementPct: null };
    items[2] = { ...items[2], selfAchievementPct: 0 };
    expect(issues(canSubmit({ formType: 'KPI_EVAL', step: selfStep, items, goals: planGoals }))).toEqual([['ERR-KPI-09', 'it-g2', 'SCORE_MISSING']]);
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
    const items = off.map((g) => evaluationItem({ goalId: g.id, finalAchievementPct: 100 }));
    expect(issues(canSubmit({ formType: 'KPI_EVAL', step: finalStep, items, goals: off }))[0][0]).toBe('ERR-KPI-07');
    const near = goals(3, [33.33, 33.33, 33.33]);
    const nearItems = near.map((g) => evaluationItem({ goalId: g.id, finalAchievementPct: 100 }));
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
