import { describe, expect, it } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import { seedId } from '@/data/fixtures/ids';
import { COLLECTION_NAMES, type CollectionName, type TenantSeed } from '@/data/fixtures/types';
import type { Goal, RecipientFilter } from '@/data/types';
import { KpiDeferredError } from '@/lib/errorCatalog';
import type { DataGateway, DomainEvent } from '../types';
import { flush, newGateway, rejection, testSeed } from './gateway.test-util';
import { SCHEMA, type RefSpec } from './schema';
import { keyOf } from './store';

/**
 * Tenant isolation — what stands in for RLS until Phase 5 (BR-KPI-50, plan §8.1). Demo Co never
 * sees, writes or hears anything of Syntra, by any path, and the answer to another tenant's id is
 * word for word the answer to an id that does not exist. The suite fails if a contract method is
 * not covered by one of its tables.
 */

const seed = testSeed();
const syntra = seed.tenants.find((t) => t.tenant.id === SYNTRA.tenantId) as TenantSeed;
const demo = seed.tenants.find((t) => t.tenant.id === DEMO.tenantId) as TenantSeed;
const D = DEMO.tenantId;
const S = SYNTRA.tenantId;
const demoActor = DEMO.user(DEMO.personas.hr);

/** Every key of every Syntra row — no Demo answer may contain one. */
const SYNTRA_IDS = new Set(COLLECTION_NAMES.flatMap((c) => syntra.rows[c].map((r) => keyOf(c, r as never))));
const NOWHERE = seedId('nowhere', 'id');

function foreignIdsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string' && SYNTRA_IDS.has(value)) found.push(value);
  else if (Array.isArray(value)) for (const v of value) foreignIdsIn(v, found);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) foreignIdsIn(v, found);
  return found;
}

const firstId = (t: TenantSeed, c: CollectionName) => keyOf(c, t.rows[c][0] as never);
const sId = (c: CollectionName) => firstId(syntra, c);
const dId = (c: CollectionName) => firstId(demo, c);
const normal = (detail: string | undefined, id: string) => (detail ?? '').split(id).join('<id>');

/** Rejects alike for another tenant's id and for an id that exists nowhere (same code, same words). */
async function expectSameAsMissing(call: (id: string) => Promise<unknown>, foreignId: string, code: string) {
  const foreign = await rejection(call(foreignId));
  const missing = await rejection(call(NOWHERE));
  expect(foreign.code).toBe(code);
  expect(missing.code).toBe(code);
  expect(normal(foreign.detail, foreignId)).toBe(normal(missing.detail, NOWHERE));
}

