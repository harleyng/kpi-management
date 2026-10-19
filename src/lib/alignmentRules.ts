/**
 * Cascade and link between goals — BR-KPI-07, D3.
 *
 * A goal can never be its own ancestor, and what a manager hands down (plus what they keep, "tự giao")
 * can never exceed their own target. "Chưa giao" is always derived here, never stored.
 */

import type { CalcMethod, CalcMethodType, Employee, Goal, GoalAlignment, Id, IsoDate, PerformanceCycle } from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';

type Edge = Pick<GoalAlignment, 'id' | 'childGoalId' | 'parentGoalId'>;

/**
 * Whether adding (or re-saving) `proposed` would make a goal its own ancestor: a self-link, or the
 * child already sits above the parent. A goal may have several parents (links), so the whole upward
 * graph is walked. An alignment with the same id as `proposed` is the one being edited and is
 * ignored. Alignments touching cancelled goals still count — refusing is the safe answer.
 */
export function wouldCreateCycle(alignments: readonly Edge[], proposed: Pick<Edge, 'childGoalId' | 'parentGoalId'> & { id?: Id }): boolean {
  if (proposed.childGoalId === proposed.parentGoalId) return true;
  const parentsOf = new Map<Id, Id[]>();
  for (const a of alignments) {
    if (proposed.id !== undefined && a.id === proposed.id) continue;
    parentsOf.set(a.childGoalId, [...(parentsOf.get(a.childGoalId) ?? []), a.parentGoalId]);
  }
  const seen = new Set<Id>();
  const stack = [proposed.parentGoalId];
  while (stack.length) {
    const goalId = stack.pop() as Id;
    if (goalId === proposed.childGoalId) return true;
    if (seen.has(goalId)) continue;
    seen.add(goalId);
    stack.push(...(parentsOf.get(goalId) ?? []));
  }
  return false;
}

/** One CASCADE child of a goal, with what the bucket arithmetic needs to know about it. */
export interface CascadeChild {
  alignment: Pick<GoalAlignment, 'id' | 'alignmentType' | 'allocatedValue'>;
  childGoal: Pick<Goal, 'status'>;
  /** The child goal's owner; `null` for a unit-level child. */
  childOwner: Pick<Employee, 'leftOn' | 'employmentStatus'> | null;
}

export interface AllocationBuckets {
  /** The parent's numeric target; `null` for a TEXT goal (nothing to split). */
  target: number | null;
  /** "Phân bổ nhân viên" — Σ allocated to children whose owner is still employed. */
  assigned: number;
  /** "Tự giao" — the parent's `selfAssignedValue`. */
  selfAssigned: number;
  /** "Chưa giao" = target − assigned − self-assigned; `null` for a TEXT goal. */
  unassigned: number | null;
  /** Allocations held by people who have left — counted as NOT assigned, so they can be re-cascaded. */
  heldByLeavers: number;
  overAllocated: boolean;
}

/** Left by `asOf`: their last working day is before it (or "Resigned" with no last day). */
const hasLeftBy = (owner: CascadeChild['childOwner'], asOf: IsoDate) =>
  owner !== null && ((owner.employmentStatus === 'Resigned' && owner.leftOn === null) || (owner.leftOn !== null && owner.leftOn < asOf));

/**
 * The four buckets a manager sees on a cascaded goal (HR guide p. 24). Only Active CASCADE children
 * count. "Tự thực hiện" is not tracked in P1 (`ASSUMPTION Q11`).
 */
export function allocationBuckets(parent: Pick<Goal, 'targetType' | 'targetValue' | 'selfAssignedValue'>, children: readonly CascadeChild[], asOf: IsoDate): AllocationBuckets {
  let assigned = 0;
  let heldByLeavers = 0;
  for (const child of children) {
    if (child.alignment.alignmentType !== 'CASCADE' || child.childGoal.status !== 'Active') continue;
    const value = child.alignment.allocatedValue ?? 0;
    if (hasLeftBy(child.childOwner, asOf)) heldByLeavers += value;
    else assigned += value;
  }
  const selfAssigned = parent.selfAssignedValue ?? 0;
  const target = parent.targetType === 'NUMERIC' ? parent.targetValue : null;
  const unassigned = target === null ? null : target - assigned - selfAssigned;
  const epsilon = 1e-9 * Math.max(1, Math.abs(target ?? 0));
  return { target, assigned, selfAssigned, unassigned, heldByLeavers, overAllocated: unassigned !== null && unassigned < -epsilon };
}

