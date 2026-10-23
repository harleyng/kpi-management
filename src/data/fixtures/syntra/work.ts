import type { RecipientFilter } from '@/data/types';
import { EVAL_DUE_DAYS, WORK_PLAN_DUE_DAYS } from '../catalog';
import type { IdFn, SeedRows, Workflows } from '../shared';
import { T, vn } from '../timeline';
import { workSeed, type ReviewSpec, type TaskSpec } from '../work';
import type { SyntraGoals } from './goals';
import type { SyntraOrg } from './org';

/**
 * Monthly work (PEND-14) — the Kinh doanh pilot (manager E006; E015, E016, E017; E018 from April).
 * HR launches each month by hand for the department (the `PERIOD_START` rule is step 8.4):
 * - **T02 recorded**: plans approved, reviews Completed, results produced by `workRules` — E017 below
 *   80 with the manager's Hsnv and reason;
 * - **T03 under review** (launched 04-01, step-1 deadline 04-07): E015 has saved self-scores (EDIT,
 *   still Open), E016 Open, E017 sent to the manager on 04-03; E016's plan had a task cancelled
 *   mid-month; E018 (hired 03-15) had no March plan, so the review launch skipped her (Q69);
 * - **T04 planning** (launched 04-01, due 04-08): E015 approved, E016 sent on 04-04 (at the manager),
 *   E017 returned on 04-05 (back at step 1), E018 still writing hers (Draft, 60% of the weight).
 * No deadline falls between the last scheduler tick (04-01) and SEED_NOW.
 */

/** The department's staff (its head's own month is not in the pilot). */
const KDBH_STAFF = (unitId: string): RecipientFilter => ({
  orgUnitIds: [unitId],
  includeChildUnits: false,
  positionIds: [],
  jobLevels: ['TeamLead', 'Specialist', 'Staff'],
  employmentStatuses: [],
  employeeIds: [],
});

const HR = 'E035';
const MANAGER = 'E006';

