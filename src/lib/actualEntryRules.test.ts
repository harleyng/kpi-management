import { describe, expect, it } from 'vitest';
import type { GoalActual } from '@/data/types';
import { assignment, employee, goal, orgUnit, period, periodTarget, plan } from '@/test/builders';
import {
  actualEntrySummary,
  buildActualEntryRows,
  defaultCycle,
  defaultMonth,
  monthsOf,
  nextEntryRow,
  EMPTY_ACTUAL_ENTRY_FILTER,
  filterActualEntryRows,
  isActualEntryFiltered,
  type ActualEntryInput,
} from './actualEntryRules';

const actual = (o: Partial<GoalActual>): GoalActual => ({
  id: 'a1', tenantId: 't1', goalId: 'g1', periodId: 'T03', actualValue: 5, actualText: null, sourceType: 'EXCEL',
  batchId: null, syncRunId: null, enteredBy: null, note: null, recordedAt: '2027-04-01T00:00:00Z', isCurrent: true, ...o,
});

const input = (o: Partial<ActualEntryInput> = {}): ActualEntryInput => ({
  period: period({ id: 'T03', label: 'T03', startDate: '2027-03-01', endDate: '2027-03-31' }),
  goals: [
    goal({ id: 'g1', goalPlanId: 'p-an', name: 'Doanh thu', sortOrder: 0, dataSourceId: 'ds-erp' }),
    goal({ id: 'g2', goalPlanId: 'p-an', name: 'Nghiệm thu', sortOrder: 1, targetType: 'TEXT', targetValue: null, targetText: 'Đạt', dataSourceId: 'ds-manual' }),
    goal({ id: 'g3', goalPlanId: 'p-binh', name: 'Khách mới', sortOrder: 0 }),
    goal({ id: 'g4', goalPlanId: 'p-an', name: 'Cũ', status: 'Cancelled' }),
    goal({ id: 'g5', goalPlanId: 'p-unit', name: 'Doanh thu phòng', sortOrder: 0 }),
    goal({ id: 'g6', goalPlanId: 'p-2026', name: 'Năm trước' }),
  ],
  plans: [
    plan({ id: 'p-an', status: 'Locked', ownerEmployeeId: 'e-an' }),
    plan({ id: 'p-binh', status: 'Returned', ownerEmployeeId: 'e-binh' }),
    plan({ id: 'p-unit', status: 'Locked', ownerType: 'OrgUnit', ownerEmployeeId: null, ownerOrgUnitId: 'ou-kd' }),
    plan({ id: 'p-2026', cycleId: 'c2026', status: 'Locked', ownerEmployeeId: 'e-an' }),
  ],
  employees: [employee({ id: 'e-an', fullName: 'An' }), employee({ id: 'e-binh', fullName: 'Bình' })],
  assignments: [assignment({ employeeId: 'e-an', orgUnitId: 'ou-kd' }), assignment({ employeeId: 'e-binh', orgUnitId: 'ou-mkt' })],
  orgUnits: [orgUnit(), orgUnit({ id: 'ou-kd', parentId: 'ou-root', name: 'Kinh doanh' }), orgUnit({ id: 'ou-mkt', parentId: 'ou-root', name: 'Marketing' })],
  dataSources: [
    { id: 'ds-erp', code: 'ERP_SALE', name: 'ERP Sale', sourceType: 'API' },
    { id: 'ds-manual', code: 'MANUAL', name: 'Nhập tay', sourceType: 'MANUAL' },
    { id: 'ds1', code: 'X', name: 'Excel', sourceType: 'EXCEL' },
  ],
  units: [{ id: 'u-pct', name: '%' }],
  periodTargets: [periodTarget({ goalId: 'g1', periodId: 'T03', targetValue: 12 })],
  actuals: [actual({ goalId: 'g1' }), actual({ id: 'old', goalId: 'g1', isCurrent: false }), actual({ id: 'other', goalId: 'g5', periodId: 'T02' })],
  results: [],
  asOf: '2027-04-06',
  mayEnter: () => true,
  ...o,
});

describe('buildActualEntryRows', () => {
  it('lists the Active goals of the cycle by unit, owner and goal order, with owner, unit, source, target and current actual', () => {
    const rows = buildActualEntryRows(input());
    expect(rows.map((r) => [r.goal.id, r.ownerName, r.orgUnit?.name])).toEqual([
      ['g1', 'An', 'Kinh doanh'],
      ['g2', 'An', 'Kinh doanh'],
      ['g5', 'Kinh doanh', 'Kinh doanh'],
      ['g3', 'Bình', 'Marketing'],
    ]);
    const [g1, g2, g5] = rows;
    expect([g1.target, g1.current?.id, g1.dataSource?.sourceType, g1.measureUnit]).toEqual([12, 'a1', 'API', '%']);
    expect([g2.target, g2.current]).toEqual(['Đạt', null]);
    expect(g5.current).toBeNull(); // its T02 actual is not this month's
  });

  it('names the company plan after the root unit', () => {
    const rows = buildActualEntryRows(input({ plans: [plan({ id: 'p-an', status: 'Locked', ownerType: 'Company', ownerEmployeeId: null })] }));
    expect(rows[0].ownerName).toBe('Syntra');
  });

  it('a goal whose plan is not agreed is listed with its blocker and cannot be entered', () => {
    const binh = buildActualEntryRows(input()).find((r) => r.goal.id === 'g3');
    expect(binh?.blockers.map((b) => b.detail)).toEqual(['PLAN_NOT_APPROVED']);
    expect(binh?.canEnter).toBe(false);
  });

  it('a locked month blocks every row; the viewer\'s entitlement is applied per plan', () => {
    const locked = buildActualEntryRows(input({ period: period({ id: 'T03', label: 'T03', startDate: '2027-03-01', isLocked: true }) }));
    expect(locked.every((r) => !r.canEnter && r.blockers.some((b) => b.detail === 'PERIOD_LOCKED'))).toBe(true);
    const onlyUnit = buildActualEntryRows(input({ mayEnter: (p) => p.ownerType === 'OrgUnit' }));
    expect(onlyUnit.filter((r) => r.canEnter).map((r) => r.goal.id)).toEqual(['g5']);
  });

  it('a Final result of the plan for the month blocks with RESULT_FINAL', () => {
    const rows = buildActualEntryRows(input({ results: [{ goalPlanId: 'p-an', periodId: 'T03', status: 'Final' }] }));
    expect(rows.find((r) => r.goal.id === 'g1')?.blockers.map((b) => b.detail)).toEqual(['RESULT_FINAL']);
  });
});

