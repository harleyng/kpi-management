/**
 * The `DataGateway` contract — the ONLY way the app reads or writes domain data.
 *
 *   components/pages → React Query hooks (src/hooks/queries/*) → DataGateway
 *                                                                ├── mockGateway     (now)
 *                                                                └── supabaseGateway (Phase 5)
 *
 * Obtain it with `getDataGateway()` from `./index`. No component, page or hook imports an adapter
 * file directly (CLAUDE.md, critical rule 3).
 *
 * Non-negotiables for every method (CLAUDE.md, critical rule 4; reviewed at the Phase 1.1 gate):
 *
 * 1. **Tenant first.** The first argument is `tenantId` and the method filters by it — there is no
 *    RLS in the prototype; this argument IS the tenant boundary.
 *    - A `get`/update of an id that exists only in another tenant throws `ERR-KPI-02`, exactly like
 *      an id that does not exist — never a hint that it does.
 *    - **Every id inside a write payload** (perspectiveId, dataSourceId, parentGoalId,
 *      onBehalfOfUserId, delegationId…) must resolve inside `tenantId`, or the write throws
 *      `ERR-KPI-06`. A cross-tenant foreign key is never writable.
 *    - Tenant-isolation tests cover reads AND writes. The one exception to the rule is `platform.*`,
 *      whose subject is the tenant itself.
 *    - An unknown `tenantId` rejects ERR-KPI-02 on every method except `platform.listTenants` —
 *      never an empty list.
 * 2. **Actor second.** Every user write takes `actorUserId` second — the signed-in user from
 *    `useSession()`. It is what `enteredBy`, `uploadedBy`, the audit log… record; "who did it" is
 *    never taken from the payload. System writes (`system.recordNotification`, `system.recordAudit`)
 *    are called only by T7's event listeners and take no actor.
 * 3. **One clock.** The adapter stamps every timestamp, deadline check and "today" from `clock.now()`
 *    — never from the machine directly. The mock's dev toolbar moves it (`dev.setNow`), so a launch
 *    fired on a simulated 1 Feb and the `act` that follows agree on the date. "Today" in the
 *    tenant's zone is computed from it by a rules function.
 * 4. **Loud failures.** Methods are `async`, return domain types from `@/data/types`, and reject with
 *    `KpiError` (`src/lib/errorCatalog.ts`) — never resolve with an empty list to hide a failure.
 *    ERR-KPI-02 not found · 03 write failed · 04 not allowed in the current state · 05 actor not
 *    entitled · 06 invalid input (incl. a parent foreign key changed on update).
 * 5. **Rules, not copies.** Business decisions (can this plan be submitted, which step is next, what
 *    is the score) are `src/lib/*Rules.ts` functions. An adapter CALLS them to refuse an illegal
 *    write; it never holds its own copy (common-pitfalls.md).
 * 6. **Every successful write emits `entity.changed`** (one per row touched), plus the domain events
 *    other tracks react to. That is what the audit log (WBS 4.8.4) and cache invalidation hang on.
 * 7. **List-by-ids**: an omitted filter field does not filter; an EMPTY id list returns `[]`.
 *
 * Phase 1.1 fixed the SHAPE; Phase 1.2 implements it in the mock (`./mock/`). A method whose rule is
 * not wired yet rejects with `KpiDeferredError` (`mockGateway.registry.deferred`); Gate 1 requires
 * that list — and the pending guards — to be empty. After Gate 1 changing the contract is a Large
 * change (system-architect, and every track is told).
 */

import type {
  AlignmentType,
  AuditAction,
  AuditLog,
  BscPerspective,
  CalcMethod,
  CalcTier,
  CycleStatus,
  CyclePeriod,
  DataMapping,
  DataSource,
  Delegation,
  Employee,
  EmployeeAssignment,
  EntityName,
  EvaluationItem,
  Evidence,
  FileObject,
  FormInstance,
  FormLaunch,
  FormLaunchRule,
  FormStatus,
  FormStepAction,
  FormType,
  Goal,
  GoalActual,
  GoalAlignment,
  GoalChangeItem,
  GoalPeriodTarget,
  GoalPlan,
  GoalPlanStatus,
  GoalStatus,
  GoalTargetLevel,
  Id,
  ImportBatch,
  ImportRowsByType,
  ImportType,
  IntegrationConnection,
  IsoDate,
  IsoDateTime,
  JobPosition,
  Kgi,
  KpiDefinition,
  KpiNotification,
  KpiTemplate,
  KpiTemplateItem,
  LibraryStatus,
  MeasureUnit,
  NotificationEvent,
  NotificationRefType,
  NotificationTemplate,
  OrgUnit,
  OverdueBehaviour,
  OwnerType,
  PayoutRule,
  PayrollExport,
  PerformanceCycle,
  PeriodResult,
  PeriodResultStatus,
  Permission,
  PersonFormAction,
  RatingLevel,
  RatingScale,
  ResultDetail,
  Role,
  RolePermission,
  SourceType,
  StepAction,
  SyncRun,
  Tenant,
  TenantScoped,
  UserAccount,
  UserRole,
  WorkflowStep,
  WorkflowTemplate,
} from '@/data/types';

