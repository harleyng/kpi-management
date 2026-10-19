/**
 * The live dashboard (WBS 4.7.1–4.7.3, Phase 3) — BR-KPI-83…89, `ASSUMPTION Q40`–`Q43`.
 *
 * Every STORED number (a result's `totalScore`, its rating, its payout) is passed through untouched;
 * what this module derives — who sits where, averages, differences, breakdowns, counts — it derives
 * from those stored numbers and the existing rules (`scoreRules`, `resultRules`, `formViewRules`), so
 * the dashboard can never disagree with the result screens (T6) or the form lists (T5).
 *
 * Scope (BR-KPI-83): `dashboard.view` is scope-sensitive. A unit is shown when the grant covers it;
 * a person is shown under — and only under — the unit they sat in on the period's last day
 * (`resultRules.subjectAssignment`, Q43), so a leaver and a transfer keep their past results where
 * they earned them. Employee coverage "as of today" is deliberately NOT used: it drops leavers.
 */

import type {
  CyclePeriod,
  Employee,
  EmployeeAssignment,
  FormInstance,
  FormStatus,
  Goal,
  GoalPlan,
  GoalPlanStatus,
  Id,
  IsoDate,
  OrgUnit,
  PeriodResult,
  RatingLevel,
  WorkflowStep,
} from '@/data/types';
import { FORM_STATUSES, GOAL_PLAN_STATUSES } from '@/data/types';
import { defaultResultPeriod } from './cycleRules';
import { stepTiming } from './formViewRules';
import { daysBetween, todayOf, type Clock } from './isoDate';
import { can, type AccessProfile } from './permissionRules';
import { subjectAssignment } from './resultRules';
import { roundScore, weightedScore } from './scoreRules';

// ─── Constants and small predicates ────────────────────────────────────────────────────────────

/**
 * BR-KPI-86, `ASSUMPTION Q41` — a goal whose achievement is BELOW this % needs attention. A fixed
 * number, independent of the rating scale (it equals the sample scale's B floor by coincidence of the
 * Q2 sample, not by design). Exactly 90 is not flagged.
 */
export const AT_RISK_ACHIEVEMENT_PCT = 90;

/** BR-KPI-84 — only a Final or Locked result is official; a Draft is "Tạm tính". */
export const isOfficial = (result: Pick<PeriodResult, 'status'>): boolean => result.status === 'Final' || result.status === 'Locked';

/** Someone who worked at least one day of the period (a leaver's past results still count). */
export function employedDuring(employee: Pick<Employee, 'hireDate' | 'leftOn'>, period: Pick<CyclePeriod, 'startDate' | 'endDate'>): boolean {
  return employee.hireDate <= period.endDate && (employee.leftOn === null || employee.leftOn >= period.startDate);
}

/** The period before `period` in the same cycle and of the same type — never an earlier one that happens to have data (Q42). */
export function previousPeriod(periods: readonly CyclePeriod[], period: CyclePeriod): CyclePeriod | null {
  const same = periods.filter((p) => p.cycleId === period.cycleId && p.periodType === period.periodType).sort(byStart);
  const index = same.findIndex((p) => p.id === period.id);
  return index > 0 ? same[index - 1] : null;
}

const byStart = (a: CyclePeriod, b: CyclePeriod) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.id < b.id ? -1 : 1);

/**
 * The period the dashboard opens on: the latest MONTH of the cycle with at least one official result
 * (an executive wants the newest finalised picture), else `cycleRules.defaultResultPeriod`.
 */
export function defaultDashboardPeriod(periods: readonly CyclePeriod[], results: readonly Pick<PeriodResult, 'periodId' | 'status'>[], today: IsoDate): CyclePeriod | null {
  const withOfficial = new Set(results.filter(isOfficial).map((r) => r.periodId));
  const months = periods.filter((p) => p.periodType === 'Month' && withOfficial.has(p.id)).sort(byStart);
  return months[months.length - 1] ?? defaultResultPeriod([...periods], today);
}

// ─── Difference between periods (BR-KPI-87, Q42) ───────────────────────────────────────────────

