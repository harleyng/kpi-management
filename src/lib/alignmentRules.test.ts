import { describe, expect, it } from 'vitest';
import { alignment, goal } from '@/test/builders';
import { allocationBuckets, allocationIssue, checkAlignment, wouldCreateCycle, type CascadeChild } from './alignmentRules';

const edge = (childGoalId: string, parentGoalId: string) => alignment({ id: `${childGoalId}>${parentGoalId}`, childGoalId, parentGoalId });

describe('wouldCreateCycle — a goal can never be its own ancestor', () => {
  const chain = [edge('B', 'A'), edge('C', 'B')]; // C → B → A

  it.each([
    ['A', 'B', true], // A → B → A
    ['A', 'C', true], // A → C → B → A
    ['A', 'A', true], // self-link
    ['D', 'C', false],
    ['C', 'A', false], // a second path up is fine
  ])('linking %s under %s → %s', (child, parent, expected) => {
    expect(wouldCreateCycle(chain, { childGoalId: child, parentGoalId: parent })).toBe(expected);
  });

  it('allows a diamond (two parents sharing an ancestor)', () => {
    const diamond = [edge('B', 'A'), edge('C', 'A'), edge('D', 'B')];
    expect(wouldCreateCycle(diamond, { childGoalId: 'D', parentGoalId: 'C' })).toBe(false);
  });

  it('re-saving an existing alignment does not collide with itself', () => {
    expect(wouldCreateCycle(chain, { id: 'C>B', childGoalId: 'C', parentGoalId: 'B' })).toBe(false);
  });

  it('agrees with a brute-force reachability check on random graphs', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let round = 0; round < 200; round++) {
      const edges = nodes.flatMap((child) => nodes.filter((p) => p !== child && rand() < 0.15).map((p) => edge(child, p)));
      const child = nodes[Math.floor(rand() * nodes.length)];
      const parent = nodes[Math.floor(rand() * nodes.length)];
      const reach = new Set([parent]);
      for (let i = 0; i < nodes.length; i++) for (const e of edges) if (reach.has(e.childGoalId)) reach.add(e.parentGoalId);
      expect(wouldCreateCycle(edges, { childGoalId: child, parentGoalId: parent })).toBe(reach.has(child));
    }
  });
});

describe('allocationBuckets — "chưa giao" is derived (D3)', () => {
  const parent = goal({ id: 'P', targetValue: 100, selfAssignedValue: 20 });
  const child = (allocatedValue: number, o: Partial<CascadeChild> = {}): CascadeChild => ({
    alignment: { id: `a${allocatedValue}`, alignmentType: 'CASCADE', allocatedValue },
    childGoal: { status: 'Active' },
    childOwner: { leftOn: null, employmentStatus: 'Official' },
    ...o,
  });

  it('splits the target into assigned, self-assigned and not yet assigned', () => {
    expect(allocationBuckets(parent, [child(30), child(25)], '2027-01-15')).toEqual({
      target: 100, assigned: 55, selfAssigned: 20, unassigned: 25, heldByLeavers: 0, overAllocated: false,
    });
  });

  it('assigning exactly the target is not over-allocation, including float sums (0.1 + 0.2 of 0.3)', () => {
    expect(allocationBuckets(parent, [child(40), child(40)], '2027-01-15')).toMatchObject({ unassigned: 0, overAllocated: false });
    const small = goal({ targetValue: 0.3, selfAssignedValue: null });
    expect(allocationBuckets(small, [child(0.1), child(0.2)], '2027-01-15').overAllocated).toBe(false);
  });

  it('flags giving away more than the target (ERR-KPI-11)', () => {
    expect(allocationBuckets(parent, [child(50), child(31)], '2027-01-15').overAllocated).toBe(true);
    expect(allocationIssue(parent, [child(50), child(31)], '2027-01-15')).toMatchObject({
      code: 'ERR-KPI-11', ref: 'P', data: { target: 100, assigned: 81, selfAssigned: 20 },
    });
  });

  it('ignores cancelled children and LINK alignments', () => {
    const cancelled = child(50, { childGoal: { status: 'Cancelled' } });
    const link = child(50, { alignment: { id: 'l', alignmentType: 'LINK', allocatedValue: 50 } });
    expect(allocationBuckets(parent, [cancelled, link], '2027-01-15').assigned).toBe(0);
  });

  it('returns a leaver\'s allocation to "chưa giao" from the day after their last working day', () => {
    const leaver = child(30, { childOwner: { leftOn: '2027-01-15', employmentStatus: 'Resigned' } });
    expect(allocationBuckets(parent, [leaver], '2027-01-15')).toMatchObject({ assigned: 30, heldByLeavers: 0 });
    expect(allocationBuckets(parent, [leaver], '2027-01-16')).toMatchObject({ assigned: 0, heldByLeavers: 30, unassigned: 80 });
    // …so the manager can re-cascade it without tripping the over-allocation check
    expect(allocationBuckets(parent, [leaver, child(80)], '2027-01-16').overAllocated).toBe(false);
  });

  it('has nothing to split on a TEXT goal', () => {
    const textual = goal({ targetType: 'TEXT', targetValue: null, targetText: 'Đạt' });
    expect(allocationBuckets(textual, [], '2027-01-15')).toMatchObject({ target: null, unassigned: null, overAllocated: false });
  });
});