export type DataAdapterName = 'mock' | 'supabase';

// ─── Input and output helpers ──────────────────────────────────────────────────────────────────

/**
 * What a caller sends to create or update a row: everything except `tenantId` (the first argument
 * carries it) and the `Managed` columns the gateway sets itself (status transitions, timestamps,
 * who-did-it). `id` present = update that row; absent = create. A parent foreign key (e.g.
 * `Goal.goalPlanId`) cannot change on update — `ERR-KPI-06`.
 */
export type Upsert<T extends TenantScoped, Managed extends keyof T = never> = Omit<
  T,
  'id' | 'tenantId' | Managed
> & { id?: Id };

/**
 * A child row sent with its parent's save (tiers of a method, steps of a workflow, levels of a
 * scale). Children are matched BY ID: a child with an `id` is updated in place, so rows pointing at
 * it (`FormInstance.currentStepId`, `PeriodResult.ratingLevelId`…) stay valid; one without is
 * created; a stored child missing from the list is removed — refused with `ERR-KPI-04` while
 * anything references it.
 */
export type ChildInput<T extends TenantScoped, Parent extends keyof T> = Omit<T, 'id' | 'tenantId' | Parent> & {
  id?: Id;
};

/** What an aggregate save returns, so a hook can refresh the parent and children keys at once. */
export interface Aggregate<P, C> {
  parent: P;
  children: C[];
}

/** Cursor pagination for the lists that grow without bound (forms, notifications, audit log). */
export interface PageRequest {
  /** Default 50, max 500; outside 1…500 is ERR-KPI-06. */
  limit?: number;
  /**
   * `nextCursor` from the previous page; omitted = first page. A KEYSET cursor (the last row's sort
   * key and id), so a row added between two reads never repeats or shifts the next page. An
   * unreadable cursor is ERR-KPI-06.
   */
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  /** `null` on the last page. */
  nextCursor: string | null;
}

/** Selects goals either by plan (a stable query key) or by an explicit id list. */
export type GoalScope = { goalPlanId: Id } | { goalIds: readonly Id[] };

// ─── Filters ───────────────────────────────────────────────────────────────────────────────────
// Every field is optional and AND-ed; an omitted field does not filter; an empty id list matches
// nothing. Hooks put the filter object in the query key as-is (sort id lists first).

export interface EmployeeFilter {
  orgUnitId?: Id;
  /** With `orgUnitId`: include the unit's descendants. */
  includeChildUnits?: boolean;
  managerEmployeeId?: Id;
  /** Only people with an assignment effective on this date. Omitted: no date filter. */
  activeOn?: IsoDate;
  includeResigned?: boolean;
  /** Diacritic-insensitive (`foldDiacritics`) on name, code and email. */
  search?: string;
}

export interface AssignmentFilter {
  employeeId?: Id;
  orgUnitId?: Id;
  managerEmployeeId?: Id;
  activeOn?: IsoDate;
}

export interface KpiDefinitionFilter {
  status?: LibraryStatus;
  perspectiveId?: Id;
  search?: string;
}

export interface GoalPlanFilter {
  cycleId?: Id;
  ownerType?: OwnerType;
  ownerOrgUnitId?: Id;
  ownerEmployeeIds?: readonly Id[];
  status?: GoalPlanStatus;
}

export interface GoalFilter {
  goalPlanIds?: readonly Id[];
  ownerEmployeeId?: Id;
  kpiDefId?: Id;
  status?: GoalStatus;
}

export interface AlignmentFilter {
  /** Rows where the goal is the parent OR the child. */
  goalId?: Id;
  parentGoalId?: Id;
  childGoalId?: Id;
  alignmentType?: AlignmentType;
}

export interface ActualFilter {
  goalIds?: readonly Id[];
  periodId?: Id;
  sourceType?: SourceType;
  /** Default `true`: only the current snapshot per (goal, period). `false` returns the history. */
  currentOnly?: boolean;
}

export interface EvidenceFilter {
  goalId?: Id;
  periodId?: Id;
  actualId?: Id;
}

export interface FormFilter {
  formType?: FormType;
  subjectEmployeeIds?: readonly Id[];
  launchId?: Id;
  periodId?: Id;
  goalPlanId?: Id;
  status?: FormStatus;
}

export interface PeriodResultFilter {
  periodId?: Id;
  goalPlanIds?: readonly Id[];
  ownerType?: OwnerType;
  status?: PeriodResultStatus;
}

export interface AuditLogFilter {
  entityName?: EntityName;
  entityId?: Id;
  userId?: Id;
  from?: IsoDateTime;
  to?: IsoDateTime;
}

// ─── Command payloads ──────────────────────────────────────────────────────────────────────────

/** Parsed import rows, typed per import type so rows of two types can never be mixed. */
export type StageImportInput = {
  [K in ImportType]: {
    importType: K;
    fileId: Id;
    /** Required for `Actual` and `GoalPlan` (period labels and plans resolve in it). */
    cycleId: Id | null;
    rows: readonly ImportRowsByType[K][];
  };
}[ImportType];

