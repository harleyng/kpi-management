/**
 * The manual-entry table (WBS 4.4.2) — one row per goal for the chosen month, with everything the
 * screen shows already decided here: owner and unit, the month's target, the current actual, and
 * whether a number may be entered (and why not). The page only renders (CLAUDE.md rule 5).
 */

import type {
  CyclePeriod,
  DataSource,
  Employee,
  EmployeeAssignment,
  Goal,
  GoalActual,
  GoalPeriodTarget,
  GoalPlan,
  IsoDate,
  MeasureUnit,
  OrgUnit,
  PerformanceCycle,
  PeriodResult,
  SourceType,
} from '@/data/types';
import { currentActual, entryBlockers, isResultFinalised } from './actualRules';
import { targetForPeriod } from './calcRules';
import type { RuleIssue } from './errorCatalog';
import { primaryAssignmentOn } from './orgRules';
import { matchesSearch } from './search';

export interface ActualEntryRow {
  goal: Goal;
  plan: GoalPlan;
  /** The person, unit or company the plan belongs to. */
  ownerName: string;
  /** The org unit the row belongs to (the owner's unit during the month), for the unit filter. */
  orgUnit: Pick<OrgUnit, 'id' | 'name'> | null;
  dataSource: Pick<DataSource, 'id' | 'code' | 'name' | 'sourceType'> | null;
  measureUnit: string | null;
  /** The month's target: its split, else the goal's (number), or the text target. */
  target: number | string | null;
  current: GoalActual | null;
  /** Why nothing can be entered (`actualRules.entryBlockers`); empty = open for entry. */
  blockers: RuleIssue[];
  /** Open for entry AND the viewer may enter actuals for this plan's owner. */
  canEnter: boolean;
}

export interface ActualEntryInput {
  period: CyclePeriod;
  goals: readonly Goal[];
  plans: readonly GoalPlan[];
  employees: readonly Pick<Employee, 'id' | 'fullName'>[];
  assignments: readonly EmployeeAssignment[];
  orgUnits: readonly Pick<OrgUnit, 'id' | 'name' | 'parentId'>[];
  dataSources: readonly Pick<DataSource, 'id' | 'code' | 'name' | 'sourceType'>[];
  units: readonly Pick<MeasureUnit, 'id' | 'name'>[];
  periodTargets: readonly GoalPeriodTarget[];
  /** The period's actuals (current ones are picked here). */
  actuals: readonly GoalActual[];
  results: readonly Pick<PeriodResult, 'goalPlanId' | 'periodId' | 'status'>[];
  asOf: IsoDate;
  /** `useSession().can('actual.enter', plan owner)` — the viewer's entitlement. */
  mayEnter: (plan: GoalPlan) => boolean;
}

/**
 * The Active goals of every plan of the period's cycle, ordered by unit, owner, goal order. Maps are
 * built once, so 150 goals cost 150 lookups.
 */
export function buildActualEntryRows(input: ActualEntryInput): ActualEntryRow[] {
  const plans = new Map(input.plans.filter((p) => p.cycleId === input.period.cycleId).map((p) => [p.id, p]));
  const employees = new Map(input.employees.map((e) => [e.id, e.fullName]));
  const units = new Map(input.orgUnits.map((u) => [u.id, u]));
  const sources = new Map(input.dataSources.map((d) => [d.id, d]));
  const measures = new Map(input.units.map((u) => [u.id, u.name]));
  const root = input.orgUnits.find((u) => u.parentId === null) ?? null;
  const periodActuals = input.actuals.filter((a) => a.periodId === input.period.id);

  const rows: ActualEntryRow[] = [];
  for (const goal of input.goals) {
    const plan = plans.get(goal.goalPlanId);
    if (!plan || goal.status !== 'Active') continue;
    let ownerName: string;
    let orgUnit: Pick<OrgUnit, 'id' | 'name'> | null;
    if (plan.ownerType === 'Employee' && plan.ownerEmployeeId) {
      ownerName = employees.get(plan.ownerEmployeeId) ?? '';
      // The unit the person sat in during the month — someone who left mid-month (Q13) still has one.
      const unitId = (primaryAssignmentOn(plan.ownerEmployeeId, input.assignments, input.period.startDate) ?? primaryAssignmentOn(plan.ownerEmployeeId, input.assignments, input.asOf))?.orgUnitId;
      orgUnit = unitId ? (units.get(unitId) ?? null) : null;
    } else if (plan.ownerType === 'OrgUnit' && plan.ownerOrgUnitId) {
      orgUnit = units.get(plan.ownerOrgUnitId) ?? null;
      ownerName = orgUnit?.name ?? '';
    } else {
      orgUnit = root;
      ownerName = root?.name ?? '';
    }
    const blockers = entryBlockers({
      goal,
      planStatus: plan.status,
      goalCycleId: plan.cycleId,
      period: input.period,
      resultsFinalised: isResultFinalised(input.results, plan.id, input.period.id),
      asOf: input.asOf,
    });
    rows.push({
      goal,
      plan,
      ownerName,
      orgUnit: orgUnit ? { id: orgUnit.id, name: orgUnit.name } : null,
      dataSource: sources.get(goal.dataSourceId) ?? null,
      measureUnit: measures.get(goal.unitId) ?? null,
      target: goal.targetType === 'TEXT' ? goal.targetText : targetForPeriod(goal, input.periodTargets, input.period.id),
      current: currentActual(periodActuals, goal.id, input.period.id),
      blockers,
      canEnter: blockers.length === 0 && input.mayEnter(plan),
    });
  }
  const key = (r: ActualEntryRow) => `${r.orgUnit?.name ?? ''}\u0000${r.ownerName}\u0000${String(r.goal.sortOrder).padStart(4, '0')}`;
  return rows.sort((a, b) => key(a).localeCompare(key(b), 'vi'));
}

