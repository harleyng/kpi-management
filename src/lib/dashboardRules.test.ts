import { describe, expect, it } from 'vitest';
import type { Id, PeriodResult } from '@/data/types';
import { assignment, employee, evaluationSteps, form, months2027, orgUnit, period, plan, ratingLevel, sampleScale, TENANT, TZ } from '@/test/builders';
import {
  AT_RISK_ACHIEVEMENT_PCT,
  buildDashboard,
  dashboardSnapshot,
  defaultDashboardPeriod,
  employedDuring,
  flaggedLevelIds,
  formProgress,
  goalAttention,
  isResultFlagged,
  latestOfficialResult,
  overdueRows,
  perspectiveBreakdown,
  planProgress,
  previousPeriod,
  rankableUnits,
  ratingDistribution,
  scoreDelta,
  snapshotDigest,
  staffOfUnit,
  subjectInScope,
  trendSeries,
  unitPath,
  UNCLASSIFIED_PERSPECTIVE,
  type DashboardData,
} from './dashboardRules';
import type { AccessProfile, PermissionCoverage } from './permissionRules';

const result = (o: Partial<PeriodResult> = {}): PeriodResult => ({
  id: `r-${o.goalPlanId ?? 'plan1'}-${o.periodId ?? 'T01'}`, tenantId: TENANT, periodId: 'T01', goalPlanId: 'plan1',
  ownerType: 'Employee', totalScore: 95, ratingLevelId: null, payoutPct: null, adjustmentPct: 0, status: 'Final', finalizedAt: null, ...o,
});

/** A profile holding `dashboard.view` with the given coverage (the real one is built by `buildAccessProfile`). */
function profile(coverage: Partial<PermissionCoverage> | null): AccessProfile {
  const map = new Map<string, PermissionCoverage>();
  if (coverage) map.set('dashboard.view', { tenantWide: false, employeeIds: new Set(), orgUnitIds: new Set(), company: false, ...coverage });
  return { tenantId: TENANT, userId: 'u1', employeeId: null, active: true, roleCodes: [], coverage: map as AccessProfile['coverage'], asOf: '2027-04-06' };
}
const TENANT_WIDE = profile({ tenantWide: true });

const months = months2027().map((p) => ({ ...p, cycleId: 'c2027' }));
const T01 = months[0];
const T02 = months[1];
const T03 = months[2];

// Company → Khối KD → Phòng Sale (+ Phòng MKT)
const units = [
  orgUnit({ id: 'root', name: 'Công ty' }),
  orgUnit({ id: 'kd', parentId: 'root', name: 'Khối Kinh doanh', unitType: 'Division' }),
  orgUnit({ id: 'sale', parentId: 'kd', name: 'Phòng Sale', unitType: 'Department' }),
  orgUnit({ id: 'mkt', parentId: 'kd', name: 'Phòng Marketing', unitType: 'Department' }),
];
const companyPlan = plan({ id: 'p-co', cycleId: 'c2027', ownerType: 'Company', ownerOrgUnitId: null, ownerEmployeeId: null, status: 'Locked' });
const salePlan = plan({ id: 'p-sale', cycleId: 'c2027', ownerType: 'OrgUnit', ownerOrgUnitId: 'sale', ownerEmployeeId: null, status: 'Locked' });
const empPlan = (id: string) => plan({ id: `p-${id}`, cycleId: 'c2027', ownerType: 'Employee', ownerOrgUnitId: null, ownerEmployeeId: id, status: 'Locked' });