export interface RecordActualInput {
  goalId: Id;
  periodId: Id;
  actualValue: number | null;
  actualText: string | null;
  note: string | null;
}

/**
 * "Lưu nháp" on an evaluation form — only the current step's columns are accepted. A key left
 * `undefined` leaves the column untouched; `null` clears it.
 */
export interface EvaluationItemPatch {
  itemId: Id;
  selfAchievementPct?: number | null;
  selfComment?: string | null;
  managerAchievementPct?: number | null;
  managerComment?: string | null;
  finalAchievementPct?: number | null;
  finalComment?: string | null;
}

/**
 * Acting on a form's current step.
 * - `expectedStepId` is the step the screen showed; if the form has moved on, `ERR-KPI-04`.
 * - `onBehalfOfUserId` = the person whose step it is, when the actor is a proxy (HR) or a delegate;
 *   `delegationId` is set for a delegate. Entitlement is checked by `workflowRules` against
 *   `clock.now()`; for SUBMIT/APPROVE also `formRules.canSubmit` (D6).
 * - CANCEL is HR/ADMIN only, at any non-terminal step, and needs a `comment` (the reason).
 */
export interface FormActionInput {
  formId: Id;
  expectedStepId: Id;
  action: PersonFormAction;
  comment: string | null;
  onBehalfOfUserId: Id | null;
  delegationId: Id | null;
}

/** Starting one form by hand: an adjustment (GOAL_CHANGE), or a Company / OrgUnit plan's registration. */
export interface StartFormInput {
  workflowId: Id;
  subjectEmployeeId: Id;
  goalPlanId: Id | null;
  periodId: Id | null;
  dueDate: IsoDate;
}

/** A one-off launch as HR creates it; `RECURRING` launches come only from a `FormLaunchRule`. */
export type NewLaunchInput = Omit<
  FormLaunch,
  'id' | 'tenantId' | 'formType' | 'timing' | 'scheduledAt' | 'status' | 'launchedAt' | 'createdBy' | 'createdAt' | 'launchRuleId'
> &
  ({ timing: 'NOW' } | { timing: 'SCHEDULED'; scheduledAt: IsoDateTime });

export interface UploadFileInput {
  fileName: string;
  mimeType: string;
  data: Blob;
}

/** Written by T7's listener after it renders a template. */
export interface NewNotificationInput {
  /** The event that caused it — the write is idempotent per (sourceEventId, recipientUserId). */
  sourceEventId: Id;
  templateId: Id | null;
  eventCode: NotificationEvent;
  recipientUserId: Id;
  refType: NotificationRefType;
  refId: Id;
  subject: string;
  body: string;
}

/** What one scheduler tick did (see `scheduler.runDue`). */
export interface SchedulerReport {
  launchesFired: Id[];
  formsCreated: Id[];
  overdueHandled: { formId: Id; stepId: Id; behaviour: OverdueBehaviour }[];
  remindersDue: { formId: Id; stepId: Id }[];
}

// ─── Domain events (the bus T7 and the query-cache invalidation listen on) ────────────────────

/**
 * A row as it was before / after a write — any domain row (they are JSON-safe by construction:
 * no functions, no Dates). `system.recordAudit` stores it as the audit log's json column.
 */
export type RowSnapshot = object;

interface EventBase {
  /** Unique per event; listeners are idempotent by it. */
  id: Id;
  tenantId: Id;
  occurredAt: IsoDateTime;
  /** `null` for a system action (scheduler). */
  actorUserId: Id | null;
  onBehalfOfUserId: Id | null;
}

export type EntityChangedEvent = EventBase & {
  type: 'entity.changed';
  entityName: EntityName;
  entityId: Id;
  action: AuditAction;
  before: RowSnapshot | null;
  after: RowSnapshot | null;
  /** The reason the action took, if any (unlock, cancel). */
  reason: string | null;
};

export type DomainEvent =
  | EntityChangedEvent
  | (EventBase & { type: 'goalPlan.statusChanged'; goalPlanId: Id; from: GoalPlanStatus; to: GoalPlanStatus })
  | (EventBase & { type: 'form.launched'; launchId: Id; formIds: Id[] })
  | (EventBase & {
      type: 'form.stepActed';
      formId: Id;
      stepId: Id;
      action: StepAction;
      /** The step the form moved to; `null` when it completed or was cancelled. */
      nextStepId: Id | null;
      /** Who must act next (resolved by `workflowRules`), for STEP_ASSIGNED / RETURNED. */
      assigneeUserIds: Id[];
      formStatus: FormStatus;
    })
  | (EventBase & {
      type: 'form.dueSoon';
      formId: Id;
      stepId: Id;
      assigneeUserIds: Id[];
      deadline: IsoDate;
      /**
       * `workflowRules.reminderKey(form)` — the same for every tick inside the reminder window of one
       * step entry. The scheduler does not deduplicate reminders: T7's listener uses this as the
       * notification's `sourceEventId`, so the reminder is written once per recipient.
       */
      reminderKey: string;
    })
  | (EventBase & { type: 'form.overdue'; formId: Id; stepId: Id; behaviour: OverdueBehaviour; assigneeUserIds: Id[] })
  | (EventBase & {
      type: 'actuals.recorded';
      periodId: Id;
      goalIds: Id[];
      sourceType: SourceType;
      batchId: Id | null;
      syncRunId: Id | null;
    })
  | (EventBase & { type: 'results.finalized'; periodId: Id; resultIds: Id[] })
  | (EventBase & { type: 'payroll.exported'; periodId: Id; exportId: Id });

