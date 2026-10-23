import { describe, expect, it } from 'vitest';
import { SEED_NOW, SYNTRA } from '@/data/fixtures';
import { vn } from '@/data/fixtures/timeline';
import type { EvaluationColumn, FormInstance, Goal, Id, PersonFormAction, RecipientFilter } from '@/data/types';
import type { DataGateway, DomainEvent, EvaluationItemPatch } from '../types';
import { flush, newGateway, rejection } from './gateway.test-util';

/**
 * Gate 1 — the workflow lane, end to end through the mock gateway against the seed: forms move only
 * by `workflowRules`, launches and the scheduler create and move them, plans lock and unlock, cycles
 * move forward, and plan edits are guarded. Every refusal changes nothing.
 */

const S = SYNTRA.tenantId;
const u = (code: string) => SYNTRA.user(code);
const emp = (code: string) => SYNTRA.employee(code);
const admin = u(SYNTRA.personas.admin);
const hr = u(SYNTRA.personas.hr);
const cycle2027 = SYNTRA.id('PerformanceCycle', '2027');
const cycle2028 = SYNTRA.id('PerformanceCycle', '2028');
const T03 = SYNTRA.id('CyclePeriod', 2027, 'T03');
const T04 = SYNTRA.id('CyclePeriod', 2027, 'T04');
const formId = (key: string) => SYNTRA.id('FormInstance', key);
const planId = (owner: string) => SYNTRA.id('GoalPlan', cycle2027, owner);
const delegationId = (key: 'active' | 'expired' | 'revoked') => SYNTRA.id('Delegation', key);
const FAR = '2027-12-31';
const STAFF: RecipientFilter = { orgUnitIds: [], includeChildUnits: false, positionIds: [], jobLevels: ['TeamLead', 'Specialist', 'Staff'], employmentStatuses: [], employeeIds: [] };

type Gw = DataGateway;

async function act(gw: Gw, actor: Id, id: Id, action: PersonFormAction, o: { comment?: string | null; onBehalfOf?: Id; delegation?: Id; expectedStepId?: Id } = {}) {
  const form = await gw.forms.getForm(S, id);
  return gw.forms.act(S, actor, {
    formId: id,
    expectedStepId: o.expectedStepId ?? (form.currentStepId as Id),
    action,
    comment: o.comment ?? null,
    onBehalfOfUserId: o.onBehalfOf ?? null,
    delegationId: o.delegation ?? null,
  });
}

const FIELDS: Record<EvaluationColumn, [keyof EvaluationItemPatch, keyof EvaluationItemPatch]> = {
  SELF: ['selfAchievementPct', 'selfComment'],
  MANAGER: ['managerAchievementPct', 'managerComment'],
  FINAL: ['finalAchievementPct', 'finalComment'],
};

/** "Lưu nháp" of one column on every item of the form — at SELF only the explanation: the % is the system's (PEND-07). */
async function score(gw: Gw, actor: Id, id: Id, column: EvaluationColumn, pct = 100) {
  const [p, c] = FIELDS[column];
  const items = await gw.forms.listEvaluationItems(S, id);
  return gw.forms.saveEvaluationItems(S, actor, id, items.map((i) => (column === 'SELF' ? { itemId: i.id, [c]: 'Nhận xét' } : { itemId: i.id, [p]: pct, [c]: 'Nhận xét' })));
}

const stepNoOf = async (gw: Gw, form: FormInstance) => (await gw.forms.listWorkflowSteps(S, form.workflowId)).find((s) => s.id === form.currentStepId)?.stepNo ?? null;
const workflowOf = async (gw: Gw, type: 'GOAL_SETTING' | 'GOAL_CHANGE' | 'KPI_EVAL') => (await gw.forms.listWorkflows(S, type))[0].id;

function listen(gw: Gw): DomainEvent[] {
  const heard: DomainEvent[] = [];
  gw.events.subscribe(S, (e) => void heard.push(e));
  return heard;
}

/** Everything a refused write could have touched, to compare before / after. */
async function snapshotOf(gw: Gw, id: Id) {
  const form = await gw.forms.getForm(S, id);
  return {
    form,
    actions: await gw.forms.listFormActions(S, id),
    items: await gw.forms.listEvaluationItems(S, id),
    plan: form.goalPlanId ? await gw.goals.getGoalPlan(S, form.goalPlanId) : null,
    audit: (await gw.system.listAuditLog(S, {}, { limit: 500 })).items.length,
  };
}

// ─── The seed's first tick ─────────────────────────────────────────────────────────────────────