function data(o: Partial<DashboardData> = {}): DashboardData {
  return {
    tenantId: TENANT,
    periods: months,
    results: [],
    plans: [companyPlan, salePlan, empPlan('e1'), empPlan('e2'), empPlan('e3')],
    units,
    employees: [employee({ id: 'e1', fullName: 'An' }), employee({ id: 'e2', fullName: 'Bình' }), employee({ id: 'e3', fullName: 'Chi' })],
    assignments: [
      assignment({ id: 'a1', employeeId: 'e1', orgUnitId: 'sale' }),
      assignment({ id: 'a2', employeeId: 'e2', orgUnitId: 'sale' }),
      assignment({ id: 'a3', employeeId: 'e3', orgUnitId: 'mkt' }),
    ],
    levels: sampleScale(),
    access: TENANT_WIDE,
    ...o,
  };
}

describe('previousPeriod / defaultDashboardPeriod', () => {
  it('the previous period of the same type in the same cycle; the first has none', () => {
    expect(previousPeriod(months, T03)?.id).toBe('T02');
    expect(previousPeriod(months, T01)).toBeNull();
  });

  it('never skips back to an earlier month that has data (Q42): T03\'s previous is T02 even without results', () => {
    const d = buildDashboard(data({ results: [result({ goalPlanId: 'p-sale', ownerType: 'OrgUnit', periodId: 'T01', totalScore: 90 }), result({ goalPlanId: 'p-sale', ownerType: 'OrgUnit', periodId: 'T03', totalScore: 95 })] }), 'T03');
    expect(d?.previous?.id).toBe('T02');
    expect(d?.nodes.get('sale')?.delta).toEqual({ points: null, provisional: false });
  });

  it('opens on the latest month with an OFFICIAL result, else the results screen default', () => {
    const results = [result({ periodId: 'T01' }), result({ periodId: 'T02', status: 'Final' }), result({ periodId: 'T03', status: 'Draft' })];
    expect(defaultDashboardPeriod(months, results, '2027-04-06')?.id).toBe('T02');
    expect(defaultDashboardPeriod(months, [result({ periodId: 'T03', status: 'Draft' })], '2027-04-06')?.id).toBe('T03');
  });
});

describe('scoreDelta (BR-KPI-87, Q42)', () => {
  it.each([
    ['missing previous', result({ totalScore: 95 }), null, { points: null, provisional: false }],
    ['null score', result({ totalScore: null }), result({ totalScore: 90 }), { points: null, provisional: false }],
    ['both final', result({ totalScore: 95.25 }), result({ totalScore: 90.5 }), { points: 4.75, provisional: false }],
    ['a missing Draft side', result({ totalScore: 95, status: 'Draft' }), null, { points: null, provisional: false }],
    ['a Draft side', result({ totalScore: 95, status: 'Draft' }), result({ totalScore: 90 }), { points: 5, provisional: true }],
    ['Draft noise rounded once', result({ totalScore: 92.33333333333333, status: 'Draft' }), result({ totalScore: 90.5 }), { points: 1.83, provisional: true }],
  ] as const)('%s', (_, current, previous, expected) => {
    expect(scoreDelta(current, previous)).toEqual(expected);
  });
});

describe('flaggedLevelIds / isResultFlagged (BR-KPI-86, Q41)', () => {
  it('a 5-level scale flags its two lowest bands (C, D), whatever the sortOrder direction', () => {
    const ids = flaggedLevelIds(sampleScale());
    expect([...ids].sort()).toEqual(['rl-C', 'rl-D']);
    const flipped = sampleScale().map((l) => ({ ...l, sortOrder: -l.sortOrder }));
    expect([...flaggedLevelIds(flipped)].sort()).toEqual(['rl-C', 'rl-D']);
  });

  it('a 1-level or empty scale flags nothing', () => {
    expect(flaggedLevelIds([ratingLevel({ id: 'only', minScore: 0, maxScore: 1000 })]).size).toBe(0);
    expect(flaggedLevelIds([]).size).toBe(0);
  });

  it('a 2-level scale flags only its lowest — never everyone', () => {
    const two = [ratingLevel({ id: 'pass', minScore: 50, maxScore: 1000 }), ratingLevel({ id: 'fail', minScore: 0, maxScore: 50 })];
    expect([...flaggedLevelIds(two)]).toEqual(['fail']);
  });

  it('no rating, an unknown level, an Employee Draft never flag; a unit Draft in a low band does', () => {
    const flagged = flaggedLevelIds(sampleScale());
    expect(isResultFlagged(result({ ratingLevelId: null }), flagged)).toBe(false);
    expect(isResultFlagged(result({ ratingLevelId: 'gone' }), flagged)).toBe(false);
    expect(isResultFlagged(result({ ratingLevelId: 'rl-C', status: 'Draft' }), flagged)).toBe(false);
    expect(isResultFlagged(result({ ratingLevelId: 'rl-C', status: 'Final' }), flagged)).toBe(true);
    expect(isResultFlagged(result({ ratingLevelId: 'rl-C', status: 'Draft', ownerType: 'OrgUnit' }), flagged)).toBe(true);
    expect(isResultFlagged(result({ ratingLevelId: 'rl-B', status: 'Final' }), flagged)).toBe(false);
  });
});

