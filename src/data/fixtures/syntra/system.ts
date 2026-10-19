import type { AuditAction, EntityName, Id, JsonValue, NotificationChannel, NotificationEvent, NotificationRefType, NotificationStatus } from '@/data/types';
import type { IdFn, SeedRows } from '../shared';
import { T, vn } from '../timeline';
import type { SyntraForms } from './forms';
import { AUTO_LOCK_AT, REENTERED, type SyntraGoals } from './goals';
import { DEPARTMENTS, type SyntraOrg } from './org';

/**
 * What T7's listeners would have written while the story happened: in-app notifications per
 * persona, two e-mails (queued and failed — P1 sends in-app only), and the audit trail of every
 * lock, unlock, cancellation and configuration change (BR-KPI-14).
 */
export function buildSystem(s: SeedRows, id: IdFn, org: SyntraOrg, g: SyntraGoals, f: SyntraForms, templateOf: (event: string, channel?: string) => Id) {
  const user = org.userId;

  const notify = (
    key: string,
    n: { event: NotificationEvent; to: string; refType: NotificationRefType; refId: Id; subject: string; body: string; at: string; channel?: NotificationChannel; status?: NotificationStatus; readAt?: string },
  ) => {
    const channel = n.channel ?? 'InApp';
    const status = n.status ?? (n.readAt ? 'Read' : 'Sent');
    s.add('Notification', {
      id: id('Notification', key),
      templateId: templateOf(n.event, channel),
      eventCode: n.event,
      recipientUserId: user(n.to),
      refType: n.refType,
      refId: n.refId,
      subject: n.subject,
      body: n.body,
      status,
      createdAt: n.at,
      sentAt: status === 'Sent' || status === 'Read' ? n.at : null,
      readAt: n.readAt ?? null,
    });
  };

  // The T03 evaluation launch, to every subject.
  const t03 = f.launches.evaluation.T03;
  for (const form of s.rows.FormInstance.filter((x) => x.launchId === t03.id)) {
    const code = s.rows.Employee.find((e) => e.id === form.subjectEmployeeId)?.employeeCode as string;
    notify(`launch-T03-${code}`, {
      event: 'FORM_LAUNCHED', to: code, refType: 'Launch', refId: t03.id,
      subject: 'Đợt Đánh giá KPI tháng 03/2027 đã bắt đầu',
      body: 'Quy trình gồm 3 bước; hiện bạn ở bước 1 – Tự đánh giá. Hạn hoàn thành: 13/04/2027.',
      at: T.evalT03,
      readAt: ['E016', 'E019', 'E022', 'E031'].includes(code) ? vn('2027-04-01 10:15') : undefined,
    });
  }
  // Forms waiting for a manager or HR at SEED_NOW.
  const assigned: [string, string, string, string][] = [
    ['EVAL:T03:E015', 'E006', 'Mai Quang Huy', '2027-04-03 10:00'],
    ['EVAL:T03:E016', 'E006', 'Nguyễn Văn An', '2027-04-03 14:00'],
    ['EVAL:T03:E029', 'E010', 'Lưu Thị Nhung', '2027-04-04 10:00'],
    ['EVAL:T03:E034', 'E012', 'Triệu Thị Hạnh', '2027-04-05 10:00'],
    ['EVAL:T03:E020', 'E035', 'Lâm Văn Phú', '2027-04-05 14:00'],
    ['EVAL:T03:E038', 'E035', 'Lò Văn Hiếu', '2027-04-05 16:00'],
  ];
  for (const [formKey, to, subjectName, at] of assigned) {
    notify(`assigned-${formKey}`, {
      event: 'STEP_ASSIGNED', to, refType: 'Form', refId: f.form(formKey).id,
      subject: 'Bạn có phiếu Đánh giá KPI cần xử lý',
      body: `Phiếu Đánh giá KPI của ${subjectName} đang chờ bạn xử lý. Hạn: 13/04/2027.`,
      at: vn(at),
    });
  }
  notify('returned-E021', {
    event: 'RETURNED', to: 'E021', refType: 'GoalPlan', refId: g.plan('E021').id,
    subject: 'Phiếu Đăng ký KPI đã bị trả lại',
    body: 'Hoàng Ngọc Lan đã trả lại phiếu Đăng ký KPI của Đinh Thị Thảo. Lý do: Cần bổ sung chỉ tiêu học hỏi & phát triển và liên kết với KPI phòng.',
    at: T.registrationReturn,
  });
  notify('returned-T02-E041', {
    event: 'RETURNED', to: 'E014', refType: 'Form', refId: f.form('EVAL:T02:E041').id,
    subject: 'Phiếu Đánh giá KPI đã bị trả lại',
    body: 'Kha Thị Duyên đã trả lại phiếu Đánh giá KPI của Văn Thị Nga. Lý do: Điểm quản lý chưa khớp số liệu đối soát, đề nghị chấm lại.',
    at: vn('2027-03-06 10:00'),
    readAt: vn('2027-03-06 11:30'),
  });
  notify('remind-GC-open', {
    event: 'DEADLINE_REMIND', to: 'E010', refType: 'Form', refId: f.form('GC:open').id,
    subject: 'Sắp đến hạn bước Quản lý duyệt điều chỉnh',
    body: 'Hạn của bước Quản lý duyệt điều chỉnh trên phiếu của Lưu Thị Nhung là 02/04/2027.',
    at: T.evalT03,
  });
  // P1 sends no e-mail: one written and still queued, one that failed.
  notify('email-launch-T03-E016', {
    event: 'FORM_LAUNCHED', to: 'E016', refType: 'Launch', refId: t03.id, channel: 'Email', status: 'Queued',
    subject: '[Syntra KPI] Khởi chạy Đánh giá KPI tháng 03/2027', body: 'Kính gửi Nguyễn Văn An, đợt Đánh giá KPI tháng 03/2027 đã bắt đầu.', at: T.evalT03,
  });
  notify('email-launch-T03-E017', {
    event: 'FORM_LAUNCHED', to: 'E017', refType: 'Launch', refId: t03.id, channel: 'Email', status: 'Failed',
    subject: '[Syntra KPI] Khởi chạy Đánh giá KPI tháng 03/2027', body: 'Kính gửi Trần Thị Bình, đợt Đánh giá KPI tháng 03/2027 đã bắt đầu.', at: T.evalT03,
  });

  // ─── Audit log ──────────────────────────────────────────────────────────────────────────────
  const audit = (key: string, e: { entity: EntityName; entityId: Id; action: AuditAction; by: string | null; at: string; before?: JsonValue; after?: JsonValue; reason?: string }) =>
    s.add('AuditLog', {
      id: id('AuditLog', key),
      userId: e.by === null ? null : user(e.by),
      onBehalfOfUserId: null,
      entityName: e.entity,
      entityId: e.entityId,
      action: e.action,
      beforeData: e.before ?? null,
      afterData: e.after ?? null,
      reason: e.reason ?? null,
      createdAt: e.at,
    });
  audit('cycle-2027-create', { entity: 'PerformanceCycle', entityId: g.cycleId, action: 'CREATE', by: 'E035', at: T.cycle2027Created, after: { name: 'KPI 2027', status: 'Planning' } });
  audit('cycle-2027-active', { entity: 'PerformanceCycle', entityId: g.cycleId, action: 'UPDATE', by: 'E035', at: T.cycleActivated, before: { status: 'Planning' }, after: { status: 'Active' } });
  audit('plan-SYN-lock', { entity: 'GoalPlan', entityId: g.plan('SYN').id, action: 'LOCK', by: 'E035', at: T.unitPlansDone, before: { status: 'Approved' }, after: { status: 'Locked' } });
  for (const dept of DEPARTMENTS) {
    audit(`plan-${dept}-lock`, { entity: 'GoalPlan', entityId: g.plan(dept).id, action: 'LOCK', by: 'E035', at: T.unitPlansDone, before: { status: 'Approved' }, after: { status: 'Locked' } });
  }
  for (const plan of s.rows.GoalPlan.filter((p) => p.ownerType === 'Employee' && p.cycleId === g.cycleId)) {
    const code = s.rows.Employee.find((e) => e.id === plan.ownerEmployeeId)?.employeeCode as string;
    const autoLock = AUTO_LOCK_AT[code];
    if (autoLock) {
      audit(`plan-${code}-autolock`, { entity: 'GoalPlan', entityId: plan.id, action: 'LOCK', by: null, at: autoLock, after: { status: 'Locked' }, reason: 'Quá hạn bước đăng ký (tự khóa)' });
      if ((REENTERED as readonly string[]).includes(code)) {
        audit(`plan-${code}-unlock`, { entity: 'GoalPlan', entityId: plan.id, action: 'UNLOCK', by: 'E035', at: T.registrationUnlock, before: { status: 'Locked' }, after: { status: plan.status }, reason: 'Gia hạn đăng ký KPI đến 15/04/2027 theo đề nghị của trưởng phòng.' });
      }
    } else if (plan.status === 'Locked') {
      audit(`plan-${code}-lock`, { entity: 'GoalPlan', entityId: plan.id, action: 'LOCK', by: code === 'E035' ? 'E012' : 'E035', at: T.registrationLocked, before: { status: 'Approved' }, after: { status: 'Locked' } });
    }
  }
  audit('form-T03-E024-cancel', { entity: 'FormInstance', entityId: f.form('EVAL:T03:E024').id, action: 'UPDATE', by: 'E035', at: vn('2027-04-02 10:00'), before: { status: 'Open' }, after: { status: 'Cancelled' }, reason: 'Nhân viên nghỉ việc từ 10/03/2027, không đánh giá tháng 3.' });
  audit('launch-round-1-cancel', { entity: 'FormLaunch', entityId: id('FormLaunch', 'GS-2027-round-1'), action: 'UPDATE', by: 'E035', at: vn('2027-03-10 16:00'), before: { status: 'Scheduled' }, after: { status: 'Cancelled' }, reason: 'Gộp vào đợt bổ sung tháng 4.' });
  audit('delegation-revoke', { entity: 'Delegation', entityId: f.delegations.revoked.id, action: 'UPDATE', by: 'E011', at: vn('2027-03-20 10:00'), before: { revokedAt: null }, after: { revokedAt: vn('2027-03-20 10:00') } });
}