describe('scheduler.runDue — the first tick at SEED_NOW is what the seed story says', () => {
  it('handles only the open adjustment (REMIND, no move, no history), fires nothing, and reminds the steps due tomorrow', async () => {
    const { gateway } = newGateway();
    const heard = listen(gateway);
    const before = await snapshotOf(gateway, formId('GC:open'));
    expect((await gateway.forms.listLaunches(S)).filter((l) => l.status === 'Scheduled' && l.scheduledAt <= SEED_NOW)).toEqual([]);

    const report = await gateway.scheduler.runDue(S);
    expect(report.launchesFired).toEqual([]);
    expect(report.formsCreated).toEqual([]);
    expect(report.overdueHandled).toEqual([{ formId: formId('GC:open'), stepId: before.form.currentStepId, behaviour: 'REMIND' }]);

    // Reminders: every step whose deadline is 04-07 (remindDaysBefore 1) — T03 at step 1, E015/E016
    // at the manager, E020/E038 at HR, and E040's re-entered registration at HR.
    const t03Open = (await gateway.forms.listForms(S, { periodId: T03, status: 'Open' }, { limit: 500 })).items.map((f) => f.id);
    expect(t03Open).toHaveLength(20);
    const expected = [...t03Open, ...['E015', 'E016', 'E020', 'E038'].map((c) => formId(`EVAL:T03:${c}`)), formId('GS:E040')];
    expect(report.remindersDue.map((r) => r.formId).sort()).toEqual(expected.sort());

    const after = await snapshotOf(gateway, formId('GC:open'));
    expect(after.form).toMatchObject({ status: 'InProgress', currentStepId: before.form.currentStepId });
    expect(after.form.overdueHandledAt).not.toBeNull();
    expect(after.actions).toEqual(before.actions); // REMIND records no action

    await flush();
    const overdue = heard.filter((e) => e.type === 'form.overdue');
    expect(overdue).toEqual([expect.objectContaining({ formId: formId('GC:open'), behaviour: 'REMIND', actorUserId: null, assigneeUserIds: [u('E010')] })]);
    const dueSoon = heard.filter((e): e is Extract<DomainEvent, { type: 'form.dueSoon' }> => e.type === 'form.dueSoon');
    expect(dueSoon).toHaveLength(expected.length);
    expect(dueSoon.every((e) => e.deadline === '2027-04-07' && e.reminderKey.startsWith(`remind:${e.formId}:`))).toBe(true);
  });

  it('a second tick handles nothing again, and repeats the reminders with the SAME keys (T7 dedupes on them)', async () => {
    const { gateway } = newGateway();
    const heard = listen(gateway);
    const first = await gateway.scheduler.runDue(S);
    await flush();
    const keys = heard.filter((e) => e.type === 'form.dueSoon').map((e) => (e as { reminderKey: string }).reminderKey).sort();
    heard.length = 0;
    const second = await gateway.scheduler.runDue(S);
    await flush();
    expect(second.overdueHandled).toEqual([]);
    expect(second.remindersDue).toEqual(first.remindersDue);
    expect(heard.filter((e) => e.type === 'form.dueSoon').map((e) => (e as { reminderKey: string }).reminderKey).sort()).toEqual(keys);
    expect(heard.filter((e) => e.type === 'entity.changed')).toEqual([]);
  });
});

// ─── Happy paths ───────────────────────────────────────────────────────────────────────────────

describe('forms.act — each form type to Completed', () => {
  it('evaluation: the manager scores and submits, HR records the final % and approves', async () => {
    const { gateway } = newGateway();
    const heard = listen(gateway);
    const id = formId('EVAL:T03:E016');
    await score(gateway, u('E006'), id, 'MANAGER', 95);
    const atHr = await act(gateway, u('E006'), id, 'SUBMIT');
    expect(await stepNoOf(gateway, atHr)).toBe(3);
    await score(gateway, hr, id, 'FINAL', 95);
    const done = await act(gateway, hr, id, 'APPROVE');
    expect(done).toMatchObject({ status: 'Completed', currentStepId: null, currentStepEnteredAt: null });
    const actions = await gateway.forms.listFormActions(S, id);
    expect(actions.slice(-2).map((a) => [a.action, a.actorUserId, a.onBehalfOfUserId])).toEqual([
      ['SUBMIT', u('E006'), null],
      ['APPROVE', hr, null],
    ]);
    await flush();
    const acted = heard.filter((e): e is Extract<DomainEvent, { type: 'form.stepActed' }> => e.type === 'form.stepActed');
    expect(acted.map((e) => [e.action, e.formStatus])).toEqual([['SUBMIT', 'InProgress'], ['APPROVE', 'Completed']]);
    expect(acted[0].assigneeUserIds).toContain(hr);
    expect(acted[1]).toMatchObject({ nextStepId: null, assigneeUserIds: [] });
  });

  it('registration: manager → employee adds goals → manager approves → HR approves and the plan is Locked', async () => {
    const { gateway } = newGateway();
    const id = formId('GS:E018');
    const plan = planId('E018');
    await act(gateway, u('E006'), id, 'SUBMIT'); // step 1: an unfinished plan is handed down
    expect((await gateway.goals.getGoalPlan(S, plan)).status).toBe('Draft');

    // E018's own step: refused until the plan is complete (100%, 5–8 goals), then accepted.
    expect((await rejection(act(gateway, u('E018'), id, 'SUBMIT'))).code).toBe('ERR-KPI-07');
    const template = await gateway.goals.listGoals(S, { goalPlanIds: [planId('E016')], status: 'Active' });
    for (const g of template) {
      const { id: _id, status: _s, replacesGoalId: _r, ...fields } = g;
      await gateway.goals.saveGoal(S, u('E018'), { ...fields, goalPlanId: plan, kgiId: null, ownerEmployeeId: emp('E018') });
    }
    await act(gateway, u('E018'), id, 'SUBMIT');
    expect((await gateway.goals.getGoalPlan(S, plan)).status).toBe('Submitted');
    await act(gateway, u('E006'), id, 'APPROVE');
    expect((await gateway.goals.getGoalPlan(S, plan)).status).toBe('Approved');
    const done = await act(gateway, hr, id, 'APPROVE');
    expect(done.status).toBe('Completed');
    const locked = await gateway.goals.getGoalPlan(S, plan);
    expect(locked.status).toBe('Locked');
    expect(locked.lockedAt).not.toBeNull();
    const audit = (await gateway.system.listAuditLog(S, { entityName: 'GoalPlan', entityId: plan })).items;
    expect(audit.some((a) => a.action === 'LOCK' && a.userId === hr)).toBe(true);
  });

  it('adjustment: manager and HR approve, and the proposal is applied (old goal Changed, a new one replaces it)', async () => {
    const { gateway } = newGateway();
    const id = formId('GC:open');
    const [item] = await gateway.forms.listGoalChangeItems(S, id);
    await act(gateway, u('E010'), id, 'APPROVE');
    const done = await act(gateway, hr, id, 'APPROVE');
    expect(done.status).toBe('Completed');
    const goals = await gateway.goals.listGoals(S, { goalPlanIds: [planId('E029')] });
    expect(goals.find((g) => g.id === item.goalId)?.status).toBe('Changed');
    const replacement = goals.find((g) => g.replacesGoalId === item.goalId) as Goal;
    expect(replacement).toMatchObject({ status: 'Active', targetValue: item.proposed?.targetValue });
    expect((await gateway.goals.getGoalPlan(S, planId('E029'))).status).toBe('Locked'); // the plan stays Locked
  });
});

