import { describe, expect, it } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import { seedId } from '@/data/fixtures/ids';
import { COLLECTION_NAMES, type CollectionName, type TenantSeed } from '@/data/fixtures/types';
import type { Goal, RecipientFilter } from '@/data/types';
import { KpiDeferredError } from '@/lib/errorCatalog';
import type { DataGateway, DomainEvent, FormActionInput, NewLaunchInput, StartFormInput } from '../types';
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
const demoActor = DEMO.user(DEMO.personas.admin);

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
  'work.listWorkPlans': (gw) => gw.work.listWorkPlans(D),
  'work.listWorkResults': (gw) => gw.work.listWorkResults(D),
  'work.listWorkTasksOfPlans': (gw) => gw.work.listWorkTasksOfPlans(D, demo.rows.WorkPlan.map((p) => p.id)),
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
  'work.getWorkPlan': ['WorkPlan', (gw, id) => gw.work.getWorkPlan(D, id)],
  'work.listWorkTasks': ['WorkPlan', (gw, id) => gw.work.listWorkTasks(D, id)],
  'work.getWorkReview': ['FormInstance', (gw, id) => gw.work.getWorkReview(D, id)],
  'work.listWorkReviewItems': ['FormInstance', (gw, id) => gw.work.listWorkReviewItems(D, id)],
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

// ═══ Gate 1 workflow lane ════════════════════════════════════════════════════════════════════════
// (a) Guards wired at Gate 1 answer BEFORE the reference check on Demo Co's rows: its plans are
// Locked (plan edits → ERR-KPI-04), its only cycle Active (cycle edits → 04), its forms Completed
// (form edits → 04). A reference case first makes the row writable the way a user would.
// (b) The methods wired at Gate 1 (formerly deferred) get their own cases below.

const demoWorkflow = (formType: string) => (demo.rows.WorkflowTemplate.find((w) => w.formType === formType) as { id: string }).id;
const demoStaffPlan = DEMO.id('GoalPlan', 'D003');
const FAR = '2099-12-31';

async function unlockDemoPlans(gw: DataGateway): Promise<void> {
  for (const plan of demo.rows.GoalPlan) await gw.goals.unlockGoalPlan(D, demoActor, plan.id, 'Kiểm thử cô lập dữ liệu', FAR);
}

type Row = Record<string, unknown>;
type Prepare = (gw: DataGateway) => Promise<(row: Row) => Row>;
const unlocked: Prepare = async (gw) => {
  await unlockDemoPlans(gw);
  return (row) => row;
};
const PREPARE: Partial<Record<CollectionName, Prepare>> = {
  // An Active cycle is not editable (cycleRules): a NEW cycle carries the reference instead.
  PerformanceCycle: async () => (row) => ({ ...row, id: undefined }),
  Kgi: unlocked,
  Goal: unlocked,
  GoalAlignment: unlocked,
  GoalPeriodTarget: unlocked,
  // The seeded adjustment is Completed: open a new one on the (Locked) plan and propose there.
  GoalChangeItem: async (gw) => {
    const form = await gw.forms.startForm(D, demoActor, { workflowId: demoWorkflow('GOAL_CHANGE'), subjectEmployeeId: DEMO.employee('D003'), goalPlanId: demoStaffPlan, periodId: null, dueDate: FAR });
    return (row) => ({ ...row, id: undefined, formId: form.id });
  },
};

