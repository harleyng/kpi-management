import { describe, expect, it } from 'vitest';
import type { ActualImportRow, GoalActual, ImportRowError } from '@/data/types';
import { goal, months2027, period, periodTarget, plan, user } from '@/test/builders';
import {
  ACTUAL_COLUMNS,
  ACTUAL_IMPORT_SPEC,
  actualImportWarnings,
  actualTemplateRows,
  resolveActualRow,
  validateActualRows,
  type ActualImportContext,
} from './actualImportRules';
import { parseSheet } from './importRules';

// Two people, each with goals in the 2027 plan; e2 has the same KPI twice (ambiguous by login + code).
const months = months2027().map((p) => (p.label === 'T01' ? { ...p, isLocked: true } : p));
const ctx = (o: Partial<ActualImportContext> = {}): ActualImportContext => ({
  cycleId: 'c2027',
  goals: [
    goal({ id: 'g1', goalPlanId: 'plan1', kpiDefId: 'k-rev', ownerEmployeeId: 'e1' }),
    goal({ id: 'g2', goalPlanId: 'plan1', kpiDefId: 'k-ok', ownerEmployeeId: 'e1', targetType: 'TEXT', targetValue: null, targetText: 'Đạt' }),
    goal({ id: 'g3', goalPlanId: 'plan2', kpiDefId: 'k-rev', ownerEmployeeId: 'e2' }),
    goal({ id: 'g4', goalPlanId: 'plan2', kpiDefId: 'k-rev', ownerEmployeeId: 'e2' }),
    goal({ id: 'g5', goalPlanId: 'plan1', kpiDefId: 'k-old', ownerEmployeeId: 'e1', status: 'Changed' }),
    goal({ id: 'g-2026', goalPlanId: 'plan2026', kpiDefId: 'k-rev', ownerEmployeeId: 'e1' }),
    goal({ id: 'g-draft', goalPlanId: 'plan3', kpiDefId: 'k-rev', ownerEmployeeId: 'e3' }),
  ],
  plans: [
    plan({ id: 'plan1', status: 'Locked', ownerEmployeeId: 'e1' }),
    plan({ id: 'plan2', status: 'Approved', ownerEmployeeId: 'e2' }),
    plan({ id: 'plan3', status: 'Draft', ownerEmployeeId: 'e3' }),
    plan({ id: 'plan2026', cycleId: 'c2026', status: 'Locked', ownerEmployeeId: 'e1' }),
  ],
  periods: [...months, period({ id: 'Q1', label: 'Q1', periodType: 'Quarter', startDate: '2027-01-01', endDate: '2027-03-31' }), period({ id: 'T03-2026', cycleId: 'c2026', label: 'T03', startDate: '2026-03-01' })],
  users: [user({ employeeId: 'e1', login: 'an.nv' }), user({ employeeId: 'e2', login: 'binh.tt' }), user({ employeeId: 'e3', login: 'chi.lt' }), user({ id: 'u-sys', employeeId: null, login: 'system' })],
  kpiDefinitions: [
    { id: 'k-rev', code: 'KPI-DOANH-THU' },
    { id: 'k-ok', code: 'KPI-NGHIEM-THU' },
    { id: 'k-old', code: 'KPI-CU' },
  ],
  results: [{ goalPlanId: 'plan1', periodId: 'T02', status: 'Final' }],
  asOf: '2027-04-06',
  ...o,
});

const row = (o: Partial<ActualImportRow> = {}): ActualImportRow => ({
  rowNo: 2,
  goalId: 'g1',
  login: null,
  kpiCode: null,
  periodLabel: 'T03',
  actualValue: 120,
  actualText: null,
  note: null,
  evidenceUrl: null,
  ...o,
});
const brief = (errors: ImportRowError[]) => errors.map((e) => `${e.rowNo}|${e.column ?? '—'}|${e.code}|${e.detail}`);
const H = Object.fromEntries(Object.entries(ACTUAL_COLUMNS).map(([k, c]) => [k, c.header])) as Record<keyof typeof ACTUAL_COLUMNS, string>;