describe('forms.act — RETURN, CANCEL and refusals', () => {
  it('HR returns an evaluation at the LAST step to the manager; the history shows it', async () => {
    const { gateway } = newGateway();
    const id = formId('EVAL:T03:E020');
    const back = await act(gateway, hr, id, 'RETURN', { comment: 'Chấm lại theo số liệu đối soát.' });
    expect(await stepNoOf(gateway, back)).toBe(2);
    expect((await gateway.forms.listFormActions(S, id)).at(-1)).toMatchObject({ action: 'RETURN', actorUserId: hr, comment: 'Chấm lại theo số liệu đối soát.' });
  });

  it('a manager returns a registration: the plan becomes Returned', async () => {
    const { gateway } = newGateway();
    const back = await act(gateway, u('E006'), formId('GS:E017'), 'RETURN', { comment: 'Bổ sung chỉ tiêu.' });
    expect(await stepNoOf(gateway, back)).toBe(2);
    expect((await gateway.goals.getGoalPlan(S, planId('E017'))).status).toBe('Returned');
  });

  it('refuses RETURN on step 1 (04), RETURN without a comment (06), a stale step (04), self-approval (05)', async () => {
    const { gateway } = newGateway();
    expect((await rejection(act(gateway, u('E017'), formId('EVAL:T03:E017'), 'RETURN', { comment: 'x' }))).code).toBe('ERR-KPI-04');
    expect((await rejection(act(gateway, hr, formId('EVAL:T03:E020'), 'RETURN', { comment: '  ' }))).code).toBe('ERR-KPI-06');
    const t03 = await gateway.forms.getForm(S, formId('EVAL:T03:E017'));
    const stale = await rejection(act(gateway, u('E006'), formId('EVAL:T03:E016'), 'SUBMIT', { expectedStepId: t03.currentStepId as Id }));
    expect([stale.code, stale.detail]).toEqual(['ERR-KPI-04', 'STALE_STEP']);
    const self = await rejection(act(gateway, u('E016'), formId('EVAL:T03:E016'), 'SUBMIT'));
    expect([self.code, self.detail]).toEqual(['ERR-KPI-05', 'SELF_APPROVAL']);
  });

  it('a submit with missing scores is refused (ERR-KPI-09) and a refusal changes nothing, announces nothing', async () => {
    const { gateway } = newGateway();
    // At the employee's step with no explanation yet (the % is the system's, PEND-07).
    const id = formId('EVAL:T03:E033');
    const before = await snapshotOf(gateway, id);
    const heard = listen(gateway);
    expect((await rejection(act(gateway, u('E033'), id, 'SUBMIT'))).code).toBe('ERR-KPI-09');
    expect((await rejection(act(gateway, u('E017'), id, 'SUBMIT'))).code).toBe('ERR-KPI-05');
    await flush();
    expect(heard).toEqual([]);
    expect(await snapshotOf(gateway, id)).toEqual(before);
  });

  it('CANCEL is HR\'s, with a reason, at any step — also on a frozen registration, whose plan goes back to Draft', async () => {
    const { gateway } = newGateway();
    const id = formId('GS:E027'); // AUTO_LOCKed in January, never unlocked
    expect((await rejection(act(gateway, u('E009'), id, 'CANCEL', { comment: 'x' }))).code).toBe('ERR-KPI-05');
    expect((await rejection(act(gateway, hr, id, 'CANCEL'))).code).toBe('ERR-KPI-06');
    const cancelled = await act(gateway, hr, id, 'CANCEL', { comment: 'Đăng ký lại từ đầu.' });
    expect(cancelled.status).toBe('Cancelled');
    expect(await gateway.goals.getGoalPlan(S, planId('E027'))).toMatchObject({ status: 'Draft', lockedAt: null });
    const audit = (await gateway.system.listAuditLog(S, { entityName: 'GoalPlan', entityId: planId('E027') })).items;
    expect(audit.find((a) => a.action === 'UNLOCK' && a.reason === 'Đăng ký lại từ đầu.')).toBeDefined();
  });
});

// ─── Proxy and delegation ──────────────────────────────────────────────────────────────────────