export interface ScoreDelta {
  /** Points, rounded once to 2 decimals (`roundScore`); `null` when either side has no score. */
  points: number | null;
  /** Either side is a Draft — shown "(tạm tính)". */
  provisional: boolean;
}

export function scoreDelta(current: Pick<PeriodResult, 'totalScore' | 'status'> | null, previous: Pick<PeriodResult, 'totalScore' | 'status'> | null): ScoreDelta {
  if (!current || !previous || current.totalScore === null || previous.totalScore === null) return { points: null, provisional: false };
  return { points: roundScore(current.totalScore - previous.totalScore), provisional: !isOfficial(current) || !isOfficial(previous) };
}

// ─── Rating flag (BR-KPI-86, Q41) ──────────────────────────────────────────────────────────────

/**
 * The levels that flag a result: the scale's two LOWEST bands (C and D in the sample) — only
 * the lowest on a two-level scale, and none on a scale of one level or none — a flag must never mark
 * everyone. Read from the scale, never from a level code.
 */
export function flaggedLevelIds(levels: readonly Pick<RatingLevel, 'id' | 'minScore'>[]): Set<Id> {
  // "Lowest" by the score band, so it does not matter which way a scale numbers its `sortOrder`.
  const ordered = [...levels].sort((a, b) => a.minScore - b.minScore || a.id.localeCompare(b.id));
  const count = ordered.length < 2 ? 0 : ordered.length < 3 ? 1 : 2;
  return new Set(ordered.slice(0, count).map((l) => l.id));
}

/** A rated result in one of the flagged levels. An Employee Draft never flags; no rating never flags. */
export function isResultFlagged(result: Pick<PeriodResult, 'ratingLevelId' | 'ownerType' | 'status'>, flagged: ReadonlySet<Id>): boolean {
  if (result.ratingLevelId === null || !flagged.has(result.ratingLevelId)) return false;
  return result.ownerType !== 'Employee' || isOfficial(result);
}

// ─── Goal lines: attention and BSC breakdown ───────────────────────────────────────────────────

export interface DetailLine {
  goalId: Id;
  weight: number;
  achievementPct: number | null;
}

export type AttentionKind = 'BELOW_THRESHOLD' | 'MISSING';

export interface AttentionItem {
  goalId: Id;
  /** `null` for a goal the viewer may not see (PRIVATE) — counted, never named. */
  name: string | null;
  achievementPct: number | null;
  kind: AttentionKind;
}

/**
 * BR-KPI-86 — the result's goal lines that need attention: below `AT_RISK_ACHIEVEMENT_PCT` ("Dưới
 * ngưỡng") or without an achievement ("Thiếu số liệu" — never a warning, never 0). The lines are the
 * stored result's (`ResultDetail`), so a Changed goal still on an evaluation snapshot counts as it did
 * in the score. Worst first, missing last.
 */
export function goalAttention(lines: readonly DetailLine[], visibleGoals: readonly Pick<Goal, 'id' | 'name'>[]): { items: AttentionItem[]; hiddenCount: number } {
  const names = new Map(visibleGoals.map((g) => [g.id, g.name]));
  const items: AttentionItem[] = [];
  for (const line of lines) {
    const kind: AttentionKind | null =
      line.achievementPct === null ? 'MISSING' : line.achievementPct < AT_RISK_ACHIEVEMENT_PCT ? 'BELOW_THRESHOLD' : null;
    if (kind) items.push({ goalId: line.goalId, name: names.get(line.goalId) ?? null, achievementPct: line.achievementPct, kind });
  }
  items.sort((a, b) => (a.achievementPct ?? Infinity) - (b.achievementPct ?? Infinity) || a.goalId.localeCompare(b.goalId));
  return { items, hiddenCount: items.filter((i) => i.name === null).length };
}

/** The bucket of goals whose perspective is unknown — kept, never dropped. */
export const UNCLASSIFIED_PERSPECTIVE = 'UNCLASSIFIED';

export interface PerspectiveRow {
  perspectiveId: Id | typeof UNCLASSIFIED_PERSPECTIVE;
  /** Σ weight of the perspective's lines. */
  weight: number;
  /** Its share of the result's total weight, in % — NOT a contribution to the score. */
  weightShare: number | null;
  /** Σ(a × w) / Σw over its scored lines — an average achievement; `null` when none is scored. */
  achievement: number | null;
  missing: number;
  lines: number;
}

