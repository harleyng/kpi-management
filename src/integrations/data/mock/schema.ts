import type { CollectionName } from '@/data/fixtures/types';
import { GOAL_VISIBILITIES, WORK_PLAN_STATUSES, WORK_TASK_STATUSES, type NotificationRefType } from '@/data/types';

/**
 * The mock's table definitions — what a database would hold as columns, foreign keys, unique
 * indexes and CHECK constraints. `integrity.ts` enforces them generically at commit, so no group
 * file repeats "does this id exist in the tenant". Each entry maps 1:1 to DDL in Phase 5.
 *
 * These are STRUCTURAL constraints only. Anything that depends on state or on who is acting (a
 * locked plan, the step's actor, weights summing to 100) is a rule in `src/lib/*Rules.ts`.
 */

/** `owner` never changes after insert; `hierarchy` may change but must stay acyclic. */
export type RefKind = 'owner' | 'reference' | 'hierarchy';
/** What deleting the TARGET does to the referencing row. */
export type OnDelete = 'restrict' | 'cascade' | 'setNull';

export interface RefSpec {
  /** Dotted path; `[]` iterates an array: `recipientFilter.orgUnitIds[]`, `proposed.kpiDefId`. */
  path: string;
  to: CollectionName | 'Permission';
  kind: RefKind;
  onDelete: OnDelete;
}

export interface UniqueSpec {
  fields: readonly string[];
  /** Partial index: only rows where this holds take part. */
  where?: (row: Record<string, unknown>) => boolean;
}

/** Read access a check needs; given by the transaction. */
export interface CheckContext {
  find(collection: CollectionName, id: string): Record<string, unknown> | undefined;
  all(collection: CollectionName): Record<string, unknown>[];
}

export type RowCheck = (row: Record<string, unknown>, ctx: CheckContext) => string | null;
export type CollectionCheck = (rows: Record<string, unknown>[]) => string | null;