/** "Còn X/Y chỉ tiêu chưa có số": of the goals open for entry, how many have no current actual. */
export function actualEntrySummary(rows: readonly ActualEntryRow[]): { open: number; missing: number } {
  const open = rows.filter((r) => r.blockers.length === 0);
  return { open: open.length, missing: open.filter((r) => r.current === null).length };
}

export interface ActualEntryFilter {
  search: string;
  orgUnitId: string | null;
  sourceType: SourceType | null;
  /** Only goals open for entry that have no current actual. */
  missingOnly: boolean;
}

export const EMPTY_ACTUAL_ENTRY_FILTER: ActualEntryFilter = { search: '', orgUnitId: null, sourceType: null, missingOnly: false };

export function filterActualEntryRows(rows: readonly ActualEntryRow[], filter: ActualEntryFilter): ActualEntryRow[] {
  return rows.filter(
    (r) =>
      (filter.orgUnitId === null || r.orgUnit?.id === filter.orgUnitId) &&
      (filter.sourceType === null || r.dataSource?.sourceType === filter.sourceType) &&
      (!filter.missingOnly || (r.blockers.length === 0 && r.current === null)) &&
      matchesSearch(filter.search, [r.ownerName, r.goal.name, r.orgUnit?.name, r.dataSource?.name]),
  );
}

export const isActualEntryFiltered = (filter: ActualEntryFilter) =>
  filter.search.trim() !== '' || filter.orgUnitId !== null || filter.sourceType !== null || filter.missingOnly;

// ─── The shared cycle / month pickers ────────────────────────────────────────────────────────────

/** The cycle the actuals screens open on: the Active one, else one being evaluated, else the latest. */
export function defaultCycle<C extends Pick<PerformanceCycle, 'status' | 'startDate'>>(cycles: readonly C[]): C | null {
  const byStart = [...cycles].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return byStart.find((c) => c.status === 'Active') ?? byStart.find((c) => c.status === 'Evaluating') ?? byStart[0] ?? null;
}

/** A cycle's months in order — actuals are entered per month only (`ASSUMPTION Q36`). */
export function monthsOf<P extends Pick<CyclePeriod, 'periodType' | 'startDate'>>(periods: readonly P[]): P[] {
  return periods.filter((p) => p.periodType === 'Month').sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
}

/**
 * The month the screens open on: the latest one that has ENDED by `today` (actuals are entered after
 * the month closes), else the one in progress, else the first.
 */
export function defaultMonth<P extends Pick<CyclePeriod, 'startDate' | 'endDate'>>(months: readonly P[], today: IsoDate): P | null {
  const ended = months.filter((p) => p.endDate < today);
  const started = months.filter((p) => p.startDate <= today);
  return ended[ended.length - 1] ?? started[started.length - 1] ?? months[0] ?? null;
}

/**
 * "Lưu và sang chỉ tiêu kế tiếp": the first row AFTER the open one, in the table's order, that is still
 * shown and open for entry. Found by position in the FULL list, because the open row may have just left
 * the filtered one (saving a number takes it out of "chưa có số").
 */
export function nextEntryRow(rows: readonly ActualEntryRow[], shown: readonly ActualEntryRow[], currentGoalId: string): ActualEntryRow | null {
  const index = rows.findIndex((r) => r.goal.id === currentGoalId);
  if (index < 0) return null;
  const visible = new Set(shown.map((r) => r.goal.id));
  return rows.slice(index + 1).find((r) => r.canEnter && visible.has(r.goal.id)) ?? null;
}