describe('checkAlignment — what saveAlignment refuses', () => {
  const parentGoal = goal({ id: 'P', targetValue: 100, selfAssignedValue: null });
  const ctx = { alignments: [edge('P', 'TOP')], parentGoal, existingChildren: [] as CascadeChild[], asOf: '2027-01-15' };
  const cascade = (allocatedValue: number | null, childGoalId = 'C') =>
    ({ childGoalId, parentGoalId: 'P', alignmentType: 'CASCADE' as const, allocatedValue, contributionPct: null });

  it('accepts a sound cascade', () => {
    expect(checkAlignment(cascade(60), ctx)).toEqual([]);
  });

  it.each([
    [cascade(60, 'TOP'), 'ERR-KPI-10', null],
    [cascade(160), 'ERR-KPI-11', null],
    [cascade(null), 'ERR-KPI-06', 'ALLOCATION_REQUIRED'],
    [cascade(0), 'ERR-KPI-06', 'ALLOCATION_REQUIRED'],
    [{ ...cascade(null), alignmentType: 'LINK' as const, contributionPct: 0 }, 'ERR-KPI-06', 'CONTRIBUTION_INVALID'],
    [{ ...cascade(null), alignmentType: 'LINK' as const, contributionPct: 101 }, 'ERR-KPI-06', 'CONTRIBUTION_INVALID'],
  ])('%# → %s %s', (proposed, code, detail) => {
    expect(checkAlignment(proposed, ctx)).toEqual([expect.objectContaining({ code, detail })]);
  });

  it('accepts a link with a contribution', () => {
    expect(checkAlignment({ ...cascade(null), alignmentType: 'LINK', contributionPct: 50 }, ctx)).toEqual([]);
  });

  it('counts the other children but not the alignment being edited', () => {
    const existing: CascadeChild[] = [
      { alignment: { id: 'x', alignmentType: 'CASCADE', allocatedValue: 70 }, childGoal: { status: 'Active' }, childOwner: null },
    ];
    expect(checkAlignment(cascade(40), { ...ctx, existingChildren: existing })[0]?.code).toBe('ERR-KPI-11');
    expect(checkAlignment({ ...cascade(40), id: 'x' }, { ...ctx, existingChildren: existing })).toEqual([]);
  });

  it('cannot cascade from a TEXT goal', () => {
    const textual = { ...ctx, parentGoal: goal({ id: 'P', targetType: 'TEXT', targetValue: null, targetText: 'Đạt' }) };
    expect(checkAlignment(cascade(10), textual)[0]?.detail).toBe('PARENT_NOT_NUMERIC');
  });
});