export interface CollectionSpec {
  /** Columns a caller's payload may set. Everything else on the row is the gateway's. */
  writable: readonly string[];
  refs: readonly RefSpec[];
  /** Columns that never change after insert although they are not references. */
  immutable?: readonly string[];
  unique?: readonly UniqueSpec[];
  checks?: readonly RowCheck[];
  collectionChecks?: readonly CollectionCheck[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────────────────────

const ref = (path: string, to: RefSpec['to'], kind: RefKind = 'reference', onDelete: OnDelete = 'restrict'): RefSpec => ({
  path,
  to,
  kind,
  onDelete,
});
const owner = (path: string, to: CollectionName, onDelete: OnDelete = 'restrict') => ref(path, to, 'owner', onDelete);

const s = (v: unknown) => (typeof v === 'string' ? v : null);
const n = (v: unknown) => (typeof v === 'number' ? v : null);

/** `from ≤ to` when both are set (ISO dates compare as strings). */
const ordered =
  (from: string, to: string): RowCheck =>
  (row) => {
    const a = row[from];
    const b = row[to];
    if (a === null || b === null || a === undefined || b === undefined) return null;
    return (a as string | number) <= (b as string | number) ? null : `${from} must not be after ${to}`;
  };

const nonNegative =
  (...fields: string[]): RowCheck =>
  (row) => {
    for (const f of fields) {
      const v = n(row[f]);
      if (v !== null && v < 0) return `${f} must be ≥ 0`;
    }
    return null;
  };

/** `field` is set exactly when `when(row)` holds. */
const setIff =
  (field: string, when: (row: Record<string, unknown>) => boolean, label: string): RowCheck =>
  (row) => {
    const isSet = row[field] !== null && row[field] !== undefined;
    return isSet === when(row) ? null : `${field} must be set exactly when ${label}`;
  };

/** The row at `refField` has `parentField` equal to this row's `expected` value. */
const sameParent =
  (refField: string, target: CollectionName, parentField: string, expected: (row: Record<string, unknown>, ctx: CheckContext) => unknown): RowCheck =>
  (row, ctx) => {
    const id = s(row[refField]);
    if (id === null) return null;
    const target_ = ctx.find(target, id);
    if (!target_) return null; // the reference check reports a missing target
    const want = expected(row, ctx);
    if (want === undefined || want === null) return null;
    return target_[parentField] === want ? null : `${refField} belongs to another ${parentField}`;
  };

const planOfGoal = (goalId: unknown, ctx: CheckContext) => {
  const goal = typeof goalId === 'string' ? ctx.find('Goal', goalId) : undefined;
  return goal ? ctx.find('GoalPlan', goal.goalPlanId as string) : undefined;
};

const recipientFilterRefs = [
  ref('recipientFilter.orgUnitIds[]', 'OrgUnit'),
  ref('recipientFilter.positionIds[]', 'JobPosition'),
  ref('recipientFilter.employeeIds[]', 'Employee'),
];

const goalDraftRefs = [
  ref('proposed.kgiId', 'Kgi'),
  ref('proposed.kpiDefId', 'KpiDefinition'),
  ref('proposed.perspectiveId', 'BscPerspective'),
  ref('proposed.unitId', 'MeasureUnit'),
  ref('proposed.calcMethodId', 'CalcMethod'),
  ref('proposed.dataSourceId', 'DataSource'),
  ref('proposed.ownerEmployeeId', 'Employee'),
];

/** Notification.refType → the collection its refId points into. */
export const NOTIFICATION_REF_COLLECTION: Readonly<Record<NotificationRefType, CollectionName>> = {
  Form: 'FormInstance',
  GoalPlan: 'GoalPlan',
  Goal: 'Goal',
  Result: 'PeriodResult',
  Launch: 'FormLaunch',
};

// ─── The tables ────────────────────────────────────────────────────────────────────────────────

export const SCHEMA: Readonly<Record<CollectionName, CollectionSpec>> = {
  OrgUnit: {
    writable: ['parentId', 'code', 'name', 'unitType', 'headEmployeeId', 'effectiveFrom', 'effectiveTo', 'status'],
    refs: [ref('parentId', 'OrgUnit', 'hierarchy'), ref('headEmployeeId', 'Employee', 'reference', 'setNull')],
    unique: [{ fields: ['code'] }],
    checks: [
      ordered('effectiveFrom', 'effectiveTo'),
      (row) => ((row.parentId === null) === (row.unitType === 'Company') ? null : 'only the root unit is a Company, and the root has no parent'),
    ],
    collectionChecks: [(rows) => (rows.filter((r) => r.parentId === null).length > 1 ? 'a tenant has exactly one root unit' : null)],
  },
  JobPosition: { writable: ['code', 'name', 'jobLevel', 'status'], refs: [], unique: [{ fields: ['code'] }] },
  Employee: {
    writable: ['employeeCode', 'fullName', 'email', 'hireDate', 'employmentStatus', 'leftOn'],
    refs: [],
    unique: [{ fields: ['employeeCode'] }],
    checks: [ordered('hireDate', 'leftOn')],
  },
  EmployeeAssignment: {
    writable: ['employeeId', 'orgUnitId', 'positionId', 'managerEmployeeId', 'isPrimary', 'effectiveFrom', 'effectiveTo'],
    refs: [owner('employeeId', 'Employee'), ref('orgUnitId', 'OrgUnit'), ref('positionId', 'JobPosition'), ref('managerEmployeeId', 'Employee')],
    checks: [ordered('effectiveFrom', 'effectiveTo'), (row) => (row.managerEmployeeId === row.employeeId ? 'nobody is their own manager' : null)],
    collectionChecks: [
      (rows) => {
        const primary = rows.filter((r) => r.isPrimary === true);
        for (const a of primary) {
          for (const b of primary) {
            if (a === b || a.employeeId !== b.employeeId) continue;
            const aEnd = (a.effectiveTo as string | null) ?? '9999-12-31';
            const bEnd = (b.effectiveTo as string | null) ?? '9999-12-31';
            if ((a.effectiveFrom as string) <= bEnd && (b.effectiveFrom as string) <= aEnd) {
              return 'an employee has at most one primary assignment on any date';
            }
          }
        }
        return null;
      },
    ],
  },
  UserAccount: {
    writable: ['employeeId', 'login', 'displayName', 'authProvider', 'status'],
    refs: [ref('employeeId', 'Employee')],
    // Login is unique per tenant in the prototype (simulated sign-in). A shared identity provider
    // would make it global — Phase 5 decides.
    unique: [{ fields: ['login'] }],
  },
  Role: { writable: ['code', 'name'], refs: [], unique: [{ fields: ['code'] }] },
  RolePermission: {
    writable: ['roleId', 'permissionId'],
    refs: [owner('roleId', 'Role', 'cascade'), ref('permissionId', 'Permission')],
  },
  UserRole: {
    writable: ['userId', 'roleId', 'scopeType', 'scopeOrgUnitId', 'includeChildren'],
    refs: [owner('userId', 'UserAccount', 'cascade'), ref('roleId', 'Role'), ref('scopeOrgUnitId', 'OrgUnit')],
    unique: [{ fields: ['userId', 'roleId', 'scopeType', 'scopeOrgUnitId'] }],
    checks: [setIff('scopeOrgUnitId', (r) => r.scopeType === 'OrgUnit', 'scopeType is OrgUnit')],
  },
  BscPerspective: { writable: ['code', 'name', 'sortOrder'], refs: [], unique: [{ fields: ['code'] }] },
  MeasureUnit: {
    writable: ['code', 'name', 'decimals'],
    refs: [],
    unique: [{ fields: ['code'] }],
    checks: [nonNegative('decimals')],
  },
  CalcMethod: {
    writable: ['code', 'name', 'methodType', 'formulaExpr', 'capPct', 'floorPct', 'description'],
    refs: [],
    unique: [{ fields: ['code'] }],
  },
  CalcTier: {
    writable: ['fromValue', 'toValue', 'achievementPct'],
    refs: [owner('calcMethodId', 'CalcMethod', 'cascade')],
    checks: [(row) => (row.fromValue !== null && row.toValue !== null && (row.fromValue as number) >= (row.toValue as number) ? 'fromValue must be below toValue' : null)],
  },
  KpiDefinition: {
    writable: ['code', 'name', 'perspectiveId', 'unitId', 'calcMethodId', 'defaultDataSourceId', 'definition', 'formulaText', 'frequency', 'aggregation', 'categoryTag', 'status'],
    refs: [
      ref('perspectiveId', 'BscPerspective'),
      ref('unitId', 'MeasureUnit'),
      ref('calcMethodId', 'CalcMethod'),
      ref('defaultDataSourceId', 'DataSource', 'reference', 'setNull'),
    ],
    unique: [{ fields: ['code'] }],
  },
  KpiTemplate: {
    writable: ['name', 'orgUnitId', 'positionId', 'status'],
    refs: [ref('orgUnitId', 'OrgUnit'), ref('positionId', 'JobPosition')],
    checks: [(row) => (row.orgUnitId !== null && row.positionId !== null ? 'a template is for a unit OR a position, not both' : null)],
  },
  KpiTemplateItem: {
    writable: ['kpiDefId', 'defaultWeight', 'defaultTarget'],
    refs: [owner('templateId', 'KpiTemplate', 'cascade'), ref('kpiDefId', 'KpiDefinition')],
    unique: [{ fields: ['templateId', 'kpiDefId'] }],
    checks: [nonNegative('defaultWeight')],
  },
  PerformanceCycle: {
    writable: ['name', 'startDate', 'endDate', 'ratingScaleId'],
    refs: [ref('ratingScaleId', 'RatingScale')],
    checks: [ordered('startDate', 'endDate')],
  },
  CyclePeriod: {
    writable: ['periodType', 'label', 'startDate', 'endDate', 'inputDeadline', 'evalDeadline', 'isLocked'],
    refs: [owner('cycleId', 'PerformanceCycle', 'cascade')],
    unique: [{ fields: ['cycleId', 'label'] }],
    checks: [ordered('startDate', 'endDate')],
  },
  GoalPlan: {
    writable: ['cycleId', 'planType', 'ownerType', 'ownerOrgUnitId', 'ownerEmployeeId'],
    refs: [owner('cycleId', 'PerformanceCycle'), owner('ownerOrgUnitId', 'OrgUnit'), owner('ownerEmployeeId', 'Employee')],
    immutable: ['ownerType', 'planType'],
    unique: [{ fields: ['cycleId', 'ownerType', 'ownerOrgUnitId', 'ownerEmployeeId'] }],
    checks: [
      (row, ctx) => {
        const unit = s(row.ownerOrgUnitId);
        const emp = s(row.ownerEmployeeId);
        switch (row.ownerType) {
          case 'Employee':
            return emp !== null && unit === null ? null : 'an Employee plan names the employee only';
          case 'OrgUnit':
            return unit !== null && emp === null ? null : 'an OrgUnit plan names the unit only';
          case 'Company': {
            if (unit === null || emp !== null) return 'a Company plan names the root unit only';
            return ctx.find('OrgUnit', unit)?.parentId === null ? null : 'a Company plan is owned by the root unit';
          }
          default:
            return 'unknown ownerType';
        }
      },
    ],
  },
  Kgi: {
    writable: ['goalPlanId', 'name', 'description', 'sortOrder', 'targetValue', 'unitId'],
    refs: [owner('goalPlanId', 'GoalPlan', 'cascade'), ref('unitId', 'MeasureUnit')],
  },
  Goal: {
    writable: [
      'goalPlanId', 'kgiId', 'kpiDefId', 'name', 'description', 'formulaText', 'perspectiveId', 'kriType',
      'visibility', 'unitId', 'calcMethodId', 'dataSourceId', 'weight', 'targetType', 'targetValue',
      'targetText', 'selfAssignedValue', 'rollUpFromChildren', 'startDate', 'dueDate', 'ownerEmployeeId', 'sortOrder',
    ],
    refs: [
      owner('goalPlanId', 'GoalPlan', 'cascade'),
      ref('kgiId', 'Kgi', 'reference', 'setNull'),
      ref('kpiDefId', 'KpiDefinition'),
      ref('perspectiveId', 'BscPerspective'),
      ref('unitId', 'MeasureUnit'),
      ref('calcMethodId', 'CalcMethod'),
      ref('dataSourceId', 'DataSource'),
      ref('ownerEmployeeId', 'Employee'),
      ref('replacesGoalId', 'Goal'),
    ],
    checks: [
      nonNegative('weight'),
      ordered('startDate', 'dueDate'),
      sameParent('kgiId', 'Kgi', 'goalPlanId', (row) => row.goalPlanId),
    ],
  },
  GoalTargetLevel: {
    writable: ['levelCode', 'targetValue', 'targetText', 'scorePct'],
    refs: [owner('goalId', 'Goal', 'cascade')],
    unique: [{ fields: ['goalId', 'levelCode'] }],
  },
  GoalAlignment: {
    writable: ['childGoalId', 'parentGoalId', 'alignmentType', 'contributionPct', 'allocatedValue'],
    refs: [owner('childGoalId', 'Goal', 'cascade'), ref('parentGoalId', 'Goal', 'reference', 'cascade')],
    unique: [{ fields: ['childGoalId', 'parentGoalId'] }],
    checks: [
      (row) => (row.childGoalId === row.parentGoalId ? 'a goal cannot align to itself' : null),
      (row) => (row.alignmentType === 'CASCADE' && row.contributionPct !== null ? 'a CASCADE carries allocatedValue, not contributionPct' : null),
      (row) => (row.alignmentType === 'LINK' && row.allocatedValue !== null ? 'a LINK carries contributionPct, not allocatedValue' : null),
    ],
  },
  GoalPeriodTarget: {
    writable: ['periodId', 'targetValue'],
    refs: [owner('goalId', 'Goal', 'cascade'), ref('periodId', 'CyclePeriod')],
    unique: [{ fields: ['goalId', 'periodId'] }],
    checks: [sameParent('periodId', 'CyclePeriod', 'cycleId', (row, ctx) => planOfGoal(row.goalId, ctx)?.cycleId)],
  },
  DataSource: {
    writable: ['code', 'name', 'sourceType', 'ownerOrgUnitId'],
    refs: [ref('ownerOrgUnitId', 'OrgUnit')],
    unique: [{ fields: ['code'] }],
  },
  IntegrationConnection: {
    writable: ['dataSourceId', 'endpoint', 'authType', 'secretRef', 'scheduleCron', 'status'],
    refs: [owner('dataSourceId', 'DataSource')],
  },
  DataMapping: {
    writable: ['connectionId', 'kpiDefId', 'queryOrPath', 'orgDimension', 'transformExpr'],
    refs: [owner('connectionId', 'IntegrationConnection', 'cascade'), ref('kpiDefId', 'KpiDefinition')],
  },
  SyncRun: { writable: [], refs: [owner('connectionId', 'IntegrationConnection'), ref('periodId', 'CyclePeriod')] },
  ImportBatch: {
    writable: [],
    refs: [ref('cycleId', 'PerformanceCycle'), ref('fileId', 'FileObject'), ref('uploadedBy', 'UserAccount')],
  },
  GoalActual: {
    writable: [],
    refs: [
      owner('goalId', 'Goal'),
      ref('periodId', 'CyclePeriod'),
      ref('batchId', 'ImportBatch'),
      ref('syncRunId', 'SyncRun'),
      ref('enteredBy', 'UserAccount'),
    ],
    unique: [{ fields: ['goalId', 'periodId'], where: (row) => row.isCurrent === true }],
    checks: [sameParent('periodId', 'CyclePeriod', 'cycleId', (row, ctx) => planOfGoal(row.goalId, ctx)?.cycleId)],
  },
  Evidence: {
    writable: ['goalId', 'periodId', 'actualId', 'fileId', 'url', 'note'],
    refs: [
      owner('goalId', 'Goal'),
      ref('periodId', 'CyclePeriod'),
      ref('actualId', 'GoalActual'),
      ref('fileId', 'FileObject'),
      ref('uploadedBy', 'UserAccount'),
    ],
    checks: [
      (row) => (row.fileId === null && (row.url === null || row.url === '') ? 'evidence needs a file or a URL' : null),
      sameParent('actualId', 'GoalActual', 'goalId', (row) => row.goalId),
    ],
  },
  WorkflowTemplate: {
    writable: ['formType', 'name', 'isDefault'],
    refs: [],
    immutable: ['formType'],
    unique: [{ fields: ['formType'], where: (row) => row.isDefault === true }],
  },
  WorkflowStep: {
    writable: ['name', 'actorRule', 'actorRoleId', 'allowedActions', 'returnToStepNo', 'slaDays', 'onOverdue', 'remindDaysBefore', 'evaluationColumn', 'requiresComment', 'autoApprove'],
    refs: [owner('workflowId', 'WorkflowTemplate', 'cascade'), ref('actorRoleId', 'Role')],
    unique: [{ fields: ['workflowId', 'stepNo'] }],
    checks: [
      setIff('actorRoleId', (r) => r.actorRule === 'ROLE', 'actorRule is ROLE'),
      nonNegative('slaDays', 'remindDaysBefore'),
      // PEND-02: the row-local half of `validateWorkflow`'s autoApprove rules (last step is cross-row).
      (row) =>
        row.autoApprove === true && (!(Array.isArray(row.allowedActions) && row.allowedActions.includes('APPROVE')) || row.stepNo === 1)
          ? 'autoApprove needs APPROVE and a step after the first'
          : null,
    ],
  },
  FormInstance: {
    writable: [],
    refs: [
      owner('workflowId', 'WorkflowTemplate'),
      owner('subjectEmployeeId', 'Employee'),
      ref('goalPlanId', 'GoalPlan'),
      ref('periodId', 'CyclePeriod'),
      ref('currentStepId', 'WorkflowStep'),
      ref('launchId', 'FormLaunch'),
      ref('workPlanId', 'WorkPlan'),
    ],
    checks: [
      sameParent('currentStepId', 'WorkflowStep', 'workflowId', (row) => row.workflowId),
      setIff('workPlanId', (r) => r.formType === 'WORK_PLAN' || r.formType === 'WORK_REVIEW', 'the form is WORK_PLAN or WORK_REVIEW'),
      (row) => ((row.formType === 'WORK_PLAN' || row.formType === 'WORK_REVIEW') && row.goalPlanId !== null ? 'a monthly work form has no goalPlanId' : null),
      (row, ctx) => {
        const plan = typeof row.workPlanId === 'string' ? ctx.find('WorkPlan', row.workPlanId) : undefined;
        if (!plan) return null;
        return plan.employeeId === row.subjectEmployeeId && plan.periodId === row.periodId ? null : "workPlanId is not the subject's plan for the form's period";
      },
    ],
  },
  FormStepAction: {
    writable: [],
    refs: [
      owner('formId', 'FormInstance', 'cascade'),
      ref('stepId', 'WorkflowStep'),
      ref('actorUserId', 'UserAccount'),
      ref('onBehalfOfUserId', 'UserAccount'),
      ref('delegationId', 'Delegation'),
    ],
    checks: [sameParent('stepId', 'WorkflowStep', 'workflowId', (row, ctx) => ctx.find('FormInstance', row.formId as string)?.workflowId)],
  },
  EvaluationItem: {
    writable: [],
    refs: [owner('formId', 'FormInstance', 'cascade'), ref('goalId', 'Goal')],
    unique: [{ fields: ['formId', 'goalId'] }],
    checks: [sameParent('goalId', 'Goal', 'goalPlanId', (row, ctx) => ctx.find('FormInstance', row.formId as string)?.goalPlanId)],
  },
  Delegation: {
    writable: ['toUserId', 'formType', 'validFrom', 'validTo'],
    refs: [owner('fromUserId', 'UserAccount'), ref('toUserId', 'UserAccount')],
    checks: [ordered('validFrom', 'validTo')],
  },
  GoalChangeItem: {
    writable: ['goalId', 'changeType', 'proposed', 'reason'],
    refs: [owner('formId', 'FormInstance', 'cascade'), ref('goalId', 'Goal'), ...goalDraftRefs],
    checks: [
      sameParent('goalId', 'Goal', 'goalPlanId', (row, ctx) => ctx.find('FormInstance', row.formId as string)?.goalPlanId),
      setIff('goalId', (r) => r.changeType !== 'ADD', 'the change is not an ADD'),
      setIff('proposed', (r) => r.changeType !== 'CANCEL', 'the change is not a CANCEL'),
    ],
  },
  FormLaunch: {
    writable: [],
    refs: [
      owner('workflowId', 'WorkflowTemplate'),
      ref('launchRuleId', 'FormLaunchRule'),
      ref('cycleId', 'PerformanceCycle'),
      ref('periodId', 'CyclePeriod'),
      ref('createdBy', 'UserAccount'),
      ...recipientFilterRefs,
    ],
    checks: [
      nonNegative('dueDays'),
      (row) => (row.startStepNo === null || row.startStepNo === undefined || (Number.isInteger(row.startStepNo) && (row.startStepNo as number) >= 1) ? null : 'startStepNo must be null or an integer ≥ 1'),
      setIff('recipientFilter', (r) => r.recipientMode === 'FILTER', 'recipientMode is FILTER'),
      sameParent('periodId', 'CyclePeriod', 'cycleId', (row) => row.cycleId),
    ],
  },
  FormLaunchRule: {
    writable: ['workflowId', 'name', 'triggerEvent', 'periodType', 'offsetDays', 'dueDays', 'recipientMode', 'recipientFilter', 'isActive'],
    refs: [owner('workflowId', 'WorkflowTemplate'), ...recipientFilterRefs],
    checks: [nonNegative('offsetDays', 'dueDays'), setIff('recipientFilter', (r) => r.recipientMode === 'FILTER', 'recipientMode is FILTER')],
  },
  RatingScale: { writable: ['name', 'status'], refs: [] },
  RatingLevel: {
    writable: ['code', 'label', 'minScore', 'maxScore', 'sortOrder'],
    refs: [owner('ratingScaleId', 'RatingScale', 'cascade')],
    unique: [{ fields: ['ratingScaleId', 'code'] }],
    checks: [ordered('minScore', 'maxScore')],
  },
  PayoutRule: {
    writable: ['ratingScaleId', 'ratingLevelId', 'appliesTo', 'orgUnitId', 'positionId', 'payoutPct', 'effectiveFrom'],
    refs: [owner('ratingScaleId', 'RatingScale'), ref('ratingLevelId', 'RatingLevel'), ref('orgUnitId', 'OrgUnit'), ref('positionId', 'JobPosition')],
    checks: [
      sameParent('ratingLevelId', 'RatingLevel', 'ratingScaleId', (row) => row.ratingScaleId),
      setIff('orgUnitId', (r) => r.appliesTo === 'OrgUnit', 'appliesTo is OrgUnit'),
      setIff('positionId', (r) => r.appliesTo === 'Position', 'appliesTo is Position'),
      nonNegative('payoutPct'),
    ],
  },
  PeriodResult: {
    writable: [],
    refs: [owner('periodId', 'CyclePeriod'), owner('goalPlanId', 'GoalPlan'), ref('ratingLevelId', 'RatingLevel')],
    unique: [{ fields: ['periodId', 'goalPlanId'] }],
  },
  ResultDetail: {
    writable: [],
    refs: [owner('resultId', 'PeriodResult', 'cascade'), ref('goalId', 'Goal')],
    unique: [{ fields: ['resultId', 'goalId'] }],
  },
  PayrollExport: {
    writable: [],
    refs: [owner('periodId', 'CyclePeriod'), ref('fileId', 'FileObject'), ref('exportedBy', 'UserAccount')],
  },
  FileObject: { writable: [], refs: [ref('uploadedBy', 'UserAccount')] },
  NotificationTemplate: {
    writable: ['eventCode', 'channel', 'language', 'subject', 'body'],
    refs: [],
    unique: [{ fields: ['eventCode', 'channel', 'language'] }],
  },
  Notification: {
    writable: [],
    refs: [ref('templateId', 'NotificationTemplate', 'reference', 'setNull'), owner('recipientUserId', 'UserAccount')],
    checks: [
      (row, ctx) => {
        const target = NOTIFICATION_REF_COLLECTION[row.refType as NotificationRefType];
        if (!target) return 'unknown refType';
        return ctx.find(target, row.refId as string) ? null : `refId not found in ${target}`;
      },
    ],
  },
  // ─── Monthly work (PEND-14) ────────────────────────────────────────────────────────────────
  WorkScoringConfig: {
    writable: ['resultWeight', 'disciplineWeight', 'hsnvThreshold', 'scoreMin', 'scoreMax'],
    refs: [],
    collectionChecks: [(rows) => (rows.length > 1 ? 'a tenant has at most one scoring config' : null)],
  },
  WorkPlan: {
    writable: [],
    refs: [owner('employeeId', 'Employee'), owner('periodId', 'CyclePeriod'), ref('approvedBy', 'UserAccount')],
    unique: [{ fields: ['employeeId', 'periodId'] }],
    checks: [
      (row) => (WORK_PLAN_STATUSES.includes(row.status as never) ? null : 'status is not a work plan status'),
      (row, ctx) => (ctx.find('CyclePeriod', row.periodId as string)?.periodType === 'Month' ? null : 'a work plan is for a Month period'),
      setIff('approvedAt', (r) => r.status === 'Locked', 'the plan is Locked'),
      // A system approval (an automatic step) leaves `approvedBy` empty; a person's never comes without `approvedAt`.
      (row) => (row.approvedBy !== null && row.approvedAt === null ? 'approvedBy needs approvedAt' : null),
    ],
  },
  WorkTask: {
    writable: ['name', 'product', 'description', 'unitText', 'weight', 'startDate', 'dueDate', 'visibility', 'linkedGoalId'],
    refs: [
      owner('workPlanId', 'WorkPlan', 'cascade'),
      ref('linkedGoalId', 'Goal'),
      ref('createdBy', 'UserAccount'),
      ref('cancelledBy', 'UserAccount'),
    ],
    checks: [
      nonNegative('weight'),
      ordered('startDate', 'dueDate'),
      (row) => {
        const pct = n(row.progressPct);
        return pct !== null && pct >= 0 && pct <= 100 ? null : 'progressPct must be 0–100';
      },
      setIff('cancelledAt', (r) => r.progressStatus === 'Cancelled', 'progressStatus is Cancelled'),
      setIff('cancelledBy', (r) => r.cancelledAt !== null, 'cancelledAt is set'),
      setIff('cancelReason', (r) => r.cancelledAt !== null, 'cancelledAt is set'),
      (row) => (WORK_TASK_STATUSES.includes(row.progressStatus as never) ? null : 'progressStatus is not a work task status'),
      (row) => (GOAL_VISIBILITIES.includes(row.visibility as never) ? null : 'visibility is not a visibility'),
    ],
  },
  WorkReview: {
    writable: [],
    refs: [owner('formId', 'FormInstance', 'cascade'), owner('workPlanId', 'WorkPlan')],
    unique: [{ fields: ['formId'] }],
    checks: [
      (row, ctx) => {
        const form = ctx.find('FormInstance', row.formId as string);
        if (!form) return null;
        if (form.formType !== 'WORK_REVIEW') return 'formId is not a WORK_REVIEW form';
        return form.workPlanId === row.workPlanId ? null : "workPlanId is not the form's work plan";
      },
    ],
  },
  WorkReviewItem: {
    writable: [],
    refs: [owner('formId', 'FormInstance', 'cascade'), owner('taskId', 'WorkTask')],
    unique: [{ fields: ['formId', 'taskId'] }],
    checks: [sameParent('taskId', 'WorkTask', 'workPlanId', (row, ctx) => ctx.find('FormInstance', row.formId as string)?.workPlanId)],
  },
  WorkResult: {
    writable: [],
    refs: [owner('employeeId', 'Employee'), owner('periodId', 'CyclePeriod'), owner('workPlanId', 'WorkPlan'), owner('formId', 'FormInstance')],
    unique: [{ fields: ['employeeId', 'periodId'] }],
    checks: [
      (row, ctx) => {
        const plan = ctx.find('WorkPlan', row.workPlanId as string);
        if (plan && (plan.employeeId !== row.employeeId || plan.periodId !== row.periodId)) return 'workPlanId is not this employee and period';
        const form = ctx.find('FormInstance', row.formId as string);
        if (form && (form.formType !== 'WORK_REVIEW' || form.workPlanId !== row.workPlanId)) return "formId is not the plan's WORK_REVIEW form";
        return null;
      },
    ],
  },
  // `entityId` is history: it may name a row that was deleted since, so it is not a foreign key.
  AuditLog: { writable: [], refs: [ref('userId', 'UserAccount'), ref('onBehalfOfUserId', 'UserAccount')] },
};

/** Polymorphic id columns (validated by a check, not by `refs`) — the schema meta-test reads this. */
export const POLYMORPHIC_ID_COLUMNS: Readonly<Partial<Record<CollectionName, readonly string[]>>> = {
  Notification: ['refId'],
  AuditLog: ['entityId'],
};

/** Every value at `path` in `row` (an `[]` segment flattens an array); nulls are skipped. */
export function valuesAt(row: unknown, path: string): string[] {
  let current: unknown[] = [row];
  for (const segment of path.split('.')) {
    const isArray = segment.endsWith('[]');
    const key = isArray ? segment.slice(0, -2) : segment;
    const next: unknown[] = [];
    for (const value of current) {
      if (value === null || typeof value !== 'object') continue;
      const field = (value as Record<string, unknown>)[key];
      if (isArray) {
        if (Array.isArray(field)) next.push(...field);
      } else next.push(field);
    }
    current = next;
  }
  return current.filter((v): v is string => typeof v === 'string');
}

/** For each target collection, the specs that point at it — what deleting a target must consult. */
export const REVERSE_REFS: ReadonlyMap<string, readonly { from: CollectionName; spec: RefSpec }[]> = (() => {
  const map = new Map<string, { from: CollectionName; spec: RefSpec }[]>();
  for (const [from, spec] of Object.entries(SCHEMA) as [CollectionName, CollectionSpec][]) {
    for (const r of spec.refs) {
      const list = map.get(r.to) ?? [];
      list.push({ from, spec: r });
      map.set(r.to, list);
    }
  }
  return map;
})();
