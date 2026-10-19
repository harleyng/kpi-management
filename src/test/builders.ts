/**
 * Minimal row factories for rule tests — one per entity, every column defaulted, override what the
 * case is about. Deliberately NOT the seed fixtures (`src/data/fixtures/`, Phase 1.2): a rule test
 * that leaned on the seed would break whenever the seed changed and would hide which values matter.
 */

import type {
  CalcMethod,
  CalcTier,
  CyclePeriod,
  Delegation,
  Employee,
  EmployeeAssignment,
  EvaluationItem,
  FormInstance,
  FormLaunch,
  FormLaunchRule,
  Goal,
  GoalAlignment,
  GoalChangeItem,
  GoalPeriodTarget,
  GoalPlan,
  GoalTargetLevel,
  JobPosition,
  Kgi,
  OrgUnit,
  PayoutRule,
  RatingLevel,
  Role,
  UserAccount,
  UserRole,
  WorkflowStep,
} from '@/data/types';

export const TENANT = 't1';
export const TZ = 'Asia/Ho_Chi_Minh';

export const calcMethod = (o: Partial<CalcMethod> = {}): CalcMethod => ({
  id: 'cm1', tenantId: TENANT, code: 'CM', name: 'Method', methodType: 'RATIO_UP',
  formulaExpr: null, capPct: 120, floorPct: null, description: null, ...o,
});

export const tier = (o: Partial<CalcTier> = {}): CalcTier => ({
  id: 'tier1', tenantId: TENANT, calcMethodId: 'cm1', fromValue: null, toValue: null, achievementPct: 100, ...o,
});

export const level = (o: Partial<GoalTargetLevel> = {}): GoalTargetLevel => ({
  id: `lv-${o.levelCode ?? 'L1'}`, tenantId: TENANT, goalId: 'g1', levelCode: 'L1',
  targetValue: null, targetText: null, scorePct: 0, ...o,
});

export const goal = (o: Partial<Goal> = {}): Goal => ({
  id: 'g1', tenantId: TENANT, goalPlanId: 'plan1', kgiId: null, kpiDefId: null, name: 'Goal',
  description: null, formulaText: null, perspectiveId: 'p-fin', kriType: null, visibility: 'PUBLIC',
  unitId: 'u-pct', calcMethodId: 'cm1', dataSourceId: 'ds1', weight: 20, targetType: 'NUMERIC',
  targetValue: 100, targetText: null, selfAssignedValue: null, rollUpFromChildren: false,
  startDate: '2027-01-01', dueDate: '2027-12-31', ownerEmployeeId: 'e1', status: 'Active',
  replacesGoalId: null, sortOrder: 0, ...o,
});

/** `count` active goals whose weights are `weights` (default: equal shares of 100). */
export function goals(count: number, weights?: number[]): Goal[] {
  return Array.from({ length: count }, (_, i) =>
    goal({ id: `g${i + 1}`, weight: weights?.[i] ?? 100 / count, sortOrder: i }),
  );
}

export const kgi = (o: Partial<Kgi> = {}): Kgi => ({
  id: 'k1', tenantId: TENANT, goalPlanId: 'plan1', name: 'KGI', description: null, sortOrder: 0,
  targetValue: null, unitId: null, ...o,
});

export const plan = (o: Partial<GoalPlan> = {}): GoalPlan => ({
  id: 'plan1', tenantId: TENANT, cycleId: 'c2027', planType: 'KPI', ownerType: 'Employee',
  ownerOrgUnitId: null, ownerEmployeeId: 'e1', status: 'Draft', lockedAt: null, ...o,
});

export const alignment = (o: Partial<GoalAlignment> = {}): GoalAlignment => ({
  id: `al-${o.childGoalId ?? 'c'}-${o.parentGoalId ?? 'p'}`, tenantId: TENANT, childGoalId: 'c',
  parentGoalId: 'p', alignmentType: 'CASCADE', contributionPct: null, allocatedValue: 10, ...o,
});

export const periodTarget = (o: Partial<GoalPeriodTarget> = {}): GoalPeriodTarget => ({
  id: 'pt1', tenantId: TENANT, goalId: 'g1', periodId: 'T01', targetValue: 10, ...o,
});

export const period = (o: Partial<CyclePeriod> = {}): CyclePeriod => ({
  id: 'T01', tenantId: TENANT, cycleId: 'c2027', periodType: 'Month', label: 'T01',
  startDate: '2027-01-01', endDate: '2027-01-31', inputDeadline: null, evalDeadline: null,
  isLocked: false, ...o,
});

