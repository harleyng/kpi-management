import { describe, expect, it } from 'vitest';
import type { Goal } from '@/data/types';
import { alignment, calcMethod, goal } from '@/test/builders';
import {
  allocationBuckets,
  allocationIssue,
  cascadedGoalDraft,
  checkAlignment,
  goalAllocationIssues,
  wouldCreateCycle,
  type CascadeChild,
  type CascadeInput,
} from './alignmentRules';

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

describe('goalAllocationIssues — re-saving a parent goal (saveGoal guard, T3)', () => {
  const parent = goal({ id: 'p', targetValue: 100, selfAssignedValue: 10 });
  const child = (value: number, o: Partial<CascadeChild> = {}): CascadeChild => ({
    alignment: { id: `al${value}`, alignmentType: 'CASCADE', allocatedValue: value },
    childGoal: { status: 'Active' },
    childOwner: null,
    ...o,
  });
  const kids = [child(40), child(40)];
  const asOf = '2027-04-06';
  const save = (patch: Partial<typeof parent>, children = kids, stored: typeof parent | null = parent) =>
    goalAllocationIssues(stored, { ...parent, ...patch }, children, asOf);

  it('lowering the target below what is handed down → ERR-KPI-11 with the numbers', () => {
    expect(save({ targetValue: 85 })).toEqual([
      { code: 'ERR-KPI-11', ref: 'p', detail: null, data: { target: 85, assigned: 80, selfAssigned: 10 } },
    ]);
    expect(save({ targetValue: 90 })).toEqual([]);
  });

  it('raising "tự giao" past the target → ERR-KPI-11', () => {
    expect(save({ selfAssignedValue: 21 }).map((i) => i.code)).toEqual(['ERR-KPI-11']);
    expect(save({ selfAssignedValue: 20 })).toEqual([]);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('"tự giao" %s → SELF_ASSIGNED_INVALID first', (v) => {
    expect(save({ selfAssignedValue: v, targetValue: 1 })).toEqual([{ code: 'ERR-KPI-06', ref: 'p', detail: 'SELF_ASSIGNED_INVALID', data: null }]);
  });

  it('turning a cascaded goal into a TEXT goal → PARENT_NOT_NUMERIC; without children it is fine', () => {
    expect(save({ targetType: 'TEXT', targetValue: null, targetText: 'Đạt', selfAssignedValue: null }).map((i) => i.detail)).toEqual(['PARENT_NOT_NUMERIC']);
    expect(save({ targetType: 'TEXT', targetValue: null, targetText: 'Đạt', selfAssignedValue: null }, [])).toEqual([]);
  });

  it('a rename or weight change on an already over-allocated goal is NOT blocked', () => {
    const over = { ...parent, targetValue: 50 };
    const renamed: Goal = { ...over, name: 'Mới', weight: 5 };
    expect(goalAllocationIssues(over, renamed, kids, asOf)).toEqual([]);
  });

  it('a leaver\'s allocation does not count; a cancelled child or a LINK does not either', () => {
    const left = child(40, { childOwner: { leftOn: '2027-03-31', employmentStatus: 'Resigned' } });
    const cancelled = child(40, { childGoal: { status: 'Cancelled' } });
    const link = child(40, { alignment: { id: 'l', alignmentType: 'LINK', allocatedValue: null } });
    expect(save({ targetValue: 50 }, [child(40), left, cancelled, link])).toEqual([]);
  });

  it('a target lowered to 0 with a child still holding a share → 11', () => {
    expect(save({ targetValue: 0, selfAssignedValue: null }, [child(10)]).map((i) => i.code)).toEqual(['ERR-KPI-11']);
  });

  it('a new goal is checked too: "tự giao" above its own target → 11', () => {
    expect(save({ selfAssignedValue: 120 }, [], null).map((i) => i.code)).toEqual(['ERR-KPI-11']);
    expect(save({}, [], null)).toEqual([]);
  });
});

describe('cascadedGoalDraft — the child goal a cascade creates', () => {
  const parent = goal({
    id: 'p', kpiDefId: 'k1', name: 'Doanh thu', description: 'mô tả', formulaText: 'Σ', visibility: 'PRIVATE',
    targetValue: 100, selfAssignedValue: 10, rollUpFromChildren: true, kgiId: 'kgi-parent', weight: 40,
    startDate: '2026-12-01', dueDate: '2028-01-31', calcMethodId: 'cm1',
  });
  const input = (o: Partial<CascadeInput> = {}): CascadeInput => ({
    goalPlanId: 'child-plan', ownerEmployeeId: 'e2', allocatedValue: 30, weight: 25, sortOrder: 4, calcMethodId: null,
    cycle: { startDate: '2027-01-01', endDate: '2027-12-31' }, owner: { hireDate: '2020-01-01', leftOn: null }, ...o,
  });

  it('a RATIO_UP parent → its method is copied; target = the allocation; not copied: weight, KGI, tự giao, roll-up', () => {
    const r = cascadedGoalDraft(parent, calcMethod({ id: 'cm1', methodType: 'RATIO_UP' }), input());
    expect(r).toEqual({
      ok: true,
      goal: expect.objectContaining({
        goalPlanId: 'child-plan', kpiDefId: 'k1', name: 'Doanh thu', description: 'mô tả', formulaText: 'Σ', visibility: 'PRIVATE',
        calcMethodId: 'cm1', targetType: 'NUMERIC', targetValue: 30, targetText: null, weight: 25, kgiId: null,
        selfAssignedValue: null, rollUpFromChildren: false, ownerEmployeeId: 'e2', sortOrder: 4,
      }),
    });
  });

  it.each(['RATIO_DOWN', 'BINARY'] as const)('%s is share-safe too', (methodType) => {
    const r = cascadedGoalDraft(parent, calcMethod({ id: 'cm1', methodType }), input());
    expect(r.ok && r.goal.calcMethodId).toBe('cm1');
  });

  it.each(['LEVELS', 'TIERED', 'FORMULA'] as const)('a %s parent needs the child\'s own method', (methodType) => {
    const method = calcMethod({ id: 'cm1', methodType });
    expect(cascadedGoalDraft(parent, method, input())).toEqual({ ok: false, issues: [expect.objectContaining({ detail: 'CALC_METHOD_REQUIRED' })] });
    const r = cascadedGoalDraft(parent, method, input({ calcMethodId: 'cm-up' }));
    expect(r.ok && r.goal.calcMethodId).toBe('cm-up');
  });

  it('dates are clipped to the cycle and the owner\'s employment', () => {
    const r = cascadedGoalDraft(parent, calcMethod({ id: 'cm1' }), input({ owner: { hireDate: '2027-03-15', leftOn: '2027-09-30' } }));
    expect(r.ok && [r.goal.startDate, r.goal.dueDate]).toEqual(['2027-03-15', '2027-09-30']);
    const plain = cascadedGoalDraft(parent, calcMethod({ id: 'cm1' }), input());
    expect(plain.ok && [plain.goal.startDate, plain.goal.dueDate]).toEqual(['2027-01-01', '2027-12-31']);
  });

  it('refuses a TEXT parent, a non-positive allocation or weight, and an owner who left before the cycle', () => {
    const text = goal({ ...parent, targetType: 'TEXT', targetValue: null, targetText: 'Đạt' });
    const detailsOf = (r: ReturnType<typeof cascadedGoalDraft>) => (r.ok ? [] : r.issues.map((i) => i.detail));
    expect(detailsOf(cascadedGoalDraft(text, calcMethod({ id: 'cm1' }), input()))).toContain('PARENT_NOT_NUMERIC');
    expect(detailsOf(cascadedGoalDraft(parent, calcMethod({ id: 'cm1' }), input({ allocatedValue: 0 })))).toContain('ALLOCATION_REQUIRED');
    expect(detailsOf(cascadedGoalDraft(parent, calcMethod({ id: 'cm1' }), input({ weight: 0 })))).toContain('WEIGHT_INVALID');
    expect(detailsOf(cascadedGoalDraft(parent, calcMethod({ id: 'cm1' }), input({ owner: { hireDate: '2020-01-01', leftOn: '2026-06-30' } })))).toContain('DATES_INVALID');
  });

  it('an unknown parent method is not trusted as share-safe', () => {
    expect(cascadedGoalDraft(parent, null, input()).ok).toBe(false);
  });
});