// ─── Reads that take no id: the answer as Demo Co contains no Syntra id ──────────────────────────
type Read = (gw: DataGateway) => Promise<unknown>;
const LIST_READS: Record<string, Read> = {
  'org.listOrgUnits': (gw) => gw.org.listOrgUnits(D),
  'org.listPositions': (gw) => gw.org.listPositions(D),
  'org.listEmployees': (gw) => gw.org.listEmployees(D, { includeResigned: true }),
  'org.listAssignments': (gw) => gw.org.listAssignments(D),
  'org.listUserAccounts': (gw) => gw.org.listUserAccounts(D),
  'org.listRoles': (gw) => gw.org.listRoles(D),
  'org.listRolePermissions': (gw) => gw.org.listRolePermissions(D),
  'org.listUserRoles': (gw) => gw.org.listUserRoles(D),
  'library.listPerspectives': (gw) => gw.library.listPerspectives(D),
  'library.listMeasureUnits': (gw) => gw.library.listMeasureUnits(D),
  'library.listCalcMethods': (gw) => gw.library.listCalcMethods(D),
  'library.listCalcTiers': (gw) => gw.library.listCalcTiers(D),
  'library.listKpiDefinitions': (gw) => gw.library.listKpiDefinitions(D),
  'library.listKpiTemplates': (gw) => gw.library.listKpiTemplates(D),
  'library.listKpiTemplateItems': (gw) => gw.library.listKpiTemplateItems(D),
  'goals.listCycles': (gw) => gw.goals.listCycles(D),
  'goals.listGoalPlans': (gw) => gw.goals.listGoalPlans(D),
  'goals.listGoals': (gw) => gw.goals.listGoals(D),
  'goals.listAlignments': (gw) => gw.goals.listAlignments(D),
  'actuals.listDataSources': (gw) => gw.actuals.listDataSources(D),
  'actuals.listConnections': (gw) => gw.actuals.listConnections(D),
  'actuals.listMappings': (gw) => gw.actuals.listMappings(D),
  'actuals.listSyncRuns': (gw) => gw.actuals.listSyncRuns(D),
  'actuals.listActuals': (gw) => gw.actuals.listActuals(D, { currentOnly: false }),
  'actuals.listImportBatches': (gw) => gw.actuals.listImportBatches(D),
  'actuals.listEvidence': (gw) => gw.actuals.listEvidence(D),
  'forms.listWorkflows': (gw) => gw.forms.listWorkflows(D),
  'forms.listWorkflowSteps': (gw) => gw.forms.listWorkflowSteps(D),
  'forms.listLaunches': (gw) => gw.forms.listLaunches(D),
  'forms.listLaunchRules': (gw) => gw.forms.listLaunchRules(D),
  'forms.listForms': (gw) => gw.forms.listForms(D, {}, { limit: 500 }),
  'forms.listDelegations': (gw) => gw.forms.listDelegations(D),
  'results.listRatingScales': (gw) => gw.results.listRatingScales(D),
  'results.listRatingLevels': (gw) => gw.results.listRatingLevels(D),
  'results.listPayoutRules': (gw) => gw.results.listPayoutRules(D),
  'results.listPeriodResults': (gw) => gw.results.listPeriodResults(D),
  'results.listPayrollExports': (gw) => gw.results.listPayrollExports(D),
  'system.listNotificationTemplates': (gw) => gw.system.listNotificationTemplates(D),
  'system.listNotifications': (gw) => gw.system.listNotifications(D, DEMO.user(DEMO.personas.employee), {}, { limit: 500 }),
  'system.listAuditLog': (gw) => gw.system.listAuditLog(D, {}, { limit: 500 }),
};

// ─── Reads by id: another tenant's id answers ERR-KPI-02 exactly like a missing one ──────────────
type ById = (gw: DataGateway, id: string) => Promise<unknown>;
const ID_READS: Record<string, [CollectionName, ById]> = {
  'org.getEmployee': ['Employee', (gw, id) => gw.org.getEmployee(D, id)],
  'org.getUserAccount': ['UserAccount', (gw, id) => gw.org.getUserAccount(D, id)],
  'library.getKpiDefinition': ['KpiDefinition', (gw, id) => gw.library.getKpiDefinition(D, id)],
  'goals.getCycle': ['PerformanceCycle', (gw, id) => gw.goals.getCycle(D, id)],
  'goals.listPeriods': ['PerformanceCycle', (gw, id) => gw.goals.listPeriods(D, id)],
  'goals.getGoalPlan': ['GoalPlan', (gw, id) => gw.goals.getGoalPlan(D, id)],
  'goals.listKgis': ['GoalPlan', (gw, id) => gw.goals.listKgis(D, id)],
  'goals.getGoal': ['Goal', (gw, id) => gw.goals.getGoal(D, id)],
  'goals.listTargetLevels': ['GoalPlan', (gw, id) => gw.goals.listTargetLevels(D, { goalPlanId: id })],
  'goals.listPeriodTargets': ['GoalPlan', (gw, id) => gw.goals.listPeriodTargets(D, { goalPlanId: id })],
  'actuals.getImportBatch': ['ImportBatch', (gw, id) => gw.actuals.getImportBatch(D, id)],
  'forms.getLaunch': ['FormLaunch', (gw, id) => gw.forms.getLaunch(D, id)],
  'forms.getForm': ['FormInstance', (gw, id) => gw.forms.getForm(D, id)],
  'forms.listFormActions': ['FormInstance', (gw, id) => gw.forms.listFormActions(D, id)],
  'forms.listEvaluationItems': ['FormInstance', (gw, id) => gw.forms.listEvaluationItems(D, id)],
  'forms.listGoalChangeItems': ['FormInstance', (gw, id) => gw.forms.listGoalChangeItems(D, id)],
  'results.listResultDetails': ['Goal', (gw, id) => gw.results.listResultDetails(D, id)],
  'system.getFile': ['FileObject', (gw, id) => gw.system.getFile(D, id)],
  'system.getFileUrl': ['FileObject', (gw, id) => gw.system.getFileUrl(D, id)],
};

