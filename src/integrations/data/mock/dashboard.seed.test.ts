import { describe, expect, it } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import type { FormInstance, FormType, Id } from '@/data/types';
import { getInsightGateway } from '@/integrations/insight';
import {
  buildDashboard,
  dashboardSnapshot,
  defaultDashboardPeriod,
  formProgress,
  formsInScope,
  planProgress,
  plansInScope,
  ratingDistribution,
  resultsInScope,
  staffOfUnit,
  type DashboardData,
} from '@/lib/dashboardRules';
import { todayOf } from '@/lib/isoDate';
import { buildAccessProfile } from '@/lib/permissionRules';
import type { DataGateway } from '../types';
import { newGateway } from './gateway.test-util';

/**
 * The Phase 3 gate — "Dashboard đúng số với kịch bản seed" (plan §6.2): the dashboard's rules, fed by
 * the mock gateway over the frozen seed exactly as the screens feed them, give the numbers of the
 * story in `src/data/fixtures/README.md` and of the stored results. Stored figures are compared as
 * stored (never recomputed); derived ones (averages, counts) are pinned.
 */

const TZ = 'Asia/Ho_Chi_Minh';

async function allForms(gw: DataGateway, tenantId: Id, formType: FormType, periodId?: Id): Promise<FormInstance[]> {
  const out: FormInstance[] = [];
  let cursor: string | undefined;
  do {
    const page = await gw.forms.listForms(tenantId, { formType, periodId }, { limit: 500, cursor });
    out.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return out;
}

/** What `useDashboardModel` assembles, for one person of one tenant. */
async function load(gw: DataGateway, tenantId: Id, userId: Id) {
  const cycles = await gw.goals.listCycles(tenantId);
  const cycle = cycles.find((c) => c.name === 'KPI 2027');
  if (!cycle) throw new Error('no KPI 2027');
  const periods = await gw.goals.listPeriods(tenantId, cycle.id);
  const results = (await Promise.all(periods.map((p) => gw.results.listPeriodResults(tenantId, { periodId: p.id })))).flat();
  const [plans, units, employees, assignments, levels, accounts, roles, permissions, rolePermissions, userRoles, steps] = await Promise.all([
    gw.goals.listGoalPlans(tenantId, { cycleId: cycle.id }),
    gw.org.listOrgUnits(tenantId),
    gw.org.listEmployees(tenantId, { includeResigned: true }),
    gw.org.listAssignments(tenantId),
    cycle.ratingScaleId ? gw.results.listRatingLevels(tenantId, cycle.ratingScaleId) : Promise.resolve([]),
    gw.org.listUserAccounts(tenantId),
    gw.org.listRoles(tenantId),
    gw.org.listPermissions(tenantId),
    gw.org.listRolePermissions(tenantId),
    gw.org.listUserRoles(tenantId),
    gw.forms.listWorkflowSteps(tenantId),
  ]);
  const clock = { now: gw.clock.now(), tz: TZ };
  const today = todayOf(clock);
  const account = accounts.find((a) => a.id === userId);
  if (!account) throw new Error('no account');
  const access = buildAccessProfile({ tenantId, account, roles, userRoles, permissions, rolePermissions, orgUnits: units, assignments, employees, asOf: today });
  const data: DashboardData = { tenantId, periods, results, plans, units, employees, assignments, levels, access };
  const period = (label: string) => {
    const p = periods.find((x) => x.label === label && x.periodType === 'Month');
    if (!p) throw new Error(label);
    return p;
  };
  return { data, period, periods, results, today, clock, steps, levels };
}

const S = SYNTRA.tenantId;
const unit = (code: string) => SYNTRA.unit(code);
const emp = (code: string) => SYNTRA.employee(code);

describe('the dashboard on the seed (Phase 3 gate)', () => {
  const { gateway: gw } = newGateway();

  it('BOD opens on T02 — the latest month with official results — at the company', async () => {
    const { data, periods, results, today, period } = await load(gw, S, SYNTRA.user(SYNTRA.personas.bod));
    expect(defaultDashboardPeriod(periods, results, today)?.id).toBe(period('T02').id);
    const model = buildDashboard(data, period('T02').id);
    expect(model?.rootIds).toEqual([unit('SYN')]);
    expect(model?.previous?.label).toBe('T01');
  });

  it('T02: the company result is a Draft of 106.07, unrated; departments show their stored Final scores', async () => {
    const { data, period } = await load(gw, S, SYNTRA.user(SYNTRA.personas.bod));
    const model = buildDashboard(data, period('T02').id);
    const company = model?.nodes.get(unit('SYN'));
    expect(company?.own).toMatchObject({ status: 'Draft', ratingLevelId: null });
    expect(company?.own?.totalScore).toBeCloseTo(106.0716, 4);
    expect(company?.ownLevel).toBeNull();
    expect(company?.delta.provisional).toBe(true);
    expect(company?.delta.points).toBe(12.36); // 106.0716… − 93.71, rounded once

    const show = (code: string) => {
      const n = model?.nodes.get(unit(code));
      return [n?.own?.status, n?.own?.totalScore, n?.ownLevel?.code ?? null];
    };
    expect(show('KDBH')).toEqual(['Final', 105.45, 'A']);
    expect(show('VHN')).toEqual(['Final', 114.03, 'A+']);
    expect(show('CN')).toEqual(['Final', 90.88, 'B']);
    expect(show('MKT')).toEqual(['Final', 98.42, 'B']);
  });

  it('a Khối has no plan of its own: "Chưa có kế hoạch", with the average of its people\'s official results', async () => {
    const { data, period } = await load(gw, S, SYNTRA.user(SYNTRA.personas.bod));
    const model = buildDashboard(data, period('T02').id);
    const kd = model?.nodes.get(unit('KD'));
    expect(kd?.ownPlan).toBeNull();
    expect(kd?.own).toBeNull();
    expect(kd).toMatchObject({ staffTotal: 9, staffCounted: 6 });
    expect(kd?.staffAverage).toBeCloseTo(99.7467, 4);
    // The company: 27 people evaluated in T02, 17 official results (E023 and E027 Draft; five without a completed form).
    const company = model?.nodes.get(unit('SYN'));
    expect(company).toMatchObject({ staffTotal: 27, staffCounted: 17 });
    expect(company?.staffAverage).toBeCloseTo(97.6429, 4);
  });

  it('T01: everything Locked but E027 — company 93.71 B; no previous month', async () => {
    const { data, period } = await load(gw, S, SYNTRA.user(SYNTRA.personas.bod));
    const model = buildDashboard(data, period('T01').id);
    const company = model?.nodes.get(unit('SYN'));
    expect([company?.own?.status, company?.own?.totalScore, company?.ownLevel?.code]).toEqual(['Locked', 93.71, 'B']);
    expect(company?.delta).toEqual({ points: null, provisional: false });
    expect(model?.previous).toBeNull();
  });

  it('people sit where they were on the period\'s last day: E024 (left 03-10) through T03, not in T04; E018 (hired 03-15) not in T02; E021 in Marketing', async () => {
    const { data, period } = await load(gw, S, SYNTRA.user(SYNTRA.personas.bod));
    const t02 = buildDashboard(data, period('T02').id);
    const t03 = buildDashboard(data, period('T03').id);
    const t04 = buildDashboard(data, period('T04').id);
    const placed = (m: typeof t02, code: string) => m?.staff.find((s) => s.employee?.id === emp(code));
    expect(placed(t02, 'E024')?.unitId).not.toBeNull();
    expect(placed(t02, 'E024')?.result?.status).toBe('Final');
    expect(placed(t03, 'E024')?.unitId).toBe(placed(t02, 'E024')?.unitId); // worked in March until the 10th
    expect(placed(t04, 'E024')).toBeUndefined();
    expect(placed(t02, 'E018')).toBeUndefined();
    expect(placed(t03, 'E018')?.unitId).toBe(unit('KDBH'));
    expect(placed(t02, 'E021')?.unitId).toBe(unit('MKT')); // moved CSKH → Marketing on 01-01
  });

  it('manager E006 sees Kinh doanh only — its own people, no company, no Khối, no other department', async () => {
    const { data, period } = await load(gw, S, SYNTRA.user(SYNTRA.personas.manager));
    const model = buildDashboard(data, period('T02').id);
    expect(model?.rootIds).toEqual([unit('KDBH')]);
    expect([...(model?.nodes.keys() ?? [])]).toEqual([unit('KDBH')]);
    const people = model ? staffOfUnit(model, unit('KDBH')).map((s) => s.employee?.employeeCode) : [];
    expect(people).toEqual(['E015', 'E016', 'E017']);
    const snapshot = model && dashboardSnapshot(S, model, unit('KDBH'), [], 0);
    const text = JSON.stringify(snapshot);
    for (const other of ['SYN', 'KD', 'MKT', 'CSKH', 'VHN']) expect(text).not.toContain(unit(other));
  });

  it('operations, HR: T03 evaluations 20 Open / 6 in progress / 1 cancelled; 2027 staff plans by status', async () => {
    const { data, period, steps, clock, today } = await load(gw, S, SYNTRA.user(SYNTRA.personas.hr));
    const evals = formsInScope(await allForms(gw, S, 'KPI_EVAL', period('T03').id), data, period('T03'));
    const progress = formProgress(evals, steps, clock);
    expect(progress.byStatus).toEqual({ Open: 20, InProgress: 6, Completed: 0, Cancelled: 1 });
    expect(progress).toMatchObject({ total: 27, active: 26, completed: 0 });
    expect(progress.overdue).toBe(0); // T03 step-1 deadline 04-07, after SEED_NOW
    const plans = planProgress(plansInScope(data.plans, data, { endDate: today }));
    expect(plans.byStatus).toEqual({ Draft: 2, Submitted: 1, Returned: 1, Approved: 1, Locked: 23 });
    // T02: 22 completed, 5 still open past their step deadline — the same "Quá hạn" as T5's lists.
    const t02 = formProgress(formsInScope(await allForms(gw, S, 'KPI_EVAL', period('T02').id), data, period('T02')), steps, clock);
    expect(t02).toMatchObject({ total: 27, completed: 22, overdue: 5 });
    expect(t02.byStep.map((s) => [s.name, s.count])).toEqual([['Quản lý đánh giá', 4], ['HR ghi nhận kết quả', 1]]);
  });

  it('operations: the T02 rating distribution counts the official Employee results only', async () => {
    const { data, period, levels } = await load(gw, S, SYNTRA.user(SYNTRA.personas.hr));
    const model = buildDashboard(data, period('T02').id);
    const dist = model ? ratingDistribution(resultsInScope(model), levels) : null;
    expect(dist?.levels.map((l) => [l.level.code, l.count])).toEqual([['A+', 0], ['A', 5], ['B', 12], ['C', 0], ['D', 0]]);
    expect(dist).toMatchObject({ unrated: 0, total: 17 });
  });

  it('the assistant summarises BOD\'s company view from the snapshot', async () => {
    const { data, period } = await load(gw, S, SYNTRA.user(SYNTRA.personas.bod));
    const model = buildDashboard(data, period('T02').id);
    const snapshot = model && dashboardSnapshot(S, model, unit('SYN'), [], 3);
    if (!snapshot) throw new Error('snapshot');
    const answer = await getInsightGateway().summarise(S, snapshot);
    const text = answer.sentences.map((s) => s.text).join(' ');
    expect(text).toContain('Công ty Syntra đạt 106,07 điểm kỳ T02 (tạm tính, chưa xếp loại).');
    expect(text).toContain('Chưa đủ đơn vị trực thuộc có điểm riêng'); // its children are Khối: no plan, never ranked (Q40)
  });

  it('Demo Co: its own numbers only — no Syntra id anywhere in the model or the snapshot', async () => {
    const { data, period } = await load(gw, DEMO.tenantId, DEMO.user(DEMO.personas.hr));
    const model = buildDashboard(data, period('T01').id);
    const root = model?.rootIds[0];
    expect(root).toBe(DEMO.unit('DEMO'));
    const d003 = model?.staff.find((s) => s.employee?.id === DEMO.employee('D003'));
    expect([d003?.result?.status, d003?.result?.totalScore]).toEqual(['Final', 95]);
    const snapshot = model && root ? dashboardSnapshot(DEMO.tenantId, model, root, [], 0) : null;
    const text = JSON.stringify(snapshot) + JSON.stringify([...(model?.nodes.values() ?? [])]);
    expect(text).not.toContain(S);
    await expect(getInsightGateway().summarise(S, snapshot as NonNullable<typeof snapshot>)).rejects.toMatchObject({ code: 'ERR-KPI-06' });
  });
});