describe('resolveActualRow — which goal and period a row names (never guessed)', () => {
  it('by the assigned goal id, and by login + KPI code (case-insensitive)', () => {
    expect(resolveActualRow(row(), ctx())).toEqual({ goalId: 'g1', periodId: 'T03', errors: [] });
    expect(resolveActualRow(row({ goalId: null, login: 'AN.NV', kpiCode: 'kpi-doanh-thu', periodLabel: 't03' }), ctx()).goalId).toBe('g1');
  });

  it('both keys agreeing is fine; disagreeing is GOAL_KEY_CONFLICT', () => {
    expect(resolveActualRow(row({ login: 'an.nv', kpiCode: 'KPI-DOANH-THU' }), ctx()).errors).toEqual([]);
    expect(brief(resolveActualRow(row({ goalId: 'g2', login: 'an.nv', kpiCode: 'KPI-DOANH-THU' }), ctx()).errors)).toEqual([`2|${H.goalId}|ERR-KPI-06|GOAL_KEY_CONFLICT`]);
  });

  it('no key at all, or half of the login + code key → GOAL_KEY_REQUIRED', () => {
    expect(brief(resolveActualRow(row({ goalId: null }), ctx()).errors)).toEqual([`2|${H.goalId}|ERR-KPI-06|GOAL_KEY_REQUIRED`]);
    expect(brief(resolveActualRow(row({ goalId: null, login: 'an.nv' }), ctx()).errors)).toEqual([`2|${H.kpiCode}|ERR-KPI-06|GOAL_KEY_REQUIRED`]);
    expect(brief(resolveActualRow(row({ goalId: null, kpiCode: 'KPI-DOANH-THU' }), ctx()).errors)).toEqual([`2|${H.login}|ERR-KPI-06|GOAL_KEY_REQUIRED`]);
  });

  it('unknown goal id (another tenant\'s answers the same), login, KPI code; a system account is not a person', () => {
    expect(brief(resolveActualRow(row({ goalId: 'g-other-tenant' }), ctx()).errors)).toEqual([`2|${H.goalId}|ERR-KPI-06|GOAL_NOT_FOUND`]);
    expect(brief(resolveActualRow(row({ goalId: null, login: 'nam.hv2', kpiCode: 'KPI-X' }), ctx()).errors)).toEqual([
      `2|${H.login}|ERR-KPI-06|USER_NOT_FOUND`,
      `2|${H.kpiCode}|ERR-KPI-06|KPI_NOT_FOUND`,
    ]);
    expect(brief(resolveActualRow(row({ goalId: null, login: 'system', kpiCode: 'KPI-DOANH-THU' }), ctx()).errors)).toEqual([`2|${H.login}|ERR-KPI-06|USER_NOT_FOUND`]);
  });

  it('login + code matching two Active goals → GOAL_AMBIGUOUS; only a Changed one → GOAL_NOT_ACTIVE; none → GOAL_NOT_FOUND', () => {
    expect(brief(resolveActualRow(row({ goalId: null, login: 'binh.tt', kpiCode: 'KPI-DOANH-THU' }), ctx()).errors)).toEqual([`2|${H.kpiCode}|ERR-KPI-06|GOAL_AMBIGUOUS`]);
    expect(brief(resolveActualRow(row({ goalId: null, login: 'an.nv', kpiCode: 'KPI-CU' }), ctx()).errors)).toEqual([`2|${H.kpiCode}|ERR-KPI-06|GOAL_NOT_ACTIVE`]);
    expect(brief(resolveActualRow(row({ goalId: null, login: 'binh.tt', kpiCode: 'KPI-NGHIEM-THU' }), ctx()).errors)).toEqual([`2|${H.kpiCode}|ERR-KPI-06|GOAL_NOT_FOUND`]);
  });

  it('a goal of another cycle → GOAL_NOT_IN_CYCLE; a period label outside the batch\'s cycle → PERIOD_NOT_FOUND', () => {
    expect(brief(resolveActualRow(row({ goalId: 'g-2026' }), ctx()).errors)).toEqual([`2|${H.goalId}|ERR-KPI-06|GOAL_NOT_IN_CYCLE`]);
    const r = resolveActualRow(row({ periodLabel: 'T13' }), ctx());
    expect(brief(r.errors)).toEqual([`2|${H.period}|ERR-KPI-06|PERIOD_NOT_FOUND`]);
    expect(r.goalId).toBe('g1'); // the goal still resolved
  });
});