// ─── Writes that name a row by id: another tenant's row answers ERR-KPI-02 like a missing one ────
const ID_WRITES: Record<string, [CollectionName, ById]> = {
  'org.setRolePermissions': ['Role', (gw, id) => gw.org.setRolePermissions(D, demoActor, id, [])],
  'org.deleteUserRole': ['UserRole', (gw, id) => gw.org.deleteUserRole(D, demoActor, id)],
  'goals.setPeriodLocked': ['CyclePeriod', (gw, id) => gw.goals.setPeriodLocked(D, demoActor, id, true)],
  'goals.savePeriods': ['PerformanceCycle', (gw, id) => gw.goals.savePeriods(D, demoActor, id, [])],
  'goals.deleteKgi': ['Kgi', (gw, id) => gw.goals.deleteKgi(D, demoActor, id)],
  'goals.deleteGoal': ['Goal', (gw, id) => gw.goals.deleteGoal(D, demoActor, id)],
  'goals.setTargetLevels': ['Goal', (gw, id) => gw.goals.setTargetLevels(D, demoActor, id, [])],
  'goals.deleteAlignment': ['GoalAlignment', (gw, id) => gw.goals.deleteAlignment(D, demoActor, id)],
  'actuals.deleteMapping': ['DataMapping', (gw, id) => gw.actuals.deleteMapping(D, demoActor, id)],
  'actuals.recordActual': ['Goal', (gw, id) => gw.actuals.recordActual(D, demoActor, { goalId: id, periodId: dId('CyclePeriod'), actualValue: 1, actualText: null, note: null })],
  'actuals.rejectImport': ['ImportBatch', (gw, id) => gw.actuals.rejectImport(D, demoActor, id)],
  'actuals.deleteEvidence': ['Evidence', (gw, id) => gw.actuals.deleteEvidence(D, demoActor, id)],
  'forms.revokeDelegation': ['Delegation', (gw, id) => gw.forms.revokeDelegation(D, demoActor, id)],
  'results.deletePayoutRule': ['PayoutRule', (gw, id) => gw.results.deletePayoutRule(D, demoActor, id)],
  'system.markNotificationRead': ['Notification', (gw, id) => gw.system.markNotificationRead(D, demoActor, id)],
};

