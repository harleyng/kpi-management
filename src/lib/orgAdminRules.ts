/**
 * Organisation guards (Track T1, WBS 4.1.1–4.1.4) — what may be saved to the org tree, positions,
 * employees, assignments and the tenant record, as `RuleIssue[]` (never thrown).
 *
 * The SAME functions pre-check a screen (a disabled action with its reason) and guard the gateway
 * write (`mock/groups/orgTx.ts`), so the two never disagree. They take whole arrays of rows — the
 * gateway passes `tx.all(...)`, a screen passes complete, unfiltered query data — and the date as
 * `today` (the tenant's "today" from the gateway clock); they read no clock of their own.
 *
 * Every check is TRANSITION-based: it compares the draft with the stored row (`prev`) and fires only
 * on the change it is about, so a seeded row that predates a rule (an Inactive unit with history, a
 * manager hired after a report) stays editable. Ids are resolved by the caller BEFORE these run: a
 * row a draft names but `ctx` does not hold is skipped here and left to the integrity check, so a
 * foreign id answers exactly like a missing one.
 *
 * Every rule here is a Syntra decision (`ASSUMPTION Q19–Q24`): no source describes the org data.
 */

import type {
  CycleStatus,
  Employee,
  EmployeeAssignment,
  GoalPlan,
  Id,
  IsoDate,
  JobPosition,
  OrgUnit,
  OrgUnitType,
  PerformanceCycle,
  Tenant,
  TenantScoped,
  UserAccount,
} from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';
import { addDays } from './isoDate';
import { descendantUnitIds, isEffectiveOn, isEmployedOn, isStillEmployedOn, wouldCreateReportingCycle } from './orgRules';

/** A row as a screen or a payload sends it: no tenant, and no id when it is new. */
export type Draft<T extends TenantScoped> = Omit<T, 'id' | 'tenantId'> & { id?: Id };

const blank = (value: string | null | undefined) => value === null || value === undefined || value.trim() === '';
const sameText = (a: string, b: string) => a.trim().toLocaleLowerCase('vi') === b.trim().toLocaleLowerCase('vi');
/** Open-ended (`null`) or still running on/after `date`. */
const runsOnOrAfter = (to: IsoDate | null, date: IsoDate) => to === null || to >= date;

function required<T extends object>(draft: T, fields: readonly (keyof T & string)[]): RuleIssue[] {
  return fields
    .filter((f) => blank(draft[f] as unknown as string | null))
    .map((f) => ruleIssue('ERR-KPI-06', f, 'REQUIRED'));
}

// ─── Units (BR-KPI-67, 69) ─────────────────────────────────────────────────────────────────────

/** Company > Division > Department > Team: a child sits strictly below its parent (not necessarily one step). */
export const UNIT_TYPE_RANK: Readonly<Record<OrgUnitType, number>> = { Company: 0, Division: 1, Department: 2, Team: 3 };

/** The day a unit stops: its `effectiveTo`, or `today` when it is set Inactive without one. `null` = running. */
export function unitEndDate(unit: Pick<OrgUnit, 'status' | 'effectiveTo'>, today: IsoDate): IsoDate | null {
  if (unit.effectiveTo !== null) return unit.effectiveTo;
  return unit.status === 'Inactive' ? today : null;
}

export interface UnitContext {
  units: readonly OrgUnit[];
  assignments: readonly EmployeeAssignment[];
  employees: readonly Employee[];
  plans: readonly Pick<GoalPlan, 'cycleId' | 'ownerOrgUnitId'>[];
  cycles: readonly Pick<PerformanceCycle, 'id' | 'status'>[];
  today: IsoDate;
}

/** What still uses a unit after `end` — the reasons it cannot stop yet (also shown on the screen). */
export interface UnitUsage {
  activeChildren: number;
  /** People with an assignment there that runs past the end date. */
  staff: number;
  /** Goal Plans the unit owns in a cycle that is not Closed. */
  openPlans: number;
}

const OPEN_CYCLE: ReadonlySet<CycleStatus> = new Set(['Planning', 'Active', 'Evaluating']);

export function unitUsage(unitId: Id, end: IsoDate, ctx: Omit<UnitContext, 'employees' | 'today'>): UnitUsage {
  const openCycles = new Set(ctx.cycles.filter((c) => OPEN_CYCLE.has(c.status)).map((c) => c.id));
  return {
    activeChildren: ctx.units.filter((u) => u.parentId === unitId && u.status === 'Active' && runsOnOrAfter(u.effectiveTo, addDays(end, 1))).length,
    staff: new Set(ctx.assignments.filter((a) => a.orgUnitId === unitId && runsOnOrAfter(a.effectiveTo, addDays(end, 1))).map((a) => a.employeeId)).size,
    openPlans: ctx.plans.filter((p) => p.ownerOrgUnitId === unitId && openCycles.has(p.cycleId)).length,
  };
}