/**
 * BSC view of one result (BR-KPI-86): its stored lines grouped by the goal's perspective, each group
 * through `scoreRules.weightedScore`. The bars are average achievements per perspective — they do not
 * add up to the total score, and the screen says so. Every line counts as it did in the score.
 */
export function perspectiveBreakdown(
  lines: readonly DetailLine[],
  goals: readonly Pick<Goal, 'id' | 'perspectiveId'>[],
  perspectiveOrder: readonly Id[],
): PerspectiveRow[] {
  const perspectiveOf = new Map(goals.map((g) => [g.id, g.perspectiveId]));
  const known = new Set(perspectiveOrder);
  const groups = new Map<string, DetailLine[]>();
  for (const line of lines) {
    const p = perspectiveOf.get(line.goalId);
    const key = p && known.has(p) ? p : UNCLASSIFIED_PERSPECTIVE;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const total = lines.reduce((s, l) => s + l.weight, 0);
  const order = [...perspectiveOrder, UNCLASSIFIED_PERSPECTIVE];
  return order
    .filter((key) => groups.has(key))
    .map((key) => {
      const group = groups.get(key) ?? [];
      const score = weightedScore(group.map((l) => ({ goalId: l.goalId, weight: l.weight, status: 'Active' as const, achievementPct: l.achievementPct })));
      return {
        perspectiveId: key,
        weight: score.totalWeight,
        weightShare: total > 0 ? (score.totalWeight / total) * 100 : null,
        achievement: score.score,
        missing: score.missingGoalIds.length,
        lines: group.length,
      };
    });
}

// ─── The org tree (BR-KPI-84, 85, Q40, Q43) ────────────────────────────────────────────────────

export interface DashboardData {
  tenantId: Id;
  /** The cycle's periods (every type). */
  periods: readonly CyclePeriod[];
  /** Results of the cycle's periods (at least the selected one and the one before it). */
  results: readonly PeriodResult[];
  /** The cycle's Goal Plans. */
  plans: readonly GoalPlan[];
  units: readonly OrgUnit[];
  employees: readonly Employee[];
  assignments: readonly EmployeeAssignment[];
  levels: readonly RatingLevel[];
  access: AccessProfile;
}

/** May the viewer see this unit on the dashboard? The root is the Company resource. */
export function canSeeUnit(data: Pick<DashboardData, 'tenantId' | 'access'>, unit: Pick<OrgUnit, 'id' | 'parentId'>): boolean {
  const resource = unit.parentId === null ? { kind: 'Company' as const, tenantId: data.tenantId } : { kind: 'OrgUnit' as const, tenantId: data.tenantId, orgUnitId: unit.id };
  return can(data.access, 'dashboard.view', resource) || can(data.access, 'dashboard.view', { kind: 'OrgUnit', tenantId: data.tenantId, orgUnitId: unit.id });
}

/** A unit appears for a period while it is in force then, or when it holds a plan of the cycle. */
function unitShown(unit: OrgUnit, period: CyclePeriod, plans: readonly GoalPlan[]): boolean {
  const inForce = unit.effectiveFrom <= period.endDate && (unit.effectiveTo === null || unit.effectiveTo >= period.startDate);
  return inForce || plans.some((p) => p.ownerOrgUnitId === unit.id);
}

export interface StaffEntry {
  plan: GoalPlan;
  employee: Employee | null;
  /** The unit the person sat in on the period's last (working) day; `null` = no primary assignment then. */
  unitId: Id | null;
  result: PeriodResult | null;
  previous: PeriodResult | null;
}

export interface UnitNode {
  unit: OrgUnit;
  depth: number;
  childIds: Id[];
  /** The unit's OWN plan (the Company plan for the root, the OrgUnit plan below). A Khối has none. */
  ownPlan: GoalPlan | null;
  own: PeriodResult | null;
  ownLevel: RatingLevel | null;
  delta: ScoreDelta;
  /** People placed in the unit's subtree (Q43) whose Employee plan is of the cycle and who worked in the period. */
  staffTotal: number;
  /** …of whom have an OFFICIAL result for the period. */
  staffCounted: number;
  /** Q40 — the unweighted mean of those official scores; `null` (never 0) when none. NOT a unit score. */
  staffAverage: number | null;
  /** Its own result is in a flagged level. */
  flagged: boolean;
}

export interface DashboardModel {
  period: CyclePeriod;
  previous: CyclePeriod | null;
  /** Visible units, by id. */
  nodes: ReadonlyMap<Id, UnitNode>;
  /** The highest visible units (one for a single-unit manager, the company for HR / BOD). */
  rootIds: Id[];
  /** Every Employee plan of the cycle, placed for the period (also the ones the viewer may not see — filter with `nodes`). */
  staff: StaffEntry[];
  /** Employee plans whose owner had no primary assignment in the period — shown to a Tenant-wide viewer only. */
  unplaced: StaffEntry[];
  flaggedLevels: ReadonlySet<Id>;
}

/** Everything the "Tổng quan" tab shows for one period, in the viewer's scope. */
export function buildDashboard(data: DashboardData, periodId: Id): DashboardModel | null {
  const period = data.periods.find((p) => p.id === periodId);
  if (!period) return null;
  const previous = previousPeriod(data.periods, period);
  const flaggedLevels = flaggedLevelIds(data.levels);
  const levelById = new Map(data.levels.map((l) => [l.id, l]));
  const resultOf = (planId: Id, pid: Id | undefined) => (pid ? (data.results.find((r) => r.goalPlanId === planId && r.periodId === pid) ?? null) : null);

  const employees = new Map(data.employees.map((e) => [e.id, e]));
  const placementData = { Employee: data.employees, EmployeeAssignment: data.assignments };
  const staff: StaffEntry[] = [];
  for (const plan of data.plans) {
    if (plan.ownerType !== 'Employee' || plan.ownerEmployeeId === null) continue;
    const employee = employees.get(plan.ownerEmployeeId) ?? null;
    if (employee && !employedDuring(employee, period)) continue;
    staff.push({
      plan,
      employee,
      unitId: subjectAssignment(plan, period, placementData)?.orgUnitId ?? null,
      result: resultOf(plan.id, period.id),
      previous: resultOf(plan.id, previous?.id),
    });
  }

  const shown = data.units.filter((u) => unitShown(u, period, data.plans));
  const shownIds = new Set(shown.map((u) => u.id));
  const children = new Map<Id, Id[]>();
  for (const u of shown) if (u.parentId && shownIds.has(u.parentId)) children.set(u.parentId, [...(children.get(u.parentId) ?? []), u.id]);
  const byName = (a: Id, b: Id) => (shown.find((u) => u.id === a)?.name ?? '').localeCompare(shown.find((u) => u.id === b)?.name ?? '', 'vi');
  for (const list of children.values()) list.sort(byName);

  const subtree = (id: Id): Id[] => [id, ...(children.get(id) ?? []).flatMap(subtree)];
  const visible = shown.filter((u) => canSeeUnit(data, u));
  const visibleIds = new Set(visible.map((u) => u.id));
  const nodes = new Map<Id, UnitNode>();
  const depthOf = (u: OrgUnit): number => (u.parentId && shownIds.has(u.parentId) ? 1 + depthOf(shown.find((x) => x.id === u.parentId) as OrgUnit) : 0);

  for (const unit of visible) {
    const ownPlan =
      (unit.parentId === null
        ? data.plans.find((p) => p.ownerType === 'Company')
        : data.plans.find((p) => p.ownerType === 'OrgUnit' && p.ownerOrgUnitId === unit.id)) ?? null;
    const own = ownPlan ? resultOf(ownPlan.id, period.id) : null;
    const prev = ownPlan ? resultOf(ownPlan.id, previous?.id) : null;
    const inTree = new Set(subtree(unit.id));
    const people = staff.filter((s) => s.unitId !== null && inTree.has(s.unitId));
    const official = people.filter((s) => s.result !== null && isOfficial(s.result) && s.result.totalScore !== null);
    nodes.set(unit.id, {
      unit,
      depth: depthOf(unit),
      childIds: (children.get(unit.id) ?? []).filter((id) => visibleIds.has(id)),
      ownPlan,
      own,
      ownLevel: own?.ratingLevelId ? (levelById.get(own.ratingLevelId) ?? null) : null,
      delta: scoreDelta(own, prev),
      staffTotal: people.length,
      staffCounted: official.length,
      staffAverage: official.length > 0 ? official.reduce((s, x) => s + (x.result?.totalScore ?? 0), 0) / official.length : null,
      flagged: own ? isResultFlagged(own, flaggedLevels) : false,
    });
  }

  const rootIds = visible.filter((u) => !u.parentId || !visibleIds.has(u.parentId)).sort((a, b) => a.name.localeCompare(b.name, 'vi')).map((u) => u.id);
  const tenantWide = can(data.access, 'dashboard.view', { kind: 'Tenant', tenantId: data.tenantId });
  return { period, previous, nodes, rootIds, staff, unplaced: tenantWide ? staff.filter((s) => s.unitId === null) : [], flaggedLevels };
}

/** The people of ONE unit (not its children): the leaf table. Sorted by name. */
export function staffOfUnit(model: DashboardModel, unitId: Id): StaffEntry[] {
  if (!model.nodes.has(unitId)) return [];
  return model.staff
    .filter((s) => s.unitId === unitId)
    .sort((a, b) => (a.employee?.fullName ?? '').localeCompare(b.employee?.fullName ?? '', 'vi'));
}

/** The unit chain from a root down to `unitId`, for the breadcrumb (visible units only). */
export function unitPath(model: DashboardModel, unitId: Id): UnitNode[] {
  const path: UnitNode[] = [];
  let node = model.nodes.get(unitId);
  while (node) {
    path.unshift(node);
    node = node.unit.parentId ? model.nodes.get(node.unit.parentId) : undefined;
  }
  return path;
}

/**
 * Units to RANK (best / worst): only those with their own plan and a score — a Khối's staff average is
 * another basis and is never ranked against a plan score (Q40).
 */
export function rankableUnits(nodes: readonly UnitNode[]): UnitNode[] {
  return nodes.filter((n) => n.own !== null && n.own.totalScore !== null).sort((a, b) => (b.own?.totalScore ?? 0) - (a.own?.totalScore ?? 0));
}

// ─── Trend (Q42) ───────────────────────────────────────────────────────────────────────────────

export interface TrendPoint {
  periodId: Id;
  label: string;
  score: number | null;
  /** The point comes from a Draft — drawn hollow, labelled "tạm tính". */
  provisional: boolean;
}

/**
 * One plan's stored score over the cycle's periods of `periodType`, in order. `officialOnly` (the
 * employee's own view, BR-KPI-82) leaves a Draft month empty — it is never shown, not even greyed.
 */
export function trendSeries(
  results: readonly PeriodResult[],
  periods: readonly CyclePeriod[],
  planId: Id,
  options: { periodType?: CyclePeriod['periodType']; officialOnly?: boolean } = {},
): TrendPoint[] {
  const type = options.periodType ?? 'Month';
  return periods
    .filter((p) => p.periodType === type)
    .sort(byStart)
    .map((p) => {
      const r = results.find((x) => x.goalPlanId === planId && x.periodId === p.id) ?? null;
      const hide = r === null || (options.officialOnly === true && !isOfficial(r));
      return { periodId: p.id, label: p.label, score: hide ? null : r.totalScore, provisional: !hide && !isOfficial(r) };
    });
}

/**
 * "KPI của tôi" (WBS 4.7.2, BR-KPI-82): the person's latest OFFICIAL result of the cycle (monthly), and
 * the one of the month before it — only if that one is official too: an employee never sees a Draft
 * figure, not even as the other side of a difference. `null` when nothing is official yet.
 */
export function latestOfficialResult(
  results: readonly PeriodResult[],
  periods: readonly CyclePeriod[],
): { result: PeriodResult; period: CyclePeriod; previous: PeriodResult | null; previousPeriod: CyclePeriod | null; delta: ScoreDelta } | null {
  const months = periods.filter((p) => p.periodType === 'Month').sort(byStart);
  for (let i = months.length - 1; i >= 0; i -= 1) {
    const result = results.find((r) => r.periodId === months[i].id && isOfficial(r));
    if (!result) continue;
    const before = i > 0 ? months[i - 1] : null;
    const previous = before ? (results.find((r) => r.periodId === before.id && r.goalPlanId === result.goalPlanId && isOfficial(r)) ?? null) : null;
    return { result, period: months[i], previous, previousPeriod: before, delta: scoreDelta(result, previous) };
  }
  return null;
}

// ─── Operations report (WBS 4.7.3, BR-KPI-88) ──────────────────────────────────────────────────

/** Which forms / plans the viewer may count: their subject's unit (on `asOf`) must be on the dashboard. */
export function subjectUnitOn(
  employeeId: Id,
  asOf: Pick<CyclePeriod, 'endDate'>,
  data: Pick<DashboardData, 'employees' | 'assignments'>,
): Id | null {
  return subjectAssignment({ ownerType: 'Employee', ownerEmployeeId: employeeId }, asOf, { Employee: data.employees, EmployeeAssignment: data.assignments })?.orgUnitId ?? null;
}

/** The unit-visibility test for subjects: a tenant-wide viewer sees everyone, even an unplaced person. */
export function subjectInScope(data: Pick<DashboardData, 'tenantId' | 'access'>, unitId: Id | null): boolean {
  if (can(data.access, 'dashboard.view', { kind: 'Tenant', tenantId: data.tenantId })) return true;
  return unitId !== null && can(data.access, 'dashboard.view', { kind: 'OrgUnit', tenantId: data.tenantId, orgUnitId: unitId });
}

/**
 * The forms the viewer may count (BR-KPI-88): their subject sat, on `asOf` (the period's last day; a
 * registration: today), in a unit the dashboard grant covers — or the viewer is tenant-wide.
 */
export function formsInScope(
  forms: readonly FormInstance[],
  data: Pick<DashboardData, 'tenantId' | 'access' | 'employees' | 'assignments'>,
  asOf: Pick<CyclePeriod, 'endDate'>,
): FormInstance[] {
  return forms.filter((f) => subjectInScope(data, subjectUnitOn(f.subjectEmployeeId, asOf, data)));
}

/** The period's results the viewer may count: the visible units' own results and the visible people's. */
export function resultsInScope(model: DashboardModel): PeriodResult[] {
  const out: PeriodResult[] = [];
  for (const node of model.nodes.values()) if (node.own) out.push(node.own);
  for (const s of [...model.staff.filter((x) => x.unitId !== null && model.nodes.has(x.unitId)), ...model.unplaced]) if (s.result) out.push(s.result);
  return out;
}

/** Employee plans the viewer may count for registration progress (placed on `asOf`). */
export function plansInScope(
  plans: readonly GoalPlan[],
  data: Pick<DashboardData, 'tenantId' | 'access' | 'employees' | 'assignments'>,
  asOf: Pick<CyclePeriod, 'endDate'>,
): GoalPlan[] {
  return plans.filter((p) => p.ownerType === 'Employee' && p.ownerEmployeeId !== null && subjectInScope(data, subjectUnitOn(p.ownerEmployeeId, asOf, data)));
}

export interface FormProgress {
  byStatus: Record<FormStatus, number>;
  total: number;
  /** Not Cancelled — the denominator of the completion rate. */
  active: number;
  completed: number;
  /** Completed / active, in %; `null` when there is nothing to complete. */
  completionPct: number | null;
  /** "Quá hạn" — `formViewRules.stepTiming`, the same test as T5's lists. */
  overdue: number;
  /** Open forms by their current step, in step order. */
  byStep: { stepId: Id; name: string; count: number }[];
}

export function formProgress(forms: readonly FormInstance[], steps: readonly WorkflowStep[], clock: Clock): FormProgress {
  const byStatus = Object.fromEntries(FORM_STATUSES.map((s) => [s, 0])) as Record<FormStatus, number>;
  const stepCounts = new Map<Id, { step: WorkflowStep; count: number }>();
  let overdue = 0;
  for (const form of forms) {
    byStatus[form.status] += 1;
    const timing = stepTiming(form, steps, clock);
    if (timing.overdue) overdue += 1;
    if (timing.step) {
      const entry = stepCounts.get(timing.step.id) ?? { step: timing.step, count: 0 };
      entry.count += 1;
      stepCounts.set(timing.step.id, entry);
    }
  }
  const active = forms.length - byStatus.Cancelled;
  return {
    byStatus,
    total: forms.length,
    active,
    completed: byStatus.Completed,
    completionPct: active > 0 ? (byStatus.Completed / active) * 100 : null,
    overdue,
    byStep: [...stepCounts.values()]
      .sort((a, b) => a.step.stepNo - b.step.stepNo || a.step.name.localeCompare(b.step.name, 'vi'))
      .map(({ step, count }) => ({ stepId: step.id, name: step.name, count })),
  };
}

export interface OverdueRow {
  form: FormInstance;
  step: WorkflowStep;
  deadline: IsoDate;
  /** Whole days past the deadline (the deadline day itself is on time). */
  daysOver: number;
}

/** The overdue forms, most overdue first. */
export function overdueRows(forms: readonly FormInstance[], steps: readonly WorkflowStep[], clock: Clock): OverdueRow[] {
  const today = todayOf(clock);
  const rows: OverdueRow[] = [];
  for (const form of forms) {
    const timing = stepTiming(form, steps, clock);
    if (timing.overdue && timing.step && timing.deadline) rows.push({ form, step: timing.step, deadline: timing.deadline, daysOver: daysBetween(timing.deadline, today) });
  }
  return rows.sort((a, b) => b.daysOver - a.daysOver || a.form.id.localeCompare(b.form.id));
}

/** Employee Goal Plans of the cycle by status — the registration progress. */
export function planProgress(plans: readonly Pick<GoalPlan, 'ownerType' | 'status'>[]): { byStatus: Record<GoalPlanStatus, number>; total: number } {
  const byStatus = Object.fromEntries(GOAL_PLAN_STATUSES.map((s) => [s, 0])) as Record<GoalPlanStatus, number>;
  let total = 0;
  for (const p of plans) {
    if (p.ownerType !== 'Employee') continue;
    byStatus[p.status] += 1;
    total += 1;
  }
  return { byStatus, total };
}

/**
 * The rating distribution of OFFICIAL Employee results (BR-KPI-84), highest level first, plus the
 * official ones without a level. A Draft never enters it.
 */
export function ratingDistribution(
  results: readonly Pick<PeriodResult, 'ownerType' | 'status' | 'ratingLevelId'>[],
  levels: readonly RatingLevel[],
): { levels: { level: RatingLevel; count: number }[]; unrated: number; total: number } {
  const official = results.filter((r) => r.ownerType === 'Employee' && isOfficial(r));
  const counts = new Map<Id, number>();
  let unrated = 0;
  for (const r of official) {
    if (r.ratingLevelId && levels.some((l) => l.id === r.ratingLevelId)) counts.set(r.ratingLevelId, (counts.get(r.ratingLevelId) ?? 0) + 1);
    else unrated += 1;
  }
  return {
    levels: [...levels].sort((a, b) => b.minScore - a.minScore).map((level) => ({ level, count: counts.get(level.id) ?? 0 })),
    unrated,
    total: official.length,
  };
}

export interface OperationsReport {
  /** Employee Goal Plans of the cycle (registration). */
  plans: ReturnType<typeof planProgress>;
  registration: FormProgress;
  evaluation: FormProgress;
  /** Overdue evaluation and registration forms, most overdue first. */
  overdue: OverdueRow[];
  results: { all: PeriodResult[]; ratings: ReturnType<typeof ratingDistribution> };
}

/**
 * The "Vận hành" report (WBS 4.7.3, BR-KPI-88) in the viewer's scope: registration progress of the
 * cycle (subjects placed on `today`), the period's evaluation forms (placed on the period's last day),
 * the overdue list, and the period's results.
 */
export function operationsReport(input: {
  data: DashboardData;
  model: DashboardModel;
  evaluationForms: readonly FormInstance[];
  registrationForms: readonly FormInstance[];
  steps: readonly WorkflowStep[];
  clock: Clock;
}): OperationsReport {
  const { data, model, steps, clock } = input;
  const now = { endDate: todayOf(clock) };
  const cyclePlanIds = new Set(data.plans.map((p) => p.id));
  const evaluations = formsInScope(input.evaluationForms.filter((f) => f.periodId === model.period.id), data, model.period);
  const registrations = formsInScope(input.registrationForms.filter((f) => f.goalPlanId !== null && cyclePlanIds.has(f.goalPlanId)), data, now);
  const results = resultsInScope(model);
  return {
    plans: planProgress(plansInScope(data.plans, data, now)),
    registration: formProgress(registrations, steps, clock),
    evaluation: formProgress(evaluations, steps, clock),
    overdue: overdueRows([...evaluations, ...registrations], steps, clock),
    results: { all: results, ratings: ratingDistribution(results, data.levels) },
  };
}

// ─── The snapshot the assistant reads (WBS 4.7.4, BR-KPI-89) ───────────────────────────────────

/** One unit as the assistant sees it — numbers already on screen, nothing more. Plain JSON. */
export interface SnapshotUnit {
  id: Id;
  name: string;
  hasOwnPlan: boolean;
  score: number | null;
  /** The stored result's status, `null` without a result. */
  status: PeriodResult['status'] | null;
  ratingCode: string | null;
  deltaPoints: number | null;
  deltaProvisional: boolean;
  staffAverage: number | null;
  staffCounted: number;
  staffTotal: number;
  flagged: boolean;
}

/**
 * Everything the simulated assistant may talk about — built from what the viewer's screen shows, in
 * the viewer's scope, so an answer can never cite what they cannot see. Plain JSON (a real model
 * would get it serialised as its only context).
 */
export interface DashboardSnapshot {
  tenantId: Id;
  periodId: Id;
  periodLabel: string;
  previousPeriodLabel: string | null;
  /** The unit being looked at. */
  focus: SnapshotUnit;
  /** Its visible child units. */
  children: SnapshotUnit[];
  /**
   * The focus unit's goals needing attention (hidden goals unnamed). `null` = not known: the unit has no
   * own result, or its goal lines have not loaded — never an empty list, which would read as "all clear".
   */
  attention: { name: string | null; achievementPct: number | null; kind: AttentionKind }[] | null;
  /** Overdue forms in the viewer's scope for the period (the operations figure); `null` when not loaded. */
  overdueForms: number | null;
}

export function snapshotUnit(node: UnitNode): SnapshotUnit {
  return {
    id: node.unit.id,
    name: node.unit.name,
    hasOwnPlan: node.ownPlan !== null,
    score: node.own?.totalScore ?? null,
    status: node.own?.status ?? null,
    ratingCode: node.ownLevel?.code ?? null,
    deltaPoints: node.delta.points,
    deltaProvisional: node.delta.provisional,
    staffAverage: node.staffAverage,
    staffCounted: node.staffCounted,
    staffTotal: node.staffTotal,
    flagged: node.flagged,
  };
}

export function dashboardSnapshot(
  tenantId: Id,
  model: DashboardModel,
  focusId: Id,
  attention: readonly AttentionItem[] | null,
  overdueForms: number | null,
): DashboardSnapshot | null {
  const focus = model.nodes.get(focusId);
  if (!focus) return null;
  return {
    tenantId,
    periodId: model.period.id,
    periodLabel: model.period.label,
    previousPeriodLabel: model.previous?.label ?? null,
    focus: snapshotUnit(focus),
    children: focus.childIds.map((id) => model.nodes.get(id)).filter((n): n is UnitNode => n !== undefined).map(snapshotUnit),
    attention: attention === null ? null : attention.map((a) => ({ name: a.name, achievementPct: a.achievementPct, kind: a.kind })),
    overdueForms,
  };
}

/** The snapshot units the assistant may rank: own plan + a score, best first (Q40 — never a staff average). */
export function rankSnapshotUnits(units: readonly SnapshotUnit[]): SnapshotUnit[] {
  return units.filter((u) => u.hasOwnPlan && u.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name, 'vi'));
}

/** A short, stable digest of a snapshot — the assistant's cache key, so its text never outlives the numbers. */
export function snapshotDigest(snapshot: DashboardSnapshot): string {
  const text = JSON.stringify(snapshot);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}