/** ERR-KPI-11 when the buckets overflow the target, with the numbers for the screen. */
export function allocationIssue(parent: Pick<Goal, 'id' | 'targetType' | 'targetValue' | 'selfAssignedValue'>, children: readonly CascadeChild[], asOf: IsoDate): RuleIssue | null {
  const b = allocationBuckets(parent, children, asOf);
  if (!b.overAllocated) return null;
  return ruleIssue('ERR-KPI-11', parent.id, null, { target: b.target as number, assigned: b.assigned, selfAssigned: b.selfAssigned });
}

/**
 * Everything `saveAlignment` must refuse: a cycle (ERR-KPI-10), an over-allocation (ERR-KPI-11), and
 * malformed input (ERR-KPI-06). `existingChildren` are the parent's OTHER cascade children.
 */
export function checkAlignment(
  proposed: Pick<GoalAlignment, 'childGoalId' | 'parentGoalId' | 'alignmentType' | 'allocatedValue' | 'contributionPct'> & { id?: Id },
  ctx: {
    alignments: readonly Edge[];
    parentGoal: Pick<Goal, 'id' | 'targetType' | 'targetValue' | 'selfAssignedValue'>;
    existingChildren: readonly CascadeChild[];
    asOf: IsoDate;
  },
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const ref = proposed.childGoalId;
  if (wouldCreateCycle(ctx.alignments, proposed)) issues.push(ruleIssue('ERR-KPI-10', ref));

  if (proposed.alignmentType === 'CASCADE') {
    const value = proposed.allocatedValue;
    if (ctx.parentGoal.targetType !== 'NUMERIC') issues.push(ruleIssue('ERR-KPI-06', ref, 'PARENT_NOT_NUMERIC'));
    else if (value === null || !Number.isFinite(value) || value <= 0) issues.push(ruleIssue('ERR-KPI-06', ref, 'ALLOCATION_REQUIRED'));
    else {
      const others = ctx.existingChildren.filter((c) => proposed.id === undefined || c.alignment.id !== proposed.id);
      const withProposed: CascadeChild[] = [
        ...others,
        { alignment: { id: proposed.id ?? 'proposed', alignmentType: 'CASCADE', allocatedValue: value }, childGoal: { status: 'Active' }, childOwner: null },
      ];
      const over = allocationIssue(ctx.parentGoal, withProposed, ctx.asOf);
      if (over) issues.push(over);
    }
  } else {
    const pct = proposed.contributionPct;
    if (pct === null || !Number.isFinite(pct) || pct <= 0 || pct > 100) issues.push(ruleIssue('ERR-KPI-06', ref, 'CONTRIBUTION_INVALID'));
  }
  return issues;
}

// ─── Re-saving a parent goal (T3) ──────────────────────────────────────────────────────────────

const blankOrInvalid = (v: number | null) => v !== null && (!Number.isFinite(v) || v < 0);

/**
 * What `saveGoal` must refuse on a goal that others were cascaded from (BR-KPI-07): lowering its target
 * or raising "tự giao" (`selfAssignedValue`) after cascading must not over-allocate it silently. In
 * order: "tự giao" null or a finite number ≥ 0 (ERR-KPI-06 `SELF_ASSIGNED_INVALID`); with Active
 * CASCADE children it stays NUMERIC (06 `PARENT_NOT_NUMERIC`); then the buckets fit the target
 * (ERR-KPI-11, leavers' allocations not counted — `allocationBuckets`).
 *
 * Checked ONLY when the save changes the target, its type or "tự giao" (or creates the goal): a
 * rename or a weight change on a goal that is already over-allocated (an import, an old row) is
 * never blocked by it.
 */
export function goalAllocationIssues(
  stored: Pick<Goal, 'targetType' | 'targetValue' | 'selfAssignedValue'> | null,
  next: Pick<Goal, 'id' | 'targetType' | 'targetValue' | 'selfAssignedValue'>,
  children: readonly CascadeChild[],
  asOf: IsoDate,
): RuleIssue[] {
  const changed =
    stored === null || stored.targetType !== next.targetType || stored.targetValue !== next.targetValue || stored.selfAssignedValue !== next.selfAssignedValue;
  if (!changed) return [];
  if (blankOrInvalid(next.selfAssignedValue)) return [ruleIssue('ERR-KPI-06', next.id, 'SELF_ASSIGNED_INVALID')];
  const active = children.filter((c) => c.alignment.alignmentType === 'CASCADE' && c.childGoal.status === 'Active');
  if (active.length > 0 && next.targetType !== 'NUMERIC') return [ruleIssue('ERR-KPI-06', next.id, 'PARENT_NOT_NUMERIC')];
  if (next.targetType !== 'NUMERIC') return [];
  const over = allocationIssue(next, active, asOf);
  return over ? [over] : [];
}

// ─── The cascaded child goal (WBS 4.3.4) ───────────────────────────────────────────────────────