/** The issues that refuse stopping a unit on `end` (ERR-KPI-14 per reason, root 06). */
export function unitEndIssues(unit: Pick<OrgUnit, 'parentId'> & { id?: Id }, end: IsoDate, ctx: UnitContext): RuleIssue[] {
  if (unit.parentId === null) return [ruleIssue('ERR-KPI-06', 'status', 'ROOT_CANNOT_END')];
  if (unit.id === undefined) return [];
  const usage = unitUsage(unit.id, end, ctx);
  const issues: RuleIssue[] = [];
  if (usage.activeChildren > 0) issues.push(ruleIssue('ERR-KPI-14', 'status', 'UNIT_HAS_CHILDREN', { count: usage.activeChildren }));
  if (usage.staff > 0) issues.push(ruleIssue('ERR-KPI-14', 'status', 'UNIT_HAS_STAFF', { count: usage.staff }));
  if (usage.openPlans > 0) issues.push(ruleIssue('ERR-KPI-14', 'status', 'UNIT_HAS_PLANS', { count: usage.openPlans }));
  return issues;
}

/** Whether `employeeId` may head `unitId` today: employed and assigned in the unit or below it. */
export function headIssues(unitId: Id | undefined, headEmployeeId: Id, ctx: Pick<UnitContext, 'units' | 'assignments' | 'employees' | 'today'>): RuleIssue[] {
  const head = ctx.employees.find((e) => e.id === headEmployeeId);
  if (!head) return [];
  if (!isEmployedOn(head, ctx.today)) return [ruleIssue('ERR-KPI-06', 'headEmployeeId', 'HEAD_NOT_EMPLOYED')];
  const subtree = unitId === undefined ? new Set<Id>() : descendantUnitIds(ctx.units, unitId);
  const placed = ctx.assignments.some((a) => a.employeeId === headEmployeeId && subtree.has(a.orgUnitId) && isEffectiveOn(a, ctx.today));
  return placed ? [] : [ruleIssue('ERR-KPI-06', 'headEmployeeId', 'HEAD_NOT_IN_UNIT')];
}

export function unitIssues(next: Draft<OrgUnit>, prev: OrgUnit | null, ctx: UnitContext): RuleIssue[] {
  const issues = required(next, ['code', 'name']);
  const parent = next.parentId === null ? null : ctx.units.find((u) => u.id === next.parentId);
  const moved = prev === null || prev.parentId !== next.parentId;

  if (parent && (moved || prev?.unitType !== next.unitType) && UNIT_TYPE_RANK[next.unitType] <= UNIT_TYPE_RANK[parent.unitType]) {
    issues.push(ruleIssue('ERR-KPI-06', 'unitType', 'UNIT_TYPE_ORDER'));
  }
  if (prev && prev.unitType !== next.unitType) {
    const tooHigh = ctx.units.some((u) => u.parentId === prev.id && UNIT_TYPE_RANK[u.unitType] <= UNIT_TYPE_RANK[next.unitType]);
    if (tooHigh) issues.push(ruleIssue('ERR-KPI-06', 'unitType', 'UNIT_TYPE_ORDER'));
  }
  if (parent && moved && parent.status === 'Inactive') issues.push(ruleIssue('ERR-KPI-06', 'parentId', 'PARENT_INACTIVE'));

  const end = unitEndDate(next, ctx.today);
  const prevEnd = prev ? unitEndDate(prev, ctx.today) : null;
  const ending = end !== null && (prev === null || prevEnd === null || end < prevEnd || prev.status !== next.status);
  if (ending && prev !== null) issues.push(...unitEndIssues({ id: next.id, parentId: next.parentId }, end, ctx));

  if (next.headEmployeeId !== null && next.headEmployeeId !== (prev?.headEmployeeId ?? null)) {
    issues.push(...headIssues(next.id, next.headEmployeeId, ctx));
  }
  return issues;
}

// ─── Positions (BR-KPI-70) ─────────────────────────────────────────────────────────────────────

