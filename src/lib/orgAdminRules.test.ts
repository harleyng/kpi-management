import { describe, expect, it } from 'vitest';
import { assignment, employee, orgUnit, plan, position, user } from '@/test/builders';
import type { RuleIssue } from './errorCatalog';
import {
  assignmentIssues,
  employeeIssues,
  headIssues,
  isValidTimeZone,
  managerOutsideUnit,
  positionIssues,
  resignationImpact,
  resignationPlan,
  tenantIssues,
  transferPlan,
  unitEndDate,
  unitIssues,
  unitUsage,
} from './orgAdminRules';

const TODAY = '2027-04-06';
const details = (issues: readonly RuleIssue[]) => issues.map((i) => `${i.code}:${i.detail}`);

// root → div → sale → team; hr under root.
const root = orgUnit({ id: 'root' });
const div = orgUnit({ id: 'div', parentId: 'root', code: 'DIV', unitType: 'Division' });
const sale = orgUnit({ id: 'sale', parentId: 'div', code: 'SALE', unitType: 'Department', headEmployeeId: 'm1' });
const team = orgUnit({ id: 'team', parentId: 'sale', code: 'TEAM', unitType: 'Team' });
const hr = orgUnit({ id: 'hr', parentId: 'root', code: 'HR', unitType: 'Department' });
const units = [root, div, sale, team, hr];
const m1 = employee({ id: 'm1', employeeCode: 'M1', email: 'm1@x.test', hireDate: '2019-01-01' });
const e1 = employee({ id: 'e1', employeeCode: 'E1', email: 'e1@x.test', hireDate: '2020-01-01' });
const employees = [m1, e1];
const assignments = [
  assignment({ id: 'as-m1', employeeId: 'm1', orgUnitId: 'sale', effectiveFrom: '2019-01-01' }),
  assignment({ id: 'as-e1', employeeId: 'e1', orgUnitId: 'sale', managerEmployeeId: 'm1', effectiveFrom: '2020-01-01' }),
];
const cycles = [
  { id: 'c2026', status: 'Closed' as const },
  { id: 'c2027', status: 'Active' as const },
];
const unitCtx = { units, assignments, employees, plans: [] as ReturnType<typeof plan>[], cycles, today: TODAY };

