import type { EntityName, Id } from '@/data/types';

/**
 * Query keys — `[tenantId, root, ...params]` (CLAUDE.md rule 7). The tenant comes first, so
 * switching tenant can never serve another tenant's cached rows and `[tenantId, root]` invalidates
 * every variant of a list.
 *
 * Every root says which entities its data is read from. `useGatewayEventInvalidation` turns each
 * `entity.changed` event into "invalidate every root that depends on that entity", so a write in
 * one track (`forms.act` moving a plan) refreshes another track's screens without either listing
 * the other's keys. A new query = a root here (or an existing one) + `queryKey(tenantId, root, …)`.
 */
export const KEY_ROOTS = {
  // Session (Phase 1.3) — everything the access profile is built from.
  sessionDirectory: ['UserAccount', 'UserRole', 'RolePermission', 'Role', 'OrgUnit', 'EmployeeAssignment', 'Employee'],
  // G1
  orgUnits: ['OrgUnit'],
  positions: ['JobPosition'],
  employees: ['Employee', 'EmployeeAssignment', 'OrgUnit'],
  assignments: ['EmployeeAssignment'],
  userAccounts: ['UserAccount'],
  roles: ['Role', 'RolePermission', 'UserRole'],
  // G2
  perspectives: ['BscPerspective'],
  measureUnits: ['MeasureUnit'],
  calcMethods: ['CalcMethod', 'CalcTier'],
  kpiDefinitions: ['KpiDefinition'],
  kpiTemplates: ['KpiTemplate', 'KpiTemplateItem'],
  // G3
  cycles: ['PerformanceCycle', 'CyclePeriod'],
  goalPlans: ['GoalPlan'],
  kgis: ['Kgi'],
  goals: ['Goal', 'GoalTargetLevel', 'GoalPeriodTarget'],
  alignments: ['GoalAlignment'],
  // G4
  dataSources: ['DataSource'],
  connections: ['IntegrationConnection', 'DataMapping', 'SyncRun'],
  actuals: ['GoalActual'],
  importBatches: ['ImportBatch'],
  evidence: ['Evidence', 'FileObject'],
  // G5
  workflows: ['WorkflowTemplate', 'WorkflowStep'],
  launches: ['FormLaunch', 'FormLaunchRule'],
  forms: ['FormInstance', 'FormStepAction', 'EvaluationItem', 'GoalChangeItem'],
  /** "Việc cần xử lý" — who must act depends on the forms, delegations and the reporting line. */
  inbox: ['FormInstance', 'Delegation', 'EmployeeAssignment', 'UserRole'],
  delegations: ['Delegation'],
  // G6
  ratingScales: ['RatingScale', 'RatingLevel', 'PayoutRule'],
  results: ['PeriodResult', 'ResultDetail'],
  payrollExports: ['PayrollExport'],
  // G7
  files: ['FileObject'],
  notificationTemplates: ['NotificationTemplate'],
  notifications: ['Notification'],
  /**
   * The simulated assistant (Phase 3). Its keys carry the DIGEST of the snapshot it was asked about
   * (`dashboardRules.snapshotDigest`), so new numbers are a new key — no entity needs to stale it.
   */
  insight: [],
  /** The audit log records every change, so every change refreshes it. */
  auditLog: '*',
} as const satisfies Record<string, readonly EntityName[] | '*'>;

export type KeyRoot = keyof typeof KEY_ROOTS;

/** `[tenantId, root, ...params]` — put filter objects in as they are (sort id lists first). */
export const queryKey = <R extends KeyRoot, P extends readonly unknown[]>(tenantId: Id, root: R, ...params: P) =>
  [tenantId, root, ...params] as const;

/** The roots whose data an `entity.changed` on `entity` makes stale. */
export function rootsAffectedBy(entity: EntityName): KeyRoot[] {
  return (Object.entries(KEY_ROOTS) as [KeyRoot, readonly EntityName[] | '*'][])
    .filter(([, deps]) => deps === '*' || deps.includes(entity))
    .map(([root]) => root);
}

/** The tenant list has no tenant to key by (the platform exception, `session.ts`). */
export const TENANTS_KEY = ['platform', 'tenants'] as const;

/**
 * The simulated clock's reading (dev toolbar) — not tenant data: one clock serves every tenant
 * (`DataGateway.clock`), so like the tenant list it is keyed apart.
 */
export const DEV_NOW_KEY = ['dev', 'now'] as const;