/** Assignments in force today or later that use the position. */
export function positionUsage(positionId: Id, ctx: { assignments: readonly EmployeeAssignment[]; today: IsoDate }): number {
  return ctx.assignments.filter((a) => a.positionId === positionId && runsOnOrAfter(a.effectiveTo, ctx.today)).length;
}

export function positionIssues(next: Draft<JobPosition>, prev: JobPosition | null, ctx: { assignments: readonly EmployeeAssignment[]; today: IsoDate }): RuleIssue[] {
  const issues = required(next, ['code', 'name']);
  if (next.id !== undefined && next.status === 'Inactive' && prev?.status !== 'Inactive') {
    const count = positionUsage(next.id, ctx);
    if (count > 0) issues.push(ruleIssue('ERR-KPI-14', 'status', 'POSITION_IN_USE', { count }));
  }
  return issues;
}

// ─── Employees (BR-KPI-68) ─────────────────────────────────────────────────────────────────────

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function employeeIssues(
  next: Draft<Employee>,
  prev: Employee | null,
  ctx: { employees: readonly Employee[]; assignments: readonly EmployeeAssignment[] },
): RuleIssue[] {
  const issues = required(next, ['employeeCode', 'fullName', 'email', 'hireDate']);
  const others = ctx.employees.filter((e) => e.id !== next.id);
  if (!blank(next.employeeCode) && (prev === null || !sameText(prev.employeeCode, next.employeeCode)) && others.some((e) => sameText(e.employeeCode, next.employeeCode))) {
    issues.push(ruleIssue('ERR-KPI-06', 'employeeCode', 'CODE_TAKEN'));
  }
  if (!blank(next.email) && (prev === null || !sameText(prev.email, next.email))) {
    if (!EMAIL.test(next.email.trim())) issues.push(ruleIssue('ERR-KPI-06', 'email', 'EMAIL_INVALID'));
    else if (others.some((e) => sameText(e.email, next.email))) issues.push(ruleIssue('ERR-KPI-06', 'email', 'EMAIL_TAKEN'));
  }
  if (next.employmentStatus === 'Resigned' && next.leftOn === null) issues.push(ruleIssue('ERR-KPI-06', 'leftOn', 'LEFT_ON_REQUIRED'));
  if (next.employmentStatus !== 'Resigned' && next.leftOn !== null) issues.push(ruleIssue('ERR-KPI-06', 'employmentStatus', 'LEFT_ON_NEEDS_RESIGNED'));
  if (next.leftOn !== null && !blank(next.hireDate) && next.leftOn < next.hireDate) issues.push(ruleIssue('ERR-KPI-06', 'leftOn', 'LEFT_BEFORE_HIRED'));

  // A last working day before an assignment that has not started yet would leave a leaver assigned.
  if (next.id !== undefined && next.leftOn !== null && next.leftOn !== (prev?.leftOn ?? null)) {
    const leftOn = next.leftOn;
    if (ctx.assignments.some((a) => a.employeeId === next.id && a.effectiveFrom > leftOn)) issues.push(ruleIssue('ERR-KPI-06', 'leftOn', 'ASSIGNMENT_AFTER_LEFT_ON'));
  }

  // Moving the hire date later must not strand an assignment before it (the end date is handled by
  // `resignationPlan`, which ends the assignments that run past the last working day).
  if (prev && next.id !== undefined && prev.hireDate !== next.hireDate && !blank(next.hireDate)) {
    const before = ctx.assignments.some((a) => a.employeeId === next.id && a.effectiveFrom < next.hireDate);
    if (before) issues.push(ruleIssue('ERR-KPI-06', 'hireDate', 'ASSIGNMENT_BEFORE_HIRE'));
  }
  return issues;
}

/**
 * Recording a last working day (B3): the employee's assignments that run past it end on it, in the
 * same write, so nobody stays assigned after leaving. Nothing else changes by itself — direct reports,
 * units headed, the account and delegations are the screen's warning (`resignationImpact`).
 */
export function resignationPlan(next: Draft<Employee>, prev: Employee | null, assignments: readonly EmployeeAssignment[]): EmployeeAssignment[] {
  const leftOn = next.leftOn;
  if (leftOn === null || prev === null || prev.leftOn === leftOn || next.id === undefined) return [];
  return assignments
    .filter((a) => a.employeeId === next.id && runsOnOrAfter(a.effectiveTo, addDays(leftOn, 1)) && a.effectiveFrom <= leftOn)
    .map((a) => ({ ...a, effectiveTo: leftOn }));
}