describe('validateActualRows (BR-KPI-53)', () => {
  it('a valid file resolves every row', () => {
    const { errors, resolved } = validateActualRows(
      [row(), row({ rowNo: 3, goalId: 'g2', actualValue: null, actualText: ' Đạt ', note: 'ok', evidenceUrl: ' https://drive.example/a ' })],
      ctx(),
    );
    expect(errors).toEqual([]);
    expect(resolved).toEqual([
      { rowNo: 2, goalId: 'g1', periodId: 'T03', actualValue: 120, actualText: null, note: null, evidenceUrl: null },
      { rowNo: 3, goalId: 'g2', periodId: 'T03', actualValue: null, actualText: 'Đạt', note: 'ok', evidenceUrl: 'https://drive.example/a' },
    ]);
  });

  it('a real 0 passes as 0', () => {
    expect(validateActualRows([row({ actualValue: 0 })], ctx()).resolved[0].actualValue).toBe(0);
  });

  it('applies the very rule recordActual applies, each issue on the cell it is about', () => {
    const check = (o: Partial<ActualImportRow>, c = ctx()) => brief(validateActualRows([row(o)], c).errors);
    expect(check({ periodLabel: 'T01' })).toEqual([`2|${H.period}|ERR-KPI-04|PERIOD_LOCKED`]);
    expect(check({ periodLabel: 'T02' })).toEqual([`2|${H.period}|ERR-KPI-04|RESULT_FINAL`]);
    expect(check({ periodLabel: 'T05' })).toEqual([`2|${H.period}|ERR-KPI-06|PERIOD_NOT_STARTED`]);
    expect(check({ periodLabel: 'Q1' })).toEqual([`2|${H.period}|ERR-KPI-06|PERIOD_NOT_MONTH`]);
    expect(check({ goalId: 'g-draft' })).toEqual([`2|${H.goalId}|ERR-KPI-04|PLAN_NOT_APPROVED`]);
    expect(check({ goalId: 'g5' })).toEqual([`2|${H.goalId}|ERR-KPI-06|GOAL_NOT_ACTIVE`]);
    expect(check({ actualValue: null })).toEqual([`2|${H.actualValue}|ERR-KPI-06|ACTUAL_REQUIRED`]);
    expect(check({ actualText: 'Đạt' })).toEqual([`2|${H.actualValue}|ERR-KPI-06|ACTUAL_TYPE_MISMATCH`]);
    expect(check({ goalId: 'g2', actualValue: 1 })).toEqual([`2|${H.actualText}|ERR-KPI-06|ACTUAL_TYPE_MISMATCH`]);
    expect(check({ evidenceUrl: 'drive/abc' })).toEqual([`2|${H.evidenceUrl}|ERR-KPI-06|EVIDENCE_URL_INVALID`]);
  });

  it('reports every problem of a row, including a blank value on a row whose goal did not resolve', () => {
    expect(brief(validateActualRows([row({ goalId: 'nope', periodLabel: 'X', actualValue: null, evidenceUrl: 'x' })], ctx()).errors)).toEqual([
      `2|${H.goalId}|ERR-KPI-06|GOAL_NOT_FOUND`,
      `2|${H.period}|ERR-KPI-06|PERIOD_NOT_FOUND`,
      `2|${H.actualValue}|ERR-KPI-06|ACTUAL_REQUIRED`,
      `2|${H.evidenceUrl}|ERR-KPI-06|EVIDENCE_URL_INVALID`,
    ]);
  });

  it('two or three rows naming the same goal and period → DUPLICATE_ROW on every one; the same goal in two months is fine', () => {
    const { errors, resolved } = validateActualRows(
      [
        row({ rowNo: 2 }),
        row({ rowNo: 3, goalId: null, login: 'an.nv', kpiCode: 'KPI-DOANH-THU' }),
        row({ rowNo: 4, actualValue: 5 }),
        row({ rowNo: 5, periodLabel: 'T04' }),
      ],
      ctx(),
    );
    expect(brief(errors)).toEqual(['2|—|ERR-KPI-06|DUPLICATE_ROW', '3|—|ERR-KPI-06|DUPLICATE_ROW', '4|—|ERR-KPI-06|DUPLICATE_ROW']);
    expect(resolved.map((r) => r.rowNo)).toEqual([5]);
  });

  it('only the rows without errors are resolved, and errors are in sheet order', () => {
    const { errors, resolved } = validateActualRows([row({ rowNo: 9, goalId: 'nope' }), row({ rowNo: 4 })], ctx());
    expect(errors.map((e) => e.rowNo)).toEqual([9]);
    expect(resolved.map((r) => r.rowNo)).toEqual([4]);
  });
});