describe('proxy and delegation (BR-KPI-21)', () => {
  it('HR as proxy: both people on the history row AND on the audit rows', async () => {
    const { gateway } = newGateway();
    const id = formId('EVAL:T03:E016');
    await score(gateway, hr, id, 'MANAGER'); // HR fills the manager's column for him
    await act(gateway, hr, id, 'SUBMIT', { onBehalfOf: u('E006') });
    expect((await gateway.forms.listFormActions(S, id)).at(-1)).toMatchObject({ action: 'SUBMIT', actorUserId: hr, onBehalfOfUserId: u('E006'), delegationId: null });
    const audit = (await gateway.system.listAuditLog(S, { entityName: 'FormInstance', entityId: id })).items;
    expect(audit[0]).toMatchObject({ userId: hr, onBehalfOfUserId: u('E006') });
    const items = (await gateway.system.listAuditLog(S, { entityName: 'EvaluationItem', userId: hr })).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((a) => a.onBehalfOfUserId === u('E006'))).toBe(true);
  });

  /** E021 self-assesses and submits: the form waits for E007, whose delegate is E019 until 04-15. */
  async function atMarketingHead(gw: Gw) {
    const id = formId('EVAL:T03:E021');
    await score(gw, u('E021'), id, 'SELF');
    await act(gw, u('E021'), id, 'SUBMIT');
    return id;
  }

  it('a delegate acts on the delegation\'s last day, recorded with the delegator and the delegation', async () => {
    const { gateway } = newGateway();
    const id = await atMarketingHead(gateway);
    gateway.dev?.setNow(vn('2027-04-15 17:00'));
    expect((await gateway.forms.listInbox(S, u('E019'))).map((f) => f.id)).toContain(id);
    await score(gateway, u('E019'), id, 'MANAGER');
    await act(gateway, u('E019'), id, 'SUBMIT', { onBehalfOf: u('E007'), delegation: delegationId('active') });
    expect((await gateway.forms.listFormActions(S, id)).at(-1)).toMatchObject({ actorUserId: u('E019'), onBehalfOfUserId: u('E007'), delegationId: delegationId('active') });
    const audit = (await gateway.system.listAuditLog(S, { entityName: 'FormInstance', entityId: id })).items[0];
    expect(audit).toMatchObject({ userId: u('E019'), onBehalfOfUserId: u('E007') });
  });

  it('the day after it expires the delegate is refused (05) and the form leaves their inbox', async () => {
    const { gateway } = newGateway();
    const id = await atMarketingHead(gateway);
    await score(gateway, u('E019'), id, 'MANAGER'); // still valid on 04-06
    gateway.dev?.setNow(vn('2027-04-16 08:00'));
    const error = await rejection(act(gateway, u('E019'), id, 'SUBMIT', { onBehalfOf: u('E007'), delegation: delegationId('active') }));
    expect([error.code, error.detail]).toEqual(['ERR-KPI-05', 'DELEGATION_NOT_VALID']);
    expect((await gateway.forms.listInbox(S, u('E019'))).map((f) => f.id)).not.toContain(id);
    expect((await gateway.forms.listInbox(S, u('E007'))).map((f) => f.id)).toContain(id);
    expect((await rejection(score(gateway, u('E019'), id, 'MANAGER'))).code).toBe('ERR-KPI-05');
  });

  it('the seeded expired and revoked delegations grant nothing', async () => {
    const { gateway } = newGateway();
    const cskh = formId('EVAL:T03:E022'); // self-scores already saved
    await act(gateway, u('E022'), cskh, 'SUBMIT');
    const expired = await rejection(act(gateway, u('E006'), cskh, 'SUBMIT', { onBehalfOf: u('E008'), delegation: delegationId('expired') }));
    expect([expired.code, expired.detail]).toEqual(['ERR-KPI-05', 'DELEGATION_NOT_VALID']);
    const tech = formId('EVAL:T03:E033');
    await score(gateway, u('E033'), tech, 'SELF');
    await act(gateway, u('E033'), tech, 'SUBMIT');
    const revoked = await rejection(act(gateway, u('E031'), tech, 'SUBMIT', { onBehalfOf: u('E011'), delegation: delegationId('revoked') }));
    expect([revoked.code, revoked.detail]).toEqual(['ERR-KPI-05', 'DELEGATION_NOT_VALID']);
  });

  it('the inbox holds the forms whose current step the user acts on, most urgent first', async () => {
    const { gateway } = newGateway();
    const inbox = (await gateway.forms.listInbox(S, u('E006'))).map((f) => f.id);
    expect(inbox).toEqual(expect.arrayContaining([formId('EVAL:T03:E015'), formId('EVAL:T03:E016'), formId('GS:E017'), formId('GS:E018')]));
    expect(inbox).not.toContain(formId('EVAL:T03:E017')); // at E017's own step
    expect((await gateway.forms.listInbox(S, u('E016'))).map((f) => f.id)).toEqual([]);
    expect((await gateway.forms.listInbox(S, u('E017'))).map((f) => f.id)).toEqual([formId('EVAL:T03:E017')]);
  });
});

// ─── "Lưu nháp" ────────────────────────────────────────────────────────────────────────────────

describe('forms.saveEvaluationItems — the current step\'s column, by its actor', () => {
  it('saves the column, records no history row, and keeps the actual read-only', async () => {
    const { gateway } = newGateway();
    const id = formId('EVAL:T03:E016');
    const before = await gateway.forms.listFormActions(S, id);
    const saved = await score(gateway, u('E006'), id, 'MANAGER', 90);
    expect(saved.every((i) => i.managerAchievementPct === 90 && i.managerComment === 'Nhận xét')).toBe(true);
    expect(await gateway.forms.listFormActions(S, id)).toEqual(before);
    const [item] = saved;
    const snapshot = await rejection(gateway.forms.saveEvaluationItems(S, u('E006'), id, [{ itemId: item.id, actualSnapshot: 1 } as EvaluationItemPatch]));
    expect(snapshot.code).toBe('ERR-KPI-04');
  });

  it('refuses a non-actor (05), another column (04), a closed form (04), a score above the cap (06), an item of another form (06)', async () => {
    const { gateway } = newGateway();
    const id = formId('EVAL:T03:E016');
    const [item] = await gateway.forms.listEvaluationItems(S, id);
    expect((await rejection(gateway.forms.saveEvaluationItems(S, u('E017'), id, [{ itemId: item.id, managerAchievementPct: 90 }]))).code).toBe('ERR-KPI-05');
    expect((await rejection(gateway.forms.saveEvaluationItems(S, u('E006'), id, [{ itemId: item.id, selfAchievementPct: 90 }]))).code).toBe('ERR-KPI-04');
    const closed = formId('EVAL:T01:E016');
    const [old] = await gateway.forms.listEvaluationItems(S, closed);
    expect((await rejection(gateway.forms.saveEvaluationItems(S, hr, closed, [{ itemId: old.id, finalAchievementPct: 90 }]))).code).toBe('ERR-KPI-04');
    const cap = await rejection(gateway.forms.saveEvaluationItems(S, u('E006'), id, [{ itemId: item.id, managerAchievementPct: 500 }]));
    expect([cap.code, cap.issues[0]?.detail]).toEqual(['ERR-KPI-06', 'SCORE_OUT_OF_RANGE']);
    expect((await rejection(gateway.forms.saveEvaluationItems(S, u('E006'), id, [{ itemId: old.id, managerAchievementPct: 90 }]))).code).toBe('ERR-KPI-06');
    expect((await gateway.forms.listEvaluationItems(S, id)).find((i) => i.id === item.id)?.managerAchievementPct).toBe(item.managerAchievementPct);
  });
});