// ─── Writes with a payload: generated from schema.ts — every writable reference, set to Syntra ───
type Save = (gw: DataGateway, actor: string, row: Record<string, unknown>) => Promise<unknown>;
const demoRow = (c: CollectionName) => ({ ...(demo.rows[c][0] as unknown as Record<string, unknown>) });
const SAVES: Partial<Record<CollectionName, [method: string, save: Save]>> = {
  OrgUnit: ['org.saveOrgUnit', (gw, a, r) => gw.org.saveOrgUnit(D, a, r as never)],
  EmployeeAssignment: ['org.saveAssignment', (gw, a, r) => gw.org.saveAssignment(D, a, r as never)],
  UserAccount: ['org.saveUserAccount', (gw, a, r) => gw.org.saveUserAccount(D, a, r as never)],
  UserRole: ['org.saveUserRole', (gw, a, r) => gw.org.saveUserRole(D, a, r as never)],
  KpiDefinition: ['library.saveKpiDefinition', (gw, a, r) => gw.library.saveKpiDefinition(D, a, r as never)],
  KpiTemplate: ['library.saveKpiTemplate', (gw, a, r) => gw.library.saveKpiTemplate(D, a, r as never, [])],
  KpiTemplateItem: ['library.saveKpiTemplate', (gw, a, r) => gw.library.saveKpiTemplate(D, a, demoRow('KpiTemplate') as never, [r as never])],
  PerformanceCycle: ['goals.saveCycle', (gw, a, r) => gw.goals.saveCycle(D, a, r as never)],
  GoalPlan: ['goals.createGoalPlan', (gw, a, r) => gw.goals.createGoalPlan(D, a, { ...r, id: undefined } as never)],
  Kgi: ['goals.saveKgi', (gw, a, r) => gw.goals.saveKgi(D, a, r as never)],
  Goal: ['goals.saveGoal', (gw, a, r) => gw.goals.saveGoal(D, a, r as never)],
  GoalAlignment: ['goals.saveAlignment', (gw, a, r) => gw.goals.saveAlignment(D, a, r as never)],
  GoalPeriodTarget: ['goals.setPeriodTargets', (gw, a, r) => gw.goals.setPeriodTargets(D, a, r.goalId as string, [r as never])],
  DataSource: ['actuals.saveDataSource', (gw, a, r) => gw.actuals.saveDataSource(D, a, r as never)],
  IntegrationConnection: ['actuals.saveConnection', (gw, a, r) => gw.actuals.saveConnection(D, a, r as never)],
  DataMapping: ['actuals.saveMapping', (gw, a, r) => gw.actuals.saveMapping(D, a, r as never)],
  Evidence: ['actuals.addEvidence', (gw, a, r) => gw.actuals.addEvidence(D, a, { ...r, id: undefined } as never)],
  // All the workflow's steps, the changed one in place — dropping the others would be refused first
  // (open forms point at them, ERR-KPI-04).
  WorkflowStep: [
    'forms.saveWorkflow',
    (gw, a, r) =>
      gw.forms.saveWorkflow(
        D,
        a,
        demo.rows.WorkflowTemplate.find((w) => w.id === r.workflowId) as never,
        demo.rows.WorkflowStep.filter((s) => s.workflowId === r.workflowId).map((s) => (s.id === r.id ? r : s)) as never,
      ),
  ],
  FormLaunchRule: ['forms.saveLaunchRule', (gw, a, r) => gw.forms.saveLaunchRule(D, a, r as never)],
  Delegation: ['forms.saveDelegation', (gw, a, r) => gw.forms.saveDelegation(D, a, r as never)],
  GoalChangeItem: ['forms.saveGoalChangeItems', (gw, a, r) => gw.forms.saveGoalChangeItems(D, a, r.formId as string, [r as never])],
  PayoutRule: ['results.savePayoutRule', (gw, a, r) => gw.results.savePayoutRule(D, a, r as never)],
};
/** Who may make the write at all (the delegation's owner saves it). */
const actorFor = (c: CollectionName) => (c === 'Delegation' ? DEMO.user(DEMO.personas.manager) : demoActor);

const EMPTY_FILTER: RecipientFilter = { orgUnitIds: [], includeChildUnits: false, positionIds: [], jobLevels: [], employmentStatuses: [], employeeIds: [] };

function withRef(c: CollectionName, ref: RefSpec, value: string): Record<string, unknown> {
  const row = demoRow(c);
  const [top, ...rest] = ref.path.split('.');
  if (top === 'recipientFilter') {
    row.recipientMode = 'FILTER';
    row.recipientFilter = { ...EMPTY_FILTER, [rest[0].replace('[]', '')]: [value] };
  } else if (top === 'proposed') {
    const goal = demo.rows.Goal.find((g) => g.id === row.goalId) as Goal;
    const { id: _i, tenantId: _t, goalPlanId: _p, status: _s, replacesGoalId: _r, sortOrder: _o, ...draft } = goal;
    row.changeType = 'MODIFY';
    row.proposed = { ...draft, targetLevels: [], [rest[0]]: value };
  } else {
    row[top.replace('[]', '')] = value;
  }
  return row;
}

const WRITE_CASES = (Object.keys(SAVES) as CollectionName[]).flatMap((c) =>
  SCHEMA[c].refs
    .filter((r) => r.to !== 'Permission' && SCHEMA[c].writable.includes(r.path.split('.')[0].replace('[]', '')))
    .map((r) => [`${c}.${r.path}`, c, r] as const),
);

/** Methods covered elsewhere in this file (or that have no tenant: the tenant list itself). */
const OTHER = new Set([
  'platform.listTenants', 'platform.getTenant', 'platform.saveTenant',
  'org.listPermissions', // the global catalogue — identical for every tenant by design
  'org.savePosition', 'org.saveEmployee', 'library.savePerspective', 'library.saveMeasureUnit', 'library.saveCalcMethod',
  'results.saveRatingScale', 'system.saveNotificationTemplate', 'system.uploadFile', // no writable reference: covered by "update another tenant's row"
  'system.recordNotification', 'system.recordAudit',
]);