const demoForm = (key: string) => DEMO.id('FormInstance', key);
const cancelInput = (o: Partial<FormActionInput> = {}): FormActionInput => ({
  formId: demoForm('GS'), expectedStepId: dId('WorkflowStep'), action: 'CANCEL', comment: 'Hủy', onBehalfOfUserId: null, delegationId: null, ...o,
});
const startInput = (o: Partial<StartFormInput> = {}): StartFormInput => ({
  workflowId: demoWorkflow('GOAL_CHANGE'), subjectEmployeeId: DEMO.employee('D003'), goalPlanId: demoStaffPlan, periodId: null, dueDate: FAR, ...o,
});
const launchInput = (o: Partial<NewLaunchInput> = {}): NewLaunchInput =>
  ({
    workflowId: demoWorkflow('KPI_EVAL'), name: 'Đánh giá', cycleId: DEMO.id('PerformanceCycle', '2027'), periodId: DEMO.id('CyclePeriod', 'T02'),
    dueDays: 7, recipientMode: 'ALL', recipientFilter: null, timing: 'NOW', ...o,
  }) as NewLaunchInput;
const filterWith = (field: keyof RecipientFilter, id: string) => launchInput({ recipientMode: 'FILTER', recipientFilter: { ...EMPTY_FILTER, [field]: [id] } });

/** Wired methods that name a row by id: another tenant's row answers ERR-KPI-02 like a missing one. */
const WORKFLOW_ID_CALLS: Record<string, [CollectionName, ById]> = {
  'forms.act': ['FormInstance', (gw, id) => gw.forms.act(D, demoActor, cancelInput({ formId: id }))],
  'forms.saveEvaluationItems': ['FormInstance', (gw, id) => gw.forms.saveEvaluationItems(D, demoActor, id, [])],
  'forms.cancelLaunch': ['FormLaunch', (gw, id) => gw.forms.cancelLaunch(D, demoActor, id)],
  'forms.listInbox': ['UserAccount', (gw, id) => gw.forms.listInbox(D, id)],
  'goals.lockGoalPlan': ['GoalPlan', (gw, id) => gw.goals.lockGoalPlan(D, demoActor, id)],
  'goals.unlockGoalPlan': ['GoalPlan', (gw, id) => gw.goals.unlockGoalPlan(D, demoActor, id, 'Lý do', FAR)],
  'goals.setCycleStatus': ['PerformanceCycle', (gw, id) => gw.goals.setCycleStatus(D, demoActor, id, 'Evaluating')],
};

/** Wired methods whose PAYLOAD names rows: each reference set to a Syntra id → ERR-KPI-06 like a missing one. */
const WORKFLOW_PAYLOAD_REFS: [string, CollectionName, ById][] = [
  ['forms.startForm workflowId', 'WorkflowTemplate', (gw, id) => gw.forms.startForm(D, demoActor, startInput({ workflowId: id }))],
  ['forms.startForm subjectEmployeeId', 'Employee', (gw, id) => gw.forms.startForm(D, demoActor, startInput({ subjectEmployeeId: id }))],
  ['forms.startForm goalPlanId', 'GoalPlan', (gw, id) => gw.forms.startForm(D, demoActor, startInput({ goalPlanId: id }))],
  ['forms.startForm periodId', 'CyclePeriod', (gw, id) => gw.forms.startForm(D, demoActor, startInput({ periodId: id }))],
  ['forms.act onBehalfOfUserId', 'UserAccount', (gw, id) => gw.forms.act(D, demoActor, cancelInput({ onBehalfOfUserId: id }))],
  ['forms.act delegationId', 'Delegation', (gw, id) => gw.forms.act(D, demoActor, cancelInput({ delegationId: id }))],
  ['forms.createLaunch workflowId', 'WorkflowTemplate', (gw, id) => gw.forms.createLaunch(D, demoActor, launchInput({ workflowId: id }))],
  ['forms.createLaunch cycleId', 'PerformanceCycle', (gw, id) => gw.forms.createLaunch(D, demoActor, launchInput({ cycleId: id }))],
  ['forms.createLaunch periodId', 'CyclePeriod', (gw, id) => gw.forms.createLaunch(D, demoActor, launchInput({ periodId: id }))],
  ['forms.createLaunch recipientFilter.orgUnitIds', 'OrgUnit', (gw, id) => gw.forms.createLaunch(D, demoActor, filterWith('orgUnitIds', id))],
  ['forms.createLaunch recipientFilter.positionIds', 'JobPosition', (gw, id) => gw.forms.createLaunch(D, demoActor, filterWith('positionIds', id))],
  ['forms.createLaunch recipientFilter.employeeIds', 'Employee', (gw, id) => gw.forms.createLaunch(D, demoActor, filterWith('employeeIds', id))],
];

