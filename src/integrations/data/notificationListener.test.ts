import { describe, expect, it, vi } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import type { Id, KpiNotification, NotificationEvent, PersonFormAction, RecipientFilter } from '@/data/types';
import { newGateway } from './mock/gateway.test-util';
import type { DataGateway } from './types';

/**
 * T7's notification listener end to end through the mock, against the seed (BR-KPI-45…47): who is
 * told what, once, in which tenant — and what is never told.
 */

const S = SYNTRA.tenantId;
const u = (code: string) => SYNTRA.user(code);
const emp = (code: string) => SYNTRA.employee(code);
const hr = u(SYNTRA.personas.hr);
const cycle2027 = SYNTRA.id('PerformanceCycle', '2027');
const cycle2028 = SYNTRA.id('PerformanceCycle', '2028');
const T03 = SYNTRA.id('CyclePeriod', 2027, 'T03');
const T04 = SYNTRA.id('CyclePeriod', 2027, 'T04');
const formId = (key: string) => SYNTRA.id('FormInstance', key);
const NOBODY: RecipientFilter = { orgUnitIds: [], includeChildUnits: false, positionIds: [], jobLevels: [], employmentStatuses: [], employeeIds: [] };

function setup() {
  const diagnostics: unknown[] = [];
  const { gateway } = newGateway({ notifications: true, onDiagnostic: (_, error) => void diagnostics.push(error) });
  return { gateway, diagnostics };
}

type Gw = ReturnType<typeof setup>['gateway'];

/** Every notification of `userId` (in Syntra) written AFTER the seed. */
async function inbox(gw: Gw, userId: Id, event?: NotificationEvent): Promise<KpiNotification[]> {
  await gw.notificationsSettled();
  const seeded = new Set(SEEDED_IDS);
  return (await gw.system.listNotifications(S, userId, {}, { limit: 500 })).items.filter(
    (n) => !seeded.has(n.id) && (event === undefined || n.eventCode === event),
  );
}
let SEEDED_IDS: Id[] = [];
async function rememberSeed(gw: DataGateway) {
  const users = await gw.org.listUserAccounts(S);
  const pages = await Promise.all(users.map((x) => gw.system.listNotifications(S, x.id, {}, { limit: 500 })));
  SEEDED_IDS = pages.flatMap((p) => p.items.map((n) => n.id));
}

async function act(gw: Gw, actor: Id, id: Id, action: PersonFormAction, comment: string | null = null, onBehalfOf: Id | null = null) {
  const form = await gw.forms.getForm(S, id);
  return gw.forms.act(S, actor, { formId: id, expectedStepId: form.currentStepId as Id, action, comment, onBehalfOfUserId: onBehalfOf, delegationId: null });
}

const workflowOf = async (gw: Gw, type: 'GOAL_SETTING' | 'KPI_EVAL') => (await gw.forms.listWorkflows(S, type))[0].id;