describe('goalAttention (BR-KPI-86, Q41)', () => {
  const lines = [
    { goalId: 'g90', weight: 20, achievementPct: AT_RISK_ACHIEVEMENT_PCT },
    { goalId: 'g8999', weight: 20, achievementPct: 89.99 },
    { goalId: 'gnull', weight: 20, achievementPct: null },
    { goalId: 'gzero', weight: 20, achievementPct: 0 },
    { goalId: 'gprivate', weight: 20, achievementPct: 50 },
  ];
  const visible = [{ id: 'g90', name: 'Đúng ngưỡng' }, { id: 'g8999', name: 'Sát ngưỡng' }, { id: 'gnull', name: 'Chưa có số' }, { id: 'gzero', name: 'Bằng 0' }];

  it('exactly 90 is not flagged; 89.99 and 0 are below; null is "missing", never below; worst first', () => {
    const { items } = goalAttention(lines, visible);
    expect(items.map((i) => [i.goalId, i.kind])).toEqual([
      ['gzero', 'BELOW_THRESHOLD'],
      ['gprivate', 'BELOW_THRESHOLD'],
      ['g8999', 'BELOW_THRESHOLD'],
      ['gnull', 'MISSING'],
    ]);
  });

  it('a goal the viewer may not see is counted, never named', () => {
    const { items, hiddenCount } = goalAttention(lines, visible);
    expect(items.find((i) => i.goalId === 'gprivate')?.name).toBeNull();
    expect(hiddenCount).toBe(1);
  });
});

describe('perspectiveBreakdown (BR-KPI-86)', () => {
  const goals = [
    { id: 'g1', perspectiveId: 'FIN' },
    { id: 'g2', perspectiveId: 'FIN' },
    { id: 'g3', perspectiveId: 'CUS' },
    { id: 'g4', perspectiveId: 'gone' },
  ];
  const order = ['FIN', 'CUS', 'PRO', 'LNG'];

  it('a weighted average achievement per perspective, its weight share, missing counted; unknown → its own bucket', () => {
    const rows = perspectiveBreakdown(
      [
        { goalId: 'g1', weight: 30, achievementPct: 100 },
        { goalId: 'g2', weight: 10, achievementPct: 80 },
        { goalId: 'g3', weight: 40, achievementPct: null },
        { goalId: 'g4', weight: 20, achievementPct: 110 },
      ],
      goals,
      order,
    );
    expect(rows).toEqual([
      { perspectiveId: 'FIN', weight: 40, weightShare: 40, achievement: 95, missing: 0, lines: 2 },
      { perspectiveId: 'CUS', weight: 40, weightShare: 40, achievement: null, missing: 1, lines: 1 },
      { perspectiveId: UNCLASSIFIED_PERSPECTIVE, weight: 20, weightShare: 20, achievement: 110, missing: 0, lines: 1 },
    ]);
  });

  it('a perspective whose lines all lack an achievement → null, never 0; 99.99 / 100.01 totals are shares, not errors', () => {
    const rows = perspectiveBreakdown(
      [
        { goalId: 'g1', weight: 50, achievementPct: null },
        { goalId: 'g2', weight: 49.99, achievementPct: null },
        { goalId: 'g3', weight: 0.02, achievementPct: 100 },
      ],
      goals,
      order,
    );
    expect(rows[0]).toMatchObject({ perspectiveId: 'FIN', achievement: null, missing: 2 });
    expect(rows[0].weightShare).toBeCloseTo(99.98, 2);
  });

  it('weights that do not total 100 still give shares; no lines → no rows', () => {
    const rows = perspectiveBreakdown([{ goalId: 'g1', weight: 30, achievementPct: 100 }], goals, order);
    expect(rows[0]).toMatchObject({ weight: 30, weightShare: 100 });
    expect(perspectiveBreakdown([], goals, order)).toEqual([]);
  });
});

