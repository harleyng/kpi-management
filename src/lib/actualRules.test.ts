import { describe, expect, it } from 'vitest';
import { actualIssues, canRejectImport, isResultFinalised, type ActualEntryInput } from './actualRules';

const input = (o: Partial<ActualEntryInput> = {}): ActualEntryInput => ({
  actual: { actualValue: 42, actualText: null },
  goal: { status: 'Active', targetType: 'NUMERIC' },
  goalCycleId: 'c2027',
  period: { cycleId: 'c2027', isLocked: false, startDate: '2027-03-01' },
  resultsFinalised: false,
  asOf: '2027-04-06',
  ...o,
});
const details = (o: Partial<ActualEntryInput>) => actualIssues(input(o)).map((i) => `${i.code} ${i.detail}`);

describe('actualIssues — what recordActual and every import row refuse', () => {
  it('accepts a number on a NUMERIC goal, text on a TEXT goal, and a negative number', () => {
    expect(actualIssues(input())).toEqual([]);
    expect(actualIssues(input({ goal: { status: 'Active', targetType: 'TEXT' }, actual: { actualValue: null, actualText: 'Đạt' } }))).toEqual([]);
    expect(actualIssues(input({ actual: { actualValue: -1_500_000, actualText: null } }))).toEqual([]);
    expect(actualIssues(input({ actual: { actualValue: 0, actualText: null } }))).toEqual([]);
  });

  it('a locked period → ERR-KPI-04 PERIOD_LOCKED', () => {
    expect(details({ period: { cycleId: 'c2027', isLocked: true, startDate: '2027-01-01' } })).toEqual(['ERR-KPI-04 PERIOD_LOCKED']);
  });

  it('a Final / Locked result for the plan and period → ERR-KPI-04 RESULT_FINAL', () => {
    expect(details({ resultsFinalised: true })).toEqual(['ERR-KPI-04 RESULT_FINAL']);
  });

  it('a goal that is not Active → ERR-KPI-06 GOAL_NOT_ACTIVE', () => {
    expect(details({ goal: { status: 'Changed', targetType: 'NUMERIC' } })).toEqual(['ERR-KPI-06 GOAL_NOT_ACTIVE']);
    expect(details({ goal: { status: 'Cancelled', targetType: 'NUMERIC' } })).toEqual(['ERR-KPI-06 GOAL_NOT_ACTIVE']);
  });

  it('a period of another cycle → ERR-KPI-06 PERIOD_NOT_IN_CYCLE', () => {
    expect(details({ goalCycleId: 'c2026' })).toEqual(['ERR-KPI-06 PERIOD_NOT_IN_CYCLE']);
  });

  it('the wrong kind for the target type → ERR-KPI-06 ACTUAL_TYPE_MISMATCH', () => {
    expect(details({ actual: { actualValue: 42, actualText: 'Đạt' } })).toEqual(['ERR-KPI-06 ACTUAL_TYPE_MISMATCH']); // NUMERIC with text
    expect(details({ actual: { actualValue: null, actualText: 'Đạt' } })).toEqual(['ERR-KPI-06 ACTUAL_TYPE_MISMATCH']);
    expect(details({ actual: { actualValue: Number.NaN, actualText: null } })).toEqual(['ERR-KPI-06 ACTUAL_TYPE_MISMATCH']);
    const text = { status: 'Active' as const, targetType: 'TEXT' as const };
    expect(details({ goal: text, actual: { actualValue: 1, actualText: null } })).toEqual(['ERR-KPI-06 ACTUAL_TYPE_MISMATCH']); // TEXT with a number
    expect(details({ goal: text, actual: { actualValue: 1, actualText: 'Đạt' } })).toEqual(['ERR-KPI-06 ACTUAL_TYPE_MISMATCH']);
  });

  it('nothing entered → ERR-KPI-06 ACTUAL_REQUIRED (never stored as 0)', () => {
    expect(details({ actual: { actualValue: null, actualText: null } })).toEqual(['ERR-KPI-06 ACTUAL_REQUIRED']);
    expect(details({ actual: { actualValue: null, actualText: '  ' } })).toEqual(['ERR-KPI-06 ACTUAL_REQUIRED']);
  });

  it('a period that has not started → ERR-KPI-06 PERIOD_NOT_STARTED (ASSUMPTION Q18); its first day is fine', () => {
    expect(details({ period: { cycleId: 'c2027', isLocked: false, startDate: '2027-05-01' } })).toEqual(['ERR-KPI-06 PERIOD_NOT_STARTED']);
    expect(details({ period: { cycleId: 'c2027', isLocked: false, startDate: '2027-04-06' } })).toEqual([]);
  });

  it('lists every problem, state refusals first', () => {
    expect(
      details({
        period: { cycleId: 'other', isLocked: true, startDate: '2028-01-01' },
        resultsFinalised: true,
        goal: { status: 'Cancelled', targetType: 'NUMERIC' },
        actual: { actualValue: null, actualText: null },
      }),
    ).toEqual([
      'ERR-KPI-04 PERIOD_LOCKED',
      'ERR-KPI-04 RESULT_FINAL',
      'ERR-KPI-06 GOAL_NOT_ACTIVE',
      'ERR-KPI-06 PERIOD_NOT_IN_CYCLE',
      'ERR-KPI-06 ACTUAL_REQUIRED',
      'ERR-KPI-06 PERIOD_NOT_STARTED',
    ]);
  });
});

describe('isResultFinalised', () => {
  it('is true for a Final or Locked result of that plan and period only', () => {
    const results = [
      { goalPlanId: 'p1', periodId: 'T01', status: 'Locked' as const },
      { goalPlanId: 'p1', periodId: 'T02', status: 'Draft' as const },
      { goalPlanId: 'p2', periodId: 'T02', status: 'Final' as const },
    ];
    expect(isResultFinalised(results, 'p1', 'T01')).toBe(true);
    expect(isResultFinalised(results, 'p1', 'T02')).toBe(false);
    expect(isResultFinalised(results, 'p2', 'T02')).toBe(true);
    expect(isResultFinalised(results, 'p2', 'T01')).toBe(false);
  });
});

describe('canRejectImport — only a Validating batch (BR-KPI-52)', () => {
  it('allows Validating; refuses Committed and Rejected with ERR-KPI-04', () => {
    expect(canRejectImport({ status: 'Validating' })).toEqual({ ok: true });
    expect(canRejectImport({ status: 'Committed' })).toEqual({ ok: false, code: 'ERR-KPI-04' });
    expect(canRejectImport({ status: 'Rejected' })).toEqual({ ok: false, code: 'ERR-KPI-04' });
  });
});