describe('tenant isolation — coverage', () => {
  it('covers every method of the contract', () => {
    const { gateway } = newGateway();
    const covered = new Set([
      ...Object.keys(LIST_READS),
      ...Object.keys(ID_READS),
      ...Object.keys(ID_WRITES),
      ...Object.values(SAVES).map(([m]) => m as string),
      ...gateway.registry.deferred.keys(),
      ...OTHER,
    ]);
    const missing = [...gateway.registry.methods.keys()].filter((m) => !covered.has(m));
    expect(missing).toEqual([]);
  });

  it('Demo Co is not empty where it is read, so the scans below can fail', async () => {
    const { gateway } = newGateway();
    for (const [name, read] of Object.entries(LIST_READS)) {
      const result = await read(gateway);
      const size = Array.isArray(result) ? result.length : (result as { items: unknown[] }).items.length;
      if (['results.listPeriodResults', 'results.listPayrollExports'].includes(name)) continue; // empty until Phase 1.5
      expect(size, name).toBeGreaterThan(0);
    }
  });
});

describe('tenant isolation — reads', () => {
  it.each(Object.entries(LIST_READS))('%s as Demo Co returns no Syntra row', async (_, read) => {
    const { gateway } = newGateway();
    expect(foreignIdsIn(await read(gateway))).toEqual([]);
  });

  it('returns exactly each tenant\'s own rows, in both directions', async () => {
    const { gateway } = newGateway();
    for (const t of [syntra, demo]) {
      expect((await gateway.org.listEmployees(t.tenant.id, { includeResigned: true })).length).toBe(t.rows.Employee.length);
      expect((await gateway.goals.listGoals(t.tenant.id)).length).toBe(t.rows.Goal.length);
      expect((await gateway.actuals.listActuals(t.tenant.id, { currentOnly: false })).length).toBe(t.rows.GoalActual.length);
      expect((await gateway.forms.listForms(t.tenant.id, {}, { limit: 500 })).items.length).toBe(t.rows.FormInstance.length);
    }
  });

  it.each(Object.entries(ID_READS))('%s with a Syntra id answers like a missing id (ERR-KPI-02)', async (_, [c, read]) => {
    const { gateway } = newGateway();
    await expectSameAsMissing((id) => read(gateway, id), sId(c), 'ERR-KPI-02');
  });

  it('a filter naming Syntra ids matches nothing in Demo Co', async () => {
    const { gateway } = newGateway();
    expect(await gateway.goals.listGoals(D, { goalPlanIds: [sId('GoalPlan')] })).toEqual([]);
    expect(await gateway.actuals.listActuals(D, { goalIds: [sId('Goal')] })).toEqual([]);
    expect((await gateway.forms.listForms(D, { subjectEmployeeIds: [sId('Employee')] })).items).toEqual([]);
  });

  it('an unknown tenant fails loudly (ERR-KPI-02), never an empty list', async () => {
    const { gateway } = newGateway();
    expect((await rejection(gateway.org.listOrgUnits(NOWHERE))).code).toBe('ERR-KPI-02');
    expect(() => gateway.events.subscribe(NOWHERE, () => {})).toThrow(/ERR-KPI-02/);
  });

  it('a page cursor from Syntra is harmless in Demo Co', async () => {
    const { gateway } = newGateway();
    const syntraPage = await gateway.forms.listForms(S, {}, { limit: 5 });
    const demoPage = await gateway.forms.listForms(D, {}, { limit: 5, cursor: syntraPage.nextCursor as string });
    expect(foreignIdsIn(demoPage)).toEqual([]);
  });
});