describe('buildDashboard — units, staff and scope (Q40, Q43)', () => {
  const results = [
    result({ goalPlanId: 'p-co', ownerType: 'Company', periodId: 'T02', totalScore: 106.07, status: 'Draft' }),
    result({ goalPlanId: 'p-co', ownerType: 'Company', periodId: 'T01', totalScore: 93.71, ratingLevelId: 'rl-B', status: 'Locked' }),
    result({ goalPlanId: 'p-sale', ownerType: 'OrgUnit', periodId: 'T02', totalScore: 85, ratingLevelId: 'rl-C' }),
    result({ goalPlanId: 'p-e1', periodId: 'T02', totalScore: 100 }),
    result({ goalPlanId: 'p-e2', periodId: 'T02', totalScore: 90, status: 'Draft' }),
    result({ goalPlanId: 'p-e3', periodId: 'T02', totalScore: 95.5, status: 'Locked' }),
  ];

  it('a unit shows its OWN plan; a Khối has none; the staff average uses official results only (n/m)', () => {
    const d = buildDashboard(data({ results }), 'T02');
    const root = d?.nodes.get('root');
    expect(root?.own?.totalScore).toBe(106.07);
    expect(root?.delta).toEqual({ points: 12.36, provisional: true });
    const kd = d?.nodes.get('kd');
    expect(kd?.ownPlan).toBeNull();
    expect(kd).toMatchObject({ staffTotal: 3, staffCounted: 2, staffAverage: 97.75 });
    expect(d?.nodes.get('sale')).toMatchObject({ staffTotal: 2, staffCounted: 1, staffAverage: 100, flagged: true });
    expect(d?.rootIds).toEqual(['root']);
  });

  it('no official staff result → average null, never 0', () => {
    const d = buildDashboard(data({ results: results.filter((r) => r.goalPlanId !== 'p-e1' && r.goalPlanId !== 'p-e3') }), 'T02');
    expect(d?.nodes.get('sale')).toMatchObject({ staffCounted: 0, staffAverage: null });
    expect(d?.nodes.get('mkt')).toMatchObject({ staffTotal: 1, staffCounted: 0, staffAverage: null });
  });

  it('a transfer counts once, in the unit held on the period\'s last day (E021, Q43)', () => {
    const assignments = [
      assignment({ id: 'a1-old', employeeId: 'e1', orgUnitId: 'sale', effectiveTo: '2027-02-14' }),
      assignment({ id: 'a1-new', employeeId: 'e1', orgUnitId: 'mkt', effectiveFrom: '2027-02-15' }),
      assignment({ id: 'a2', employeeId: 'e2', orgUnitId: 'sale' }),
      assignment({ id: 'a3', employeeId: 'e3', orgUnitId: 'mkt' }),
    ];
    const t01 = buildDashboard(data({ assignments }), 'T01');
    const t02 = buildDashboard(data({ assignments }), 'T02');
    expect(t01 && staffOfUnit(t01, 'sale').map((s) => s.employee?.id)).toEqual(['e1', 'e2']);
    expect(t02 && staffOfUnit(t02, 'sale').map((s) => s.employee?.id)).toEqual(['e2']);
    expect(t02 && staffOfUnit(t02, 'mkt').map((s) => s.employee?.id)).toEqual(['e1', 'e3']);
    expect(t02?.nodes.get('kd')?.staffTotal).toBe(3);
  });

  it('a leaver is counted for the periods they worked, in their last unit, and not after (E024)', () => {
    const employees = [employee({ id: 'e1', fullName: 'An', leftOn: '2027-02-10', employmentStatus: 'Resigned' }), employee({ id: 'e2' }), employee({ id: 'e3' })];
    const assignments = [assignment({ id: 'a1', employeeId: 'e1', orgUnitId: 'sale', effectiveTo: '2027-02-10' }), assignment({ id: 'a2', employeeId: 'e2', orgUnitId: 'sale' }), assignment({ id: 'a3', employeeId: 'e3', orgUnitId: 'mkt' })];
    const t02 = buildDashboard(data({ employees, assignments, results }), 'T02');
    expect(t02 && staffOfUnit(t02, 'sale').map((s) => s.employee?.id)).toEqual(['e1', 'e2']);
    expect(t02?.nodes.get('sale')).toMatchObject({ staffCounted: 1, staffAverage: 100 });
    const t03 = buildDashboard(data({ employees, assignments }), 'T03');
    expect(t03 && staffOfUnit(t03, 'sale').map((s) => s.employee?.id)).toEqual(['e2']);
  });

  it('someone with no primary assignment is unplaced — listed for a tenant-wide viewer only', () => {
    const assignments = [assignment({ id: 'a2', employeeId: 'e2', orgUnitId: 'sale' }), assignment({ id: 'a3', employeeId: 'e3', orgUnitId: 'mkt' })];
    expect(buildDashboard(data({ assignments }), 'T02')?.unplaced.map((s) => s.plan.id)).toEqual(['p-e1']);
    expect(buildDashboard(data({ assignments, access: profile({ orgUnitIds: new Set(['sale']) }) }), 'T02')?.unplaced).toEqual([]);
  });

  it('a manager scoped to one department sees it as the root — no company, no Khối, nobody else (scope)', () => {
    const d = buildDashboard(data({ results, access: profile({ orgUnitIds: new Set(['sale']) }) }), 'T02');
    expect([...(d?.nodes.keys() ?? [])]).toEqual(['sale']);
    expect(d?.rootIds).toEqual(['sale']);
    expect(d && unitPath(d, 'sale').map((n) => n.unit.id)).toEqual(['sale']);
    expect(d && staffOfUnit(d, 'mkt')).toEqual([]);
  });

  it('a Khối-level scope: Khối root, its departments as children; a profile without the code sees nothing', () => {
    const d = buildDashboard(data({ results, access: profile({ orgUnitIds: new Set(['kd', 'sale', 'mkt']) }) }), 'T02');
    expect(d?.rootIds).toEqual(['kd']);
    expect(d?.nodes.get('kd')?.childIds).toEqual(['mkt', 'sale']);
    expect(d && unitPath(d, 'sale').map((n) => n.unit.id)).toEqual(['kd', 'sale']);
    expect(buildDashboard(data({ access: profile(null) }), 'T02')?.nodes.size).toBe(0);
  });

  it('an inactive unit without a plan in the cycle is not shown; an unknown period → null', () => {
    const closed = orgUnit({ id: 'old', parentId: 'kd', name: 'Phòng cũ', status: 'Inactive', effectiveTo: '2026-12-31' });
    expect(buildDashboard(data({ units: [...units, closed] }), 'T02')?.nodes.has('old')).toBe(false);
    expect(buildDashboard(data(), 'nope')).toBeNull();
  });

  it('only units with their own scored plan are ranked — a Khối\'s staff average is never compared (Q40)', () => {
    const d = buildDashboard(data({ results }), 'T02');
    expect(rankableUnits([...(d?.nodes.values() ?? [])]).map((n) => n.unit.id)).toEqual(['root', 'sale']);
  });
});