describe('units — BR-KPI-67, 69', () => {
  it('requires a code and a name', () => {
    expect(details(unitIssues({ ...hr, id: undefined, code: ' ', name: '' }, null, unitCtx))).toEqual(['ERR-KPI-06:REQUIRED', 'ERR-KPI-06:REQUIRED']);
  });

  it.each([
    ['a Team under a Division (skipping a level) is fine', 'div', 'Team', []],
    ['a Department under a Company is fine', 'root', 'Department', []],
    ['a Division under a Department is refused', 'sale', 'Division', ['ERR-KPI-06:UNIT_TYPE_ORDER']],
    ['a Department under a Department is refused', 'hr', 'Department', ['ERR-KPI-06:UNIT_TYPE_ORDER']],
  ] as const)('%s', (_, parentId, unitType, expected) => {
    expect(details(unitIssues({ ...orgUnit({ code: 'NEW', name: 'Mới', parentId, unitType }), id: undefined }, null, unitCtx))).toEqual(expected);
  });

  it('refuses retyping a unit above or level with its children', () => {
    expect(details(unitIssues({ ...sale, unitType: 'Team' }, sale, unitCtx))).toContain('ERR-KPI-06:UNIT_TYPE_ORDER');
  });

  it('refuses moving a unit under an Inactive parent, not leaving one there', () => {
    const closed = orgUnit({ id: 'closed', parentId: 'root', code: 'X', unitType: 'Division', status: 'Inactive', effectiveTo: '2026-12-31' });
    const child = orgUnit({ id: 'child', parentId: 'closed', code: 'Y', unitType: 'Department', status: 'Inactive', effectiveTo: '2026-12-31' });
    const ctx = { ...unitCtx, units: [...units, closed, child] };
    expect(details(unitIssues({ ...hr, parentId: 'closed' }, hr, ctx))).toEqual(['ERR-KPI-06:PARENT_INACTIVE']);
    expect(unitIssues({ ...child, name: 'Đổi tên' }, child, ctx)).toEqual([]);
  });

  it('the end date is effectiveTo, or today when set Inactive without one', () => {
    expect(unitEndDate({ status: 'Active', effectiveTo: null }, TODAY)).toBeNull();
    expect(unitEndDate({ status: 'Inactive', effectiveTo: null }, TODAY)).toBe(TODAY);
    expect(unitEndDate({ status: 'Active', effectiveTo: '2027-06-30' }, TODAY)).toBe('2027-06-30');
  });

  it('refuses stopping a unit with an active sub-unit, staff past the end, or a plan in an open cycle (ERR-KPI-14)', () => {
    const ctx = { ...unitCtx, plans: [plan({ ownerType: 'OrgUnit', ownerOrgUnitId: 'sale', ownerEmployeeId: null, cycleId: 'c2027' })] };
    const issues = unitIssues({ ...sale, status: 'Inactive' }, sale, ctx);
    expect(details(issues)).toEqual(['ERR-KPI-14:UNIT_HAS_CHILDREN', 'ERR-KPI-14:UNIT_HAS_STAFF', 'ERR-KPI-14:UNIT_HAS_PLANS']);
    expect(issues.map((i) => i.data?.count)).toEqual([1, 2, 1]);
  });

  it('allows stopping a unit whose staff end by then and whose plans are in closed cycles', () => {
    const ctx = {
      ...unitCtx,
      assignments: [assignment({ id: 'old', employeeId: 'e1', orgUnitId: 'hr', effectiveFrom: '2020-01-01', effectiveTo: '2027-06-30' })],
      plans: [plan({ ownerType: 'OrgUnit', ownerOrgUnitId: 'hr', ownerEmployeeId: null, cycleId: 'c2026' })],
    };
    expect(unitIssues({ ...hr, effectiveTo: '2027-06-30' }, hr, ctx)).toEqual([]);
    expect(details(unitIssues({ ...hr, effectiveTo: '2027-06-29' }, hr, ctx))).toEqual(['ERR-KPI-14:UNIT_HAS_STAFF']);
  });

  it('never ends the root, and never re-checks a unit that was already stopped', () => {
    expect(details(unitIssues({ ...root, status: 'Inactive' }, root, unitCtx))).toEqual(['ERR-KPI-06:ROOT_CANNOT_END']);
    const stopped = { ...sale, status: 'Inactive' as const, effectiveTo: '2026-12-31' };
    expect(unitIssues({ ...stopped, name: 'Đổi tên' }, stopped, unitCtx)).toEqual([]);
  });

  it('counts what uses a unit after a date', () => {
    expect(unitUsage('sale', TODAY, unitCtx)).toEqual({ activeChildren: 1, staff: 2, openPlans: 0 });
  });

  it('a head must be employed today and assigned in the unit or below it', () => {
    const tm = employee({ id: 'tm', employeeCode: 'TM', email: 'tm@x.test' });
    const left = employee({ id: 'left', employeeCode: 'L', email: 'l@x.test', employmentStatus: 'Resigned', leftOn: '2027-03-10' });
    const ctx = {
      ...unitCtx,
      employees: [...employees, tm, left],
      assignments: [...assignments, assignment({ id: 'as-tm', employeeId: 'tm', orgUnitId: 'team' })],
    };
    expect(headIssues('sale', 'tm', ctx)).toEqual([]); // in a sub-unit
    expect(details(headIssues('hr', 'm1', ctx))).toEqual(['ERR-KPI-06:HEAD_NOT_IN_UNIT']);
    expect(details(headIssues('sale', 'left', ctx))).toEqual(['ERR-KPI-06:HEAD_NOT_EMPLOYED']);
    expect(details(unitIssues({ ...hr, headEmployeeId: 'm1' }, hr, ctx))).toEqual(['ERR-KPI-06:HEAD_NOT_IN_UNIT']);
    expect(unitIssues({ ...sale, name: 'x' }, sale, ctx)).toEqual([]); // head unchanged → not re-checked
  });
});

describe('positions — BR-KPI-70', () => {
  const staff = position({ id: 'pos-staff' });
  it('refuses Inactive while an assignment in force today or later uses it', () => {
    const issues = positionIssues({ ...staff, status: 'Inactive' }, staff, { assignments, today: TODAY });
    expect(details(issues)).toEqual(['ERR-KPI-14:POSITION_IN_USE']);
    expect(issues[0].data).toEqual({ count: 2 });
  });
  it('allows it once every assignment has ended, and leaves an Inactive one editable', () => {
    const ended = [assignment({ positionId: 'pos-staff', effectiveTo: '2027-01-31' })];
    expect(positionIssues({ ...staff, status: 'Inactive' }, staff, { assignments: ended, today: TODAY })).toEqual([]);
    const inactive = { ...staff, status: 'Inactive' as const };
    expect(positionIssues({ ...inactive, name: 'x' }, inactive, { assignments, today: TODAY })).toEqual([]);
  });
});