/**
 * Methods whose score of a SHARE means the same as of the whole (actual ÷ allocation): copied to the
 * child. LEVELS and TIERED thresholds and a FORMULA are written for the parent's full target, so a
 * share needs its own method — the manager picks one.
 */
export const SHARE_SAFE_METHODS: readonly CalcMethodType[] = ['RATIO_UP', 'RATIO_DOWN', 'BINARY'];

/** The child goal a cascade creates — `saveGoal`'s payload (the gateway sets status and `replacesGoalId`). */
export type CascadedGoalDraft = Omit<Goal, 'id' | 'tenantId' | 'status' | 'replacesGoalId'>;

export interface CascadeInput {
  goalPlanId: Id;
  ownerEmployeeId: Id | null;
  allocatedValue: number;
  /** Required: copying the parent's weight could break the child plan's 100% (offer `remainingWeight`). */
  weight: number;
  sortOrder: number;
  /** The child's method when the parent's is not share-safe (ignored otherwise). */
  calcMethodId: Id | null;
  cycle: Pick<PerformanceCycle, 'startDate' | 'endDate'>;
  /** The child's owner, to clip the dates to their employment. */
  owner: Pick<Employee, 'hireDate' | 'leftOn'> | null;
}

/**
 * Builds the child goal of a cascade from the parent (BR-KPI-07, D3): the same KPI (library item,
 * name, description, formula, perspective, unit, data source, visibility), a NUMERIC target equal to
 * the allocation, the parent's dates clipped to the cycle and to the owner's employment. NOT copied:
 * the weight (given), target levels and period split (written for the whole target), "tự giao", the
 * KGI (the child plan's own) and the roll-up flag. The method is copied only when share-safe; otherwise
 * `input.calcMethodId` is required (ERR-KPI-06 `CALC_METHOD_REQUIRED`).
 */
export function cascadedGoalDraft(
  parent: Goal,
  parentMethod: Pick<CalcMethod, 'id' | 'methodType'> | null,
  input: CascadeInput,
): { ok: true; goal: CascadedGoalDraft } | { ok: false; issues: RuleIssue[] } {
  const issues: RuleIssue[] = [];
  const shareSafe = parentMethod !== null && parentMethod.id === parent.calcMethodId && SHARE_SAFE_METHODS.includes(parentMethod.methodType);
  const calcMethodId = shareSafe ? parent.calcMethodId : input.calcMethodId;
  if (calcMethodId === null) issues.push(ruleIssue('ERR-KPI-06', 'calcMethodId', 'CALC_METHOD_REQUIRED'));
  if (parent.targetType !== 'NUMERIC') issues.push(ruleIssue('ERR-KPI-06', parent.id, 'PARENT_NOT_NUMERIC'));
  if (!Number.isFinite(input.allocatedValue) || input.allocatedValue <= 0) issues.push(ruleIssue('ERR-KPI-06', 'allocatedValue', 'ALLOCATION_REQUIRED'));
  if (!Number.isFinite(input.weight) || input.weight <= 0) issues.push(ruleIssue('ERR-KPI-06', 'weight', 'WEIGHT_INVALID'));

  const latest = (...dates: (IsoDate | null)[]) => dates.filter((d): d is IsoDate => d !== null).reduce((a, b) => (b > a ? b : a));
  const earliest = (...dates: (IsoDate | null)[]) => dates.filter((d): d is IsoDate => d !== null).reduce((a, b) => (b < a ? b : a));
  const startDate = latest(parent.startDate, input.cycle.startDate, input.owner?.hireDate ?? null);
  const dueDate = earliest(parent.dueDate, input.cycle.endDate, input.owner?.leftOn ?? null);
  if (dueDate < startDate) issues.push(ruleIssue('ERR-KPI-06', 'dueDate', 'DATES_INVALID'));
  if (issues.length) return { ok: false, issues };

  return {
    ok: true,
    goal: {
      goalPlanId: input.goalPlanId,
      kgiId: null,
      kpiDefId: parent.kpiDefId,
      name: parent.name,
      description: parent.description,
      formulaText: parent.formulaText,
      perspectiveId: parent.perspectiveId,
      kriType: parent.kriType,
      visibility: parent.visibility,
      unitId: parent.unitId,
      calcMethodId: calcMethodId as Id,
      dataSourceId: parent.dataSourceId,
      weight: input.weight,
      targetType: 'NUMERIC',
      targetValue: input.allocatedValue,
      targetText: null,
      selfAssignedValue: null,
      rollUpFromChildren: false,
      startDate,
      dueDate,
      ownerEmployeeId: input.ownerEmployeeId,
      sortOrder: input.sortOrder,
    },
  };
}