describe('employedDuring / subjectInScope', () => {
  it('a hire after the period or a leave before it is out; the boundary days are in', () => {
    expect(employedDuring(employee({ hireDate: '2027-02-28' }), T02)).toBe(true);
    expect(employedDuring(employee({ hireDate: '2027-03-01' }), T02)).toBe(false);
    expect(employedDuring(employee({ leftOn: '2027-02-01' }), T02)).toBe(true);
    expect(employedDuring(employee({ leftOn: '2027-01-31' }), T02)).toBe(false);
  });

  it('tenant-wide sees an unplaced subject; a unit scope only its units', () => {
    expect(subjectInScope({ tenantId: TENANT, access: TENANT_WIDE }, null)).toBe(true);
    const mgr = { tenantId: TENANT, access: profile({ orgUnitIds: new Set(['sale']) }) };
    expect(subjectInScope(mgr, 'sale')).toBe(true);
    expect(subjectInScope(mgr, 'mkt')).toBe(false);
    expect(subjectInScope(mgr, null)).toBe(false);
  });
});

describe('trendSeries (Q42, BR-KPI-82)', () => {
  const rs = [result({ periodId: 'T01', totalScore: 90 }), result({ periodId: 'T02', totalScore: 95, status: 'Draft' })];

  it('every month in order; a Draft point is provisional; a month without a result is null, never 0', () => {
    const points = trendSeries(rs, months, 'plan1');
    expect(points).toHaveLength(12);
    expect(points.slice(0, 3)).toEqual([
      { periodId: 'T01', label: 'T01', score: 90, provisional: false },
      { periodId: 'T02', label: 'T02', score: 95, provisional: true },
      { periodId: 'T03', label: 'T03', score: null, provisional: false },
    ]);
  });

  it('the employee\'s own view never shows a Draft point', () => {
    expect(trendSeries(rs, months, 'plan1', { officialOnly: true })[1]).toEqual({ periodId: 'T02', label: 'T02', score: null, provisional: false });
  });
});