export function buildWork(s: SeedRows, id: IdFn, org: SyntraOrg, g: SyntraGoals, wf: Workflows): void {
  const w = workSeed({ s, id, wf, user: org.userId, employee: org.employeeId, period: g.period });
  const filter = KDBH_STAFF(org.unitId('KDBH'));
  const launch = (key: string, type: 'WORK_PLAN' | 'WORK_REVIEW', month: string, at: string) =>
    w.launch(key, {
      type,
      name: `${type === 'WORK_PLAN' ? 'Kế hoạch' : 'Đánh giá'} công việc tháng ${month.slice(1)}/2027 — Phòng Kinh doanh`,
      month,
      cycleId: g.cycleId,
      at,
      dueDays: type === 'WORK_PLAN' ? WORK_PLAN_DUE_DAYS : EVAL_DUE_DAYS,
      filter,
      by: HR,
    });
  const kpi = (code: string) => g.goalsOf(code)[0].id;

  /** Each person's usual month — weights sum to 100. */
  const tasksFor = (code: string, done: boolean): TaskSpec[] => {
    const progress = (pct: number): Pick<TaskSpec, 'progressPct' | 'progressStatus'> =>
      done ? { progressPct: 100, progressStatus: 'Done' } : { progressPct: pct, progressStatus: pct === 0 ? 'NotStarted' : 'InProgress' };
    switch (code) {
      case 'E015':
        return [
          { name: 'Chăm sóc 30 khách hàng VIP', weight: 40, product: 'Khách hàng VIP', unitText: 'khách hàng', linkedGoalId: kpi('E015'), ...progress(60) },
          { name: 'Báo cáo doanh số tuần cho trưởng phòng', weight: 20, unitText: 'báo cáo', ...progress(50) },
          { name: 'Kèm cặp hai nhân viên mới', weight: 40, ...progress(30) },
        ];
      case 'E016':
        return [
          { name: 'Chốt 5 hợp đồng mới', weight: 50, unitText: 'hợp đồng', linkedGoalId: kpi('E016'), ...progress(40) },
          { name: 'Cập nhật dữ liệu khách hàng trên CRM', weight: 30, ...progress(80) },
          { name: 'Chuẩn bị hồ sơ thầu khách hàng lớn', weight: 20, visibility: 'PRIVATE', ...progress(0) },
        ];
      case 'E017':
        return [
          { name: 'Gọi lại khách hàng tiềm năng tồn', weight: 60, unitText: 'cuộc gọi', ...progress(20) },
          { name: 'Hoàn thiện bộ tài liệu giới thiệu sản phẩm', weight: 40, product: 'Tài liệu bán hàng', ...progress(0) },
        ];
      default:
        return [
          { name: 'Học quy trình bán hàng và sản phẩm', weight: 60, ...progress(30) },
          { name: 'Đi cùng trưởng nhóm gặp 10 khách hàng', weight: 40, unitText: 'buổi', ...progress(0) },
        ];
    }
  };

  // ─── T02 — recorded ────────────────────────────────────────────────────────────────────────
  const planT02 = launch('WP-T02', 'WORK_PLAN', 'T02', vn('2027-02-01 09:00'));
  const reviewT02 = launch('WR-T02', 'WORK_REVIEW', 'T02', vn('2027-03-01 09:00'));
  const T02_REVIEWS: Record<string, ReviewSpec> = {
    E015: { tasks: [[95, 90, 90], [90, 85, 85], [100, 100, 100]], discipline: [95, 90, 90] },
    E016: { tasks: [[90, 80, 80], [85, 85, 85], [80, 70, 70]], discipline: [90, 85, 85] },
    // Hsht = 70% × 59 + 30% × 70 = 62.3 < 80: the manager decides Hsnv with a reason.
    E017: {
      tasks: [[70, 55, 55], [80, 65, 65]],
      discipline: [80, 70, 70],
      hsnv: { score: 70, reason: 'Tháng 2 nghỉ phép 6 ngày theo kế hoạch, khối lượng việc giao đã giảm tương ứng.' },
    },
  };
  for (const code of ['E015', 'E016', 'E017']) {
    w.plan(code, 'T02', 'Locked', { at: vn('2027-02-03 15:00'), by: MANAGER }, tasksFor(code, true));
    const p = w.form(`WP:T02:${code}`, { type: 'WORK_PLAN', code, month: 'T02', launch: planT02, due: '2027-02-08', status: 'Completed', step: null, enteredAt: null });
    w.act(p, 2, code, 'SUBMIT', vn('2027-02-02 10:00'));
    w.act(p, 3, MANAGER, 'APPROVE', vn('2027-02-03 15:00'));
    const r = w.form(`WR:T02:${code}`, { type: 'WORK_REVIEW', code, month: 'T02', launch: reviewT02, due: '2027-03-13', status: 'Completed', step: null, enteredAt: null });
    w.act(r, 1, code, 'SUBMIT', vn('2027-03-03 10:00'));
    w.act(r, 2, MANAGER, 'SUBMIT', vn('2027-03-05 15:00'));
    w.act(r, 3, HR, 'APPROVE', vn('2027-03-07 11:00'));
    w.review(r, T02_REVIEWS[code], vn('2027-03-07 11:00'));
  }

  // ─── T03 — under review ────────────────────────────────────────────────────────────────────
  const planT03 = launch('WP-T03', 'WORK_PLAN', 'T03', vn('2027-03-01 09:00'));
  const reviewT03 = launch('WR-T03', 'WORK_REVIEW', 'T03', vn('2027-04-01 09:00'));
  for (const code of ['E015', 'E016', 'E017']) {
    const specs = tasksFor(code, false).map((t) => ({ ...t, progressPct: Math.min(100, t.progressPct + 40), progressStatus: 'InProgress' as const }));
    // The bid E016 was preparing was withdrawn by the customer: cancelled, its weight drops out (Q64).
    if (code === 'E016') specs[2] = { ...specs[2], progressPct: 10, cancelled: { at: vn('2027-03-15 10:00'), by: MANAGER, reason: 'Khách hàng dừng gói thầu, không còn cần hồ sơ.' } };
    w.plan(code, 'T03', 'Locked', { at: vn('2027-03-03 15:00'), by: MANAGER }, specs);
    const p = w.form(`WP:T03:${code}`, { type: 'WORK_PLAN', code, month: 'T03', launch: planT03, due: '2027-03-08', status: 'Completed', step: null, enteredAt: null });
    w.act(p, 2, code, 'SUBMIT', vn('2027-03-02 10:00'));
    w.act(p, 3, MANAGER, 'APPROVE', vn('2027-03-03 15:00'));
  }
  const at = reviewT03.launchedAt as string;
  const e015 = w.form('WR:T03:E015', { type: 'WORK_REVIEW', code: 'E015', month: 'T03', launch: reviewT03, due: '2027-04-13', status: 'Open', step: 1, enteredAt: at });
  w.review(e015, { tasks: [[90, null, null], [80, null, null], [85, null, null]], discipline: [90, null, null] });
  const e016 = w.form('WR:T03:E016', { type: 'WORK_REVIEW', code: 'E016', month: 'T03', launch: reviewT03, due: '2027-04-13', status: 'Open', step: 1, enteredAt: at });
  w.review(e016, { tasks: [], discipline: [null, null, null] });
  const sentAt = vn('2027-04-03 10:00');
  const e017 = w.form('WR:T03:E017', { type: 'WORK_REVIEW', code: 'E017', month: 'T03', launch: reviewT03, due: '2027-04-13', status: 'InProgress', step: 2, enteredAt: sentAt });
  w.act(e017, 1, 'E017', 'SUBMIT', sentAt);
  w.review(e017, { tasks: [[75, null, null], [70, null, null]], discipline: [80, null, null] });
  // E018 (hired 03-15, after March's plans were launched) had no March plan: the review launch skips
  // her (`NO_WORK_TASKS`, ASSUMPTION Q69) — there is nothing to score.

  // ─── T04 — planning ────────────────────────────────────────────────────────────────────────
  const planT04 = launch('WP-T04', 'WORK_PLAN', 'T04', vn('2027-04-01 09:00'));
  const dueT04 = '2027-04-08';
  for (const code of ['E015']) {
    w.plan(code, 'T04', 'Locked', { at: vn('2027-04-03 15:00'), by: MANAGER }, tasksFor(code, false));
    const p = w.form(`WP:T04:${code}`, { type: 'WORK_PLAN', code, month: 'T04', launch: planT04, due: dueT04, status: 'Completed', step: null, enteredAt: null });
    w.act(p, 2, code, 'SUBMIT', vn('2027-04-02 10:00'));
    w.act(p, 3, MANAGER, 'APPROVE', vn('2027-04-03 15:00'));
  }
  const fresh = (code: string) => tasksFor(code, false).map((t) => ({ ...t, progressPct: 0, progressStatus: 'NotStarted' as const }));
  // E018 (new hire): like her registration, HR launched her April plan on its own on 04-05; she is
  // still writing it — two tasks saved, 60% of the weight (Draft, step 1, deadline 04-08).
  const planT04NewHire = w.launch('WP-T04-E018', {
    type: 'WORK_PLAN',
    name: 'Kế hoạch công việc tháng 04/2027 — Lê Hoàng Phúc',
    month: 'T04',
    cycleId: g.cycleId,
    at: T.newHireLaunch,
    dueDays: WORK_PLAN_DUE_DAYS,
    filter: { ...filter, jobLevels: [], employeeIds: [org.employeeId('E018')] },
    by: HR,
  });
  w.plan('E018', 'T04', 'Draft', null, [
    { name: 'Học quy trình bán hàng và sản phẩm', weight: 40, progressPct: 0, progressStatus: 'NotStarted' },
    { name: 'Đi cùng trưởng nhóm gặp khách hàng', weight: 20, unitText: 'buổi', progressPct: 0, progressStatus: 'NotStarted' },
  ]);
  w.form('WP:T04:E018', { type: 'WORK_PLAN', code: 'E018', month: 'T04', launch: planT04NewHire, due: '2027-04-12', status: 'Open', step: 2, enteredAt: T.newHireLaunch });
  w.plan('E016', 'T04', 'Submitted', null, fresh('E016'));
  // Sent on 04-04, the last day of step 1's SLA; the manager's step runs to 04-07 (reminded from 04-06).
  const e016p = w.form('WP:T04:E016', { type: 'WORK_PLAN', code: 'E016', month: 'T04', launch: planT04, due: dueT04, status: 'InProgress', step: 3, enteredAt: vn('2027-04-04 10:00') });
  w.act(e016p, 2, 'E016', 'SUBMIT', vn('2027-04-04 10:00'));
  w.plan('E017', 'T04', 'Returned', null, fresh('E017'));
  const e017p = w.form('WP:T04:E017', { type: 'WORK_PLAN', code: 'E017', month: 'T04', launch: planT04, due: dueT04, status: 'InProgress', step: 2, enteredAt: vn('2027-04-05 15:00') });
  w.act(e017p, 2, 'E017', 'SUBMIT', vn('2027-04-03 10:00'));
  w.act(e017p, 3, MANAGER, 'RETURN', vn('2027-04-05 15:00'), 'Bổ sung việc kèm số lượng cụ thể cho từng khách hàng tồn.');
}