export type DomainEventType = DomainEvent['type'];
export type Unsubscribe = () => void;

/**
 * A listener may be async. The bus awaits nothing but CATCHES a throw or a rejection and reports it
 * (console.error in the mock; the 1.4 dev toolbar can read the same diagnostic sink), so a failed
 * audit write is visible, never swallowed — and never fails the write that emitted the event.
 * Events are emitted only after the write committed. System listeners (T7) are registered once,
 * when the gateway is built — never in a React effect, which StrictMode runs twice.
 */
export type DomainEventListener = (event: DomainEvent) => void | Promise<void>;

// ─── The contract, one group per ERD group ─────────────────────────────────────────────────────

/**
 * Tenants themselves — the one group not scoped by a `tenantId` filter, because its subject is the
 * tenant. Used by the simulated session switcher (1.3) and tenant management (WBS 4.1.1). A tenant
 * write is audited in that tenant's own log.
 */
export interface PlatformGateway {
  listTenants(): Promise<Tenant[]>;
  getTenant(tenantId: Id): Promise<Tenant>;
  saveTenant(actorUserId: Id, input: Omit<Tenant, 'id' | 'createdAt'> & { id?: Id }): Promise<Tenant>;
}

/** G1 · Tổ chức & người dùng (T1). */
export interface OrgGateway {
  listOrgUnits(tenantId: Id): Promise<OrgUnit[]>;
  saveOrgUnit(tenantId: Id, actorUserId: Id, input: Upsert<OrgUnit>): Promise<OrgUnit>;

  listPositions(tenantId: Id): Promise<JobPosition[]>;
  savePosition(tenantId: Id, actorUserId: Id, input: Upsert<JobPosition>): Promise<JobPosition>;

  listEmployees(tenantId: Id, filter?: EmployeeFilter): Promise<Employee[]>;
  getEmployee(tenantId: Id, employeeId: Id): Promise<Employee>;
  saveEmployee(tenantId: Id, actorUserId: Id, input: Upsert<Employee>): Promise<Employee>;

  listAssignments(tenantId: Id, filter?: AssignmentFilter): Promise<EmployeeAssignment[]>;
  saveAssignment(tenantId: Id, actorUserId: Id, input: Upsert<EmployeeAssignment>): Promise<EmployeeAssignment>;

  listUserAccounts(tenantId: Id): Promise<UserAccount[]>;
  getUserAccount(tenantId: Id, userId: Id): Promise<UserAccount>;
  saveUserAccount(tenantId: Id, actorUserId: Id, input: Upsert<UserAccount, 'lastLoginAt'>): Promise<UserAccount>;

  listRoles(tenantId: Id): Promise<Role[]>;
  /** The system catalogue — identical for every tenant; `tenantId` is taken for uniformity. */
  listPermissions(tenantId: Id): Promise<Permission[]>;
  listRolePermissions(tenantId: Id): Promise<RolePermission[]>;
  /** Replaces the role's whole permission set. */
  setRolePermissions(
    tenantId: Id,
    actorUserId: Id,
    roleId: Id,
    permissionIds: readonly Id[],
  ): Promise<RolePermission[]>;

  listUserRoles(tenantId: Id, userId?: Id): Promise<UserRole[]>;
  saveUserRole(tenantId: Id, actorUserId: Id, input: Upsert<UserRole>): Promise<UserRole>;
  deleteUserRole(tenantId: Id, actorUserId: Id, userRoleId: Id): Promise<void>;
}

/** G2 · Thư viện KPI (T2). */
export interface LibraryGateway {
  listPerspectives(tenantId: Id): Promise<BscPerspective[]>;
  savePerspective(tenantId: Id, actorUserId: Id, input: Upsert<BscPerspective>): Promise<BscPerspective>;

  listMeasureUnits(tenantId: Id): Promise<MeasureUnit[]>;
  saveMeasureUnit(tenantId: Id, actorUserId: Id, input: Upsert<MeasureUnit>): Promise<MeasureUnit>;

  listCalcMethods(tenantId: Id): Promise<CalcMethod[]>;
  /** Tiers of every method, or of one. */
  listCalcTiers(tenantId: Id, calcMethodId?: Id): Promise<CalcTier[]>;
  saveCalcMethod(
    tenantId: Id,
    actorUserId: Id,
    input: Upsert<CalcMethod>,
    tiers: readonly ChildInput<CalcTier, 'calcMethodId'>[],
  ): Promise<Aggregate<CalcMethod, CalcTier>>;

