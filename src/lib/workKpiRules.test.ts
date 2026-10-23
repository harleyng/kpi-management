import { describe, expect, it } from 'vitest';
import type { GoalActual } from '@/data/types';
import { calcMethod, goal, kpiDefinition, months2027, period, periodTarget } from '@/test/builders';
import { monthKpiReference } from './workKpiRules';

const jan = months2027()[0];
const actual = (goalId: string, value: number | null): GoalActual => ({
  id: `a-${goalId}`, tenantId: 't1', goalId, periodId: jan.id, actualValue: value, actualText: null, sourceType: 'MANUAL',
  batchId: null, syncRunId: null, enteredBy: null, note: null, recordedAt: '2027-02-01T00:00:00.000Z', isCurrent: true,
});
const ctx = (actuals: GoalActual[], targets = [periodTarget({ goalId: 'g1', periodId: jan.id, targetValue: 50 })]) => ({
  period: jan, periods: months2027(), actuals, periodTargets: targets, methods: [calcMethod()], tiers: [], levels: [], kpiDefinitions: [], allGoals: [], alignments: [],
});

describe('monthKpiReference — "KPI tháng (tham khảo)" (D-W3)', () => {
  it('actual, the month\'s target and the % the Results page would show; Active goals only, in order', () => {
    const goals = [goal({ id: 'g2', sortOrder: 1, name: 'B' }), goal({ id: 'g1', sortOrder: 0, name: 'A' }), goal({ id: 'g3', status: 'Cancelled' })];
    const lines = monthKpiReference(goals, jan, ctx([actual('g1', 40)]));
    expect(lines.map((l) => l.goalId)).toEqual(['g1', 'g2']);
    expect(lines[0]).toMatchObject({ actualValue: 40, target: 50, achievementPct: 80, targetSource: 'MONTH' });
  });

  it('no actual → no %, never 0; no month split → the goal\'s own target, flagged', () => {
    const [line] = monthKpiReference([goal({ id: 'g2' })], jan, ctx([]));
    expect(line).toMatchObject({ actualValue: null, achievementPct: null, target: 100, targetSource: 'GOAL' });
  });

  it('a quarter-only split: a SUM month is the quarter ÷ 3, flagged derived (ASSUMPTION Q67, A3)', () => {
    const q1 = period({ id: 'Q1', label: 'Q1', periodType: 'Quarter', startDate: '2027-01-01', endDate: '2027-03-31' });
    const kd = kpiDefinition({ id: 'kd-sum', aggregation: 'SUM' });
    const g = goal({ id: 'g4', kpiDefId: 'kd-sum', targetValue: 1200 });
    const [line] = monthKpiReference([g], jan, {
      ...ctx([], [periodTarget({ goalId: 'g4', periodId: 'Q1', targetValue: 300 })]),
      periods: [...months2027(), q1], kpiDefinitions: [kd],
    });
    expect(line).toMatchObject({ target: 100, targetSource: 'DERIVED' });
  });

  it('a split goal with nothing to derive the month from → no target (not the annual one), flagged derived', () => {
    const kd = kpiDefinition({ id: 'kd-sum', aggregation: 'SUM' });
    const g = goal({ id: 'g5', kpiDefId: 'kd-sum', targetValue: 1200 });
    const feb = months2027()[1];
    const [line] = monthKpiReference([g], jan, {
      ...ctx([], [periodTarget({ goalId: 'g5', periodId: feb.id, targetValue: 90 })]), kpiDefinitions: [kd],
    });
    expect(line).toMatchObject({ target: null, achievementPct: null, targetSource: 'DERIVED' });
  });
});