describe('actualImportWarnings — shown, never blocking', () => {
  const actual = (o: Partial<GoalActual>): GoalActual => ({
    id: 'a', tenantId: 't1', goalId: 'g1', periodId: 'T03', actualValue: 100, actualText: null, sourceType: 'MANUAL',
    batchId: null, syncRunId: null, enteredBy: null, note: null, recordedAt: '2027-04-01T01:00:00Z', isCurrent: true, ...o,
  });
  const resolved = (o: Partial<{ goalId: string; actualValue: number | null }> = {}) => ({
    rowNo: 2, goalId: 'g1', periodId: 'T03', actualValue: 120, actualText: null, note: null, evidenceUrl: null, ...o,
  });
  const units = [{ id: 'u-pct', code: 'PCT' }, { id: 'u-vnd', code: 'VND' }];

  it('OVERWRITES_ACTUAL names the value that stops being current; a retired snapshot does not count', () => {
    const w = actualImportWarnings([resolved()], { goals: [goal()], actuals: [actual({})], periodTargets: [], units });
    expect(w).toEqual([{ rowNo: 2, detail: 'OVERWRITES_ACTUAL', previous: expect.objectContaining({ actualValue: 100, sourceType: 'MANUAL' }) }]);
    expect(actualImportWarnings([resolved()], { goals: [goal()], actuals: [actual({ isCurrent: false })], periodTargets: [], units })).toEqual([]);
  });

  it('PERCENT_SUSPECT on a % goal whose target is above 1 and whose value is in (0, 1]', () => {
    const pctGoal = goal({ unitId: 'u-pct', targetValue: 90 });
    const warn = (value: number, g = pctGoal) =>
      actualImportWarnings([resolved({ actualValue: value })], { goals: [g], actuals: [], periodTargets: [], units }).map((x) => x.detail);
    expect(warn(0.85)).toEqual(['PERCENT_SUSPECT']);
    expect(warn(1)).toEqual(['PERCENT_SUSPECT']);
    expect(warn(85)).toEqual([]);
    expect(warn(0)).toEqual([]);
    expect(warn(0.85, goal({ unitId: 'u-pct', targetValue: 0.9 }))).toEqual([]);
    expect(warn(0.85, goal({ unitId: 'u-vnd', targetValue: 90 }))).toEqual([]);
    // the period's own split target is the one compared
    expect(actualImportWarnings([resolved({ actualValue: 0.5 })], { goals: [pctGoal], actuals: [], periodTargets: [periodTarget({ goalId: 'g1', periodId: 'T03', targetValue: 0.8 })], units })).toEqual([]);
  });
});

describe('the actuals template', () => {
  it('pre-fills every Active goal of an Approved / Locked plan of the cycle, keyed by goal id, value columns blank', () => {
    const c = ctx();
    const rows = actualTemplateRows({
      period: { id: 'T03', cycleId: 'c2027', label: 'T03' },
      goals: c.goals.map((g) => goal(g)),
      plans: c.plans.map((p) => plan(p)),
      employees: [],
      users: c.users.map((u) => user(u)),
      kpiDefinitions: c.kpiDefinitions.map((k) => ({ ...k, aggregation: 'SUM' as const })),
      units: [{ id: 'u-pct', name: '%' }],
      periodTargets: [periodTarget({ goalId: 'g1', periodId: 'T03', targetValue: 12 })],
      periods: c.periods.map((p) => period(p)),
      ownerName: (p) => (p.ownerEmployeeId === 'e1' ? 'An' : 'Bình'),
    });
    expect(rows.map((r) => r.goalId)).toEqual(['g1', 'g2', 'g3', 'g4']); // not the Changed, 2026 or Draft-plan goals
    expect(rows[0]).toEqual({
      goalId: 'g1', login: 'an.nv', employee: 'An', kpiCode: 'KPI-DOANH-THU', goalName: 'Goal', unit: '%', period: 'T03', target: 12,
      actualValue: null, actualText: null, note: null, evidenceUrl: null,
    });
    expect(rows[1].target).toBe('Đạt');
  });

  it('round-trips through the parser: a filled template reads back into rows the validator accepts', () => {
    const headers = ACTUAL_IMPORT_SPEC.columns.map((c) => c.header);
    const values = { goalId: 'g1', login: 'an.nv', employee: 'An', kpiCode: 'KPI-DOANH-THU', goalName: 'Goal', unit: '%', period: 'T03', target: 12, actualValue: 13.5, actualText: null, note: 'ok', evidenceUrl: null };
    const matrix = [headers, ACTUAL_IMPORT_SPEC.columns.map((c) => values[c.id as keyof typeof values])];
    const parsed = parseSheet(ACTUAL_IMPORT_SPEC, matrix);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([{ rowNo: 2, goalId: 'g1', login: 'an.nv', kpiCode: 'KPI-DOANH-THU', periodLabel: 'T03', actualValue: 13.5, actualText: null, note: 'ok', evidenceUrl: null }]);
    expect(validateActualRows(parsed.rows, ctx()).errors).toEqual([]);
  });

  it('the period column is required in the file', () => {
    const headers = ACTUAL_IMPORT_SPEC.columns.map((c) => c.header).filter((h) => h !== H.period);
    expect(parseSheet(ACTUAL_IMPORT_SPEC, [headers, ['g1']]).errors.map((e) => e.detail)).toEqual(['HEADER_MISSING']);
  });
});
