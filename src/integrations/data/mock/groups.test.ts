import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SYNTRA } from '@/data/fixtures';
import type { DomainEvent } from '../types';
import { flush, newGateway, rejection } from './gateway.test-util';

/** Behaviour the contract promises, method by method (beyond tenant isolation). */
const S = SYNTRA.tenantId;
const hr = SYNTRA.user(SYNTRA.personas.hr);
const cycleId = SYNTRA.id('PerformanceCycle', '2027');

// jsdom has no blob URLs; the browser does.
beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = vi.fn(() => 'blob:mock/test');
});

describe('org', () => {
  it('lists employees by unit with children, by manager, by date, and with a diacritic-insensitive search', async () => {
    const { gateway } = newGateway();
    const kd = await gateway.org.listEmployees(S, { orgUnitId: SYNTRA.unit('KD'), includeChildUnits: true, activeOn: '2027-04-06' });
    expect(kd.map((e) => e.employeeCode)).toEqual(expect.arrayContaining(['E003', 'E006', 'E016', 'E019']));
    expect(kd.some((e) => e.employeeCode === 'E024')).toBe(false); // resigned, excluded by default
    const reports = await gateway.org.listEmployees(S, { managerEmployeeId: SYNTRA.employee('E006') });
    expect(reports.map((e) => e.employeeCode).sort()).toEqual(['E015', 'E016', 'E017', 'E018']);
    expect((await gateway.org.listEmployees(S, { search: 'nguyen van an' })).map((e) => e.employeeCode)).toEqual(['E016']);
    // The dated move: E021 was in CSKH in 2026, in Marketing in 2027.
    expect((await gateway.org.listEmployees(S, { orgUnitId: SYNTRA.unit('CSKH'), activeOn: '2026-06-01' })).some((e) => e.employeeCode === 'E021')).toBe(true);
    expect((await gateway.org.listEmployees(S, { orgUnitId: SYNTRA.unit('CSKH'), activeOn: '2027-04-06' })).some((e) => e.employeeCode === 'E021')).toBe(false);
  });

  it('refuses a unit placed below itself, a duplicate code, and a second root', async () => {
    const { gateway } = newGateway();
    const kd = (await gateway.org.listOrgUnits(S)).find((u) => u.code === 'KD');
    const kdbh = (await gateway.org.listOrgUnits(S)).find((u) => u.code === 'KDBH');
    expect((await rejection(gateway.org.saveOrgUnit(S, hr, { ...(kd as object), parentId: kdbh?.id } as never))).detail).toMatch(/below itself/);
    expect((await rejection(gateway.org.saveOrgUnit(S, hr, { ...(kdbh as object), id: undefined } as never))).detail).toMatch(/duplicate/);
    expect((await rejection(gateway.org.saveOrgUnit(S, hr, { ...(kd as object), id: undefined, code: 'ROOT2', parentId: null, unitType: 'Company' } as never))).detail).toMatch(/one root/);
  });

  it('a payload missing a column is refused (ERR-KPI-06), never stored half-empty', async () => {
    const { gateway } = newGateway();
    const error = await rejection(gateway.org.savePosition(S, hr, { code: 'X', name: 'X', jobLevel: 'Staff' } as never));
    expect(error.code).toBe('ERR-KPI-06');
    expect(error.detail).toMatch(/JobPosition.status is required/);
  });

  it('setRolePermissions replaces the role\'s whole set and refuses an unknown permission', async () => {
    const { gateway } = newGateway();
    const role = (await gateway.org.listRoles(S)).find((r) => r.code === 'BOD');
    const rows = await gateway.org.setRolePermissions(S, hr, role?.id as string, ['perm.org.view']);
    expect(rows).toEqual([{ tenantId: S, roleId: role?.id, permissionId: 'perm.org.view' }]);
    expect((await gateway.org.listRolePermissions(S)).filter((r) => r.roleId === role?.id)).toHaveLength(1);
    expect((await rejection(gateway.org.setRolePermissions(S, hr, role?.id as string, ['perm.nope']))).code).toBe('ERR-KPI-06');
  });
});