describe('operations (WBS 4.7.3)', () => {
  const steps = evaluationSteps().map((s) => ({ ...s, workflowId: 'wf1' }));
  const clock = { now: '2027-02-20T02:00:00.000Z', tz: TZ };

  it('forms by status, by step, overdue with the T5 test, completion over non-cancelled', () => {
    const forms = [
      form({ id: 'f1', status: 'Completed', currentStepId: null }),
      form({ id: 'f2', status: 'Cancelled', currentStepId: null }),
      form({ id: 'f3', status: 'Open', currentStepId: 's1' }), // entered 02-01, SLA 7 → deadline 02-08 → overdue
      form({ id: 'f4', status: 'InProgress', currentStepId: 's2', dueDate: '2027-03-31', currentStepEnteredAt: '2027-02-19T02:00:00.000Z' }),
    ];
    const p = formProgress(forms, steps, clock);
    expect(p.byStatus).toEqual({ Open: 1, InProgress: 1, Completed: 1, Cancelled: 1 });
    expect(p).toMatchObject({ total: 4, active: 3, completed: 1, overdue: 1 });
    expect(p.completionPct).toBeCloseTo(33.333, 2);
    expect(p.byStep.map((s) => [s.name, s.count])).toEqual([['Tự đánh giá', 1], ['Quản lý đánh giá', 1]]);
    expect(overdueRows(forms, steps, clock).map((r) => [r.form.id, r.daysOver])).toEqual([['f3', 12]]);
    expect(formProgress([], steps, clock).completionPct).toBeNull();
  });

  it('registration progress counts Employee plans by status', () => {
    const p = planProgress([companyPlan, empPlan('a'), { ...empPlan('b'), status: 'Draft' }, { ...empPlan('c'), status: 'Draft' }]);
    expect(p.total).toBe(3);
    expect(p.byStatus).toEqual({ Draft: 2, Submitted: 0, Returned: 0, Approved: 0, Locked: 1 });
  });

  it('the rating distribution counts official Employee results only, highest level first', () => {
    const dist = ratingDistribution(
      [
        result({ ratingLevelId: 'rl-A' }),
        result({ ratingLevelId: 'rl-A', status: 'Locked' }),
        result({ ratingLevelId: 'rl-C', status: 'Draft' }),
        result({ ratingLevelId: 'rl-B', ownerType: 'OrgUnit' }),
        result({ ratingLevelId: null }),
      ],
      sampleScale(),
    );
    expect(dist.levels.map((l) => [l.level.code, l.count])).toEqual([['A+', 0], ['A', 2], ['B', 0], ['C', 0], ['D', 0]]);
    expect(dist).toMatchObject({ unrated: 1, total: 3 });
  });
});