describe('actualEntrySummary and filters', () => {
  const rows = buildActualEntryRows(input());

  it('counts the goals open for entry and those of them still without a number', () => {
    expect(actualEntrySummary(rows)).toEqual({ open: 3, missing: 2 }); // g3 is blocked; g1 has a number
  });

  it('filters by search (tone-insensitive), unit, source type and "missing only"', () => {
    const ids = (f: Partial<typeof EMPTY_ACTUAL_ENTRY_FILTER>) => filterActualEntryRows(rows, { ...EMPTY_ACTUAL_ENTRY_FILTER, ...f }).map((r) => r.goal.id);
    expect(ids({})).toEqual(['g1', 'g2', 'g5', 'g3']);
    expect(ids({ search: 'nghiem thu' })).toEqual(['g2']);
    expect(ids({ search: 'binh' })).toEqual(['g3']);
    expect(ids({ orgUnitId: 'ou-mkt' })).toEqual(['g3']);
    expect(ids({ sourceType: 'API' })).toEqual(['g1']);
    expect(ids({ missingOnly: true })).toEqual(['g2', 'g5']);
    expect(isActualEntryFiltered(EMPTY_ACTUAL_ENTRY_FILTER)).toBe(false);
    expect(isActualEntryFiltered({ ...EMPTY_ACTUAL_ENTRY_FILTER, search: ' x ' })).toBe(true);
  });
});

describe('the shared pickers\' defaults', () => {
  const cycle = (id: string, status: 'Planning' | 'Active' | 'Evaluating' | 'Closed', startDate: string) => ({ id, status, startDate });
  it('opens on the Active cycle, else the one being evaluated, else the latest', () => {
    expect(defaultCycle([cycle('2026', 'Closed', '2026-01-01'), cycle('2027', 'Active', '2027-01-01'), cycle('2028', 'Planning', '2028-01-01')])?.id).toBe('2027');
    expect(defaultCycle([cycle('2026', 'Evaluating', '2026-01-01'), cycle('2028', 'Planning', '2028-01-01')])?.id).toBe('2026');
    expect(defaultCycle([cycle('2026', 'Closed', '2026-01-01'), cycle('2028', 'Planning', '2028-01-01')])?.id).toBe('2028');
    expect(defaultCycle([])).toBeNull();
  });

  it('lists months only, in order, and opens on the latest month ended by today, else the one in progress', () => {
    const periods = [
      period({ id: 'T02', periodType: 'Month', startDate: '2027-02-01', endDate: '2027-02-28' }),
      period({ id: 'Q1', periodType: 'Quarter', startDate: '2027-01-01', endDate: '2027-03-31' }),
      period({ id: 'T01', periodType: 'Month', startDate: '2027-01-01', endDate: '2027-01-31' }),
      period({ id: 'T05', periodType: 'Month', startDate: '2027-05-01', endDate: '2027-05-31' }),
    ];
    const months = monthsOf(periods);
    expect(months.map((p) => p.id)).toEqual(['T01', 'T02', 'T05']);
    expect(defaultMonth(months, '2027-04-06')?.id).toBe('T02');
    expect(defaultMonth(months, '2027-01-15')?.id).toBe('T01'); // none ended yet: the month in progress
    expect(defaultMonth(months, '2026-12-31')?.id).toBe('T01');
    expect(defaultMonth([], '2027-04-06')).toBeNull();
  });
});

describe('the owner\'s unit', () => {
  it('is the unit they sat in during the month, even when they have left since', () => {
    const left = input({ assignments: [assignment({ employeeId: 'e-an', orgUnitId: 'ou-kd', effectiveTo: '2027-03-10' }), assignment({ employeeId: 'e-binh', orgUnitId: 'ou-mkt' })] });
    expect(buildActualEntryRows(left).find((r) => r.goal.id === 'g1')?.orgUnit?.name).toBe('Kinh doanh');
  });
});

describe('nextEntryRow', () => {
  it('moves to the next shown row open for entry, even when the current one has left the filter', () => {
    const rows = buildActualEntryRows(input());
    const ids = rows.map((r) => r.goal.id); // g1, g2, g5, g3 (g3 blocked)
    expect(ids).toEqual(['g1', 'g2', 'g5', 'g3']);
    const missingOnly = filterActualEntryRows(rows, { ...EMPTY_ACTUAL_ENTRY_FILTER, missingOnly: true }); // g2, g5
    expect(nextEntryRow(rows, missingOnly, 'g1')?.goal.id).toBe('g2'); // g1 is not in the filtered list
    expect(nextEntryRow(rows, missingOnly, 'g2')?.goal.id).toBe('g5');
    expect(nextEntryRow(rows, missingOnly, 'g5')).toBeNull(); // g3 is blocked
    expect(nextEntryRow(rows, rows, 'nope')).toBeNull();
  });
});