describe('employees — BR-KPI-68, 71', () => {
  const ctx = { employees, assignments };
  it.each([
    ['a code in another case', { employeeCode: 'm1' }, ['ERR-KPI-06:CODE_TAKEN']],
    ['an email in another case', { email: 'M1@X.test' }, ['ERR-KPI-06:EMAIL_TAKEN']],
    ['a malformed email', { email: 'nope' }, ['ERR-KPI-06:EMAIL_INVALID']],
    ['Resigned without a last day', { employmentStatus: 'Resigned', leftOn: null }, ['ERR-KPI-06:LEFT_ON_REQUIRED']],
    ['a last day while still Official', { leftOn: '2027-05-01' }, ['ERR-KPI-06:LEFT_ON_NEEDS_RESIGNED']],
    ['a last day before the hire date', { employmentStatus: 'Resigned', leftOn: '2019-12-31' }, ['ERR-KPI-06:LEFT_BEFORE_HIRED', 'ERR-KPI-06:ASSIGNMENT_AFTER_LEFT_ON']],
    ['a later hire date that strands an assignment', { hireDate: '2021-01-01' }, ['ERR-KPI-06:ASSIGNMENT_BEFORE_HIRE']],
  ] as const)('refuses %s', (_, change, expected) => {
    expect(details(employeeIssues({ ...e1, ...change }, e1, ctx))).toEqual(expected);
  });

  it('refuses a last day before an assignment that has not started; the day itself is fine', () => {
    const booked = assignment({ id: 'booked', employeeId: 'e1', effectiveFrom: '2027-08-01' });
    const c = { employees, assignments: [...assignments, booked] };
    expect(details(employeeIssues({ ...e1, employmentStatus: 'Resigned', leftOn: '2027-06-30' }, e1, c))).toEqual(['ERR-KPI-06:ASSIGNMENT_AFTER_LEFT_ON']);
    expect(employeeIssues({ ...e1, employmentStatus: 'Resigned', leftOn: '2027-08-01' }, e1, c)).toEqual([]);
  });

  it('accepts a resignation with a last day, and its own unchanged code', () => {
    expect(employeeIssues({ ...e1, employmentStatus: 'Resigned', leftOn: '2027-04-30' }, e1, ctx)).toEqual([]);
  });

  it('a resignation ends the assignments that run past the last day — once', () => {
    const resigned = { ...e1, employmentStatus: 'Resigned' as const, leftOn: '2027-04-30' };
    const later = assignment({ id: 'later', employeeId: 'e1', isPrimary: false, effectiveFrom: '2027-06-01' });
    expect(resignationPlan(resigned, e1, [...assignments, later])).toEqual([{ ...assignments[1], effectiveTo: '2027-04-30' }]);
    expect(resignationPlan(resigned, resigned, assignments)).toEqual([]);
  });

  it('lists what a resignation leaves behind, changing nothing', () => {
    const impact = resignationImpact('m1', { units, employees, assignments, accounts: [user({ id: 'u-m1', employeeId: 'm1' })], today: TODAY });
    expect(impact.directReports.map((e) => e.id)).toEqual(['e1']);
    expect(impact.headedUnits.map((u) => u.id)).toEqual(['sale']);
    expect(impact.activeAccounts.map((a) => a.id)).toEqual(['u-m1']);
  });
});

