import { describe, expect, it } from 'vitest';
import { assignment, employee, orgUnit, userRole } from '@/test/builders';
import {
  descendantUnitIds,
  employedFraction,
  isEmployedDuring,
  isEffectiveOn,
  isEmployedOn,
  isStillEmployedOn,
  managerOf,
  primaryAssignmentOn,
  scopeCoversEmployee,
  scopeSubjectOn,
  unitAncestry,
  wouldCreateReportingCycle,
  wouldCreateUnitCycle,
} from './orgRules';

const units = [
  orgUnit({ id: 'root', parentId: null }),
  orgUnit({ id: 'div', parentId: 'root', unitType: 'Division' }),
  orgUnit({ id: 'sale', parentId: 'div', unitType: 'Department' }),
  orgUnit({ id: 'team', parentId: 'sale', unitType: 'Team' }),
  orgUnit({ id: 'hr', parentId: 'root', unitType: 'Department' }),
];

describe('assignments and managers', () => {
  // e1 reports to m1 until 14 Feb, then to m2 (a manager change mid-period).
  const history = [
    assignment({ id: 'a1', employeeId: 'e1', managerEmployeeId: 'm1', effectiveFrom: '2026-01-01', effectiveTo: '2027-02-14' }),
    assignment({ id: 'a2', employeeId: 'e1', managerEmployeeId: 'm2', effectiveFrom: '2027-02-15', effectiveTo: null }),
    assignment({ id: 'a3', employeeId: 'e1', managerEmployeeId: 'm9', isPrimary: false, effectiveFrom: '2026-01-01' }),
  ];

  it.each([
    ['2027-02-14', 'm1'],
    ['2027-02-15', 'm2'],
    ['2025-12-31', null],
  ])('on %s the direct manager is %s', (date, manager) => {
    expect(managerOf('e1', history, date)).toBe(manager);
  });

  it('ignores a concurrent (non-primary) assignment', () => {
    expect(primaryAssignmentOn('e1', history, '2027-03-01')?.id).toBe('a2');
  });

  it('treats both ends of an assignment as inclusive', () => {
    expect(isEffectiveOn(history[0], '2027-02-14')).toBe(true);
    expect(isEffectiveOn(history[0], '2027-02-15')).toBe(false);
  });
});

describe('the unit tree', () => {
  it('walks up from the unit to the root', () => {
    expect(unitAncestry('team', units)).toEqual(['team', 'sale', 'div', 'root']);
    expect(unitAncestry('missing', units)).toEqual([]);
  });

  it('stops on a cyclic tree instead of looping', () => {
    const broken = [orgUnit({ id: 'a', parentId: 'b' }), orgUnit({ id: 'b', parentId: 'a' })];
    expect(unitAncestry('a', broken)).toEqual(['a', 'b']);
  });

  it('lists a unit and everything below it', () => {
    expect([...descendantUnitIds(units, 'div')].sort()).toEqual(['div', 'sale', 'team']);
    expect([...descendantUnitIds(units, 'hr')]).toEqual(['hr']);
  });

  it('includes Inactive units and survives a cycle', () => {
    const tree = [...units, orgUnit({ id: 'closed', parentId: 'sale', status: 'Inactive' })];
    expect(descendantUnitIds(tree, 'sale').has('closed')).toBe(true);
    const broken = [orgUnit({ id: 'a', parentId: 'b' }), orgUnit({ id: 'b', parentId: 'a' })];
    expect([...descendantUnitIds(broken, 'a')].sort()).toEqual(['a', 'b']);
  });

  it.each([
    ['sale', 'team', true],
    ['sale', 'sale', true],
    ['team', 'hr', false],
    ['sale', null, false],
  ] as const)('moving %s under %s creates a cycle: %s', (unitId, parent, expected) => {
    expect(wouldCreateUnitCycle(units, unitId, parent)).toBe(expected);
  });
});

describe('employment', () => {
  const leaver = employee({ hireDate: '2025-06-01', leftOn: '2027-01-15', employmentStatus: 'Resigned' });
  const joiner = employee({ hireDate: '2027-01-21' });

  it.each([
    ['2027-01-15', true], // the last working day still counts
    ['2027-01-16', false],
    ['2025-05-31', false],
  ])('the leaver is employed on %s: %s', (date, expected) => {
    expect(isEmployedOn(leaver, date)).toBe(expected);
  });

  it('counts anyone who worked a day of the period (left on 15 Jan → evaluated for January)', () => {
    expect(isEmployedDuring(leaver, '2027-01-01', '2027-01-31')).toBe(true);
    expect(isEmployedDuring(leaver, '2027-02-01', '2027-02-28')).toBe(false);
    expect(isEmployedDuring(joiner, '2027-01-01', '2027-01-31')).toBe(true);
    expect(isEmployedDuring(joiner, '2026-12-01', '2026-12-31')).toBe(false);
  });

  it('isStillEmployedOn ignores the hire date — in scope until they leave', () => {
    expect(isStillEmployedOn(joiner, '2027-01-01')).toBe(true); // not hired yet, but not gone
    expect(isStillEmployedOn(leaver, '2027-01-15')).toBe(true);
    expect(isStillEmployedOn(leaver, '2027-01-16')).toBe(false);
    expect(isStillEmployedOn(employee({ employmentStatus: 'Resigned', leftOn: null }), '2027-01-01')).toBe(false);
  });

  it('treats "Resigned" with no last day as gone', () => {
    const gone = employee({ employmentStatus: 'Resigned', leftOn: null });
    expect(isEmployedOn(gone, '2027-01-10')).toBe(false);
    expect(isEmployedDuring(gone, '2027-01-01', '2027-01-31')).toBe(false);
  });

  it('measures the employed share of a period (ASSUMPTION Q13 — not applied to pay in P1)', () => {
    expect(employedFraction(leaver, '2027-01-01', '2027-01-31')).toBeCloseTo(15 / 31);
    expect(employedFraction(joiner, '2027-01-01', '2027-01-31')).toBeCloseTo(11 / 31);
    expect(employedFraction(employee(), '2027-01-01', '2027-01-31')).toBe(1);
    expect(employedFraction(leaver, '2027-02-01', '2027-02-28')).toBe(0);
  });
});