  listKpiDefinitions(tenantId: Id, filter?: KpiDefinitionFilter): Promise<KpiDefinition[]>;
  getKpiDefinition(tenantId: Id, kpiDefId: Id): Promise<KpiDefinition>;
  /** `isSystem` is the seed's to set, never a tenant's. */
  saveKpiDefinition(tenantId: Id, actorUserId: Id, input: Upsert<KpiDefinition, 'isSystem'>): Promise<KpiDefinition>;

  listKpiTemplates(tenantId: Id): Promise<KpiTemplate[]>;
  listKpiTemplateItems(tenantId: Id, templateId?: Id): Promise<KpiTemplateItem[]>;
  saveKpiTemplate(
    tenantId: Id,
    actorUserId: Id,
    input: Upsert<KpiTemplate>,
    items: readonly ChildInput<KpiTemplateItem, 'templateId'>[],
  ): Promise<Aggregate<KpiTemplate, KpiTemplateItem>>;
}

/**
 * G3 · Kế hoạch mục tiêu (T3). A plan's Submitted / Returned / Approved status moves only through
 * its form (`forms.act`); Locked through `lockGoalPlan` / `unlockGoalPlan` or an overdue AUTO_LOCK.
 * A goal's status moves only through an approved GOAL_CHANGE.
 */
export interface GoalsGateway {
  listCycles(tenantId: Id): Promise<PerformanceCycle[]>;
  getCycle(tenantId: Id, cycleId: Id): Promise<PerformanceCycle>;
  saveCycle(tenantId: Id, actorUserId: Id, input: Upsert<PerformanceCycle, 'status'>): Promise<PerformanceCycle>;
  /** Planning → Active → Evaluating → Closed, checked by `cycleRules`. */
  setCycleStatus(tenantId: Id, actorUserId: Id, cycleId: Id, status: CycleStatus): Promise<PerformanceCycle>;
  listPeriods(tenantId: Id, cycleId: Id): Promise<CyclePeriod[]>;
  /** Saves the cycle's periods (generated by `cycleRules`), matched by id like any child list. */
  savePeriods(
    tenantId: Id,
    actorUserId: Id,
    cycleId: Id,
    periods: readonly ChildInput<CyclePeriod, 'cycleId'>[],
  ): Promise<CyclePeriod[]>;
  setPeriodLocked(tenantId: Id, actorUserId: Id, periodId: Id, locked: boolean): Promise<CyclePeriod>;

  listGoalPlans(tenantId: Id, filter?: GoalPlanFilter): Promise<GoalPlan[]>;
  getGoalPlan(tenantId: Id, goalPlanId: Id): Promise<GoalPlan>;
  /** Creates a plan in `Draft`. One plan per (cycle, owner): a duplicate throws `ERR-KPI-06`. */
  createGoalPlan(
    tenantId: Id,
    actorUserId: Id,
    input: Omit<Upsert<GoalPlan, 'status' | 'lockedAt'>, 'id'>,
  ): Promise<GoalPlan>;
  /** HR lock (BR-KPI-14), audited as LOCK. */
  lockGoalPlan(tenantId: Id, actorUserId: Id, goalPlanId: Id): Promise<GoalPlan>;
  /**
   * HR unlock, audited as UNLOCK with `reason`. An open form frozen by AUTO_LOCK gets `newDueDate`
   * and re-enters its step (fresh `currentStepEnteredAt`, `overdueHandledAt` cleared), so the next
   * scheduler tick does not lock it straight back.
   */
  unlockGoalPlan(tenantId: Id, actorUserId: Id, goalPlanId: Id, reason: string, newDueDate: IsoDate): Promise<GoalPlan>;

  listKgis(tenantId: Id, goalPlanId: Id): Promise<Kgi[]>;
  saveKgi(tenantId: Id, actorUserId: Id, input: Upsert<Kgi>): Promise<Kgi>;
  deleteKgi(tenantId: Id, actorUserId: Id, kgiId: Id): Promise<void>;

  listGoals(tenantId: Id, filter?: GoalFilter): Promise<Goal[]>;
  getGoal(tenantId: Id, goalId: Id): Promise<Goal>;
  /** Refused (`ERR-KPI-04`) unless the plan is editable for this actor (`goalPlanRules`). */
  saveGoal(tenantId: Id, actorUserId: Id, input: Upsert<Goal, 'status' | 'replacesGoalId'>): Promise<Goal>;
  /** Only while the plan is Draft/Returned; after that a goal is Cancelled through GOAL_CHANGE. */
  deleteGoal(tenantId: Id, actorUserId: Id, goalId: Id): Promise<void>;

  listTargetLevels(tenantId: Id, scope: GoalScope): Promise<GoalTargetLevel[]>;
  /** Replaces the goal's levels (D1). */
  setTargetLevels(
    tenantId: Id,
    actorUserId: Id,
    goalId: Id,
    levels: readonly ChildInput<GoalTargetLevel, 'goalId'>[],
  ): Promise<GoalTargetLevel[]>;