describe('dashboardSnapshot (BR-KPI-89)', () => {
  it('only the focus and its visible children; plain JSON; the digest follows every number', () => {
    const results = [result({ goalPlanId: 'p-sale', ownerType: 'OrgUnit', periodId: 'T02', totalScore: 85, ratingLevelId: 'rl-C' })];
    const d = buildDashboard(data({ results }), 'T02');
    if (!d) throw new Error('model');
    const snap = dashboardSnapshot(TENANT, d, 'kd', [], 3);
    expect(snap?.focus).toMatchObject({ id: 'kd', hasOwnPlan: false, score: null });
    expect(snap?.children.map((c) => [c.id, c.score, c.ratingCode, c.flagged])).toEqual([
      ['mkt', null, null, false],
      ['sale', 85, 'C', true],
    ]);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    const other = dashboardSnapshot(TENANT, d, 'kd', [], 4);
    expect(snap && other && snapshotDigest(snap) !== snapshotDigest(other)).toBe(true);
    expect(snap && snapshotDigest(snap)).toBe(snap && snapshotDigest(JSON.parse(JSON.stringify(snap))));
    expect(dashboardSnapshot(TENANT, d, 'nope' as Id, [], null)).toBeNull();
    expect(dashboardSnapshot(TENANT, d, 'kd', null, null)?.attention).toBeNull(); // not loaded ≠ nothing to flag
  });
});

describe('a period as a builder sanity check', () => {
  it('months carry the cycle id the dashboard filters on', () => {
    expect(period({ id: 'x' }).id).toBe('x');
    expect(T02.cycleId).toBe('c2027');
  });
});

describe('latestOfficialResult — "KPI của tôi" (BR-KPI-82)', () => {
  it('the latest official month, and the month before only when it is official too', () => {
    const rs = [result({ periodId: 'T01', totalScore: 90 }), result({ periodId: 'T02', totalScore: 95.25, status: 'Locked' }), result({ periodId: 'T03', totalScore: 99, status: 'Draft' })];
    const mine = latestOfficialResult(rs, months);
    expect(mine?.period.id).toBe('T02');
    expect(mine?.delta).toEqual({ points: 5.25, provisional: false });
  });

  it('a Draft previous month is never the other side of the difference; nothing official → null', () => {
    const rs = [result({ periodId: 'T01', totalScore: 90, status: 'Draft' }), result({ periodId: 'T02', totalScore: 95 })];
    const mine = latestOfficialResult(rs, months);
    expect(mine?.previous).toBeNull();
    expect(mine?.previousPeriod?.id).toBe('T01');
    expect(mine?.delta.points).toBeNull();
    expect(latestOfficialResult([result({ status: 'Draft' })], months)).toBeNull();
    expect(latestOfficialResult([], months)).toBeNull();
  });
});