/** What a resignation leaves behind — shown before it is saved, never changed by it. */
export interface ResignationImpact {
  /** People whose assignment in force today names them as direct manager. */
  directReports: Employee[];
  /** Active units they head. */
  headedUnits: OrgUnit[];
  /** Their Active accounts (the screen locks them first). */
  activeAccounts: UserAccount[];
}

export function resignationImpact(
  employeeId: Id,
  ctx: { units: readonly OrgUnit[]; employees: readonly Employee[]; assignments: readonly EmployeeAssignment[]; accounts: readonly UserAccount[]; today: IsoDate },
): ResignationImpact {
  const reportIds = new Set(
    ctx.assignments.filter((a) => a.managerEmployeeId === employeeId && isEffectiveOn(a, ctx.today)).map((a) => a.employeeId),
  );
  return {
    directReports: ctx.employees.filter((e) => reportIds.has(e.id) && e.id !== employeeId && isStillEmployedOn(e, ctx.today)),
    headedUnits: ctx.units.filter((u) => u.headEmployeeId === employeeId && u.status === 'Active'),
    activeAccounts: ctx.accounts.filter((a) => a.employeeId === employeeId && a.status === 'Active'),
  };
}

// ─── Assignments (BR-KPI-65, 66) ───────────────────────────────────────────────────────────────

export interface AssignmentContext {
  employees: readonly Employee[];
  units: readonly OrgUnit[];
  positions: readonly JobPosition[];
  assignments: readonly EmployeeAssignment[];
}

const changed = <T extends object>(next: T, prev: T | null, fields: readonly (keyof T)[]) =>
  prev === null || fields.some((f) => next[f] !== prev[f]);

/** The manager is employed on every day of `[from, end]` (`end` `null` = open-ended). */
function employedThroughout(manager: Employee, from: IsoDate, end: IsoDate | null): boolean {
  if (manager.employmentStatus === 'Resigned' && manager.leftOn === null) return false;
  if (manager.hireDate > from) return false;
  if (manager.leftOn === null) return true;
  return end !== null && manager.leftOn >= end;
}

export function assignmentIssues(next: Draft<EmployeeAssignment>, prev: EmployeeAssignment | null, ctx: AssignmentContext): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const employee = ctx.employees.find((e) => e.id === next.employeeId);
  const datesChanged = changed(next, prev, ['employeeId', 'effectiveFrom', 'effectiveTo']);

  if (next.effectiveTo !== null && next.effectiveTo < next.effectiveFrom) issues.push(ruleIssue('ERR-KPI-06', 'effectiveTo', 'DATES_ORDER'));
  if (employee && datesChanged) {
    if (next.effectiveFrom < employee.hireDate) issues.push(ruleIssue('ERR-KPI-06', 'effectiveFrom', 'OUTSIDE_EMPLOYMENT'));
    else if (employee.leftOn !== null && (next.effectiveTo === null || next.effectiveTo > employee.leftOn)) {
      issues.push(ruleIssue('ERR-KPI-06', 'effectiveTo', 'OUTSIDE_EMPLOYMENT'));
    }
  }

  const unit = ctx.units.find((u) => u.id === next.orgUnitId);
  if (unit && changed(next, prev, ['orgUnitId', 'effectiveFrom', 'effectiveTo'])) {
    const unitEnd = unit.effectiveTo;
    if (unit.status === 'Inactive' || (unitEnd !== null && (next.effectiveTo === null || next.effectiveTo > unitEnd))) {
      issues.push(ruleIssue('ERR-KPI-06', 'orgUnitId', 'UNIT_INACTIVE'));
    }
  }
  const position = ctx.positions.find((p) => p.id === next.positionId);
  if (position && position.status === 'Inactive' && changed(next, prev, ['positionId'])) {
    issues.push(ruleIssue('ERR-KPI-06', 'positionId', 'POSITION_INACTIVE'));
  }

  const managerId = next.managerEmployeeId;
  if (managerId !== null && changed(next, prev, ['managerEmployeeId', 'employeeId', 'effectiveFrom', 'effectiveTo'])) {
    const manager = ctx.employees.find((e) => e.id === managerId);
    if (managerId === next.employeeId) issues.push(ruleIssue('ERR-KPI-16', 'managerEmployeeId', 'SELF_MANAGER'));
    else if (manager && !employedThroughout(manager, next.effectiveFrom, next.effectiveTo)) {
      issues.push(ruleIssue('ERR-KPI-16', 'managerEmployeeId', 'MANAGER_NOT_EMPLOYED'));
    } else if (next.isPrimary) {
      const others = ctx.assignments.filter((a) => a.id !== next.id);
      if (wouldCreateReportingCycle(others, next.employeeId, managerId, next.effectiveFrom)) {
        issues.push(ruleIssue('ERR-KPI-16', 'managerEmployeeId', 'REPORTING_CYCLE'));
      }
    }
  }
  return issues;
}

