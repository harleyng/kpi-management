/**
 * Domain types and the FIXED STATE SETS for Syntra KPI.
 *
 * Every status label in the app comes from a set declared in this file (CLAUDE.md, critical rule 2).
 * Never write a status string literal anywhere else, and never invent a new label: add it here,
 * give it a Vietnamese label map, and update `.agents/knowledge/business-rules.md` in the same change.
 *
 * Source of truth for entity names and relations: `docs/erd/kpi_erd.mermaid` (67 tables, P1–P3).
 * IDs are strings (`crypto.randomUUID()`); the ERD's `bigint` keys are for the future database.
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * TODO Phase 1.1 — domain types for the 47 P1 tables, plus ERD deltas D1–D6
 * (docs/plans/KPI_repo_plan.md §4). Every business type carries `tenantId`.
 *
 *   G1 Tổ chức & người dùng   TENANT · ORG_UNIT · JOB_POSITION · EMPLOYEE · EMPLOYEE_ASSIGNMENT ·
 *                             USER_ACCOUNT · ROLE · PERMISSION · ROLE_PERMISSION · USER_ROLE
 *   G2 Thư viện KPI           BSC_PERSPECTIVE · MEASURE_UNIT · CALC_METHOD · CALC_TIER ·
 *                             KPI_DEFINITION · KPI_TEMPLATE · KPI_TEMPLATE_ITEM
 *   G3 Kế hoạch mục tiêu      PERFORMANCE_CYCLE · CYCLE_PERIOD · GOAL_PLAN · KGI · GOAL ·
 *                             GOAL_ALIGNMENT · GOAL_PERIOD_TARGET
 *   G4 Số liệu thực hiện      DATA_SOURCE · INTEGRATION_CONNECTION · DATA_MAPPING · SYNC_RUN ·
 *                             IMPORT_BATCH · GOAL_ACTUAL · EVIDENCE
 *   G5 Phê duyệt & đánh giá   WORKFLOW_TEMPLATE · WORKFLOW_STEP · FORM_INSTANCE · FORM_STEP_ACTION ·
 *                             EVALUATION_ITEM · DELEGATION
 *   G6 Kết quả & đãi ngộ      RATING_SCALE · RATING_LEVEL · PAYOUT_RULE · PERIOD_RESULT ·
 *                             RESULT_DETAIL · PAYROLL_EXPORT
 *   G7 Hệ thống               FILE_OBJECT · NOTIFICATION_TEMPLATE · NOTIFICATION · AUDIT_LOG
 *
 *   Deltas (proposed, awaiting 1.1 review):
 *     D1 GoalTargetLevel { goalId, levelCode L1/L2/L3, targetValue, targetText, scorePct } + LEVELS calc type
 *     D2 Goal.visibility           D3 GoalAlignment.allocatedValue ("chưa giao" is DERIVED)
 *     D4 Goal.kriType (hidden, Q6) D5 FormLaunch (+ FORM_LAUNCH_RULE moved from P2 to P1)
 *     D6 formRules.canSubmit()     — a rule, not a table
 *
 *   State sets to declare here (values proposed in business-rules.md §5, confirmed in 1.1):
 *     TenantStatus · CycleStatus · PeriodType · GoalPlanStatus · GoalStatus · AlignmentType ·
 *     CalcMethodType · ActualSourceType · FormType · FormStatus · StepAction · ActorRule ·
 *     OverdueBehaviour · PeriodResultStatus
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 */

/**
 * Role codes — the ERD's `ROLE.code`. Declared already in Phase 0 because the navigation
 * (`navConfig.ts`, plan §7.1) says which roles see which group.
 */
export const ROLE_CODES = ['EMPLOYEE', 'MANAGER', 'HR', 'CNB', 'BOD', 'ADMIN'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLE_LABEL: Record<RoleCode, string> = {
  EMPLOYEE: 'Nhân viên',
  MANAGER: 'Quản lý',
  HR: 'Nhân sự (HR)',
  CNB: 'C&B',
  BOD: 'Ban điều hành',
  ADMIN: 'Quản trị hệ thống',
};

/**
 * Data scope of a role assignment — the ERD's `USER_ROLE.scope_type`. `permissionRules.can()`
 * (Phase 1.3) resolves every check against one of these.
 */
export const SCOPE_TYPES = ['Self', 'DirectReports', 'OrgUnit', 'Tenant'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];
