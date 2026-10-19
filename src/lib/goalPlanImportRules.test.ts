import { describe, expect, it } from 'vitest';
import type { GoalPlanImportRow, ImportLevelCells } from '@/data/types';
import { GOAL_PLAN_IMPORT_COLUMNS, goalPlanImportDrafts, goalPlanImportIssues, type GoalPlanImportContext } from './goalPlanImportRules';

const ctx = (o: Partial<GoalPlanImportContext> = {}): GoalPlanImportContext => ({
  cycle: { id: 'c', startDate: '2027-01-01', endDate: '2027-12-31', status: 'Planning' },
  plans: [{ id: 'p-e1', cycleId: 'c', ownerType: 'Employee', ownerEmployeeId: 'e1', status: 'Draft' }],
  goals: [],
  accounts: [
    { login: 'an.nv', employeeId: 'e1', status: 'Active' },
    { login: 'binh.tt', employeeId: 'e2', status: 'Active' },
    { login: 'cu', employeeId: 'e3', status: 'Inactive' },
  ],
  employees: [
    { id: 'e1', employmentStatus: 'Official', leftOn: null },
    { id: 'e2', employmentStatus: 'Official', leftOn: null },
    { id: 'e3', employmentStatus: 'Official', leftOn: null },
  ],
  perspectives: [{ id: 'fin', code: 'FIN' }, { id: 'cus', code: 'CUS' }],
  units: [{ id: 'vnd', code: 'VND' }, { id: 'pct', code: 'PCT' }],
  methods: [{ id: 'up', code: 'UP', methodType: 'RATIO_UP' }, { id: 'lv', code: 'LV', methodType: 'LEVELS' }, { id: 'bin', code: 'BIN', methodType: 'BINARY' }],
  dataSources: [{ id: 'erp', code: 'ERP' }, { id: 'man', code: 'MANUAL' }],
  kpis: [{ id: 'k-dt', code: 'KPI-DT', name: 'Doanh thu', perspectiveId: 'fin', unitId: 'vnd', calcMethodId: 'up', defaultDataSourceId: 'erp', definition: 'Tổng doanh thu', formulaText: 'Σ', status: 'Active' }],
  today: '2027-01-10',
  ...o,
});
const lv = (targetValue: number, scorePct: number): ImportLevelCells => ({ targetValue, targetText: null, scorePct });
const row = (o: Partial<GoalPlanImportRow> = {}): GoalPlanImportRow => ({
  rowNo: 2, login: 'an.nv', perspectiveCode: 'FIN', goalName: 'Doanh thu', kpiCode: 'KPI-DT', unitCode: null, calcMethodCode: null, dataSourceCode: null,
  visibility: null, weight: 20, description: null, startDate: null, dueDate: null, targetType: null, targetValue: 100, targetText: null, levels: [null, null, null], ...o,
});
const details = (r: ReturnType<typeof goalPlanImportIssues>) => r.errors.map((e) => `${e.rowNo}:${e.column}:${e.code}:${e.detail}`);
const five = (login: string, weights = [20, 20, 20, 20, 20]) => weights.map((w, i) => row({ rowNo: i + 2, login, kpiCode: null, goalName: `Chỉ tiêu ${i}`, unitCode: 'PCT', calcMethodCode: 'UP', dataSourceCode: 'MANUAL', weight: w }));

describe('the Goal Plan import template (plan §5.2)', () => {
  it('has the columns in order, L1–L3 as (target, score) pairs, and unique keys', () => {
    expect(GOAL_PLAN_IMPORT_COLUMNS.slice(0, 3).map((c) => c.key)).toEqual(['login', 'perspectiveCode', 'goalName']);
    expect(GOAL_PLAN_IMPORT_COLUMNS.slice(-6).map((c) => c.key)).toEqual(['L1.target', 'L1.score', 'L2.target', 'L2.score', 'L3.target', 'L3.score']);
    expect(new Set(GOAL_PLAN_IMPORT_COLUMNS.map((c) => c.key)).size).toBe(GOAL_PLAN_IMPORT_COLUMNS.length);
  });
});