/** The 12 months of 2027. */
export function months2027(): CyclePeriod[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    const last = new Date(Date.UTC(2027, i + 1, 0)).getUTCDate();
    return period({ id: `T${m}`, label: `T${m}`, startDate: `2027-${m}-01`, endDate: `2027-${m}-${last}` });
  });
}

export const orgUnit = (o: Partial<OrgUnit> = {}): OrgUnit => ({
  id: 'ou-root', tenantId: TENANT, parentId: null, code: 'ROOT', name: 'Syntra', unitType: 'Company',
  headEmployeeId: null, effectiveFrom: '2020-01-01', effectiveTo: null, status: 'Active', ...o,
});

export const position = (o: Partial<JobPosition> = {}): JobPosition => ({
  id: 'pos-staff', tenantId: TENANT, code: 'NV', name: 'Nhân viên', jobLevel: 'Staff', status: 'Active', ...o,
});

export const employee = (o: Partial<Employee> = {}): Employee => ({
  id: 'e1', tenantId: TENANT, employeeCode: 'E1', fullName: 'Nhân viên', email: 'e1@example.test',
  hireDate: '2020-01-01', employmentStatus: 'Official', leftOn: null, ...o,
});

export const assignment = (o: Partial<EmployeeAssignment> = {}): EmployeeAssignment => ({
  id: `as-${o.employeeId ?? 'e1'}`, tenantId: TENANT, employeeId: 'e1', orgUnitId: 'ou-root',
  positionId: 'pos-staff', managerEmployeeId: null, isPrimary: true, effectiveFrom: '2020-01-01',
  effectiveTo: null, ...o,
});

export const user = (o: Partial<UserAccount> = {}): UserAccount => ({
  id: `u-${o.employeeId ?? 'e1'}`, tenantId: TENANT, employeeId: 'e1', login: 'e1', displayName: 'User',
  authProvider: 'Local', status: 'Active', lastLoginAt: null, ...o,
});

export const role = (o: Partial<Role> = {}): Role => ({
  id: `r-${o.code ?? 'HR'}`, tenantId: TENANT, code: 'HR', name: 'HR', ...o,
});

export const userRole = (o: Partial<UserRole> = {}): UserRole => ({
  id: `ur-${o.userId ?? 'u'}-${o.roleId ?? 'r'}`, tenantId: TENANT, userId: 'u-hr', roleId: 'r-HR',
  scopeType: 'Tenant', scopeOrgUnitId: null, includeChildren: false, ...o,
});

export const step = (o: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: `s${o.stepNo ?? 1}`, tenantId: TENANT, workflowId: 'wf1', stepNo: 1, name: 'Step',
  actorRule: 'SELF', actorRoleId: null, allowedActions: ['SUBMIT'], returnToStepNo: null,
  slaDays: null, onOverdue: null, remindDaysBefore: null, evaluationColumn: null,
  requiresComment: false, ...o,
});

/** The default registration workflow (BR-KPI-12): manager cascades → employee → manager → HR. */
export function registrationSteps(): WorkflowStep[] {
  return [
    step({ stepNo: 1, name: 'Quản lý phân giao', actorRule: 'DIRECT_MANAGER', allowedActions: ['EDIT', 'SUBMIT'] }),
    step({ stepNo: 2, name: 'Nhân viên đăng ký', actorRule: 'SELF', allowedActions: ['EDIT', 'SUBMIT'], slaDays: 5, onOverdue: 'LOCK' }),
    step({ stepNo: 3, name: 'Quản lý duyệt', actorRule: 'DIRECT_MANAGER', allowedActions: ['EDIT', 'APPROVE', 'RETURN'] }),
    step({ stepNo: 4, name: 'HR ghi nhận', actorRule: 'HR', allowedActions: ['APPROVE', 'RETURN'] }),
  ];
}

/** The default evaluation workflow (BR-KPI-16): self → manager → HR/C&B. */
export function evaluationSteps(): WorkflowStep[] {
  return [
    step({ stepNo: 1, name: 'Tự đánh giá', actorRule: 'SELF', allowedActions: ['SUBMIT'], slaDays: 7, onOverdue: 'AUTO_FORWARD', remindDaysBefore: 2, evaluationColumn: 'SELF' }),
    step({ stepNo: 2, name: 'Quản lý đánh giá', actorRule: 'DIRECT_MANAGER', allowedActions: ['APPROVE', 'RETURN'], evaluationColumn: 'MANAGER', requiresComment: true }),
    step({ stepNo: 3, name: 'HR chốt', actorRule: 'HR', allowedActions: ['APPROVE', 'RETURN'], evaluationColumn: 'FINAL' }),
  ];
}