describe('forms.saveGoalChangeItems and startForm', () => {
  it('HR starts an adjustment of a Locked plan; the owner drafts it without reasons, the submit needs them', async () => {
    const { gateway } = newGateway();
    const form = await gateway.forms.startForm(S, hr, { workflowId: await workflowOf(gateway, 'GOAL_CHANGE'), subjectEmployeeId: emp('E016'), goalPlanId: planId('E016'), periodId: null, dueDate: FAR });
    expect(form).toMatchObject({ status: 'Open', formType: 'GOAL_CHANGE', launchId: null });
    expect(await stepNoOf(gateway, form)).toBe(1);
    const [goal] = await gateway.goals.listGoals(S, { goalPlanIds: [planId('E016')], status: 'Active' });
    await gateway.forms.saveGoalChangeItems(S, u('E016'), form.id, [{ goalId: goal.id, changeType: 'CANCEL', proposed: null, reason: '' }]);
    const missing = await rejection(act(gateway, u('E016'), form.id, 'SUBMIT'));
    expect(missing.issues.map((i) => i.detail)).toContain('REASON_REQUIRED');
    expect((await rejection(gateway.forms.saveGoalChangeItems(S, u('E017'), form.id, []))).code).toBe('ERR-KPI-05');
  });

  it('HR starts a unit plan\'s registration for the unit head; only one at a time', async () => {
    const { gateway } = newGateway();
    const plan = await gateway.goals.createGoalPlan(S, hr, { cycleId: cycle2028, planType: 'KPI', ownerType: 'OrgUnit', ownerOrgUnitId: SYNTRA.unit('KDBH'), ownerEmployeeId: null });
    const input = { workflowId: await workflowOf(gateway, 'GOAL_SETTING'), subjectEmployeeId: emp('E006'), goalPlanId: plan.id, periodId: null, dueDate: '2027-12-31' };
    expect((await rejection(gateway.forms.startForm(S, hr, { ...input, subjectEmployeeId: emp('E016') }))).detail).toBe('SUBJECT_NOT_OWNER');
    const form = await gateway.forms.startForm(S, hr, input);
    expect(form).toMatchObject({ formType: 'GOAL_SETTING', status: 'Open', subjectEmployeeId: emp('E006') });
    expect((await gateway.forms.listInbox(S, u('E003'))).map((f) => f.id)).toContain(form.id); // the head's manager cascades first
    expect((await rejection(gateway.forms.startForm(S, hr, input))).detail).toBe('REGISTRATION_ALREADY_OPEN');
  });

  it('refuses a second open adjustment (04), a plan not Locked (04), an evaluation (06), a past due date (06), an employee (05)', async () => {
    const { gateway } = newGateway();
    const change = await workflowOf(gateway, 'GOAL_CHANGE');
    const start = (o: object, actor = hr) => gateway.forms.startForm(S, actor, { workflowId: change, subjectEmployeeId: emp('E029'), goalPlanId: planId('E029'), periodId: null, dueDate: FAR, ...o });
    expect((await rejection(start({}))).detail).toBe('CHANGE_ALREADY_OPEN');
    expect((await rejection(start({ subjectEmployeeId: emp('E030'), goalPlanId: planId('E030') }))).code).toBe('ERR-KPI-04');
    expect((await rejection(start({ workflowId: await workflowOf(gateway, 'KPI_EVAL') }))).detail).toBe('NOT_STARTABLE');
    expect((await rejection(start({ subjectEmployeeId: emp('E016'), goalPlanId: planId('E016'), dueDate: '2027-04-01' }))).detail).toBe('DUE_DATE_INVALID');
    expect((await rejection(start({ subjectEmployeeId: emp('E016'), goalPlanId: planId('E016') }, u('E016')))).code).toBe('ERR-KPI-05');
  });
});

// ─── Launches ──────────────────────────────────────────────────────────────────────────────────