  listAlignments(tenantId: Id, filter?: AlignmentFilter): Promise<GoalAlignment[]>;
  /** Refused when it would create a cycle or over-allocate the parent (`alignmentRules`). */
  saveAlignment(tenantId: Id, actorUserId: Id, input: Upsert<GoalAlignment>): Promise<GoalAlignment>;
  deleteAlignment(tenantId: Id, actorUserId: Id, alignmentId: Id): Promise<void>;

  listPeriodTargets(tenantId: Id, scope: GoalScope): Promise<GoalPeriodTarget[]>;
  /** Replaces the goal's period split. */
  setPeriodTargets(
    tenantId: Id,
    actorUserId: Id,
    goalId: Id,
    targets: readonly ChildInput<GoalPeriodTarget, 'goalId'>[],
  ): Promise<GoalPeriodTarget[]>;
}

/** G4 · Số liệu thực hiện (T4). */
export interface ActualsGateway {
  listDataSources(tenantId: Id): Promise<DataSource[]>;
  saveDataSource(tenantId: Id, actorUserId: Id, input: Upsert<DataSource>): Promise<DataSource>;

  listConnections(tenantId: Id): Promise<IntegrationConnection[]>;
  saveConnection(
    tenantId: Id,
    actorUserId: Id,
    input: Upsert<IntegrationConnection>,
  ): Promise<IntegrationConnection>;
  listMappings(tenantId: Id, connectionId?: Id): Promise<DataMapping[]>;
  saveMapping(tenantId: Id, actorUserId: Id, input: Upsert<DataMapping>): Promise<DataMapping>;
  deleteMapping(tenantId: Id, actorUserId: Id, mappingId: Id): Promise<void>;
  listSyncRuns(tenantId: Id, connectionId?: Id): Promise<SyncRun[]>;
  /** Runs the (simulated) connector for one period and records actuals with source `API`. */
  runSync(tenantId: Id, actorUserId: Id, connectionId: Id, periodId: Id): Promise<SyncRun>;

  listActuals(tenantId: Id, filter?: ActualFilter): Promise<GoalActual[]>;
  /** Manual entry: adds a snapshot and retires the previous current one (BR-KPI-52). */
  recordActual(tenantId: Id, actorUserId: Id, input: RecordActualInput): Promise<GoalActual>;

  listImportBatches(tenantId: Id, importType?: ImportType): Promise<ImportBatch[]>;
  getImportBatch(tenantId: Id, batchId: Id): Promise<ImportBatch>;
  /**
   * Stages parsed rows: validates them (`importRules`) and stores rows + row errors on the batch as
   * `Validating`. Nothing is applied yet — the screen shows the preview from the stored batch.
   */
  stageImport(tenantId: Id, actorUserId: Id, input: StageImportInput): Promise<ImportBatch>;
  /**
   * Applies a staged batch (→ `Committed`) — all rows or none. Refused (`ERR-KPI-04`) while it has
   * row errors. The rows land in org / library / goals / actuals by `importType`, so the hook
   * invalidates by the batch's type.
   */
  commitImport(tenantId: Id, actorUserId: Id, batchId: Id): Promise<ImportBatch>;
  rejectImport(tenantId: Id, actorUserId: Id, batchId: Id): Promise<ImportBatch>;

  listEvidence(tenantId: Id, filter?: EvidenceFilter): Promise<Evidence[]>;
  addEvidence(
    tenantId: Id,
    actorUserId: Id,
    input: Omit<Upsert<Evidence, 'uploadedBy' | 'uploadedAt'>, 'id'>,
  ): Promise<Evidence>;
  deleteEvidence(tenantId: Id, actorUserId: Id, evidenceId: Id): Promise<void>;
}

/** G5 · Quy trình phê duyệt & đánh giá + D5 launches (T5). */
export interface FormsGateway {
  listWorkflows(tenantId: Id, formType?: FormType): Promise<WorkflowTemplate[]>;
  listWorkflowSteps(tenantId: Id, workflowId?: Id): Promise<WorkflowStep[]>;
  /** Saves the template and its steps (numbered 1…n in the given order; validity per `WorkflowStep`). */
  saveWorkflow(
    tenantId: Id,
    actorUserId: Id,
    input: Upsert<WorkflowTemplate>,
    steps: readonly ChildInput<WorkflowStep, 'workflowId' | 'stepNo'>[],
  ): Promise<Aggregate<WorkflowTemplate, WorkflowStep>>;

  listLaunches(tenantId: Id): Promise<FormLaunch[]>;
  getLaunch(tenantId: Id, launchId: Id): Promise<FormLaunch>;
  /**
   * Creates a one-off launch. `NOW` fires immediately (the gateway sets `scheduledAt`) and creates
   * the forms; `SCHEDULED` waits for `scheduler.runDue`. Emits `form.launched` when it fires.
   */
  createLaunch(tenantId: Id, actorUserId: Id, input: NewLaunchInput): Promise<FormLaunch>;
  /** Only a `Scheduled` launch (which has no forms yet) can be cancelled. */
  cancelLaunch(tenantId: Id, actorUserId: Id, launchId: Id): Promise<FormLaunch>;
  listLaunchRules(tenantId: Id): Promise<FormLaunchRule[]>;
  saveLaunchRule(tenantId: Id, actorUserId: Id, input: Upsert<FormLaunchRule>): Promise<FormLaunchRule>;