describe('assignments — BR-KPI-65, 66', () => {
  const staff = position({ id: 'pos-staff' });
  const ctx = { employees, units, positions: [staff, position({ id: 'pos-old', code: 'OLD', status: 'Inactive' })], assignments };
  const draft = (o: Partial<ReturnType<typeof assignment>> = {}) => ({ ...assignment({ employeeId: 'e1', orgUnitId: 'hr', effectiveFrom: '2027-05-01', ...o }), id: undefined });

  it('accepts a valid assignment', () => {
    expect(assignmentIssues(draft({ managerEmployeeId: 'm1' }), null, ctx)).toEqual([]);
  });

  it.each([
    ['dates out of order', { effectiveTo: '2027-04-30' }, ['ERR-KPI-06:DATES_ORDER']],
    ['a start before the hire date', { effectiveFrom: '2019-06-01' }, ['ERR-KPI-06:OUTSIDE_EMPLOYMENT']],
    ['an Inactive position', { positionId: 'pos-old' }, ['ERR-KPI-06:POSITION_INACTIVE']],
    ['the person as their own manager', { managerEmployeeId: 'e1' }, ['ERR-KPI-16:SELF_MANAGER']],
  ] as const)('refuses %s', (_, change, expected) => {
    expect(details(assignmentIssues(draft(change), null, ctx))).toEqual(expected);
  });

  it('refuses running past the last working day', () => {
    const leaving = { ...e1, employmentStatus: 'Resigned' as const, leftOn: '2027-06-30' };
    const c = { ...ctx, employees: [m1, leaving] };
    expect(details(assignmentIssues(draft(), null, c))).toEqual(['ERR-KPI-06:OUTSIDE_EMPLOYMENT']);
    expect(assignmentIssues(draft({ effectiveTo: '2027-06-30' }), null, c)).toEqual([]);
  });

  it('refuses an Inactive unit, or one that closes before the assignment ends', () => {
    const closing = orgUnit({ id: 'closing', parentId: 'root', code: 'C', unitType: 'Department', effectiveTo: '2027-12-31' });
    const c = { ...ctx, units: [...units, closing, orgUnit({ id: 'gone', parentId: 'root', code: 'G', unitType: 'Department', status: 'Inactive' })] };
    expect(details(assignmentIssues(draft({ orgUnitId: 'gone' }), null, c))).toEqual(['ERR-KPI-06:UNIT_INACTIVE']);
    expect(details(assignmentIssues(draft({ orgUnitId: 'closing' }), null, c))).toEqual(['ERR-KPI-06:UNIT_INACTIVE']);
    expect(assignmentIssues(draft({ orgUnitId: 'closing', effectiveTo: '2027-12-31' }), null, c)).toEqual([]);
  });

  it('refuses a manager not employed over the whole assignment (ERR-KPI-16)', () => {
    const late = employee({ id: 'late', employeeCode: 'LATE', email: 'late@x.test', hireDate: '2027-06-01' });
    const leaving = employee({ id: 'leaving', employeeCode: 'LV', email: 'lv@x.test', employmentStatus: 'Resigned', leftOn: '2027-08-31' });
    const c = { ...ctx, employees: [...employees, late, leaving] };
    expect(details(assignmentIssues(draft({ managerEmployeeId: 'late' }), null, c))).toEqual(['ERR-KPI-16:MANAGER_NOT_EMPLOYED']);
    expect(details(assignmentIssues(draft({ managerEmployeeId: 'leaving' }), null, c))).toEqual(['ERR-KPI-16:MANAGER_NOT_EMPLOYED']);
    expect(assignmentIssues(draft({ managerEmployeeId: 'leaving', effectiveTo: '2027-08-31' }), null, c)).toEqual([]);
  });

  it('refuses a reporting line that loops back (A → B → A, A → B → C → A)', () => {
    // m1 reports to e1 → e1 can no longer report to m1.
    const looped = [assignments[1], assignment({ id: 'as-m1', employeeId: 'm1', orgUnitId: 'sale', managerEmployeeId: 'e1', effectiveFrom: '2019-01-01' })];
    expect(details(assignmentIssues(draft({ managerEmployeeId: 'm1' }), null, { ...ctx, assignments: looped }))).toEqual(['ERR-KPI-16:REPORTING_CYCLE']);
    const c3 = employee({ id: 'c3', employeeCode: 'C3', email: 'c3@x.test', hireDate: '2019-01-01' });
    const chain = [
      assignment({ id: 'as-m1', employeeId: 'm1', managerEmployeeId: 'c3', effectiveFrom: '2019-01-01' }),
      assignment({ id: 'as-c3', employeeId: 'c3', managerEmployeeId: 'e1', effectiveFrom: '2019-01-01' }),
    ];
    expect(details(assignmentIssues(draft({ managerEmployeeId: 'm1' }), null, { ...ctx, employees: [...employees, c3], assignments: chain }))).toEqual(['ERR-KPI-16:REPORTING_CYCLE']);
  });

  it('re-checks the manager only when the manager or the dates change (a seeded line stays editable)', () => {
    const late = employee({ id: 'late', employeeCode: 'LATE', email: 'late@x.test', hireDate: '2025-01-01' });
    const stored = assignment({ id: 'as-x', employeeId: 'e1', managerEmployeeId: 'late', effectiveFrom: '2020-01-01' });
    const c = { ...ctx, employees: [...employees, late], assignments: [stored] };
    expect(assignmentIssues({ ...stored, positionId: 'pos-staff' }, stored, c)).toEqual([]);
    expect(details(assignmentIssues({ ...stored, effectiveTo: '2027-12-31' }, stored, c))).toEqual(['ERR-KPI-16:MANAGER_NOT_EMPLOYED']);
  });

  it('flags a manager outside the employee\'s unit line — a warning, not an issue', () => {
    expect(managerOutsideUnit({ orgUnitId: 'team', managerEmployeeId: 'm1', effectiveFrom: TODAY }, { units, assignments })).toBe(false); // m1 in sale, above team
    expect(managerOutsideUnit({ orgUnitId: 'hr', managerEmployeeId: 'm1', effectiveFrom: TODAY }, { units, assignments })).toBe(true);
    expect(managerOutsideUnit({ orgUnitId: 'hr', managerEmployeeId: null, effectiveFrom: TODAY }, { units, assignments })).toBe(false);
  });
});