describe('forms.createLaunch / cancelLaunch', () => {
  const evalLaunch = async (gw: Gw, o: object = {}) =>
    gw.forms.createLaunch(S, hr, {
      workflowId: await workflowOf(gw, 'KPI_EVAL'), name: 'Đánh giá KPI tháng 4/2027', cycleId: cycle2027, periodId: T04, dueDays: 12,
      recipientMode: 'FILTER', recipientFilter: { ...STAFF, orgUnitIds: [SYNTRA.unit('KDBH')] }, timing: 'NOW', ...o,
    } as never);

  it('NOW creates the forms at once, honouring the skip rules, with one item per Active goal', async () => {
    const { gateway } = newGateway();
    const heard = listen(gateway);
    const launch = await evalLaunch(gateway);
    expect(launch).toMatchObject({ status: 'Launched', timing: 'NOW', createdBy: hr });
    expect(launch.launchedAt).not.toBeNull();
    const forms = (await gateway.forms.listForms(S, { launchId: launch.id }, { limit: 500 })).items;
    // E017 (plan Submitted) and E018 (plan Draft) have no Approved/Locked plan: skipped.
    expect(forms.map((f) => f.subjectEmployeeId).sort()).toEqual([emp('E015'), emp('E016')].sort());
    expect(forms.every((f) => f.status === 'Open' && f.dueDate === '2027-04-18' && f.periodId === T04)).toBe(true);
    expect(await gateway.forms.listEvaluationItems(S, forms[0].id)).toHaveLength(5);
    await flush();
    expect(heard.find((e) => e.type === 'form.launched')).toMatchObject({ launchId: launch.id });
  });

  it('a subject who already has the period\'s form is skipped; a new form snapshots the CURRENT actual', async () => {
    const { gateway } = newGateway();
    const again = await evalLaunch(gateway, { periodId: T03, recipientFilter: { ...STAFF, orgUnitIds: [SYNTRA.unit('KDBH')] } });
    expect((await gateway.forms.listForms(S, { launchId: again.id })).items).toEqual([]);
    // E024's March form was cancelled: a new one reaches her (she worked in March), with March's actuals.
    const leaver = await evalLaunch(gateway, { periodId: T03, recipientFilter: { ...STAFF, jobLevels: [], employeeIds: [emp('E024')] } });
    const [form] = (await gateway.forms.listForms(S, { launchId: leaver.id })).items;
    const items = await gateway.forms.listEvaluationItems(S, form.id);
    const actuals = await gateway.actuals.listActuals(S, { goalIds: items.map((i) => i.goalId), periodId: T03 });
    for (const item of items) {
      const actual = actuals.find((a) => a.goalId === item.goalId);
      expect([item.actualSnapshot, item.actualTextSnapshot]).toEqual([actual?.actualValue ?? null, actual?.actualText ?? null]);
    }
  });

  it('SCHEDULED waits for the first tick after its time; one in the past is refused', async () => {
    const { gateway } = newGateway();
    const launch = await evalLaunch(gateway, { timing: 'SCHEDULED', scheduledAt: vn('2027-04-10 09:00') });
    expect(launch.status).toBe('Scheduled');
    expect((await gateway.scheduler.runDue(S)).launchesFired).toEqual([]);
    gateway.dev?.setNow(vn('2027-04-10 09:00'));
    const report = await gateway.scheduler.runDue(S);
    expect(report.launchesFired).toEqual([launch.id]);
    expect(report.formsCreated).toHaveLength(2);
    expect((await gateway.forms.getLaunch(S, launch.id)).status).toBe('Launched');
    expect((await rejection(evalLaunch(gateway, { timing: 'SCHEDULED', scheduledAt: vn('2027-04-01 09:00') }))).code).toBe('ERR-KPI-06');
  });

  it('refuses a launch without its period (06), an evaluation into a Planning cycle and a registration into an Evaluating one (04)', async () => {
    const { gateway } = newGateway();
    expect((await rejection(evalLaunch(gateway, { periodId: null }))).detail).toBe('PERIOD_REQUIRED');
    const [jan] = await gateway.goals.savePeriods(S, admin, cycle2028, [
      { periodType: 'Month', label: 'T01', startDate: '2028-01-01', endDate: '2028-01-31', inputDeadline: null, evalDeadline: null, isLocked: false },
    ]);
    expect((await rejection(evalLaunch(gateway, { cycleId: cycle2028, periodId: jan.id }))).code).toBe('ERR-KPI-04');
    await gateway.goals.setCycleStatus(S, admin, cycle2027, 'Evaluating');
    const registration = { workflowId: await workflowOf(gateway, 'GOAL_SETTING'), periodId: null, recipientFilter: { ...STAFF, employeeIds: [emp('E018')] } };
    expect((await rejection(evalLaunch(gateway, registration))).code).toBe('ERR-KPI-04');
    expect((await gateway.forms.listLaunches(S)).filter((l) => l.createdBy === hr && l.createdAt > SEED_NOW)).toEqual([]);
  });

  it('cancels a Scheduled launch, never a Launched one', async () => {
    const { gateway } = newGateway();
    const scheduled = SYNTRA.id('FormLaunch', 'GS-2027-round-2');
    expect((await gateway.forms.cancelLaunch(S, hr, scheduled)).status).toBe('Cancelled');
    expect((await rejection(gateway.forms.cancelLaunch(S, hr, scheduled))).code).toBe('ERR-KPI-04');
    expect((await rejection(gateway.forms.cancelLaunch(S, hr, SYNTRA.id('FormLaunch', 'GS-2027')))).code).toBe('ERR-KPI-04');
  });

  it('a recurring rule fires once per (rule, period): T04 on 1 May, not again on the next tick', async () => {
    const { gateway } = newGateway();
    gateway.dev?.setNow(vn('2027-05-01 09:00'));
    await gateway.scheduler.runDue(S);
    await gateway.scheduler.runDue(S);
    const rule = SYNTRA.id('FormLaunchRule', 'monthly-eval');
    const t04 = (await gateway.forms.listLaunches(S)).filter((l) => l.launchRuleId === rule && l.periodId === T04);
    expect(t04).toHaveLength(1);
    expect(t04[0]).toMatchObject({ timing: 'RECURRING', status: 'Launched', createdBy: null });
    expect((await gateway.forms.listForms(S, { launchId: t04[0].id }, { limit: 500 })).items.length).toBeGreaterThan(20);
  });
});

// ─── Overdue ───────────────────────────────────────────────────────────────────────────────────