export const form = (o: Partial<FormInstance> = {}): FormInstance => ({
  id: 'f1', tenantId: TENANT, workflowId: 'wf1', formType: 'KPI_EVAL', subjectEmployeeId: 'e1',
  goalPlanId: 'plan1', periodId: 'T01', currentStepId: 's1',
  currentStepEnteredAt: '2027-02-01T01:00:00.000Z', overdueHandledAt: null, status: 'Open',
  dueDate: '2027-02-08', launchedAt: '2027-02-01T01:00:00.000Z', launchId: null, ...o,
});

export const evaluationItem = (o: Partial<EvaluationItem> = {}): EvaluationItem => ({
  id: `it-${o.goalId ?? 'g1'}`, tenantId: TENANT, formId: 'f1', goalId: 'g1', actualSnapshot: null,
  actualTextSnapshot: null, selfAchievementPct: null, selfComment: null, managerAchievementPct: null,
  managerComment: null, finalAchievementPct: null, finalComment: null, ...o,
});

export const delegation = (o: Partial<Delegation> = {}): Delegation => ({
  id: 'd1', tenantId: TENANT, fromUserId: 'u-m1', toUserId: 'u-m2', formType: 'KPI_EVAL',
  validFrom: '2027-02-01', validTo: '2027-02-10', revokedAt: null, ...o,
});

export const goalChange = (o: Partial<GoalChangeItem> = {}): GoalChangeItem => ({
  id: 'gc1', tenantId: TENANT, formId: 'f1', goalId: 'g1', changeType: 'CANCEL', proposed: null,
  reason: 'Đổi chiến lược', ...o,
});

export const launch = (o: Partial<FormLaunch> = {}): FormLaunch => ({
  id: 'l1', tenantId: TENANT, workflowId: 'wf1', formType: 'KPI_EVAL', name: 'Đánh giá T01',
  timing: 'NOW', scheduledAt: '2027-02-01T01:00:00.000Z', launchRuleId: null, cycleId: 'c2027',
  periodId: 'T01', dueDays: 7, recipientMode: 'ALL', recipientFilter: null, status: 'Launched',
  launchedAt: '2027-02-01T01:00:00.000Z', createdBy: 'u-hr', createdAt: '2027-02-01T01:00:00.000Z', ...o,
});

export const launchRule = (o: Partial<FormLaunchRule> = {}): FormLaunchRule => ({
  id: 'lr1', tenantId: TENANT, workflowId: 'wf1', name: 'Đánh giá tháng', triggerEvent: 'PERIOD_END',
  periodType: 'Month', offsetDays: 1, dueDays: 7, recipientMode: 'ALL', recipientFilter: null,
  isActive: true, ...o,
});

export const ratingLevel = (o: Partial<RatingLevel> = {}): RatingLevel => ({
  id: `rl-${o.code ?? 'B'}`, tenantId: TENANT, ratingScaleId: 'rs1', code: 'B', label: 'B',
  minScore: 90, maxScore: 100, sortOrder: 0, ...o,
});

/** The sample A+/A/B/C/D scale (`ASSUMPTION Q2`, business-rules.md BR-KPI-41). */
export function sampleScale(): RatingLevel[] {
  return [
    ratingLevel({ code: 'D', minScore: 0, maxScore: 70, sortOrder: 5 }),
    ratingLevel({ code: 'C', minScore: 70, maxScore: 90, sortOrder: 4 }),
    ratingLevel({ code: 'B', minScore: 90, maxScore: 100, sortOrder: 3 }),
    ratingLevel({ code: 'A', minScore: 100, maxScore: 110, sortOrder: 2 }),
    ratingLevel({ code: 'A+', minScore: 110, maxScore: 1000, sortOrder: 1 }),
  ];
}

export const payoutRule = (o: Partial<PayoutRule> = {}): PayoutRule => ({
  id: 'pr1', tenantId: TENANT, ratingScaleId: 'rs1', ratingLevelId: 'rl-B', appliesTo: 'All',
  orgUnitId: null, positionId: null, payoutPct: 80, effectiveFrom: '2027-01-01', ...o,
});