describe('transfer — B1', () => {
  const running = assignment({ id: 'run', employeeId: 'e1', effectiveFrom: '2020-01-01' });
  const draft = (o: Partial<ReturnType<typeof assignment>> = {}) => ({ ...assignment({ employeeId: 'e1', orgUnitId: 'hr', effectiveFrom: '2027-05-01', ...o }), id: undefined });

  it('a new primary from D ends the running one on D − 1', () => {
    expect(transferPlan(draft(), null, [running])).toEqual({ end: { ...running, effectiveTo: '2027-04-30' }, issues: [] });
  });

  it('a concurrent row, an update that stays primary, or no overlap ends nothing', () => {
    expect(transferPlan(draft({ isPrimary: false }), null, [running]).end).toBeNull();
    expect(transferPlan({ ...running, orgUnitId: 'hr' }, running, [running])).toEqual({ end: null, issues: [] });
    expect(transferPlan(draft(), null, [{ ...running, effectiveTo: '2027-04-30' }])).toEqual({ end: null, issues: [] });
  });

  it('refuses a bounded transfer that would drop the running row\'s tail', () => {
    expect(details(transferPlan(draft({ effectiveTo: '2027-09-30' }), null, [running]).issues)).toEqual(['ERR-KPI-06:TRANSFER_BOUNDED']);
    // Fine when the running row ends by then anyway.
    expect(transferPlan(draft({ effectiveTo: '2027-09-30' }), null, [{ ...running, effectiveTo: '2027-09-30' }]).end?.effectiveTo).toBe('2027-04-30');
  });

  it('an existing row becoming primary is a transfer too', () => {
    const concurrent = assignment({ id: 'kn', employeeId: 'e1', isPrimary: false, effectiveFrom: '2027-05-01' });
    expect(transferPlan({ ...concurrent, isPrimary: true }, concurrent, [running, concurrent]).end?.effectiveTo).toBe('2027-04-30');
  });

  it.each([
    ['on or before the running one\'s start', [running], { effectiveFrom: '2020-01-01' }],
    ['when a later primary already follows', [{ ...running, effectiveTo: '2027-06-30' }, assignment({ id: 'next', employeeId: 'e1', effectiveFrom: '2027-07-01' })], {}],
    ['when it overlaps two primaries', [{ ...running, effectiveTo: '2027-05-31' }, assignment({ id: 'next', employeeId: 'e1', effectiveFrom: '2027-06-01' })], { effectiveFrom: '2027-05-15' }],
  ] as const)('is refused %s (PRIMARY_OVERLAP)', (_, rows, change) => {
    expect(details(transferPlan(draft(change), null, rows).issues)).toEqual(['ERR-KPI-06:PRIMARY_OVERLAP']);
  });
});

describe('tenant — BR-KPI-73', () => {
  const tenant = { id: 'syn', code: 'SYN', name: 'Syntra', timezone: 'Asia/Ho_Chi_Minh', status: 'Active' as const, createdAt: '2026-01-01T00:00:00Z' };
  it('validates the time zone', () => {
    expect(isValidTimeZone('Asia/Ho_Chi_Minh')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(details(tenantIssues({ ...tenant, timezone: 'GMT+7' }, tenant, 'syn'))).toEqual(['ERR-KPI-06:TIMEZONE_INVALID']);
  });
  it('refuses suspending your own company, not editing it', () => {
    expect(details(tenantIssues({ ...tenant, status: 'Suspended' }, tenant, 'syn'))).toEqual(['ERR-KPI-15:SUSPEND_OWN_TENANT']);
    expect(tenantIssues({ ...tenant, name: 'Syntra JSC' }, tenant, 'syn')).toEqual([]);
  });
});