describe('aggregates — children matched by id', () => {
  it('keeps a child\'s id when it is sent back, creates one without, and refuses removing a referenced one', async () => {
    const { gateway } = newGateway();
    const workflow = (await gateway.forms.listWorkflows(S, 'KPI_EVAL'))[0];
    const steps = await gateway.forms.listWorkflowSteps(S, workflow.id);
    const saved = await gateway.forms.saveWorkflow(S, hr, workflow, steps.map((s) => ({ ...s, name: `${s.name} (sửa)` })));
    expect(saved.children.map((s) => s.id)).toEqual(steps.map((s) => s.id));
    expect(saved.children.map((s) => s.stepNo)).toEqual([1, 2, 3]);
    // Forms point at step 3: dropping it is refused, nothing changes.
    const error = await rejection(gateway.forms.saveWorkflow(S, hr, workflow, steps.slice(0, 2)));
    expect(error.code).toBe('ERR-KPI-04');
    expect(await gateway.forms.listWorkflowSteps(S, workflow.id)).toHaveLength(3);
  });

  it('a parent foreign key cannot change on update', async () => {
    const { gateway } = newGateway();
    const plan = (await gateway.goals.listGoalPlans(S, { ownerType: 'Employee' }))[0];
    const goal = (await gateway.goals.listGoals(S, { goalPlanIds: [plan.id] }))[0];
    const other = (await gateway.goals.listGoalPlans(S, { ownerType: 'Employee' }))[1];
    expect((await rejection(gateway.goals.saveGoal(S, hr, { ...goal, goalPlanId: other.id }))).detail).toMatch(/goalPlanId cannot change/);
  });

  it('deleting a goal cascades to its levels, monthly targets and alignments; one with actuals is refused', async () => {
    const { gateway } = newGateway();
    const draft = (await gateway.goals.listGoalPlans(S, { status: 'Draft' })).find((p) => p.ownerEmployeeId === SYNTRA.employee('E030'));
    const goal = (await gateway.goals.listGoals(S, { goalPlanIds: [draft?.id as string] }))[0];
    expect((await rejection(gateway.goals.deleteGoal(S, hr, goal.id))).code).toBe('ERR-KPI-04'); // evaluated T01–T03, has actuals
    const fresh = await gateway.goals.saveGoal(S, hr, { ...goal, id: undefined, sortOrder: 9 });
    await gateway.goals.setPeriodTargets(S, hr, fresh.id, [{ periodId: SYNTRA.id('CyclePeriod', 2027, 'T05'), targetValue: 1 }]);
    await gateway.goals.deleteGoal(S, hr, fresh.id);
    expect(await gateway.goals.listPeriodTargets(S, { goalIds: [fresh.id] })).toEqual([]);
  });
});

describe('delete policies', () => {
  it('set-null: deleting a KGI clears it on its goals; every row touched is announced', async () => {
    const { gateway } = newGateway();
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void heard.push(e));
    const plan = SYNTRA.id('GoalPlan', cycleId, 'E016');
    const [kgi] = await gateway.goals.listKgis(S, plan);
    const using = (await gateway.goals.listGoals(S, { goalPlanIds: [plan] })).filter((g) => g.kgiId === kgi.id);
    expect(using.length).toBeGreaterThan(0);
    await gateway.goals.deleteKgi(S, hr, kgi.id);
    for (const g of await gateway.goals.listGoals(S, { goalPlanIds: [plan] })) expect(g.kgiId).not.toBe(kgi.id);
    const changed = heard.filter((e) => e.type === 'entity.changed');
    expect(changed).toContainEqual(expect.objectContaining({ entityName: 'Kgi', entityId: kgi.id, action: 'DELETE', after: null }));
    expect(changed.filter((e) => e.type === 'entity.changed' && e.entityName === 'Goal' && e.action === 'UPDATE')).toHaveLength(using.length);
  });

  it('cascade: deleting a goal announces the DELETE of each child it took with it', async () => {
    const { gateway } = newGateway();
    const goal = (await gateway.goals.listGoals(S, { ownerEmployeeId: SYNTRA.employee('E030') }))[0];
    const fresh = await gateway.goals.saveGoal(S, hr, { ...goal, id: undefined, sortOrder: 9 });
    await gateway.goals.setPeriodTargets(S, hr, fresh.id, [{ periodId: SYNTRA.id('CyclePeriod', 2027, 'T05'), targetValue: 1 }]);
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void heard.push(e));
    await gateway.goals.deleteGoal(S, hr, fresh.id);
    const deleted = heard.filter((e) => e.type === 'entity.changed' && e.action === 'DELETE').map((e) => (e as { entityName: string }).entityName);
    expect(deleted.sort()).toEqual(['Goal', 'GoalPeriodTarget']);
  });
});