const WORKFLOW_COVERED = new Set([
  ...Object.keys(WORKFLOW_ID_CALLS),
  ...WORKFLOW_PAYLOAD_REFS.map(([name]) => name.split(' ')[0]),
  'scheduler.runDue', // its own case below: a tick of one tenant touches nothing of another
]);

// ═══ Track T4 — the import framework (4.4.3) and the API sync (4.4.5) ══════════════════════════
const demoCycle = DEMO.id('PerformanceCycle', '2027');
const demoT02 = DEMO.id('CyclePeriod', 'T02');
const demoUpload = async (gw: DataGateway) => (await gw.system.uploadFile(D, demoActor, { fileName: 'so-lieu.xlsx', mimeType: 'application/octet-stream', data: new Blob(['x']) })).id;
const actualRow = (o: Record<string, unknown> = {}) => ({
  rowNo: 2, goalId: DEMO.id('Goal', 'D003', 1), login: null, kpiCode: null, periodLabel: 'T02', actualValue: 1, actualText: null, note: null, evidenceUrl: null, ...o,
});

/** Methods that name a row by id: another tenant's row answers ERR-KPI-02 like a missing one. */
const T4_ID_CALLS: [string, CollectionName, ById][] = [
  ['actuals.commitImport batchId', 'ImportBatch', (gw, id) => gw.actuals.commitImport(D, demoActor, id)],
  // The period is resolved before the (Inactive) connection is judged, so both answer like a missing id.
  ['actuals.runSync connectionId', 'IntegrationConnection', (gw, id) => gw.actuals.runSync(D, demoActor, id, demoT02)],
  ['actuals.runSync periodId', 'CyclePeriod', (gw, id) => gw.actuals.runSync(D, demoActor, dId('IntegrationConnection'), id)],
];
/** Payload references of stageImport: a Syntra id → ERR-KPI-06 like a missing one. */
const T4_PAYLOAD_REFS: [string, CollectionName, ById][] = [
  ['actuals.stageImport fileId', 'FileObject', (gw, id) => gw.actuals.stageImport(D, demoActor, { importType: 'Actual', fileId: id, cycleId: demoCycle, rows: [actualRow()] })],
  ['actuals.stageImport cycleId', 'PerformanceCycle', async (gw, id) => gw.actuals.stageImport(D, demoActor, { importType: 'Actual', fileId: await demoUpload(gw), cycleId: id, rows: [actualRow()] })],
];
const T4_COVERED = new Set([...T4_ID_CALLS, ...T4_PAYLOAD_REFS].map(([name]) => name.split(' ')[0]));

// ═══ Plan B — monthly work (PEND-14, step 8.1) ═══════════════════════════════════════════════════
const demoWorkPlan = DEMO.id('WorkPlan', 'D003', 'T01');
const demoTask = DEMO.id('WorkTask', 'D003', 'T01', 1);
const demoTaskRows = () => demo.rows.WorkTask.filter((t) => t.workPlanId === demoWorkPlan);
const taskInput = (o: Record<string, unknown> = {}) => ({
  name: 'Việc mới', product: null, description: null, unitText: null, weight: 10, startDate: '2027-01-01', dueDate: '2027-01-31', visibility: 'PUBLIC', linkedGoalId: null, ...o,
});
/** An open review in Demo Co (T02, launched now): D003 may save her own column. */
const openReviews = new WeakMap<DataGateway, Promise<string>>();
function openDemoReview(gw: DataGateway): Promise<string> {
  const known = openReviews.get(gw);
  if (known) return known;
  const opened = (async () => {
    const launch = await gw.forms.createLaunch(D, demoActor, { ...filterWith('employeeIds', DEMO.employee('D003')), workflowId: demoWorkflow('WORK_REVIEW'), periodId: demoT02 });
    const forms = (await gw.forms.listForms(D, { launchId: launch.id })).items;
    expect(forms).toHaveLength(1);
    return forms[0].id;
  })();
  openReviews.set(gw, opened);
  return opened;
}

