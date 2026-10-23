import type { CyclePeriod, Goal, Id, RoleCode, Tenant } from '@/data/types';
import { targetForPeriod } from '@/lib/calcRules';
import { idsFor, seedId } from './ids';
import { ResultScript } from './results';
import { addLibrary, addNotificationTemplates, addRating, addRoles, addWorkflows, addWorkScoring, goalFromKpi, SeedRows } from './shared';
import { workSeed } from './work';
import { vn } from './timeline';
import type { TenantSeed } from './types';

/**
 * Demo Co — the second tenant. Small, but it has at least one row in EVERY collection Syntra uses
 * and it REUSES Syntra's codes (unit KD, role codes, KPI codes, login-style names), so the
 * tenant-isolation tests can never pass on an empty list or a code that happens to be unique
 * (system-architect review, Phase 1.2). It has its own full persona set (Phase 1.3).
 */
export const DEMO_TENANT_ID = seedId('tenant', 'DEMO');
export const demoId = idsFor('demo');

const KPI_CODES = new Set(['KPI-DOANH-THU', 'KPI-SO-KH', 'KPI-TL-KH-CU', 'KPI-CR', 'KPI-AOV', 'KPI-DUT-HANG']);

export function buildDemoCo(): TenantSeed {
  const tenant: Tenant = { id: DEMO_TENANT_ID, code: 'DEMO', name: 'Demo Co', timezone: 'Asia/Ho_Chi_Minh', status: 'Active', createdAt: vn('2026-10-05 09:00') };
  const id = demoId;
  const s = new SeedRows(tenant.id);

  // ─── Org and personas ────────────────────────────────────────────────────────────────────────
  const unit = (code: string) => id('OrgUnit', code);
  s.add('OrgUnit', { id: unit('DEMO'), parentId: null, code: 'DEMO', name: 'Công ty Demo', unitType: 'Company', headEmployeeId: id('Employee', 'D001'), effectiveFrom: '2020-01-01', effectiveTo: null, status: 'Active' });
  s.add('OrgUnit', { id: unit('KD'), parentId: unit('DEMO'), code: 'KD', name: 'Phòng Kinh doanh', unitType: 'Department', headEmployeeId: id('Employee', 'D002'), effectiveFrom: '2020-01-01', effectiveTo: null, status: 'Active' });
  for (const [code, name, jobLevel] of [['CEO', 'Giám đốc', 'Director'], ['HEAD', 'Trưởng phòng', 'DeptHead'], ['STAFF', 'Nhân viên', 'Staff']] as const) {
    s.add('JobPosition', { id: id('JobPosition', code), code, name, jobLevel, status: 'Active' });
  }
  const people: [code: string, name: string, login: string, unitCode: string, position: string, manager: string | null, role: RoleCode | null][] = [
    ['D003', 'Phạm Thị Lan', 'lan.pt', 'KD', 'STAFF', 'D002', null],
    ['D001', 'Đoàn Văn Minh', 'minh.dv', 'DEMO', 'CEO', null, 'BOD'],
    ['D002', 'Hứa Thị Hoa', 'hoa.ht', 'KD', 'HEAD', 'D001', 'MANAGER'],
    ['D004', 'Lương Văn Tâm', 'tam.lv', 'DEMO', 'STAFF', 'D001', 'HR'],
    ['D005', 'Bạch Thị Thu', 'thu.bt', 'DEMO', 'STAFF', 'D001', 'CNB'],
    ['D006', 'Khổng Văn Hải', 'hai.kv', 'DEMO', 'STAFF', 'D001', 'ADMIN'],
  ];
  const roles = addRoles(s, id);
  for (const [code, name, login, unitCode, position, manager, role] of people) {
    s.add('Employee', { id: id('Employee', code), employeeCode: code, fullName: name, email: `${login}@demo.example`, hireDate: '2022-01-03', employmentStatus: 'Official', leftOn: null });
    s.add('EmployeeAssignment', { id: id('EmployeeAssignment', code), employeeId: id('Employee', code), orgUnitId: unit(unitCode), positionId: id('JobPosition', position), managerEmployeeId: manager ? id('Employee', manager) : null, isPrimary: true, effectiveFrom: '2022-01-03', effectiveTo: null });
    s.add('UserAccount', { id: id('UserAccount', code), employeeId: id('Employee', code), login, displayName: name, authProvider: 'Local', status: 'Active', lastLoginAt: null });
    s.add('UserRole', { id: id('UserRole', code, 'EMPLOYEE'), userId: id('UserAccount', code), roleId: roles.EMPLOYEE.id, scopeType: 'Self', scopeOrgUnitId: null, includeChildren: false });
    if (role === 'MANAGER') s.add('UserRole', { id: id('UserRole', code, role), userId: id('UserAccount', code), roleId: roles.MANAGER.id, scopeType: 'OrgUnit', scopeOrgUnitId: unit('KD'), includeChildren: true });
    else if (role) s.add('UserRole', { id: id('UserRole', code, role), userId: id('UserAccount', code), roleId: roles[role].id, scopeType: 'Tenant', scopeOrgUnitId: null, includeChildren: false });
  }
  const user = (code: string) => id('UserAccount', code);

  // ─── Catalogues ─────────────────────────────────────────────────────────────────────────────
  const lib = addLibrary(s, id, { unitIdOf: (code) => (code === 'KD' ? unit('KD') : null), kpiCodes: KPI_CODES, templateCodes: new Set(['TPL-CONG-TY', 'TPL-CUA-HANG']) });
  const wf = addWorkflows(s, id);
  const rating = addRating(s, id, '2027-01-01');
  const templateOf = addNotificationTemplates(s, id);

  // ─── Cycle, plans, goals ────────────────────────────────────────────────────────────────────
  const cycleId = id('PerformanceCycle', '2027');
  s.add('PerformanceCycle', { id: cycleId, name: 'KPI 2027', startDate: '2027-01-01', endDate: '2027-12-31', ratingScaleId: rating.scaleId, status: 'Active' });
  const t01 = s.add('CyclePeriod', { id: id('CyclePeriod', 'T01'), cycleId, periodType: 'Month', label: 'T01', startDate: '2027-01-01', endDate: '2027-01-31', inputDeadline: '2027-02-05', evalDeadline: '2027-02-13', isLocked: true });
  s.add('CyclePeriod', { id: id('CyclePeriod', 'T02'), cycleId, periodType: 'Month', label: 'T02', startDate: '2027-02-01', endDate: '2027-02-28', inputDeadline: '2027-03-05', evalDeadline: '2027-03-13', isLocked: false });

  const company = s.add('GoalPlan', { id: id('GoalPlan', 'DEMO'), cycleId, planType: 'KPI', ownerType: 'Company', ownerOrgUnitId: unit('DEMO'), ownerEmployeeId: null, status: 'Locked', lockedAt: vn('2026-12-20 10:00') });
  const staffPlan = s.add('GoalPlan', { id: id('GoalPlan', 'D003'), cycleId, planType: 'KPI', ownerType: 'Employee', ownerOrgUnitId: null, ownerEmployeeId: id('Employee', 'D003'), status: 'Locked', lockedAt: vn('2027-01-11 15:00') });
  const kgi = s.add('Kgi', { id: id('Kgi', 'D003', 1), goalPlanId: staffPlan.id, name: 'Tăng trưởng doanh thu', description: null, sortOrder: 1, targetValue: null, unitId: null });
  for (const n of [2, 3]) s.add('Kgi', { id: id('Kgi', 'D003', n), goalPlanId: staffPlan.id, name: n === 2 ? 'Giữ chân khách hàng' : 'Nâng hiệu quả bán hàng', description: null, sortOrder: n, targetValue: null, unitId: null });
  const base = { startDate: '2027-01-01', dueDate: '2027-12-31' };
  const companyRevenue = s.add('Goal', goalFromKpi(lib, company, id('Goal', 'DEMO', 1), 'KPI-DOANH-THU', 1, { ...base, weight: 100, target: 24_000_000_000, ownerEmployeeId: id('Employee', 'D001') }));
  const goals: Goal[] = (
    [
      ['KPI-DOANH-THU', 30, 7_200_000_000, undefined],
      ['KPI-SO-KH', 25, 6_000, undefined],
      ['KPI-TL-KH-CU', 20, 30, 'CM-LEVELS'],
      ['KPI-CR', 15, 8, undefined],
      ['KPI-DUT-HANG', 10, 0, undefined],
    ] as const
  ).map(([code, weight, target, method], i) =>
    s.add('Goal', goalFromKpi(lib, staffPlan, id('Goal', 'D003', i + 1), code, i + 1, { ...base, weight, target, method, kgiId: kgi.id, ownerEmployeeId: id('Employee', 'D003') })),
  );
  s.add('GoalTargetLevel', { id: id('GoalTargetLevel', 'L1'), goalId: goals[2].id, levelCode: 'L1', targetValue: 20, targetText: null, scorePct: 0 });
  s.add('GoalTargetLevel', { id: id('GoalTargetLevel', 'L2'), goalId: goals[2].id, levelCode: 'L2', targetValue: 30, targetText: null, scorePct: 100 });
  s.add('GoalAlignment', { id: id('GoalAlignment', 1), childGoalId: goals[0].id, parentGoalId: companyRevenue.id, alignmentType: 'CASCADE', contributionPct: null, allocatedValue: 7_200_000_000 });
  s.add('GoalPeriodTarget', { id: id('GoalPeriodTarget', 1), goalId: goals[0].id, periodId: t01.id, targetValue: 600_000_000 });

  // ─── Actuals ────────────────────────────────────────────────────────────────────────────────
  const erp = lib.source('ERP_SALE');
  const connectionId = id('IntegrationConnection', 'ERP_SALE');
  s.add('IntegrationConnection', { id: connectionId, dataSourceId: erp.id, endpoint: 'https://erp.demo.example/api', authType: 'APIKey', secretRef: 'vault://demo/erp', scheduleCron: null, status: 'Inactive' });
  s.add('DataMapping', { id: id('DataMapping', 1), connectionId, kpiDefId: lib.kpi('KPI-DOANH-THU').id, queryOrPath: '/kpi/KPI-DOANH-THU', orgDimension: 'employee_code', transformExpr: null });
  const syncRun = s.add('SyncRun', { id: id('SyncRun', 'T01'), connectionId, periodId: t01.id, startedAt: vn('2027-02-01 06:00'), finishedAt: vn('2027-02-01 06:01'), recordsOk: 1, recordsError: 0, status: 'Succeeded', errorLog: null });
  const file = s.add('FileObject', { id: id('FileObject', 1), storageKey: 'seed/demo-so-lieu-T01.xlsx', fileName: 'demo-so-lieu-T01.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: 8_120, uploadedBy: user('D004'), uploadedAt: vn('2027-02-01 07:20') });
  const batch = s.add('ImportBatch', {
    id: id('ImportBatch', 'T01'), importType: 'Actual', cycleId, fileId: file.id, uploadedBy: user('D004'),
    rows: [{ rowNo: 2, goalId: goals[1].id, login: null, kpiCode: null, periodLabel: 'T01', actualValue: 540, actualText: null, note: null, evidenceUrl: null }],
    rowsTotal: 1, rowsError: 0, errors: [], status: 'Committed', createdAt: vn('2027-02-01 07:30'),
  });
  const actual = (n: number, goal: Goal, value: number, extra: object) =>
    s.add('GoalActual', { id: id('GoalActual', n), goalId: goal.id, periodId: t01.id, actualValue: value, actualText: null, sourceType: 'MANUAL', batchId: null, syncRunId: null, enteredBy: null, note: null, recordedAt: vn('2027-02-01 08:30'), isCurrent: true, ...extra });
  const revenue = actual(1, goals[0], 640_000_000, { sourceType: 'API', syncRunId: syncRun.id, recordedAt: vn('2027-02-01 06:01') });
  actual(2, goals[1], 540, { sourceType: 'EXCEL', batchId: batch.id, enteredBy: user('D004'), recordedAt: vn('2027-02-01 08:00') });
  actual(3, goals[2], 28, { enteredBy: user('D003') });
  actual(4, goals[3], 7.5, { enteredBy: user('D003') });
  actual(5, goals[4], 1, { enteredBy: user('D003') });
  s.add('Evidence', { id: id('Evidence', 1), goalId: goals[0].id, periodId: t01.id, actualId: revenue.id, fileId: null, url: 'https://drive.demo.example/bao-cao-T01', note: null, uploadedBy: user('D003'), uploadedAt: vn('2027-02-02 09:00') });

  // ─── Forms ──────────────────────────────────────────────────────────────────────────────────
  const rule = s.add('FormLaunchRule', { id: id('FormLaunchRule', 1), workflowId: wf.id('KPI_EVAL'), name: 'Đánh giá KPI hằng tháng', triggerEvent: 'PERIOD_END', periodType: 'Month', offsetDays: 1, dueDays: 12, recipientMode: 'ALL', recipientFilter: null, isActive: true });
  const launch = s.add('FormLaunch', { id: id('FormLaunch', 'T01'), workflowId: wf.id('KPI_EVAL'), formType: 'KPI_EVAL', name: 'Đánh giá KPI tháng 01/2027', timing: 'RECURRING', scheduledAt: vn('2027-02-01 09:00'), launchRuleId: rule.id, cycleId, periodId: t01.id, dueDays: 12, recipientMode: 'ALL', recipientFilter: null, status: 'Launched', launchedAt: vn('2027-02-01 09:00'), createdBy: null, createdAt: vn('2027-02-01 09:00'), startStepNo: null });
  const form = (key: string, f: { type: 'GOAL_SETTING' | 'GOAL_CHANGE' | 'KPI_EVAL'; periodId: Id | null; launchId: Id | null; at: string; due: string }) =>
    s.add('FormInstance', { id: id('FormInstance', key), workflowId: wf.id(f.type), formType: f.type, subjectEmployeeId: id('Employee', 'D003'), goalPlanId: staffPlan.id, workPlanId: null, periodId: f.periodId, currentStepId: null, currentStepEnteredAt: null, overdueHandledAt: null, status: 'Completed', dueDate: f.due, launchedAt: f.at, launchId: f.launchId });
  const step = (formId: Id, type: 'GOAL_SETTING' | 'GOAL_CHANGE' | 'KPI_EVAL', n: number, by: string, action: 'SUBMIT' | 'APPROVE', at: string, delegationId: Id | null = null, onBehalfOf: string | null = null) =>
    s.add('FormStepAction', { id: id('FormStepAction', formId, n), formId, stepId: wf.step(type, n).id, actorUserId: user(by), onBehalfOfUserId: onBehalfOf ? user(onBehalfOf) : null, delegationId, action, comment: null, actedAt: at });

  const delegation = s.add('Delegation', { id: id('Delegation', 1), fromUserId: user('D002'), toUserId: user('D001'), formType: 'KPI_EVAL', validFrom: '2027-02-01', validTo: '2027-02-10', revokedAt: null });
  const gs = form('GS', { type: 'GOAL_SETTING', periodId: null, launchId: null, at: vn('2027-01-04 09:00'), due: '2027-01-18' });
  step(gs.id, 'GOAL_SETTING', 1, 'D002', 'SUBMIT', vn('2027-01-05 10:00'));
  step(gs.id, 'GOAL_SETTING', 2, 'D003', 'SUBMIT', vn('2027-01-07 10:00'));
  step(gs.id, 'GOAL_SETTING', 3, 'D002', 'APPROVE', vn('2027-01-09 10:00'));
  step(gs.id, 'GOAL_SETTING', 4, 'D004', 'APPROVE', vn('2027-01-11 15:00'));
  const ev = form('EVAL-T01', { type: 'KPI_EVAL', periodId: t01.id, launchId: launch.id, at: vn('2027-02-01 09:00'), due: '2027-02-13' });
  step(ev.id, 'KPI_EVAL', 1, 'D003', 'SUBMIT', vn('2027-02-03 10:00'));
  step(ev.id, 'KPI_EVAL', 2, 'D001', 'SUBMIT', vn('2027-02-05 10:00'), delegation.id, 'D002');
  step(ev.id, 'KPI_EVAL', 3, 'D004', 'APPROVE', vn('2027-02-07 10:00'));
  for (const goal of goals) {
    // No actual on the form → the system has no % (PEND-07); the manager decides with a comment, HR records it.
    const targetSnapshot = targetForPeriod(goal, s.rows.GoalPeriodTarget, t01.id);
    s.add('EvaluationItem', { id: id('EvaluationItem', goal.id), formId: ev.id, goalId: goal.id, actualSnapshot: null, actualTextSnapshot: null, actualValue: null, actualText: null, actualEnteredBy: null, submittedActualValue: null, submittedActualText: null, targetSnapshot, selfAchievementPct: null, selfComment: 'Hoàn thành.', managerAchievementPct: 95, managerComment: 'Đồng ý.', finalAchievementPct: 95, finalComment: null });
  }
  const gc = form('GC', { type: 'GOAL_CHANGE', periodId: null, launchId: null, at: vn('2027-02-15 09:00'), due: '2027-02-25' });
  step(gc.id, 'GOAL_CHANGE', 1, 'D003', 'SUBMIT', vn('2027-02-15 10:00'));
  step(gc.id, 'GOAL_CHANGE', 2, 'D002', 'APPROVE', vn('2027-02-16 10:00'));
  step(gc.id, 'GOAL_CHANGE', 3, 'D004', 'APPROVE', vn('2027-02-17 10:00'));
  s.add('GoalChangeItem', { id: id('GoalChangeItem', 1), formId: gc.id, goalId: goals[3].id, changeType: 'CANCEL', proposed: null, reason: 'Chỉ tiêu không còn phù hợp.' });

  // ─── System ─────────────────────────────────────────────────────────────────────────────────
  s.add('Notification', { id: id('Notification', 1), templateId: templateOf('FORM_LAUNCHED'), eventCode: 'FORM_LAUNCHED', recipientUserId: user('D003'), refType: 'Launch', refId: launch.id, subject: 'Đợt Đánh giá KPI tháng 01/2027 đã bắt đầu', body: 'Hạn hoàn thành: 13/02/2027.', status: 'Read', createdAt: vn('2027-02-01 09:00'), sentAt: vn('2027-02-01 09:00'), readAt: vn('2027-02-01 10:00') });
  s.add('AuditLog', { id: id('AuditLog', 1), userId: user('D004'), onBehalfOfUserId: null, entityName: 'GoalPlan', entityId: staffPlan.id, action: 'LOCK', beforeData: { status: 'Approved' }, afterData: { status: 'Locked' }, reason: null, createdAt: vn('2027-01-11 15:00') });

  // ─── Monthly work (PEND-14): D003's January, planned, reviewed and recorded ───────────────────
  addWorkScoring(s, id);
  const periodOf = (label: string) => s.rows.CyclePeriod.find((p) => p.label === label) as CyclePeriod;
  const w = workSeed({ s, id, wf, user, employee: (code) => id('Employee', code), period: periodOf });
  const all = { by: 'D004', cycleId, filter: null };
  const wpT01 = w.launch('WP-T01', { ...all, type: 'WORK_PLAN', name: 'Kế hoạch công việc tháng 01/2027', month: 'T01', at: vn('2027-01-04 09:00'), dueDays: 7 });
  const wrT01 = w.launch('WR-T01', { ...all, type: 'WORK_REVIEW', name: 'Đánh giá công việc tháng 01/2027', month: 'T01', at: vn('2027-02-01 09:00'), dueDays: 12 });
  w.plan('D003', 'T01', 'Locked', { at: vn('2027-01-06 15:00'), by: 'D002' }, [
    { name: 'Mở rộng 3 đại lý mới', weight: 70, unitText: 'đại lý', progressPct: 100, progressStatus: 'Done' },
    { name: 'Báo cáo thị trường tháng', weight: 30, progressPct: 100, progressStatus: 'Done' },
  ]);
  const wp = w.form('WP:T01:D003', { type: 'WORK_PLAN', code: 'D003', month: 'T01', launch: wpT01, due: '2027-01-11', status: 'Completed', step: null, enteredAt: null });
  w.act(wp, 1, 'D003', 'SUBMIT', vn('2027-01-05 10:00'));
  w.act(wp, 2, 'D002', 'APPROVE', vn('2027-01-06 15:00'));
  const wr = w.form('WR:T01:D003', { type: 'WORK_REVIEW', code: 'D003', month: 'T01', launch: wrT01, due: '2027-02-13', status: 'Completed', step: null, enteredAt: null });
  w.act(wr, 1, 'D003', 'SUBMIT', vn('2027-02-03 11:00'));
  w.act(wr, 2, 'D002', 'SUBMIT', vn('2027-02-05 11:00'));
  w.act(wr, 3, 'D004', 'APPROVE', vn('2027-02-07 11:00'));
  w.review(wr, { tasks: [[90, 85, 85], [100, 95, 95]], discipline: [90, 90, 90] }, vn('2027-02-07 11:00'));
  // February approved, not yet reviewed: what the tenant-isolation tests launch a review on.
  const wpT02 = w.launch('WP-T02', { ...all, type: 'WORK_PLAN', name: 'Kế hoạch công việc tháng 02/2027', month: 'T02', at: vn('2027-02-01 09:00'), dueDays: 7 });
  w.plan('D003', 'T02', 'Locked', { at: vn('2027-02-03 15:00'), by: 'D002' }, [
    { name: 'Ký hợp đồng với 2 đại lý mới', weight: 60, unitText: 'đại lý', progressPct: 50, progressStatus: 'InProgress' },
    { name: 'Báo cáo thị trường tháng', weight: 40, progressPct: 100, progressStatus: 'Done' },
  ]);
  const wp2 = w.form('WP:T02:D003', { type: 'WORK_PLAN', code: 'D003', month: 'T02', launch: wpT02, due: '2027-02-08', status: 'Completed', step: null, enteredAt: null });
  w.act(wp2, 1, 'D003', 'SUBMIT', vn('2027-02-02 10:00'));
  w.act(wp2, 2, 'D002', 'APPROVE', vn('2027-02-03 15:00'));

  // ─── Results (through resultRules, like Syntra's): T01 calculated and finalised on its deadline ─
  const results = new ResultScript(s, id);
  results.calculate(t01.id);
  results.finalizeAll(t01.id, vn('2027-02-13 09:00'));

  return { tenant, rows: s.rows };
}
