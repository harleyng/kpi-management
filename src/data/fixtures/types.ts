import type {
  AuditLog,
  BscPerspective,
  CalcMethod,
  CalcTier,
  CyclePeriod,
  DataMapping,
  DataSource,
  Delegation,
  Employee,
  EmployeeAssignment,
  EvaluationItem,
  Evidence,
  FileObject,
  FormInstance,
  FormLaunch,
  FormLaunchRule,
  FormStepAction,
  Goal,
  GoalActual,
  GoalAlignment,
  GoalChangeItem,
  GoalPeriodTarget,
  GoalPlan,
  GoalTargetLevel,
  ImportBatch,
  IntegrationConnection,
  JobPosition,
  Kgi,
  KpiDefinition,
  KpiNotification,
  KpiTemplate,
  KpiTemplateItem,
  MeasureUnit,
  NotificationTemplate,
  OrgUnit,
  PayoutRule,
  PayrollExport,
  PerformanceCycle,
  PeriodResult,
  Permission,
  RatingLevel,
  RatingScale,
  ResultDetail,
  Role,
  RolePermission,
  SyncRun,
  Tenant,
  UserAccount,
  UserRole,
  WorkflowStep,
  WorkflowTemplate,
  WorkPlan,
  WorkResult,
  WorkReview,
  WorkReviewItem,
  WorkScoringConfig,
  WorkTask,
} from '@/data/types';

/**
 * The tenant-scoped collections — one per P1 table (`ENTITY_NAMES` minus `Tenant`), the monthly
 * work tables (PEND-14) and the audit log. Names are the `EntityName`s, so an `entity.changed` event names its collection directly.
 * `Tenant` and `Permission` are the only GLOBAL collections (not partitioned by tenant).
 */
export interface CollectionRows {
  OrgUnit: OrgUnit;
  JobPosition: JobPosition;
  Employee: Employee;
  EmployeeAssignment: EmployeeAssignment;
  UserAccount: UserAccount;
  Role: Role;
  RolePermission: RolePermission;
  UserRole: UserRole;
  BscPerspective: BscPerspective;
  MeasureUnit: MeasureUnit;
  CalcMethod: CalcMethod;
  CalcTier: CalcTier;
  KpiDefinition: KpiDefinition;
  KpiTemplate: KpiTemplate;
  KpiTemplateItem: KpiTemplateItem;
  PerformanceCycle: PerformanceCycle;
  CyclePeriod: CyclePeriod;
  GoalPlan: GoalPlan;
  Kgi: Kgi;
  Goal: Goal;
  GoalTargetLevel: GoalTargetLevel;
  GoalAlignment: GoalAlignment;
  GoalPeriodTarget: GoalPeriodTarget;
  DataSource: DataSource;
  IntegrationConnection: IntegrationConnection;
  DataMapping: DataMapping;
  SyncRun: SyncRun;
  ImportBatch: ImportBatch;
  GoalActual: GoalActual;
  Evidence: Evidence;
  WorkflowTemplate: WorkflowTemplate;
  WorkflowStep: WorkflowStep;
  FormInstance: FormInstance;
  FormStepAction: FormStepAction;
  EvaluationItem: EvaluationItem;
  Delegation: Delegation;
  GoalChangeItem: GoalChangeItem;
  FormLaunch: FormLaunch;
  FormLaunchRule: FormLaunchRule;
  RatingScale: RatingScale;
  RatingLevel: RatingLevel;
  PayoutRule: PayoutRule;
  PeriodResult: PeriodResult;
  ResultDetail: ResultDetail;
  PayrollExport: PayrollExport;
  FileObject: FileObject;
  NotificationTemplate: NotificationTemplate;
  Notification: KpiNotification;
  WorkScoringConfig: WorkScoringConfig;
  WorkPlan: WorkPlan;
  WorkTask: WorkTask;
  WorkReview: WorkReview;
  WorkReviewItem: WorkReviewItem;
  WorkResult: WorkResult;
  AuditLog: AuditLog;
}

export type CollectionName = keyof CollectionRows;
export type RowOf<C extends CollectionName> = CollectionRows[C];

/** Load / save order (parents before children), and the one complete list of collections. */
const ORDER: Record<CollectionName, number> = {
  OrgUnit: 0, JobPosition: 1, Employee: 2, EmployeeAssignment: 3, UserAccount: 4, Role: 5,
  RolePermission: 6, UserRole: 7, BscPerspective: 8, MeasureUnit: 9, CalcMethod: 10, CalcTier: 11,
  DataSource: 12, KpiDefinition: 13, KpiTemplate: 14, KpiTemplateItem: 15, RatingScale: 16,
  RatingLevel: 17, PayoutRule: 18, PerformanceCycle: 19, CyclePeriod: 20, GoalPlan: 21, Kgi: 22,
  Goal: 23, GoalTargetLevel: 24, GoalAlignment: 25, GoalPeriodTarget: 26, IntegrationConnection: 27,
  DataMapping: 28, SyncRun: 29, FileObject: 30, ImportBatch: 31, GoalActual: 32, Evidence: 33,
  WorkflowTemplate: 34, WorkflowStep: 35, FormLaunchRule: 36, FormLaunch: 37, FormInstance: 38,
  FormStepAction: 39, EvaluationItem: 40, Delegation: 41, GoalChangeItem: 42, PeriodResult: 43,
  ResultDetail: 44, PayrollExport: 45, NotificationTemplate: 46, Notification: 47,
  // Monthly work (PEND-14): after the forms they hang on.
  WorkScoringConfig: 48, WorkPlan: 49, WorkTask: 50, WorkReview: 51, WorkReviewItem: 52, WorkResult: 53,
  AuditLog: 54,
};

export const COLLECTION_NAMES: readonly CollectionName[] = (Object.keys(ORDER) as CollectionName[]).sort(
  (a, b) => ORDER[a] - ORDER[b],
);

export type CollectionData = { [C in CollectionName]: RowOf<C>[] };

export function emptyCollections(): CollectionData {
  return Object.fromEntries(COLLECTION_NAMES.map((c) => [c, []])) as unknown as CollectionData;
}

/** One tenant's seed. */
export interface TenantSeed {
  tenant: Tenant;
  rows: CollectionData;
}

/** Everything `resetSeed()` loads. */
export interface Seed {
  /** The system-wide permission catalogue (Phase 1.3 owns its codes). */
  permissions: Permission[];
  tenants: TenantSeed[];
}