describe('scheduler.runDue — overdue steps (BR-KPI-13)', () => {
  it('AUTO_FORWARD: an unassessed self step moves to the manager, recorded with no actor; the next tick changes nothing', async () => {
    const { gateway } = newGateway();
    const heard = listen(gateway);
    const id = formId('EVAL:T03:E017');
    gateway.dev?.setNow(vn('2027-04-08 09:00')); // step-1 deadline was 04-07
    const report = await gateway.scheduler.runDue(S);
    expect(report.overdueHandled).toContainEqual(expect.objectContaining({ formId: id, behaviour: 'AUTO_FORWARD' }));
    const moved = await gateway.forms.getForm(S, id);
    expect(await stepNoOf(gateway, moved)).toBe(2);
    expect((await gateway.forms.listFormActions(S, id)).at(-1)).toMatchObject({ action: 'AUTO_FORWARD', actorUserId: null, onBehalfOfUserId: null, delegationId: null });
    await flush();
    expect(heard.find((e) => e.type === 'form.stepActed' && e.formId === id)).toMatchObject({ actorUserId: null, assigneeUserIds: [u('E006')] });
    expect(heard.find((e) => e.type === 'form.overdue' && e.formId === id)).toMatchObject({ behaviour: 'AUTO_FORWARD', assigneeUserIds: [u('E017')] });

    const before = await gateway.forms.listForms(S, {}, { limit: 500 });
    const again = await gateway.scheduler.runDue(S);
    expect(again.overdueHandled).toEqual([]);
    expect(await gateway.forms.listForms(S, {}, { limit: 500 })).toEqual(before);
  });

  it('AUTO_LOCK freezes the registration; HR unlocks with a new due date; the next tick does not lock it again', async () => {
    const { gateway } = newGateway();
    const id = formId('GS:E040'); // at HR since the 04-05 unlock; deadline 04-07
    const plan = planId('E040');
    gateway.dev?.setNow(vn('2027-04-08 09:00'));
    const report = await gateway.scheduler.runDue(S);
    expect(report.overdueHandled).toContainEqual(expect.objectContaining({ formId: id, behaviour: 'LOCK' }));
    expect((await gateway.goals.getGoalPlan(S, plan)).status).toBe('Locked');
    expect((await gateway.forms.listFormActions(S, id)).at(-1)).toMatchObject({ action: 'AUTO_LOCK', actorUserId: null });
    const lockAudit = (await gateway.system.listAuditLog(S, { entityName: 'GoalPlan', entityId: plan })).items[0];
    expect(lockAudit).toMatchObject({ action: 'LOCK', userId: null, reason: 'AUTO_LOCK' });

    const frozen = await rejection(act(gateway, hr, id, 'APPROVE'));
    expect([frozen.code, frozen.detail]).toEqual(['ERR-KPI-04', 'FROZEN']);

    const unlocked = await gateway.goals.unlockGoalPlan(S, hr, plan, 'Gia hạn cho nhân viên đi công tác.', '2027-04-20');
    expect(unlocked).toMatchObject({ status: 'Approved', lockedAt: null });
    expect(await gateway.forms.getForm(S, id)).toMatchObject({ dueDate: '2027-04-20', overdueHandledAt: null });
    const unlockAudit = (await gateway.system.listAuditLog(S, { entityName: 'GoalPlan', entityId: plan })).items[0];
    expect(unlockAudit).toMatchObject({ action: 'UNLOCK', userId: hr, reason: 'Gia hạn cho nhân viên đi công tác.' });

    expect((await gateway.scheduler.runDue(S)).overdueHandled.map((h) => h.formId)).not.toContain(id);
    expect((await act(gateway, hr, id, 'APPROVE')).status).toBe('Completed');
    expect((await gateway.goals.getGoalPlan(S, plan)).status).toBe('Locked');
  });
});

// ─── Lock / unlock, cycles ─────────────────────────────────────────────────────────────────────

describe('goals.lockGoalPlan / unlockGoalPlan (BR-KPI-14)', () => {
  it('HR locks a plan mid-registration: the open form is frozen until the unlock; locking twice is refused', async () => {
    const { gateway } = newGateway();
    const plan = planId('E030');
    const locked = await gateway.goals.lockGoalPlan(S, hr, plan);
    expect(locked.status).toBe('Locked');
    expect(locked.lockedAt).not.toBeNull();
    expect((await gateway.system.listAuditLog(S, { entityName: 'GoalPlan', entityId: plan })).items[0]).toMatchObject({ action: 'LOCK', userId: hr });
    expect((await rejection(gateway.goals.lockGoalPlan(S, hr, plan))).code).toBe('ERR-KPI-04');
    expect((await rejection(act(gateway, u('E030'), formId('GS:E030'), 'SUBMIT'))).detail).toBe('FROZEN');
    expect((await rejection(gateway.goals.unlockGoalPlan(S, hr, plan, '', '2027-04-20'))).code).toBe('ERR-KPI-06');
    expect((await gateway.goals.unlockGoalPlan(S, hr, plan, 'Mở lại.', '2027-04-20')).status).toBe('Draft'); // back to the employee's step
    expect((await rejection(gateway.goals.unlockGoalPlan(S, hr, plan, 'Mở lại.', '2027-04-20'))).code).toBe('ERR-KPI-04');
    expect((await rejection(gateway.goals.lockGoalPlan(S, u('E006'), planId('E016')))).code).toBe('ERR-KPI-05'); // goalplan.lock is HR's
  });
});

describe('cycles (cycleRules)', () => {
  it('moves forward one status at a time; closing locks every period', async () => {
    const { gateway } = newGateway();
    expect((await rejection(gateway.goals.setCycleStatus(S, admin, cycle2027, 'Closed'))).code).toBe('ERR-KPI-04');
    expect((await gateway.goals.setCycleStatus(S, admin, cycle2027, 'Evaluating')).status).toBe('Evaluating');
    expect((await gateway.goals.setCycleStatus(S, admin, cycle2027, 'Closed')).status).toBe('Closed');
    expect((await gateway.goals.listPeriods(S, cycle2027)).every((p) => p.isLocked)).toBe(true);
    const [period] = await gateway.goals.listPeriods(S, cycle2027);
    expect((await rejection(gateway.goals.setPeriodLocked(S, admin, period.id, false))).code).toBe('ERR-KPI-04');
    // A closed cycle's plans are no longer editable.
    const [goal] = await gateway.goals.listGoals(S, { goalPlanIds: [planId('E030')] });
    expect((await rejection(gateway.goals.saveGoal(S, admin, { ...goal, name: 'Đổi tên' }))).code).toBe('ERR-KPI-04');
  });

  it('edits a cycle and its periods only while Planning; activating needs valid periods', async () => {
    const { gateway } = newGateway();
    const c2027 = await gateway.goals.getCycle(S, cycle2027);
    expect((await rejection(gateway.goals.saveCycle(S, admin, { ...c2027, name: 'Đổi tên' }))).code).toBe('ERR-KPI-04');
    expect((await rejection(gateway.goals.savePeriods(S, admin, cycle2027, await gateway.goals.listPeriods(S, cycle2027)))).code).toBe('ERR-KPI-04');

    expect((await rejection(gateway.goals.setCycleStatus(S, admin, cycle2028, 'Active'))).detail).toBe('PERIODS_REQUIRED');
    const month = (m: string, start: string, end: string) => ({ periodType: 'Month' as const, label: m, startDate: start, endDate: end, inputDeadline: null, evalDeadline: null, isLocked: false });
    const overlapping = [month('T01', '2028-01-01', '2028-01-31'), month('T02', '2028-01-31', '2028-02-29')];
    expect((await rejection(gateway.goals.savePeriods(S, admin, cycle2028, overlapping))).detail).toBe('PERIOD_OVERLAP');
    await gateway.goals.savePeriods(S, admin, cycle2028, [month('T01', '2028-01-01', '2028-01-31'), month('T02', '2028-02-01', '2028-02-29')]);
    expect((await gateway.goals.setCycleStatus(S, admin, cycle2028, 'Active')).status).toBe('Active');
  });
});

