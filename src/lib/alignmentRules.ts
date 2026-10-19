/**
 * Cascade and link between goals — BR-KPI-07, D3.
 *
 * A goal can never be its own ancestor, and what a manager hands down (plus what they keep, "tự giao")
 * can never exceed their own target. "Chưa giao" is always derived here, never stored.
 */

import type { Employee, Goal, GoalAlignment, Id, IsoDate } from '@/data/types';
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