const WORK_ID_CALLS: [string, CollectionName, ById][] = [
  ['work.saveWorkTasks workPlanId', 'WorkPlan', (gw, id) => gw.work.saveWorkTasks(D, demoActor, id, [])],
  ['work.cancelWorkTask taskId', 'WorkTask', (gw, id) => gw.work.cancelWorkTask(D, demoActor, id, 'Lý do')],
  ['work.updateTaskProgress taskId', 'WorkTask', (gw, id) => gw.work.updateTaskProgress(D, demoActor, id, { progressPct: 50, progressStatus: 'InProgress', note: null })],
  ['work.saveWorkReview formId', 'FormInstance', (gw, id) => gw.work.saveWorkReview(D, demoActor, id, {})],
];
const WORK_PAYLOAD_REFS: [string, CollectionName, ById][] = [
  // Another tenant's task id in the list is "not a task of this plan" — exactly like an unknown id.
  ['work.saveWorkTasks tasks[].id', 'WorkTask', (gw, id) => gw.work.saveWorkTasks(D, demoActor, demoWorkPlan, [...demoTaskRows(), { ...taskInput(), id }] as never)],
  ['work.saveWorkTasks tasks[].linkedGoalId', 'Goal', (gw, id) => gw.work.saveWorkTasks(D, demoActor, demoWorkPlan, [...demoTaskRows(), taskInput({ linkedGoalId: id })] as never)],
  ['work.saveWorkReview items[].itemId', 'WorkReviewItem', async (gw, id) => gw.work.saveWorkReview(D, DEMO.user('D003'), await openDemoReview(gw), { items: [{ itemId: id, score: 50 }] })],
];
const WORK_COVERED = new Set([
  ...[...WORK_ID_CALLS, ...WORK_PAYLOAD_REFS].map(([name]) => name.split(' ')[0]),
  'work.getWorkScoringConfig', // one row per tenant, no id: its own case below
  'work.saveWorkScoringConfig', // no reference in its payload: its own case below
]);