describe('goals', () => {
  it('createGoalPlan starts in Draft and refuses a second plan for the same owner and cycle', async () => {
    const { gateway } = newGateway();
    const created = await gateway.goals.createGoalPlan(S, hr, { cycleId: SYNTRA.id('PerformanceCycle', '2028'), planType: 'KPI', ownerType: 'Employee', ownerOrgUnitId: null, ownerEmployeeId: SYNTRA.employee('E016') });
    expect(created).toMatchObject({ status: 'Draft', lockedAt: null });
    const again = await rejection(gateway.goals.createGoalPlan(S, hr, { cycleId: SYNTRA.id('PerformanceCycle', '2028'), planType: 'KPI', ownerType: 'Employee', ownerOrgUnitId: null, ownerEmployeeId: SYNTRA.employee('E016') }));
    expect(again.detail).toMatch(/duplicate/);
  });

  it('saveCycle creates a cycle in Planning; listPeriods is ordered', async () => {
    const { gateway } = newGateway();
    const cycle = await gateway.goals.saveCycle(S, hr, { name: 'KPI 2029', startDate: '2029-01-01', endDate: '2029-12-31', ratingScaleId: null });
    expect(cycle.status).toBe('Planning');
    const labels = (await gateway.goals.listPeriods(S, cycleId)).map((p) => p.label);
    expect(labels.slice(0, 3)).toEqual(['T01', 'Q1', 'T02']);
  });
});

describe('actuals', () => {
  it('recordActual adds a snapshot, retires the previous one and announces actuals.recorded', async () => {
    const { gateway } = newGateway();
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void heard.push(e));
    const goal = (await gateway.goals.listGoals(S, { ownerEmployeeId: SYNTRA.employee('E016') }))[1];
    const t03 = SYNTRA.id('CyclePeriod', 2027, 'T03');
    const before = await gateway.actuals.listActuals(S, { goalIds: [goal.id], periodId: t03 });
    const row = await gateway.actuals.recordActual(S, hr, { goalId: goal.id, periodId: t03, actualValue: 42, actualText: null, note: 'sửa' });
    expect(row).toMatchObject({ sourceType: 'MANUAL', enteredBy: hr, isCurrent: true, actualValue: 42 });
    const now = await gateway.actuals.listActuals(S, { goalIds: [goal.id], periodId: t03 });
    expect(now).toEqual([row]);
    const history = await gateway.actuals.listActuals(S, { goalIds: [goal.id], periodId: t03, currentOnly: false });
    expect(history.length).toBe(before.length + 1);
    expect(heard.find((e) => e.type === 'actuals.recorded')).toMatchObject({ periodId: t03, goalIds: [goal.id], sourceType: 'MANUAL' });
  });

  it('evidence needs a file or a URL, and its actual must belong to its goal', async () => {
    const { gateway } = newGateway();
    const [g1, g2] = await gateway.goals.listGoals(S, { ownerEmployeeId: SYNTRA.employee('E016') });
    expect((await rejection(gateway.actuals.addEvidence(S, hr, { goalId: g1.id, periodId: null, actualId: null, fileId: null, url: null, note: null }))).code).toBe('ERR-KPI-06');
    const [actual] = await gateway.actuals.listActuals(S, { goalIds: [g2.id] });
    expect((await rejection(gateway.actuals.addEvidence(S, hr, { goalId: g1.id, periodId: null, actualId: actual.id, fileId: null, url: 'https://x.test', note: null }))).detail).toMatch(/another goalId/);
  });

  it('a staged batch keeps its rows and row errors (the seed\'s CRM batch)', async () => {
    const { gateway } = newGateway();
    const batches = await gateway.actuals.listImportBatches(S, 'Actual');
    const staged = batches.find((b) => b.status === 'Validating');
    expect(staged?.rowsError).toBe(2);
    expect(staged?.errors.every((e) => e.code === 'ERR-KPI-06')).toBe(true);
  });
});