describe('tenant isolation — writes', () => {
  it.each(WRITE_CASES)('%s = a Syntra id is refused like a missing id (ERR-KPI-06)', async (_, c, ref) => {
    const [, save] = SAVES[c] as [string, Save];
    const targetIds = ref.to === 'Permission' ? [] : syntra.rows[ref.to].map((r) => keyOf(ref.to as CollectionName, r as never));
    const { gateway } = newGateway();
    await expectSameAsMissing((id) => save(gateway, actorFor(c), withRef(c, ref, id)), targetIds[0], 'ERR-KPI-06');
  });

  it.each(Object.entries(ID_WRITES))('%s on a Syntra row answers like a missing id (ERR-KPI-02)', async (_, [c, write]) => {
    const { gateway } = newGateway();
    await expectSameAsMissing((id) => write(gateway, id), sId(c), 'ERR-KPI-02');
  });

  it.each((Object.keys(SAVES) as CollectionName[]).filter((c) => !['GoalPlan', 'Evidence', 'GoalPeriodTarget', 'KpiTemplateItem', 'WorkflowStep', 'GoalChangeItem'].includes(c)))(
    'updating a Syntra %s from Demo Co answers like a missing id',
    async (c) => {
      const [, save] = SAVES[c] as [string, Save];
      const { gateway } = newGateway();
      await expectSameAsMissing((id) => save(gateway, actorFor(c), { ...demoRow(c), id }), sId(c), 'ERR-KPI-02');
    },
  );

  it('a Syntra actor cannot write in Demo Co (ERR-KPI-05, same as an unknown actor)', async () => {
    const { gateway } = newGateway();
    const save = (actor: string) => gateway.org.savePosition(D, actor, { code: 'X', name: 'X', jobLevel: 'Staff', status: 'Active' });
    const foreign = await rejection(save(SYNTRA.user(SYNTRA.personas.admin)));
    const missing = await rejection(save(NOWHERE));
    expect(foreign.code).toBe('ERR-KPI-05');
    expect(normal(foreign.detail, SYNTRA.user(SYNTRA.personas.admin))).toBe(normal(missing.detail, NOWHERE));
  });

  it('a payload\'s tenantId and gateway-owned columns are ignored', async () => {
    const { gateway } = newGateway();
    const row = { ...demoRow('JobPosition'), tenantId: S, name: 'Đổi tên' };
    const saved = await gateway.org.savePosition(D, demoActor, row as never);
    expect(saved.tenantId).toBe(D);
    const def = { ...demoRow('KpiDefinition'), isSystem: false, tenantId: S };
    expect((await gateway.library.saveKpiDefinition(D, demoActor, def as never)).isSystem).toBe(true);
    const plan = { ...demoRow('GoalPlan'), status: 'Draft' };
    const goal = { ...demoRow('Goal'), status: 'Cancelled' };
    expect((await gateway.goals.saveGoal(D, demoActor, goal as never)).status).toBe('Active');
    expect(plan.status).toBe('Draft'); // (createGoalPlan always starts a plan in Draft — groups test)
  });

  it('a refused write changes nothing and emits nothing, to either tenant', async () => {
    const { gateway } = newGateway();
    const events: DomainEvent[] = [];
    gateway.events.subscribe(D, (e) => void events.push(e));
    gateway.events.subscribe(S, (e) => void events.push(e));
    const before = await gateway.org.listOrgUnits(D);
    await rejection(gateway.org.saveOrgUnit(D, demoActor, { ...demoRow('OrgUnit'), name: 'Đổi', headEmployeeId: sId('Employee') } as never));
    await flush();
    expect(await gateway.org.listOrgUnits(D)).toEqual(before);
    expect(events).toEqual([]);
  });

  it('Demo Co\'s subscriber never hears Syntra\'s events', async () => {
    const { gateway } = newGateway();
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(D, (e) => void heard.push(e));
    await gateway.org.savePosition(S, SYNTRA.user(SYNTRA.personas.hr), { code: 'NEW', name: 'Mới', jobLevel: 'Staff', status: 'Active' });
    await flush();
    expect(heard).toEqual([]);
  });

  it('recordNotification for a Syntra recipient or a Syntra row is refused in Demo Co like a missing id', async () => {
    const { gateway } = newGateway();
    const input = (recipientUserId: string, refId: string) => ({ sourceEventId: 'e', templateId: null, eventCode: 'STEP_ASSIGNED' as const, recipientUserId, refType: 'Form' as const, refId, subject: 's', body: 'b' });
    await expectSameAsMissing((id) => gateway.system.recordNotification(D, input(id, dId('FormInstance'))), sId('UserAccount'), 'ERR-KPI-06');
    await expectSameAsMissing((id) => gateway.system.recordNotification(D, input(demoActor, id)), sId('FormInstance'), 'ERR-KPI-06');
  });

  it('deferred methods reject with KpiDeferredError for every tenant (no isolation case to make yet)', async () => {
    const { gateway } = newGateway();
    const call = gateway.forms.act as unknown as (...args: unknown[]) => Promise<unknown>;
    expect(await rejection(call(D, demoActor, {}))).toBeInstanceOf(KpiDeferredError);
  });
});