describe('tenant isolation — coverage', () => {
  it('covers every method of the contract', () => {
    const { gateway } = newGateway();
    const covered = new Set([
      ...Object.keys(LIST_READS),
      ...Object.keys(ID_READS),
      ...Object.keys(ID_WRITES),
      ...Object.values(SAVES).map(([m]) => m as string),
      ...Object.keys(SCORING_ID_WRITES),
      ...gateway.registry.deferred.keys(),
      ...OTHER,
      ...WORKFLOW_COVERED,
      ...T4_COVERED,
      ...WORK_COVERED,
    ]);
    const missing = [...gateway.registry.methods.keys()].filter((m) => !covered.has(m));
    expect(missing).toEqual([]);
  });

  it('Demo Co is not empty where it is read, so the scans below can fail', async () => {
    const { gateway } = newGateway();
    // The seed has no payroll export (none is seeded, by choice): Demo Co makes one first.
    await gateway.results.exportPayroll(D, demoActor, DEMO.id('CyclePeriod', 'Q1'));
    for (const [name, read] of Object.entries(LIST_READS)) {
      const result = await read(gateway);
      const size = Array.isArray(result) ? result.length : (result as { items: unknown[] }).items.length;
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
    const writable = PREPARE[c] ? await (PREPARE[c] as Prepare)(gateway) : (row: Row) => row;
    await expectSameAsMissing((id) => save(gateway, actorFor(c), writable(withRef(c, ref, id))), targetIds[0], 'ERR-KPI-06');
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
    await unlockDemoPlans(gateway); // Demo Co's plans are Locked (Gate 1 plan-edit guard)
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
    await gateway.org.savePosition(S, SYNTRA.user(SYNTRA.personas.admin), { code: 'NEW', name: 'Mới', jobLevel: 'Staff', status: 'Active' });
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
    for (const name of gateway.registry.deferred.keys()) {
      const [group, method] = name.split('.');
      const call = (gateway as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>)[group][method];
      expect(await rejection(call(D, demoActor, {})), name).toBeInstanceOf(KpiDeferredError);
    }
  });
});

describe('tenant isolation — Gate 1 workflow lane (methods wired at Gate 1)', () => {
  it.each(Object.entries(WORKFLOW_ID_CALLS))('%s with a Syntra id answers like a missing id (ERR-KPI-02)', async (_, [c, call]) => {
    const { gateway } = newGateway();
    await expectSameAsMissing((id) => call(gateway, id), sId(c), 'ERR-KPI-02');
  });

  it.each(WORKFLOW_PAYLOAD_REFS)('%s = a Syntra id is refused like a missing id (ERR-KPI-06)', async (_, c, call) => {
    const { gateway } = newGateway();
    await expectSameAsMissing((id) => call(gateway, id), sId(c), 'ERR-KPI-06');
  });

  it('a Demo Co inbox holds no Syntra form', async () => {
    const { gateway } = newGateway();
    for (const persona of Object.values(DEMO.personas)) expect(foreignIdsIn(await gateway.forms.listInbox(D, DEMO.user(persona)))).toEqual([]);
  });

  it('a scheduler tick of Demo Co touches, reports and announces nothing of Syntra', async () => {
    const { gateway } = newGateway();
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void heard.push(e));
    const before = await gateway.forms.listForms(S, {}, { limit: 500 });
    gateway.dev?.setNow('2027-06-01T02:00:00.000Z'); // overdue steps, rule firings and reminders everywhere
    const report = await gateway.scheduler.runDue(D);
    await flush();
    expect(foreignIdsIn(report)).toEqual([]);
    expect(heard).toEqual([]);
    expect(await gateway.forms.listForms(S, {}, { limit: 500 })).toEqual(before);
    expect((await rejection(gateway.scheduler.runDue(NOWHERE))).code).toBe('ERR-KPI-02');
  });

  it('a Syntra actor cannot act, launch, lock or start a form in Demo Co (ERR-KPI-05)', async () => {
    const { gateway } = newGateway();
    const syntraHr = SYNTRA.user(SYNTRA.personas.hr);
    for (const call of [
      gateway.forms.act(D, syntraHr, cancelInput()),
      gateway.forms.createLaunch(D, syntraHr, launchInput()),
      gateway.goals.lockGoalPlan(D, syntraHr, demoStaffPlan),
      gateway.forms.startForm(D, syntraHr, startInput()),
      gateway.forms.saveEvaluationItems(D, syntraHr, demoForm('EVAL-T01'), []),
    ]) {
      expect((await rejection(call)).code).toBe('ERR-KPI-05');
    }
  });
});

// ═══ Scoring lane (Gate 1): the result lifecycle — results.calculate / adjust / finalize / lock ═══

const SCORING_ID_WRITES: Record<string, [CollectionName, ById]> = {
  'results.calculateResults': ['CyclePeriod', (gw, id) => gw.results.calculateResults(D, demoActor, id)],
  'results.setAdjustment': ['PeriodResult', (gw, id) => gw.results.setAdjustment(D, demoActor, id, 1)],
  'results.finalizeResults': ['CyclePeriod', (gw, id) => gw.results.finalizeResults(D, demoActor, id)],
  'results.lockResults': ['CyclePeriod', (gw, id) => gw.results.lockResults(D, demoActor, id)],
  'results.exportPayroll': ['CyclePeriod', (gw, id) => gw.results.exportPayroll(D, demoActor, id)],
};