describe('forms', () => {
  it('pages forms newest first with a keyset cursor, never repeating a row', async () => {
    const { gateway } = newGateway();
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await gateway.forms.listForms(S, {}, { limit: 25, cursor });
      ids.push(...page.items.map((f) => f.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe((await gateway.forms.listForms(S, {}, { limit: 500 })).items.length);
    expect((await rejection(gateway.forms.listForms(S, {}, { limit: 501 }))).code).toBe('ERR-KPI-06');
    expect((await rejection(gateway.forms.listForms(S, {}, { cursor: 'garbage' }))).code).toBe('ERR-KPI-06');
  });

  it('a delegation is the actor\'s own: fromUserId comes from the actor; revoking twice is refused', async () => {
    const { gateway } = newGateway();
    const manager = SYNTRA.user('E006');
    const d = await gateway.forms.saveDelegation(S, manager, { toUserId: SYNTRA.user('E015'), formType: 'KPI_EVAL', validFrom: '2027-04-10', validTo: '2027-04-20' });
    expect(d).toMatchObject({ fromUserId: manager, revokedAt: null });
    expect((await rejection(gateway.forms.saveDelegation(S, hr, { ...d }))).code).toBe('ERR-KPI-05');
    const revoked = await gateway.forms.revokeDelegation(S, manager, d.id);
    expect(revoked.revokedAt).not.toBeNull();
    expect((await rejection(gateway.forms.revokeDelegation(S, manager, d.id))).code).toBe('ERR-KPI-04');
  });

  it('saveGoalChangeItems only on a GOAL_CHANGE form', async () => {
    const { gateway } = newGateway();
    const evalForm = (await gateway.forms.listForms(S, { formType: 'KPI_EVAL' }, { limit: 1 })).items[0];
    expect((await rejection(gateway.forms.saveGoalChangeItems(S, hr, evalForm.id, []))).detail).toMatch(/not a GOAL_CHANGE/);
  });
});

describe('system', () => {
  it('only the recipient marks a notification read', async () => {
    const { gateway } = newGateway();
    const employee = SYNTRA.user('E016');
    const [n] = (await gateway.system.listNotifications(S, employee, { unreadOnly: true })).items;
    expect((await rejection(gateway.system.markNotificationRead(S, hr, n.id))).code).toBe('ERR-KPI-05');
    expect(await gateway.system.markNotificationRead(S, employee, n.id)).toMatchObject({ status: 'Read' });
    expect((await gateway.system.listNotifications(S, employee, { unreadOnly: true })).items.some((x) => x.id === n.id)).toBe(false);
  });

  it('recordNotification is idempotent per (event, recipient) and not audited', async () => {
    const { gateway } = newGateway();
    const input = { sourceEventId: 'evt-1', templateId: null, eventCode: 'STEP_ASSIGNED' as const, recipientUserId: hr, refType: 'GoalPlan' as const, refId: SYNTRA.id('GoalPlan', cycleId, 'E017'), subject: 'a', body: 'b' };
    const first = await gateway.system.recordNotification(S, input);
    const second = await gateway.system.recordNotification(S, input);
    expect(second.id).toBe(first.id);
    await flush();
    expect((await gateway.system.listAuditLog(S, { entityName: 'Notification' })).items).toEqual([]);
    expect((await rejection(gateway.system.recordNotification(S, { ...input, sourceEventId: 'evt-2', refId: 'nope' }))).detail).toMatch(/refId not found/);
  });

  it('uploads a file and hands back an URL; a seeded file opens a placeholder', async () => {
    const { gateway } = newGateway();
    const file = await gateway.system.uploadFile(S, hr, { fileName: 'a.txt', mimeType: 'text/plain', data: new Blob(['xin chào']) });
    expect(file).toMatchObject({ uploadedBy: hr, sizeBytes: new Blob(['xin chào']).size });
    expect(typeof (await gateway.system.getFileUrl(S, file.id))).toBe('string');
    const seeded = SYNTRA.id('FileObject', 'evidence-1');
    expect(typeof (await gateway.system.getFileUrl(S, seeded))).toBe('string');
  });
});