describe('form.launched', () => {
  it('an evaluation launch tells each subject once; their own self-assessment step adds nothing', async () => {
    const { gateway, diagnostics } = setup();
    await rememberSeed(gateway);
    const launch = await gateway.forms.createLaunch(S, hr, {
      workflowId: await workflowOf(gateway, 'KPI_EVAL'), name: 'Đánh giá KPI tháng 4/2027', cycleId: cycle2027, periodId: T04, dueDays: 12,
      recipientMode: 'FILTER', recipientFilter: { ...NOBODY, employeeIds: [emp('E015'), emp('E016')] }, timing: 'NOW',
    } as never);

    const [notice, ...rest] = await inbox(gateway, u('E016'));
    expect(rest).toEqual([]);
    expect(notice).toMatchObject({ eventCode: 'FORM_LAUNCHED', refType: 'Launch', refId: launch.id, status: 'Sent', readAt: null });
    expect(notice.subject).toBe('Đợt Đánh giá KPI tháng 04/2027 đã bắt đầu');
    expect(notice.body).toMatch(/^Quy trình gồm 3 bước; hiện bạn ở bước 1 – Tự đánh giá\. Hạn hoàn thành: \d{2}\/04\/2027\.$/);
    expect(await inbox(gateway, u('E015'), 'FORM_LAUNCHED')).toHaveLength(1);
    // HR launched it: HR is told nothing; the manager has nothing to do yet.
    expect(await inbox(gateway, hr)).toEqual([]);
    expect(await inbox(gateway, u('E006'))).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it('a registration launch also tells the direct manager — once per report — that step 1 is theirs', async () => {
    const { gateway } = setup();
    await rememberSeed(gateway);
    await gateway.forms.createLaunch(S, hr, {
      workflowId: await workflowOf(gateway, 'GOAL_SETTING'), name: 'Đăng ký KPI 2028', cycleId: cycle2028, periodId: null, dueDays: 14,
      recipientMode: 'FILTER', recipientFilter: { ...NOBODY, employeeIds: [emp('E015'), emp('E016')] }, timing: 'NOW',
    } as never);

    const manager = await inbox(gateway, u('E006'));
    expect(manager.map((n) => n.eventCode)).toEqual(['STEP_ASSIGNED', 'STEP_ASSIGNED']);
    expect(manager.every((n) => n.refType === 'Form')).toBe(true);
    expect(manager.map((n) => n.body).sort()).toEqual([
      expect.stringMatching(/^Phiếu Đăng ký KPI của .+ đang chờ bạn ở bước Quản lý giao chỉ tiêu\. Hạn: /),
      expect.stringMatching(/^Phiếu Đăng ký KPI của .+ đang chờ bạn ở bước Quản lý giao chỉ tiêu\. Hạn: /),
    ]);
    const [own] = await inbox(gateway, u('E016'));
    expect(own).toMatchObject({ eventCode: 'FORM_LAUNCHED', subject: 'Đợt Đăng ký KPI KPI 2028 đã bắt đầu' });
  });
});

describe('form.stepActed', () => {
  it('a RETURN tells the person it went back to, with who returned it and why; nobody else', async () => {
    const { gateway } = setup();
    await rememberSeed(gateway);
    const id = formId('EVAL:T03:E016'); // at the manager E006
    await act(gateway, u('E006'), id, 'RETURN', 'Bổ sung bằng chứng cho chỉ tiêu doanh thu');

    const [notice, ...rest] = await inbox(gateway, u('E016'));
    expect(rest).toEqual([]);
    expect(notice).toMatchObject({ eventCode: 'RETURNED', refType: 'Form', refId: id });
    expect(notice.body).toMatch(/đã trả lại phiếu Đánh giá KPI của Nguyễn Văn An\. Lý do: Bổ sung bằng chứng cho chỉ tiêu doanh thu\.$/);
    expect(await inbox(gateway, u('E006'))).toEqual([]);

    // The employee sends it again: the manager is told it is theirs; the employee is not.
    await act(gateway, u('E016'), id, 'SUBMIT');
    const [assigned] = await inbox(gateway, u('E006'));
    expect(assigned).toMatchObject({ eventCode: 'STEP_ASSIGNED', refId: id });
    expect(assigned.body).toContain('ở bước Quản lý đánh giá');
    expect(await inbox(gateway, u('E016'), 'STEP_ASSIGNED')).toEqual([]);
  });

  it('HR acting as proxy for the manager tells neither of them', async () => {
    const { gateway } = setup();
    await rememberSeed(gateway);
    const id = formId('EVAL:T03:E016');
    await act(gateway, hr, id, 'RETURN', 'Thiếu số liệu', u('E006'));
    const [notice] = await inbox(gateway, u('E016'), 'RETURNED');
    expect(notice.body).toMatch(/\(thay cho .+\) đã trả lại/);
    expect(await inbox(gateway, hr)).toEqual([]);
    expect(await inbox(gateway, u('E006'))).toEqual([]);
  });
});

describe('form.dueSoon — the deadline reminder', () => {
  it('is written once per recipient however many ticks fall in the window, and warns what happens next', async () => {
    const { gateway } = setup();
    await rememberSeed(gateway);
    // SEED_NOW is 04-06: the T03 self-assessments are due 04-07, reminders 1 day before.
    const open = (await gateway.forms.listForms(S, { periodId: T03, status: 'Open' }, { limit: 500 })).items;
    const subject = (await gateway.org.listUserAccounts(S)).find((x) => x.employeeId === open[0].subjectEmployeeId)?.id as Id;

    const first = await gateway.scheduler.runDue(S);
    expect(first.remindersDue.map((r) => r.formId)).toContain(open[0].id);
    await gateway.scheduler.runDue(S);
    await gateway.scheduler.runDue(S);

    const reminders = await inbox(gateway, subject, 'DEADLINE_REMIND');
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ refType: 'Form', refId: open[0].id, subject: 'Sắp đến hạn bước Tự đánh giá' });
    expect(reminders[0].body).toMatch(/là 07\/04\/2027\. Quá hạn, phiếu sẽ tự chuyển sang bước tiếp theo\.$/);
  });

  it('writes nothing once the data was reset while it was being prepared', async () => {
    const { gateway } = setup();
    await rememberSeed(gateway);
    const report = await gateway.scheduler.runDue(S);
    expect(report.remindersDue.length).toBeGreaterThan(0);
    await gateway.dev?.resetSeed();
    await gateway.notificationsSettled();
    // The seed's ids are deterministic: after the reset, only the seeded notifications exist.
    const users = await gateway.org.listUserAccounts(S);
    for (const user of users) expect(await inbox(gateway, user.id), user.login).toEqual([]);
  });
});