describe('tenant isolation — the result lifecycle (scoring lane)', () => {
  it.each(Object.entries(SCORING_ID_WRITES))('%s on a Syntra row answers like a missing id (ERR-KPI-02)', async (_, [c, write]) => {
    const { gateway } = newGateway();
    await expectSameAsMissing((id) => write(gateway, id), sId(c), 'ERR-KPI-02');
  });

  it('finalizeResults naming a Syntra result in a Demo period answers like a missing id', async () => {
    const { gateway } = newGateway();
    const demoPeriod = DEMO.id('CyclePeriod', 'T01');
    await expectSameAsMissing((id) => gateway.results.finalizeResults(D, demoActor, demoPeriod, [id]), sId('PeriodResult'), 'ERR-KPI-02');
  });

  it('Demo Co calculates from its own rows only, and Syntra\'s results stay as they were', async () => {
    const { gateway } = newGateway();
    const syntraBefore = await gateway.results.listPeriodResults(S);
    const results = await gateway.results.calculateResults(D, demoActor, DEMO.id('CyclePeriod', 'T01'));
    expect(results.length).toBeGreaterThan(0);
    expect(foreignIdsIn(results)).toEqual([]);
    for (const r of results) expect(foreignIdsIn(await gateway.results.listResultDetails(D, r.id))).toEqual([]);
    expect(await gateway.results.listPeriodResults(S)).toEqual(syntraBefore);
  });
});

describe('tenant isolation — Track T4 (the import framework and the API sync)', () => {
  it.each(T4_ID_CALLS)('%s = a Syntra id answers like a missing id (ERR-KPI-02)', async (_, c, call) => {
    const { gateway } = newGateway();
    await expectSameAsMissing((id) => call(gateway, id), sId(c), 'ERR-KPI-02');
  });

  it.each(T4_PAYLOAD_REFS)('%s = a Syntra id is refused like a missing id (ERR-KPI-06)', async (_, c, call) => {
    const { gateway } = newGateway();
    await expectSameAsMissing((id) => call(gateway, id), sId(c), 'ERR-KPI-06');
  });

  it('a row naming a Syntra goal id or a Syntra login is a row error worded exactly like an unknown one', async () => {
    const { gateway } = newGateway();
    const stage = async (row: Record<string, unknown>) =>
      (await gateway.actuals.stageImport(D, demoActor, { importType: 'Actual', fileId: await demoUpload(gateway), cycleId: demoCycle, rows: [actualRow(row)] as never })).errors;
    const syntraLogin = syntra.rows.UserAccount.find((u) => u.employeeId !== null)?.login as string;
    expect(await stage({ goalId: sId('Goal') })).toEqual(await stage({ goalId: NOWHERE }));
    expect(await stage({ goalId: null, login: syntraLogin, kpiCode: 'KPI-DOANH-THU' })).toEqual(await stage({ goalId: null, login: 'khong.ton.tai', kpiCode: 'KPI-DOANH-THU' }));
    expect((await stage({ goalId: sId('Goal') })).map((e) => e.detail)).toEqual(['GOAL_NOT_FOUND']);
  });

  it('a Syntra actor cannot stage, commit, reject or sync in Demo Co (ERR-KPI-05)', async () => {
    const { gateway } = newGateway();
    const syntraHr = SYNTRA.user(SYNTRA.personas.hr);
    const fileId = await demoUpload(gateway);
    const calls = [
      gateway.actuals.stageImport(D, syntraHr, { importType: 'Actual', fileId, cycleId: demoCycle, rows: [actualRow()] as never }),
      gateway.actuals.commitImport(D, syntraHr, dId('ImportBatch')),
      gateway.actuals.rejectImport(D, syntraHr, dId('ImportBatch')),
      gateway.actuals.runSync(D, syntraHr, dId('IntegrationConnection'), demoT02),
    ];
    for (const call of calls) expect((await rejection(call)).code).toBe('ERR-KPI-05');
  });

  it('a Demo Co sync of a Syntra-looking setup writes nothing to Syntra, and its run carries no Syntra id', async () => {
    const { gateway } = newGateway();
    const connection = (await gateway.actuals.listConnections(D))[0];
    await gateway.actuals.saveConnection(D, demoActor, { ...connection, status: 'Active' });
    const syntraBefore = await gateway.actuals.listActuals(S, { currentOnly: false });
    const run = await gateway.actuals.runSync(D, demoActor, connection.id, demoT02);
    expect(foreignIdsIn(run)).toEqual([]);
    expect(foreignIdsIn(await gateway.actuals.listActuals(D, { currentOnly: false }))).toEqual([]);
    expect(await gateway.actuals.listActuals(S, { currentOnly: false })).toEqual(syntraBefore);
  });
});