  /** One form by hand (`StartFormInput`). A second open GOAL_CHANGE on the same plan is refused. */
  startForm(tenantId: Id, actorUserId: Id, input: StartFormInput): Promise<FormInstance>;
  listForms(tenantId: Id, filter?: FormFilter, page?: PageRequest): Promise<Page<FormInstance>>;
  getForm(tenantId: Id, formId: Id): Promise<FormInstance>;
  /**
   * The forms whose CURRENT step this user may act on now — as the step's actor, or as a delegate
   * under a delegation valid now. Resolved by `workflowRules`. HR's proxy access is not an inbox:
   * HR finds the form through `listForms`. An unknown user (another tenant's too) answers ERR-KPI-02.
   */
  listInbox(tenantId: Id, userId: Id): Promise<FormInstance[]>;
  listFormActions(tenantId: Id, formId: Id): Promise<FormStepAction[]>;
  listEvaluationItems(tenantId: Id, formId: Id): Promise<EvaluationItem[]>;
  /** "Lưu nháp" — saves the current step's columns only; no step change, no action recorded. */
  saveEvaluationItems(
    tenantId: Id,
    actorUserId: Id,
    formId: Id,
    patches: readonly EvaluationItemPatch[],
  ): Promise<EvaluationItem[]>;
  listGoalChangeItems(tenantId: Id, formId: Id): Promise<GoalChangeItem[]>;
  /** Replaces the GOAL_CHANGE form's proposal (only at a step that allows EDIT). */
  saveGoalChangeItems(
    tenantId: Id,
    actorUserId: Id,
    formId: Id,
    items: readonly ChildInput<GoalChangeItem, 'formId'>[],
  ): Promise<GoalChangeItem[]>;
  /**
   * Acts on the current step. Moves the form (and, for GOAL_SETTING / GOAL_CHANGE, its Goal Plan
   * and goals) per `workflowRules`, records a `FormStepAction`, emits `form.stepActed`.
   */
  act(tenantId: Id, actorUserId: Id, input: FormActionInput): Promise<FormInstance>;

  listDelegations(tenantId: Id, userId?: Id): Promise<Delegation[]>;
  /** `fromUserId` is the actor: a user delegates their own steps. */
  saveDelegation(
    tenantId: Id,
    actorUserId: Id,
    input: Upsert<Delegation, 'fromUserId' | 'revokedAt'>,
  ): Promise<Delegation>;
  /** Ends a delegation now; it is never deleted, because past actions point at it. */
  revokeDelegation(tenantId: Id, actorUserId: Id, delegationId: Id): Promise<Delegation>;
}

/** G6 · Kết quả & đãi ngộ (T6). Scores come from `scoreRules` / `ratingRules`, never the caller. */
export interface ResultsGateway {
  listRatingScales(tenantId: Id): Promise<RatingScale[]>;
  listRatingLevels(tenantId: Id, ratingScaleId?: Id): Promise<RatingLevel[]>;
  saveRatingScale(
    tenantId: Id,
    actorUserId: Id,
    input: Upsert<RatingScale>,
    levels: readonly ChildInput<RatingLevel, 'ratingScaleId'>[],
  ): Promise<Aggregate<RatingScale, RatingLevel>>;

  listPayoutRules(tenantId: Id, ratingScaleId?: Id): Promise<PayoutRule[]>;
  savePayoutRule(tenantId: Id, actorUserId: Id, input: Upsert<PayoutRule>): Promise<PayoutRule>;
  deletePayoutRule(tenantId: Id, actorUserId: Id, payoutRuleId: Id): Promise<void>;

  listPeriodResults(tenantId: Id, filter?: PeriodResultFilter): Promise<PeriodResult[]>;
  listResultDetails(tenantId: Id, resultId: Id): Promise<ResultDetail[]>;
  /**
   * (Re)computes `Draft` results for every Approved/Locked plan of the period; Final / Locked ones
   * are untouched. Employee plans take each goal's achievement from the completed evaluation's
   * final %; Company / OrgUnit plans (no evaluation form) from `calcRules` on the period's actuals.
   */
  calculateResults(tenantId: Id, actorUserId: Id, periodId: Id): Promise<PeriodResult[]>;
  /** Only on a `Draft` result. */
  setAdjustment(tenantId: Id, actorUserId: Id, resultId: Id, adjustmentPct: number): Promise<PeriodResult>;
  /** Draft → Final (all of the period's results, or the listed ones). Emits `results.finalized`. */
  finalizeResults(tenantId: Id, actorUserId: Id, periodId: Id, resultIds?: readonly Id[]): Promise<PeriodResult[]>;
  /** Final → Locked for the period. */
  lockResults(tenantId: Id, actorUserId: Id, periodId: Id): Promise<PeriodResult[]>;

  listPayrollExports(tenantId: Id, periodId?: Id): Promise<PayrollExport[]>;
  /** Exports the period's Final/Locked results to a file (BR-KPI-43). Emits `payroll.exported`. */
  exportPayroll(tenantId: Id, actorUserId: Id, periodId: Id): Promise<PayrollExport>;
}

