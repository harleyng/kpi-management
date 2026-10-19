import { describe, expect, it } from 'vitest';
import {
  actualIssues,
  canRejectImport,
  currentActual,
  entryBlockers,
  isEvidenceUrl,
  isResultFinalised,
  monthlySchedule,
  syncKeepsHumanActual,
  syncRunStatus,
  type ActualEntryInput,
} from './actualRules';
import type { GoalActual } from '@/data/types';

const month = { cycleId: 'c2027', isLocked: false, startDate: '2027-03-01', periodType: 'Month' as const };
const input = (o: Partial<ActualEntryInput> = {}): ActualEntryInput => ({
  actual: { actualValue: 42, actualText: null },
  goal: { status: 'Active', targetType: 'NUMERIC' },
  planStatus: 'Locked',
  goalCycleId: 'c2027',
  period: month,
  resultsFinalised: false,
  asOf: '2027-04-06',
  ...o,
});
const details = (o: Partial<ActualEntryInput>) => actualIssues(input(o)).map((i) => `${i.code} ${i.detail}`);

describe('actualIssues — what recordActual, every import row and every sync reading refuse', () => {
  it('accepts a number on a NUMERIC goal, text on a TEXT goal, a negative number and a real 0', () => {
    expect(actualIssues(input())).toEqual([]);
    expect(actualIssues(input({ goal: { status: 'Active', targetType: 'TEXT' }, actual: { actualValue: null, actualText: 'Đạt' } }))).toEqual([]);
    expect(actualIssues(input({ actual: { actualValue: -1_500_000, actualText: null } }))).toEqual([]);
    expect(actualIssues(input({ actual: { actualValue: 0, actualText: null } }))).toEqual([]);
    expect(actualIssues(input({ actual: { actualValue: 5, actualText: '  ' } }))).toEqual([]); // blank text is no text
  });

  it('a plan that is not Approved / Locked → ERR-KPI-04 PLAN_NOT_APPROVED (ASSUMPTION Q35)', () => {
    for (const planStatus of ['Draft', 'Submitted', 'Returned'] as const) {
      expect(details({ planStatus })).toEqual(['ERR-KPI-04 PLAN_NOT_APPROVED']);
    }
    expect(details({ planStatus: 'Approved' })).toEqual([]);
    expect(details({ planStatus: 'Locked' })).toEqual([]);
  });

  it('a locked period → ERR-KPI-04 PERIOD_LOCKED', () => {
    expect(details({ period: { ...month, isLocked: true, startDate: '2027-01-01' } })).toEqual(['ERR-KPI-04 PERIOD_LOCKED']);
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

  it('a Quarter / Half / Year → ERR-KPI-06 PERIOD_NOT_MONTH (ASSUMPTION Q36: longer periods add their months up)', () => {
    for (const periodType of ['Quarter', 'Half', 'Year'] as const) {
      expect(details({ period: { ...month, periodType } })).toEqual(['ERR-KPI-06 PERIOD_NOT_MONTH']);
    }
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
    expect(details({ period: { ...month, startDate: '2027-05-01' } })).toEqual(['ERR-KPI-06 PERIOD_NOT_STARTED']);
    expect(details({ period: { ...month, startDate: '2027-04-06' } })).toEqual([]);
  });

  it('lists every problem: the plan first, then the period and goal, then the value', () => {
    expect(
      details({
        planStatus: 'Draft',
        period: { cycleId: 'other', isLocked: true, startDate: '2028-01-01', periodType: 'Quarter' },
        resultsFinalised: true,
        goal: { status: 'Cancelled', targetType: 'NUMERIC' },
        actual: { actualValue: null, actualText: null },
      }),
    ).toEqual([
      'ERR-KPI-04 PLAN_NOT_APPROVED',
      'ERR-KPI-04 PERIOD_LOCKED',
      'ERR-KPI-04 RESULT_FINAL',
      'ERR-KPI-06 GOAL_NOT_ACTIVE',
      'ERR-KPI-06 PERIOD_NOT_IN_CYCLE',
      'ERR-KPI-06 PERIOD_NOT_MONTH',
      'ERR-KPI-06 PERIOD_NOT_STARTED',
      'ERR-KPI-06 ACTUAL_REQUIRED',
    ]);
  });

  it('a Locked plan whose result is Final → RESULT_FINAL alone', () => {
    expect(details({ planStatus: 'Locked', resultsFinalised: true })).toEqual(['ERR-KPI-04 RESULT_FINAL']);
  });
});

describe('entryBlockers — what the entry screen shows before anyone types', () => {
  it('ignores the value and reports only the goal, plan and period', () => {
    const { actual: _ignored, ...rest } = input({ planStatus: 'Returned', resultsFinalised: true });
    expect(entryBlockers(rest).map((i) => i.detail)).toEqual(['PLAN_NOT_APPROVED', 'RESULT_FINAL']);
    const { actual: _none, ...ok } = input();
    expect(entryBlockers(ok)).toEqual([]);
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

describe('currentActual', () => {
  it('finds only the current snapshot of that goal and period', () => {
    const rows = [
      { goalId: 'g1', periodId: 'T01', isCurrent: false, v: 1 },
      { goalId: 'g1', periodId: 'T01', isCurrent: true, v: 2 },
      { goalId: 'g1', periodId: 'T02', isCurrent: true, v: 3 },
    ];
    expect(currentActual(rows, 'g1', 'T01')?.v).toBe(2);
    expect(currentActual(rows, 'g2', 'T01')).toBeNull();
  });
});

describe('canRejectImport — only a Validating batch (BR-KPI-54), still exported here', () => {
  it('allows Validating; refuses Committed and Rejected with ERR-KPI-04', () => {
    expect(canRejectImport({ status: 'Validating' })).toEqual({ ok: true });
    expect(canRejectImport({ status: 'Committed' })).toEqual({ ok: false, code: 'ERR-KPI-04' });
    expect(canRejectImport({ status: 'Rejected' })).toEqual({ ok: false, code: 'ERR-KPI-04' });
  });
});

describe('the API sync (BR-KPI-56)', () => {
  const source = (sourceType: GoalActual['sourceType']) => ({ sourceType });

  it('keeps a person\'s number (manual or Excel) and replaces only its own earlier reading (ASSUMPTION Q37)', () => {
    expect(syncKeepsHumanActual(null)).toBe(false);
    expect(syncKeepsHumanActual(source('API'))).toBe(false);
    expect(syncKeepsHumanActual(source('MANUAL'))).toBe(true);
    expect(syncKeepsHumanActual(source('EXCEL'))).toBe(true);
  });

  it.each([
    [3, 0, 0, 'Succeeded'],
    [3, 0, 2, 'Succeeded'],
    [3, 1, 0, 'PartiallyFailed'],
    [0, 2, 0, 'Failed'],
    [0, 2, 5, 'Failed'],
    [0, 0, 4, 'Succeeded'], // every goal kept its person's number
    [0, 0, 0, 'Failed'], // nothing to load at all
  ] as const)('ok %i · error %i · skipped %i → %s', (ok, error, skipped, status) => {
    expect(syncRunStatus(ok, error, skipped)).toBe(status);
  });
});

describe('isEvidenceUrl (BR-KPI-57)', () => {
  it.each([
    ['https://drive.example/a.pdf', true],
    ['http://intranet.example/bao-cao', true],
    ['  https://x.example/y  ', true],
    ['ftp://files.example/a', false],
    ['javascript:alert(1)', false],
    ['drive.example/a.pdf', false],
    ['https://', false],
    ['https://a.example/có dấu cách', false],
    ['', false],
  ])('%s → %s', (url, ok) => {
    expect(isEvidenceUrl(url)).toBe(ok);
  });
});

describe('monthlySchedule', () => {
  it('reads "m h d * *" and nothing else', () => {
    expect(monthlySchedule('0 6 1 * *')).toEqual({ day: 1, hour: 6, minute: 0 });
    expect(monthlySchedule(' 30 23 15 * * ')).toEqual({ day: 15, hour: 23, minute: 30 });
    expect(monthlySchedule('0 6 * * 1')).toBeNull();
    expect(monthlySchedule('0 24 1 * *')).toBeNull();
    expect(monthlySchedule(null)).toBeNull();
  });
});