describe('tenant isolation — Plan B monthly work (PEND-14)', () => {
  it.each(WORK_ID_CALLS)('%s = a Syntra id answers like a missing id (ERR-KPI-02)', async (_, c, call) => {
    const { gateway } = newGateway();
    await expectSameAsMissing((id) => call(gateway, id), sId(c), 'ERR-KPI-02');
  });

  it.each(WORK_PAYLOAD_REFS)('%s = a Syntra id is refused like a missing id (ERR-KPI-06)', async (_, c, call) => {
    const { gateway } = newGateway();
    await expectSameAsMissing((id) => call(gateway, id), sId(c), 'ERR-KPI-06');
  });

  it('filters naming Syntra people or periods match nothing in Demo Co', async () => {
    const { gateway } = newGateway();
    expect(await gateway.work.listWorkPlans(D, { employeeIds: [sId('Employee')] })).toEqual([]);
    expect(await gateway.work.listWorkPlans(D, { periodId: sId('CyclePeriod') })).toEqual([]);
    expect(await gateway.work.listWorkResults(D, { employeeIds: syntra.rows.WorkResult.map((r) => r.employeeId) })).toEqual([]);
    expect(await gateway.work.listWorkTasksOfPlans(D, syntra.rows.WorkPlan.map((p) => p.id))).toEqual([]);
  });

  it('each tenant reads its own scoring config; saving Demo Co\'s leaves Syntra\'s as it was', async () => {
    const { gateway } = newGateway();
    const syntraBefore = await gateway.work.getWorkScoringConfig(S);
    expect(foreignIdsIn(await gateway.work.getWorkScoringConfig(D))).toEqual([]);
    const saved = await gateway.work.saveWorkScoringConfig(D, demoActor, { resultWeight: 60, disciplineWeight: 40, hsnvThreshold: 75, scoreMin: 0, scoreMax: 100 });
    expect(saved.tenantId).toBe(D);
    expect(await gateway.work.getWorkScoringConfig(S)).toEqual(syntraBefore);
  });

  it('a Syntra actor cannot write monthly work in Demo Co (ERR-KPI-05)', async () => {
    const { gateway } = newGateway();
    const syntraHr = SYNTRA.user(SYNTRA.personas.hr);
    for (const call of [
      gateway.work.saveWorkTasks(D, syntraHr, demoWorkPlan, []),
      gateway.work.cancelWorkTask(D, syntraHr, demoTask, 'Lý do'),
      gateway.work.updateTaskProgress(D, syntraHr, demoTask, { progressPct: 1, progressStatus: 'InProgress', note: null }),
      gateway.work.saveWorkReview(D, syntraHr, demoForm('WR:T01:D003'), {}),
      gateway.work.saveWorkScoringConfig(D, syntraHr, { resultWeight: 70, disciplineWeight: 30, hsnvThreshold: 80, scoreMin: 0, scoreMax: 100 }),
    ]) {
      expect((await rejection(call)).code).toBe('ERR-KPI-05');
    }
  });
});
