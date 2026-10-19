/**
 * Org lookups shared by the rules — who someone's manager is on a date, where a unit sits in the
 * tree, whether someone was employed, whether a role's scope covers a person.
 *
 * One home for these so `workflowRules`, `permissionRules` (Phase 1.3) and the mock gateway (1.2)
 * never keep their own copies. This module imports no other rule module.
 */

import type { Employee, EmployeeAssignment, Id, IsoDate, OrgUnit, UserRole } from '@/data/types';
import { daysBetween, isWithin } from './isoDate';

/** An assignment is in force from `effectiveFrom` to `effectiveTo`, both inclusive (`null` = open). */
export function isEffectiveOn(assignment: EmployeeAssignment, date: IsoDate): boolean {
  return isWithin(date, assignment.effectiveFrom, assignment.effectiveTo);
}

/** The employee's primary assignment in force on `date` (the latest-starting one if several overlap). */
export function primaryAssignmentOn(
  employeeId: Id,
  assignments: readonly EmployeeAssignment[],
  date: IsoDate,
): EmployeeAssignment | null {
  const candidates = assignments
    .filter((a) => a.employeeId === employeeId && a.isPrimary && isEffectiveOn(a, date))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return candidates[0] ?? null;
}

/** The direct manager on `date`, read from the primary assignment (BR-KPI-20: at the time of the action). */
export function managerOf(employeeId: Id, assignments: readonly EmployeeAssignment[], date: IsoDate): Id | null {
  return primaryAssignmentOn(employeeId, assignments, date)?.managerEmployeeId ?? null;
}

/** The unit and its parents, own unit first, up to the root. Stops on a broken or cyclic tree. */
export function unitAncestry(unitId: Id, units: readonly OrgUnit[]): Id[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const chain: Id[] = [];
  let current: Id | null = unitId;
  while (current !== null && byId.has(current) && !chain.includes(current)) {
    chain.push(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return chain;
}

/**
 * `rootId` and every unit below it — Inactive units included (a scope keeps covering a unit that was
 * closed mid-period), cycle-safe. Units whose parent does not exist are simply never reached.
 */
export function descendantUnitIds(units: readonly OrgUnit[], rootId: Id): Set<Id> {
  const result = new Set<Id>([rootId]);
  const queue: Id[] = [rootId];
  for (let i = 0; i < queue.length; i++) {
    for (const u of units) {
      if (u.parentId === queue[i] && !result.has(u.id)) {
        result.add(u.id);
        queue.push(u.id);
      }
    }
  }
  return result;
}

/** Moving `unitId` under `newParentId` would put it below itself. */
export function wouldCreateUnitCycle(units: readonly OrgUnit[], unitId: Id, newParentId: Id | null): boolean {
  if (newParentId === null) return false;
  return newParentId === unitId || unitAncestry(newParentId, units).includes(unitId);
}

/** A `Resigned` employee with no recorded last day is treated as gone. */
const leftWithoutDate = (e: Employee) => e.employmentStatus === 'Resigned' && e.leftOn === null;

/**
 * Not yet gone on `date`: `leftOn` (the last working day) is not before it, and not "Resigned" without
 * a last day. Ignores the hire date — what a scope needs (a person is in scope until they leave).
 */
export function isStillEmployedOn(employee: Employee, date: IsoDate): boolean {
  return !leftWithoutDate(employee) && (employee.leftOn === null || employee.leftOn >= date);
}

/** Employed on `date`: hired by then and `leftOn` (the last working day) not before it. */
export function isEmployedOn(employee: Employee, date: IsoDate): boolean {
  return !leftWithoutDate(employee) && isWithin(date, employee.hireDate, employee.leftOn);
}

/** Employed for at least one day of `[start, end]` — someone who left on 15 Jan was employed in January. */
export function isEmployedDuring(employee: Employee, start: IsoDate, end: IsoDate): boolean {
  if (leftWithoutDate(employee)) return false;
  return employee.hireDate <= end && (employee.leftOn === null || employee.leftOn >= start);
}

/**
 * The share of `[start, end]` the employee was employed, 0–1. Exposed for `ASSUMPTION Q13`: P1 does
 * NOT prorate the payout for a mid-period joiner or leaver; this is what a proration would use.
 */
export function employedFraction(employee: Employee, start: IsoDate, end: IsoDate): number {
  if (!isEmployedDuring(employee, start, end)) return 0;
  const from = employee.hireDate > start ? employee.hireDate : start;
  const to = employee.leftOn !== null && employee.leftOn < end ? employee.leftOn : end;
  return (daysBetween(from, to) + 1) / (daysBetween(start, end) + 1);
}

/**
 * Who a scope is being checked against, on one date — built by `scopeSubjectOn`. EVERY assignment in
 * force counts, concurrent (kiêm nhiệm) ones included: a scope covers the person if it covers any of
 * their units or lines.
 */
export interface ScopeSubject {
  employeeId: Id;
  orgUnitIds: readonly Id[];
  managerEmployeeIds: readonly Id[];
  /** `false` once the person's last working day is before the date — out of every scope (fail closed). */
  inScope: boolean;
}

export function scopeSubjectOn(employee: Employee, assignments: readonly EmployeeAssignment[], date: IsoDate): ScopeSubject {
  const current = assignments.filter((a) => a.employeeId === employee.id && isEffectiveOn(a, date));
  return {
    employeeId: employee.id,
    orgUnitIds: [...new Set(current.map((a) => a.orgUnitId))],
    managerEmployeeIds: [...new Set(current.map((a) => a.managerEmployeeId).filter((m): m is Id => m !== null))],
    inScope: isStillEmployedOn(employee, date),
  };
}

/**
 * Whether a role assignment's scope (ERD `USER_ROLE.scope_type`) reaches `subject` — the same
 * semantics `permissionRules` (Phase 1.3) applies:
 * - Self — the actor is the subject (a system account, with no employee, covers nobody);
 * - DirectReports — ONE level: the actor is a direct manager of the subject, never the actor themself;
 * - OrgUnit — a subject's unit is the scope unit, or in its subtree when `includeChildren`; a missing
 *   or unknown scope unit covers nothing;
 * - Tenant — everyone in scope.
 */
export function scopeCoversEmployee(
  userRole: UserRole,
  subject: ScopeSubject,
  ctx: { units: readonly OrgUnit[]; actorEmployeeId: Id | null },
): boolean {
  if (!subject.inScope) return false;
  const actor = ctx.actorEmployeeId;
  switch (userRole.scopeType) {
    case 'Self':
      return actor !== null && actor === subject.employeeId;
    case 'DirectReports':
      return actor !== null && actor !== subject.employeeId && subject.managerEmployeeIds.includes(actor);
    case 'OrgUnit': {
      const scopeUnit = userRole.scopeOrgUnitId;
      if (scopeUnit === null || !ctx.units.some((u) => u.id === scopeUnit)) return false;
      const covered = userRole.includeChildren ? descendantUnitIds(ctx.units, scopeUnit) : new Set([scopeUnit]);
      return subject.orgUnitIds.some((unit) => covered.has(unit));
    }
    case 'Tenant':
      return true;
  }
}