/**
 * The manager holds no assignment, on the start date, in the employee's unit or any unit above it.
 * Allowed — a matrix line is real — but the screen warns (`ASSUMPTION Q21`).
 */
export function managerOutsideUnit(next: Pick<EmployeeAssignment, 'orgUnitId' | 'managerEmployeeId' | 'effectiveFrom'>, ctx: Pick<AssignmentContext, 'units' | 'assignments'>): boolean {
  if (next.managerEmployeeId === null) return false;
  const line = new Set<Id>();
  for (let unit = ctx.units.find((u) => u.id === next.orgUnitId); unit && !line.has(unit.id); unit = ctx.units.find((u) => u.id === unit?.parentId)) {
    line.add(unit.id);
  }
  return !ctx.assignments.some((a) => a.employeeId === next.managerEmployeeId && line.has(a.orgUnitId) && isEffectiveOn(a, next.effectiveFrom));
}

/** B1 — a transfer: a new primary assignment from D ends the running one on D − 1, in the same write. */
export interface TransferPlan {
  /** The running primary assignment, ended the day before; `null` when nothing needs ending. */
  end: EmployeeAssignment | null;
  issues: RuleIssue[];
}

/**
 * Applies only when the draft is a NEW primary row, or an existing row becoming primary. Refused (06
 * PRIMARY_OVERLAP) when it overlaps more than one primary row, one that starts on or after D, or a
 * row that a later primary already follows — the schema's "one primary on any date" stays the rule.
 */
export function transferPlan(next: Draft<EmployeeAssignment>, prev: EmployeeAssignment | null, assignments: readonly EmployeeAssignment[]): TransferPlan {
  const becomesPrimary = next.isPrimary && (prev === null || !prev.isPrimary);
  if (!becomesPrimary) return { end: null, issues: [] };
  const from = next.effectiveFrom;
  const to = next.effectiveTo ?? '9999-12-31';
  const primaries = assignments.filter((a) => a.employeeId === next.employeeId && a.isPrimary && a.id !== next.id);
  const overlapping = primaries.filter((a) => a.effectiveFrom <= to && runsOnOrAfter(a.effectiveTo, from));
  if (overlapping.length === 0) return { end: null, issues: [] };
  const [running] = overlapping;
  const laterStart = primaries.some((a) => a.effectiveFrom >= from);
  if (overlapping.length > 1 || running.effectiveFrom >= from || laterStart) {
    return { end: null, issues: [ruleIssue('ERR-KPI-06', 'effectiveFrom', 'PRIMARY_OVERLAP')] };
  }
  // A bounded transfer would silently drop the running row's tail (after the new one ends).
  if (next.effectiveTo !== null && (running.effectiveTo === null || running.effectiveTo > next.effectiveTo)) {
    return { end: null, issues: [ruleIssue('ERR-KPI-06', 'effectiveTo', 'TRANSFER_BOUNDED')] };
  }
  return { end: { ...running, effectiveTo: addDays(from, -1) }, issues: [] };
}

// ─── Tenant (BR-KPI-73) ────────────────────────────────────────────────────────────────────────

/** An IANA zone the runtime knows (`Asia/Ho_Chi_Minh`). */
export function isValidTimeZone(zone: string): boolean {
  if (blank(zone) || !zone.includes('/')) return zone === 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The tenant record. A tenant may not suspend itself: its people could no longer sign in, the
 * administrator included, and nothing in P1 can reactivate it (`ASSUMPTION Q24`).
 */
export function tenantIssues(next: Omit<Tenant, 'id' | 'createdAt'> & { id?: Id }, prev: Tenant | null, actorHomeTenantId: Id): RuleIssue[] {
  const issues = required(next, ['code', 'name']);
  if (!isValidTimeZone(next.timezone)) issues.push(ruleIssue('ERR-KPI-06', 'timezone', 'TIMEZONE_INVALID'));
  if (prev && prev.id === actorHomeTenantId && next.status === 'Suspended' && prev.status !== 'Suspended') {
    issues.push(ruleIssue('ERR-KPI-15', 'status', 'SUSPEND_OWN_TENANT'));
  }
  return issues;
}