describe('a form re-entering its step', () => {
  it('HR unlocking a frozen registration tells the person whose step it is, with the new due date', async () => {
    const { gateway } = setup();
    await rememberSeed(gateway);
    const plan = SYNTRA.id('GoalPlan', cycle2027, 'E027'); // AUTO_LOCKed at the employee's step on 01-09
    await gateway.goals.unlockGoalPlan(S, hr, plan, 'Gia hạn đăng ký.', '2027-04-20');

    const [notice, ...rest] = await inbox(gateway, u('E027'));
    expect(rest).toEqual([]);
    expect(notice).toMatchObject({ eventCode: 'STEP_ASSIGNED', refType: 'Form' });
    expect(notice.body).toMatch(/Hạn: 20\/04\/2027\.$/);
    expect(await inbox(gateway, hr)).toEqual([]);
  });
});

describe('isolation and loops', () => {
  it('an event of Demo Co writes only in Demo Co', async () => {
    const { gateway } = setup();
    await rememberSeed(gateway);
    const syntraBefore = (await gateway.system.listNotifications(S, u('E016'), {}, { limit: 500 })).items.length;
    await gateway.scheduler.runDue(DEMO.tenantId);
    await gateway.notificationsSettled();
    expect((await gateway.system.listNotifications(S, u('E016'), {}, { limit: 500 })).items).toHaveLength(syntraBefore);
    // …and the reverse: a Syntra action writes nothing in Demo Co.
    const demoUser = DEMO.user(DEMO.personas.employee);
    const demoBefore = (await gateway.system.listNotifications(DEMO.tenantId, demoUser, {}, { limit: 500 })).items.length;
    await act(gateway, u('E006'), formId('EVAL:T03:E016'), 'RETURN', 'Thiếu số liệu');
    await gateway.notificationsSettled();
    expect(await inbox(gateway, u('E016'))).toHaveLength(1);
    expect((await gateway.system.listNotifications(DEMO.tenantId, demoUser, {}, { limit: 500 })).items).toHaveLength(demoBefore);
  });

  it('its own writes do not wake it again, and nothing is audited', async () => {
    const { gateway } = setup();
    const recorded = vi.spyOn(gateway.system, 'recordNotification');
    await act(gateway, u('E006'), formId('EVAL:T03:E016'), 'RETURN', 'Thiếu số liệu');
    await gateway.notificationsSettled();
    expect(recorded).toHaveBeenCalledTimes(1);
    expect((await gateway.system.listAuditLog(S, { entityName: 'Notification' })).items).toEqual([]);
  });

  it('a failed read is reported, never thrown into the write that caused it', async () => {
    const { gateway, diagnostics } = setup();
    await rememberSeed(gateway);
    const id = formId('EVAL:T03:E016');
    const form = await gateway.forms.getForm(S, id);
    gateway.dev?.setFailureMode({ enabled: true, methodPattern: 'org.*' });
    // `act` itself reads no org method through the gateway, so it succeeds…
    await expect(
      gateway.forms.act(S, u('E006'), { formId: id, expectedStepId: form.currentStepId as Id, action: 'RETURN', comment: 'x', onBehalfOfUserId: null, delegationId: null }),
    ).resolves.toMatchObject({ id });
    await gateway.notificationsSettled();
    // …and the notice it would have caused is reported missing.
    expect(diagnostics).toHaveLength(1);
    gateway.dev?.setFailureMode({ enabled: false });
    expect(await inbox(gateway, u('E016'))).toEqual([]);
  });

  it('is off on the shared test gateway unless asked for', async () => {
    const { gateway } = newGateway();
    const recorded = vi.spyOn(gateway.system, 'recordNotification');
    await act(gateway as Gw, u('E006'), formId('EVAL:T03:E016'), 'RETURN', 'Thiếu số liệu');
    await gateway.notificationsSettled();
    expect(recorded).not.toHaveBeenCalled();
  });
});