describe('scopeSubjectOn / scopeCoversEmployee', () => {
  const e1 = employee({ id: 'e1' });
  const assignments = [
    assignment({ id: 'p', employeeId: 'e1', orgUnitId: 'team', managerEmployeeId: 'm1' }),
    assignment({ id: 'c', employeeId: 'e1', orgUnitId: 'hr', managerEmployeeId: 'm2', isPrimary: false }), // kiêm nhiệm
    assignment({ id: 'old', employeeId: 'e1', orgUnitId: 'div', managerEmployeeId: 'm3', effectiveTo: '2026-12-31' }),
  ];
  const subject = scopeSubjectOn(e1, assignments, '2027-01-10');
  const ctx = (actorEmployeeId: string | null) => ({ units, actorEmployeeId });

  it('takes every assignment in force, concurrent ones included, and none that ended', () => {
    expect([...subject.orgUnitIds].sort()).toEqual(['hr', 'team']);
    expect([...subject.managerEmployeeIds].sort()).toEqual(['m1', 'm2']);
    expect(subject.inScope).toBe(true);
  });

  it.each([
    [userRole({ scopeType: 'Tenant' }), 'x', true],
    [userRole({ scopeType: 'Self' }), 'e1', true],
    [userRole({ scopeType: 'Self' }), 'm1', false],
    [userRole({ scopeType: 'DirectReports' }), 'm1', true],
    [userRole({ scopeType: 'DirectReports' }), 'm2', true], // the concurrent line counts
    [userRole({ scopeType: 'DirectReports' }), 'm3', false], // an ended line does not
    [userRole({ scopeType: 'OrgUnit', scopeOrgUnitId: 'team' }), 'x', true],
    [userRole({ scopeType: 'OrgUnit', scopeOrgUnitId: 'hr' }), 'x', true], // via the concurrent unit
    [userRole({ scopeType: 'OrgUnit', scopeOrgUnitId: 'div', includeChildren: false }), 'x', false],
    [userRole({ scopeType: 'OrgUnit', scopeOrgUnitId: 'div', includeChildren: true }), 'x', true],
    [userRole({ scopeType: 'OrgUnit', scopeOrgUnitId: 'unknown', includeChildren: true }), 'x', false],
    [userRole({ scopeType: 'OrgUnit', scopeOrgUnitId: null }), 'x', false],
  ])('%# covers the subject: %s', (role, actor, expected) => {
    expect(scopeCoversEmployee(role, subject, ctx(actor))).toBe(expected);
  });

  it('never makes you your own direct report', () => {
    const selfManaged = scopeSubjectOn(employee({ id: 'm1' }), [assignment({ employeeId: 'm1', managerEmployeeId: 'm1' })], '2027-01-10');
    expect(scopeCoversEmployee(userRole({ scopeType: 'DirectReports' }), selfManaged, ctx('m1'))).toBe(false);
  });

  it('a system account (no employee) covers nobody through Self or DirectReports', () => {
    expect(scopeCoversEmployee(userRole({ scopeType: 'Self' }), subject, ctx(null))).toBe(false);
    expect(scopeCoversEmployee(userRole({ scopeType: 'DirectReports' }), subject, ctx(null))).toBe(false);
  });

  it('fails closed for someone who has left, even with an assignment left open', () => {
    const gone = scopeSubjectOn(employee({ id: 'e1', leftOn: '2027-01-09', employmentStatus: 'Resigned' }), assignments, '2027-01-10');
    expect(gone.inScope).toBe(false);
    expect(scopeCoversEmployee(userRole({ scopeType: 'Tenant' }), gone, ctx('x'))).toBe(false);
    const lastDay = scopeSubjectOn(employee({ id: 'e1', leftOn: '2027-01-10' }), assignments, '2027-01-10');
    expect(lastDay.inScope).toBe(true);
  });
});

describe('wouldCreateReportingCycle', () => {
  const lines = [
    assignment({ id: 'b', employeeId: 'b', managerEmployeeId: 'a' }),
    assignment({ id: 'c', employeeId: 'c', managerEmployeeId: 'b' }),
    assignment({ id: 'old', employeeId: 'a', managerEmployeeId: 'x', isPrimary: false }),
  ];
  it.each([
    ['A reporting to B, who reports to A', 'a', 'b', true],
    ['A reporting to C, two levels below A', 'a', 'c', true],
    ['C reporting to A, above it', 'c', 'a', false],
    ['nobody as manager', 'a', null, false],
    ['someone with no line', 'a', 'z', false],
  ] as const)('%s → %s', (_, employeeId, managerId, expected) => {
    expect(wouldCreateReportingCycle(lines, employeeId, managerId, '2027-04-06')).toBe(expected);
  });
  it('stops on a loop already in the data', () => {
    const loop = [assignment({ id: 'p', employeeId: 'p', managerEmployeeId: 'q' }), assignment({ id: 'q', employeeId: 'q', managerEmployeeId: 'p' })];
    expect(wouldCreateReportingCycle(loop, 'z', 'p', '2027-04-06')).toBe(false);
  });
});