/**
 * G7 · Hệ thống (T7). `recordNotification` and `recordAudit` are the system writes T7's listeners
 * make; only `src/integrations/` calls them — never a hook or a screen.
 */
export interface SystemGateway {
  uploadFile(tenantId: Id, actorUserId: Id, input: UploadFileInput): Promise<FileObject>;
  getFile(tenantId: Id, fileId: Id): Promise<FileObject>;
  /** A URL the browser can open (a blob URL in the mock). */
  getFileUrl(tenantId: Id, fileId: Id): Promise<string>;

  listNotificationTemplates(tenantId: Id): Promise<NotificationTemplate[]>;
  saveNotificationTemplate(
    tenantId: Id,
    actorUserId: Id,
    input: Upsert<NotificationTemplate>,
  ): Promise<NotificationTemplate>;

  listNotifications(
    tenantId: Id,
    recipientUserId: Id,
    options?: { unreadOnly?: boolean },
    page?: PageRequest,
  ): Promise<Page<KpiNotification>>;
  /** Only the recipient can mark their own notification read. */
  markNotificationRead(tenantId: Id, actorUserId: Id, notificationId: Id): Promise<KpiNotification>;
  /** System write (T7 listener). Idempotent per (sourceEventId, recipient). Emits `entity.changed`. */
  recordNotification(tenantId: Id, input: NewNotificationInput): Promise<KpiNotification>;

  listAuditLog(tenantId: Id, filter?: AuditLogFilter, page?: PageRequest): Promise<Page<AuditLog>>;
  /**
   * System write: the audit entry is built FROM the event — who, what, before/after, reason — so no
   * caller can forge its author. Idempotent per event id (the entry's id IS the event id). Does not
   * emit. An event of another tenant (`event.tenantId !== tenantId`) is ERR-KPI-06. The mock already
   * writes each change's entry in the change's own transaction (so the two are saved together);
   * this method stays for a listener- or trigger-based adapter, and is then a no-op on the mock.
   */
  recordAudit(tenantId: Id, event: EntityChangedEvent): Promise<AuditLog>;
}

/**
 * The clock-driven jobs: due SCHEDULED launches, recurring rules (D5), deadline reminders and
 * overdue steps (BR-KPI-13), all as of `clock.now()`. The mock runs it when asked (the dev toolbar);
 * a real backend runs it on a cron. Idempotent: an overdue step is handled once per entry
 * (`overdueHandledAt`), a rule fires once per (rule, period), a reminder once per step entry.
 */
export interface SchedulerGateway {
  runDue(tenantId: Id): Promise<SchedulerReport>;
}

/** The one time source for the adapter AND the screens (deadline badges, "overdue"). */
export interface ClockGateway {
  now(): IsoDateTime;
}

/** The event bus. The listener receives only `tenantId`'s events. */
export interface EventsGateway {
  subscribe(tenantId: Id, listener: DomainEventListener): Unsubscribe;
}

/**
 * Mock-only controls (Phase 1.2), behind the dev toolbar (Phase 1.4). `undefined` on a real
 * adapter, so a screen must never depend on them. `resetSeed` emits no events: whoever calls it
 * clears or invalidates the whole query cache.
 */
export interface DevControls {
  /** Reloads the fixtures for every tenant and clears the persisted copy. */
  resetSeed(): Promise<void>;
  /**
   * Moves the simulated clock; `null` returns to the seed's moment (`SEED_NOW`), NOT to real time —
   * real time (2026) lies before the seeded cycle (decision D-b, Phase 1.2).
   */
  setNow(now: IsoDateTime | null): void;
  setLatency(ms: number): void;
  /** Make every call (or the calls whose `group.method` matches) reject with `KpiError`. */
  setFailureMode(mode: { enabled: boolean; methodPattern?: string }): void;
}

export interface DataGateway {
  /** Which adapter answered — shown beside the "Dữ liệu giả lập" banner. */
  readonly adapter: DataAdapterName;
  readonly clock: ClockGateway;
  readonly platform: PlatformGateway;
  readonly org: OrgGateway;
  readonly library: LibraryGateway;
  readonly goals: GoalsGateway;
  readonly actuals: ActualsGateway;
  readonly forms: FormsGateway;
  readonly results: ResultsGateway;
  readonly system: SystemGateway;
  readonly scheduler: SchedulerGateway;
  readonly events: EventsGateway;
  readonly dev?: DevControls;
}

/** The method-bearing groups — used by adapters and tests to walk the whole contract. */
export const GATEWAY_GROUPS = [
  'clock',
  'platform',
  'org',
  'library',
  'goals',
  'actuals',
  'forms',
  'results',
  'system',
  'scheduler',
  'events',
] as const satisfies readonly (keyof DataGateway)[];
export type GatewayGroup = (typeof GATEWAY_GROUPS)[number];

/** The groups whose methods are synchronous (everything else returns a promise). */
export const SYNC_GATEWAY_GROUPS = ['clock', 'events'] as const satisfies readonly GatewayGroup[];