describe('more recipients (QA follow-ups)', () => {
  it('a form started by hand tells the person whose step it is, not HR who started it', async () => {
    const { gateway } = setup();
    await rememberSeed(gateway);
    const workflowId = (await gateway.forms.listWorkflows(S, 'GOAL_CHANGE'))[0].id;
    const form = await gateway.forms.startForm(S, hr, {
      workflowId, subjectEmployeeId: emp('E016'), goalPlanId: SYNTRA.id('GoalPlan', cycle2027, 'E016'), periodId: null, dueDate: '2027-04-30',
    });
    const [notice, ...rest] = await inbox(gateway, u('E016'));
    expect(rest).toEqual([]);
    expect(notice).toMatchObject({ eventCode: 'STEP_ASSIGNED', refType: 'Form', refId: form.id });
    expect(notice.body).toContain('Phiếu Điều chỉnh KPI của Nguyễn Văn An');
    expect(await inbox(gateway, hr)).toEqual([]);
  });

  it('a delegate is told alongside the delegator — but never about a review of their own form', async () => {
    const { gateway } = setup();
    await rememberSeed(gateway);
    // E007 has delegated KPI evaluations to E019 (04-01…04-15); E019 is also one of E007's reports.
    const reports = (await gateway.org.listAssignments(S, { managerEmployeeId: emp('E007'), activeOn: '2027-04-06' })).map((a) => a.employeeId);
    const open = (await gateway.forms.listForms(S, { periodId: T03, status: 'Open' }, { limit: 500 })).items.filter((f) => reports.includes(f.subjectEmployeeId));
    const accounts = await gateway.org.listUserAccounts(S);
    const submit = async (form: (typeof open)[number]) => {
      const subject = accounts.find((x) => x.employeeId === form.subjectEmployeeId)?.id as Id;
      const items = await gateway.forms.listEvaluationItems(S, form.id);
      await gateway.forms.saveEvaluationItems(S, subject, form.id, items.map((i) => ({ itemId: i.id, selfAchievementPct: 100, selfComment: 'Đạt' })));
      await act(gateway, subject, form.id, 'SUBMIT');
    };

    const other = open.find((f) => f.subjectEmployeeId !== emp('E019'));
    expect(other).toBeDefined();
    await submit(other as (typeof open)[number]);
    expect(await inbox(gateway, u('E007'), 'STEP_ASSIGNED')).toHaveLength(1);
    expect(await inbox(gateway, u('E019'), 'STEP_ASSIGNED')).toHaveLength(1);

    // E019's own form reaches E007's step: E007 is told, E019 (subject and delegate) is not (BR-KPI-21).
    const own = open.find((f) => f.subjectEmployeeId === emp('E019'));
    expect(own).toBeDefined();
    await submit(own as (typeof open)[number]);
    expect(await inbox(gateway, u('E007'), 'STEP_ASSIGNED')).toHaveLength(2);
    expect(await inbox(gateway, u('E019'), 'STEP_ASSIGNED')).toHaveLength(1);
  });

  it('an event with no in-app template notifies nobody', async () => {
    const { gateway } = setup();
    await rememberSeed(gateway);
    const admin = u(SYNTRA.personas.admin);
    const returned = (await gateway.system.listNotificationTemplates(S)).find((t) => t.eventCode === 'RETURNED' && t.channel === 'InApp');
    await gateway.system.saveNotificationTemplate(S, admin, { ...(returned as NonNullable<typeof returned>), channel: 'Email' });
    await act(gateway, u('E006'), formId('EVAL:T03:E016'), 'RETURN', 'Thiếu số liệu');
    expect(await inbox(gateway, u('E016'))).toEqual([]);
  });
});