describe('goalPlanImportIssues — row errors (BR-KPI-26)', () => {
  it('a library row fills unit, method and data source from the KPI; blank dates take the cycle', () => {
    const r = goalPlanImportIssues([row()], ctx());
    expect(r.errors).toEqual([]);
    expect(r.resolved[0].imported.goal).toMatchObject({ kpiDefId: 'k-dt', unitId: 'vnd', calcMethodId: 'up', dataSourceId: 'erp', startDate: '2027-01-01', dueDate: '2027-12-31', visibility: 'PUBLIC', description: 'Tổng doanh thu', ownerEmployeeId: 'e1' });
  });

  it('codes match case- and tone-insensitively', () => {
    expect(goalPlanImportIssues([row({ login: 'AN.NV', perspectiveCode: 'fin', kpiCode: 'kpi-dt' })], ctx()).errors).toEqual([]);
  });

  it.each([
    [{ login: 'ghost' }, 'login:ERR-KPI-06:LOGIN_UNKNOWN'],
    [{ login: 'cu' }, 'login:ERR-KPI-06:LOGIN_UNKNOWN'],
    [{ perspectiveCode: 'XYZ' }, 'perspectiveCode:ERR-KPI-06:PERSPECTIVE_UNKNOWN'],
    [{ goalName: '  ' }, 'goalName:ERR-KPI-06:NAME_REQUIRED'],
    [{ kpiCode: 'NOPE' }, 'kpiCode:ERR-KPI-06:KPI_UNKNOWN'],
    [{ kpiCode: null }, 'unitCode:ERR-KPI-06:REQUIRED_WITHOUT_KPI'],
    [{ unitCode: 'KG' }, 'unitCode:ERR-KPI-06:CODE_UNKNOWN'],
    [{ weight: 0 }, 'weight:ERR-KPI-06:WEIGHT_INVALID'],
    [{ weight: null }, 'weight:ERR-KPI-06:WEIGHT_INVALID'],
    [{ startDate: '2027-06-01', dueDate: '2027-05-01' }, 'dueDate:ERR-KPI-06:DATES_INVALID'],
    [{ dueDate: '2028-01-31' }, 'dueDate:ERR-KPI-06:DATES_OUTSIDE_CYCLE'],
    [{ targetValue: null }, 'targetValue:ERR-KPI-06:TARGET_REQUIRED'],
    [{ targetType: 'TEXT', targetValue: null, targetText: 'Đạt' }, 'calcMethodCode:ERR-KPI-06:TARGET_TYPE_MISMATCH'],
    [{ calcMethodCode: 'LV' }, 'L1.target:ERR-KPI-13:LEVELS_MISSING'],
    [{ levels: [lv(10, 100), lv(20, 0), null] }, 'L1.target:ERR-KPI-13:LEVEL_SCORES_ORDER'],
  ] as [Partial<GoalPlanImportRow>, string][])('%j → %s', (patch, expected) => {
    expect(details(goalPlanImportIssues([row(patch)], ctx()))).toContain(`2:${headerOf(expected)}`);
  });

  it('valid LEVELS on a TEXT goal under BINARY pass', () => {
    const r = goalPlanImportIssues([row({ kpiCode: null, unitCode: 'PCT', calcMethodCode: 'BIN', dataSourceCode: 'MANUAL', targetType: 'TEXT', targetValue: null, targetText: 'Đạt' })], ctx());
    expect(r.errors).toEqual([]);
  });

  it('duplicates: the same name or library KPI twice for one person, or already in their plan', () => {
    expect(details(goalPlanImportIssues([row(), row({ rowNo: 3, goalName: 'Doanh thu khác' })], ctx()))).toEqual([expect.stringMatching(/^3:.*DUPLICATE$/)]);
    const already = ctx({ goals: [{ goalPlanId: 'p-e1', name: 'doanh thu', kpiDefId: null, weight: 10, status: 'Active' }] });
    expect(details(goalPlanImportIssues([row()], already))).toEqual([expect.stringMatching(/DUPLICATE$/)]);
    expect(goalPlanImportIssues([row(), row({ login: 'binh.tt' })], ctx()).errors).toEqual([]); // two people may share a KPI
  });

  it('a Locked plan → 04 PLAN_LOCKED; a Closed cycle → 04 CYCLE_CLOSED', () => {
    expect(details(goalPlanImportIssues([row()], ctx({ plans: [{ id: 'p-e1', cycleId: 'c', ownerType: 'Employee', ownerEmployeeId: 'e1', status: 'Locked' }] })))).toEqual([expect.stringMatching(/ERR-KPI-04:PLAN_LOCKED$/)]);
    expect(details(goalPlanImportIssues([row()], ctx({ cycle: { id: 'c', startDate: '2027-01-01', endDate: '2027-12-31', status: 'Closed' } })))).toContain('2:null:ERR-KPI-04:CYCLE_CLOSED');
  });

  it('a person who left before today cannot be imported', () => {
    expect(details(goalPlanImportIssues([row()], ctx({ employees: [{ id: 'e1', employmentStatus: 'Resigned', leftOn: '2027-01-05' }] })))[0]).toMatch(/LOGIN_UNKNOWN$/);
  });
});