// ─── Delegations ───────────────────────────────────────────────────────────────────────────────

describe('forms.saveDelegation / revokeDelegation', () => {
  const save = (gw: Gw, from: string, to: string, validFrom = '2027-04-07', validTo = '2027-04-10') =>
    gw.forms.saveDelegation(S, u(from), { toUserId: u(to), formType: 'KPI_EVAL', validFrom, validTo });

  it('refuses delegating to oneself, a chain, an overlapping duplicate and a past one (06)', async () => {
    const { gateway } = newGateway();
    expect((await rejection(save(gateway, 'E006', 'E006'))).detail).toBe('SELF_DELEGATION');
    expect((await rejection(save(gateway, 'E019', 'E020'))).detail).toBe('DELEGATION_CHAIN'); // E019 is E007's delegate until 04-15
    expect((await rejection(save(gateway, 'E003', 'E007'))).detail).toBe('DELEGATION_CHAIN'); // E007 already delegates
    expect((await rejection(save(gateway, 'E007', 'E019'))).detail).toBe('DELEGATION_DUPLICATE');
    expect((await rejection(save(gateway, 'E006', 'E015', '2027-03-01', '2027-03-31'))).detail).toBe('VALID_TO_PAST');
    await expect(save(gateway, 'E006', 'E015')).resolves.toMatchObject({ fromUserId: u('E006'), revokedAt: null });
  });

  it('the delegator or HR revokes; a manager over the delegator is not HR (05); twice is refused (04); a revoked one is not edited', async () => {
    const { gateway } = newGateway();
    const active = delegationId('active'); // E007 → E019
    expect((await rejection(gateway.forms.revokeDelegation(S, u('E003'), active))).code).toBe('ERR-KPI-05');
    expect((await gateway.forms.revokeDelegation(S, hr, active)).revokedAt).not.toBeNull();
    expect((await rejection(gateway.forms.revokeDelegation(S, u('E007'), active))).code).toBe('ERR-KPI-04');
    const revoked = await gateway.forms.listDelegations(S, u('E011'));
    const edit = await rejection(gateway.forms.saveDelegation(S, u('E011'), { ...revoked[0], validTo: '2027-05-31' }));
    expect(edit.code).toBe('ERR-KPI-04');
  });
});

// ─── Plan-edit guards ──────────────────────────────────────────────────────────────────────────

describe('goal-plan edit guards (goalPlanRules.canEditPlan, alignmentRules, calcRules)', () => {
  it('a Locked plan is edited only through an adjustment (04)', async () => {
    const { gateway } = newGateway();
    const [goal] = await gateway.goals.listGoals(S, { goalPlanIds: [planId('E016')] });
    expect((await rejection(gateway.goals.saveGoal(S, u('E016'), { ...goal, name: 'Đổi tên' }))).code).toBe('ERR-KPI-04');
    expect((await rejection(gateway.goals.deleteGoal(S, hr, goal.id))).code).toBe('ERR-KPI-04');
    const [kgi] = await gateway.goals.listKgis(S, planId('E016'));
    expect((await rejection(gateway.goals.saveKgi(S, hr, { ...kgi, name: 'Đổi tên' }))).code).toBe('ERR-KPI-04');
  });

  it('while registration is open, only the current step\'s actor edits (the manager waits for the employee: 05)', async () => {
    const { gateway } = newGateway();
    const [goal] = await gateway.goals.listGoals(S, { goalPlanIds: [planId('E030')] });
    expect((await rejection(gateway.goals.saveGoal(S, u('E010'), { ...goal, name: 'Đổi tên' }))).code).toBe('ERR-KPI-05');
    await expect(gateway.goals.saveGoal(S, u('E030'), { ...goal, name: 'Đổi tên' })).resolves.toMatchObject({ name: 'Đổi tên' });
  });

  it('refuses an alignment cycle (10), an over-allocation (11) and unordered levels (13)', async () => {
    const { gateway } = newGateway();
    const [a, b] = await gateway.goals.listGoals(S, { goalPlanIds: [planId('E030')], status: 'Active' });
    const link = (child: Goal, parent: Goal) => ({ childGoalId: child.id, parentGoalId: parent.id, alignmentType: 'LINK' as const, contributionPct: 50, allocatedValue: null });
    await gateway.goals.saveAlignment(S, admin, link(a, b));
    expect((await rejection(gateway.goals.saveAlignment(S, admin, link(b, a)))).code).toBe('ERR-KPI-10');

    const [company] = await gateway.goals.listGoalPlans(S, { cycleId: cycle2027, ownerType: 'Company' });
    const parent = (await gateway.goals.listGoals(S, { goalPlanIds: [company.id], status: 'Active' })).find((g) => g.targetType === 'NUMERIC' && (g.targetValue ?? 0) > 0) as Goal;
    const over = { childGoalId: b.id, parentGoalId: parent.id, alignmentType: 'CASCADE' as const, contributionPct: null, allocatedValue: (parent.targetValue as number) * 2 };
    expect((await rejection(gateway.goals.saveAlignment(S, admin, over))).code).toBe('ERR-KPI-11');

    const levels = [
      { levelCode: 'L1' as const, targetValue: 10, targetText: null, scorePct: 100 },
      { levelCode: 'L2' as const, targetValue: 20, targetText: null, scorePct: 0 },
    ];
    expect((await rejection(gateway.goals.setTargetLevels(S, admin, a.id, levels))).code).toBe('ERR-KPI-13');
  });
});