describe('goalPlanImportIssues — per-plan warnings never block', () => {
  it.each([
    [[20, 20, 20, 20, 19.99], []],
    [[20, 20, 20, 20, 20.01], []],
    [[20, 20, 20, 20, 19.98], ['ERR-KPI-07']],
  ])('weights %j → %j', (weights, codes) => {
    const r = goalPlanImportIssues(five('an.nv', weights), ctx());
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(codes);
  });

  it.each([
    [4, ['ERR-KPI-07', 'ERR-KPI-08']],
    [5, []],
    [8, ['ERR-KPI-07']],
    [9, ['ERR-KPI-07', 'ERR-KPI-08']],
  ])('%i goals → %j', (count, codes) => {
    const weights = count === 5 ? [20, 20, 20, 20, 20] : Array(count).fill(count === 8 ? 10 : 20);
    expect(goalPlanImportIssues(five('an.nv', weights), ctx()).warnings.map((w) => w.code)).toEqual(codes);
  });

  it('counts the plan\'s existing Active goals', () => {
    const existing = ctx({ goals: [{ goalPlanId: 'p-e1', name: 'Cũ', kpiDefId: null, weight: 60, status: 'Active' }, { goalPlanId: 'p-e1', name: 'Hủy', kpiDefId: null, weight: 40, status: 'Cancelled' }] });
    const r = goalPlanImportIssues(five('an.nv', [10, 10, 10, 5, 5]), existing);
    expect(r.warnings).toEqual([]); // 1 Active + 5 imported = 6 goals; 60 + 40 = 100% (the Cancelled one is not counted)
  });
});

describe('goalPlanImportDrafts — the hand-off to T4\'s commit (all or none)', () => {
  it('groups by person; an existing plan is reused, a missing one is created (planId null)', () => {
    const drafts = goalPlanImportDrafts([row(), row({ rowNo: 3, login: 'binh.tt' })], ctx());
    expect(drafts.map((d) => [d.employeeId, d.planId, d.goals.length])).toEqual([
      ['e1', 'p-e1', 1],
      ['e2', null, 1],
    ]);
  });

  it('one row error → nothing to write', () => {
    expect(goalPlanImportDrafts([row(), row({ rowNo: 3, login: 'ghost' })], ctx())).toEqual([]);
  });
});

/** "column:code:detail" with the column's template header. */
function headerOf(expected: string): string {
  const [key, ...rest] = expected.split(':');
  return `${GOAL_PLAN_IMPORT_COLUMNS.find((c) => c.key === key)?.header ?? key}:${rest.join(':')}`;
}
