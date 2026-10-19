/**
 * Domain types and the FIXED STATE SETS for Syntra KPI.
 *
 * Every status label in the app comes from a set declared in this file (CLAUDE.md, critical rule 2).
 * Never write a status string literal anywhere else, and never invent a new label: add it here,
 * give it a Vietnamese label map, and update `.agents/knowledge/business-rules.md` §5 in the same change.
 *
 * Source of truth for entity names and relations: `docs/erd/kpi_erd.mermaid` (67 tables, P1–P3).
 * This file holds the 47 P1 tables (groups G1–G7) plus the deltas decided in Phase 1.1 — see the
 * "ERD deviations" table in `.agents/knowledge/architecture.md` (D1–D8).
 *
 * Conventions (they keep every shape storable in a table later, Phase 5):
 * - IDs are strings (`crypto.randomUUID()` at runtime, literal UUIDs in fixtures). The ERD's `bigint`
 *   keys are for the future database.
 * - **Every business entity carries `tenantId`** — also the child tables the ERD draws without it
 *   (KGI, GOAL, CALC_TIER…), because the ERD's own convention is "every business table has
 *   tenant_id" and the mock filters on it. The single exception is `Permission`, a system catalogue.
 * - Optional columns are `T | null`, never `?:` — a row always has every key, as a table row would.
 * - Dates are ISO strings: `IsoDate` = `YYYY-MM-DD`, `IsoDateTime` = ISO 8601 with offset.
 * - Percentages are plain numbers on a 0–100 scale (`120` = 120%), never fractions.
 * - **No derived values are stored** (total weight, "chưa giao", live scores): they are pure functions
 *   in `src/lib/*Rules.ts`. A `PeriodResult` / `ResultDetail` stores scores because it is a snapshot
 *   taken by those functions, not a cache of them.
 * - **Rows carry no generic `createdAt` / `updatedAt`.** Who changed what and when is the audit log's
 *   job (every write emits `entity.changed`); a timestamp is a column only where the domain reads it
 *   (`recordedAt`, `launchedAt`, `lockedAt`, a notification's `createdAt`…).
 * - Enum codes are English; the ERD's Vietnamese values ("Khoi", "Thử việc") map to English codes and
 *   reach the screen only through the `*_LABEL` maps (D8).
 */

import type { ErrorCode } from '@/lib/errorCatalog';

// ─── Primitives ────────────────────────────────────────────────────────────────────────────────

export type Id = string;
/** `YYYY-MM-DD`. */
export type IsoDate = string;
/** ISO 8601 with offset, e.g. `2027-01-31T17:00:00.000Z`. */
export type IsoDateTime = string;

/** A JSON-serialisable value — what an audit snapshot or a filter column can hold (jsonb later). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** The columns every tenant-scoped row has. */
export interface TenantScoped {
  id: Id;
  tenantId: Id;
}

/** Master-data lifecycle shared by org units, positions, accounts, rating scales and connections. */
export const RECORD_STATUSES = ['Active', 'Inactive'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];
export const RECORD_STATUS_LABEL: Readonly<Record<RecordStatus, string>> = {
  Active: 'Đang dùng',
  Inactive: 'Ngừng dùng',
};

// ═══ G1 · Tổ chức & người dùng ═════════════════════════════════════════════════════════════════

export const TENANT_STATUSES = ['Active', 'Suspended'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];
export const TENANT_STATUS_LABEL: Readonly<Record<TenantStatus, string>> = {
  Active: 'Đang hoạt động',
  Suspended: 'Tạm ngưng',
};

/** ERD `TENANT` — a member company. The tenant row IS the boundary, so it has no `tenantId`. */
export interface Tenant {
  id: Id;
  code: string;
  name: string;
  /** IANA zone, e.g. `Asia/Ho_Chi_Minh`. Deadlines and "today" are read in this zone. */
  timezone: string;
  status: TenantStatus;
  createdAt: IsoDateTime;
}

/** ERD `ORG_UNIT.unit_type` "Company/Khoi/PhongBan/Nhom". */
export const ORG_UNIT_TYPES = ['Company', 'Division', 'Department', 'Team'] as const;
export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number];
export const ORG_UNIT_TYPE_LABEL: Readonly<Record<OrgUnitType, string>> = {
  Company: 'Công ty',
  Division: 'Khối',
  Department: 'Phòng ban',
  Team: 'Nhóm',
};

/** ERD `ORG_UNIT` — the org tree (self-referencing `parentId`). */
export interface OrgUnit extends TenantScoped {
  /** `null` only for the root (the company). */
  parentId: Id | null;
  code: string;
  name: string;
  unitType: OrgUnitType;
  headEmployeeId: Id | null;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  status: RecordStatus;
}

/** ERD `JOB_POSITION.job_level` "GĐ/TP/TN/CV/NV/CTV". */
export const JOB_LEVELS = ['Director', 'DeptHead', 'TeamLead', 'Specialist', 'Staff', 'Collaborator'] as const;
export type JobLevel = (typeof JOB_LEVELS)[number];
export const JOB_LEVEL_LABEL: Readonly<Record<JobLevel, string>> = {
  Director: 'Giám đốc',
  DeptHead: 'Trưởng phòng',
  TeamLead: 'Trưởng nhóm',
  Specialist: 'Chuyên viên',
  Staff: 'Nhân viên',
  Collaborator: 'Cộng tác viên',
};

/** ERD `JOB_POSITION`. */
export interface JobPosition extends TenantScoped {
  code: string;
  name: string;
  jobLevel: JobLevel;
  status: RecordStatus;
}

/** ERD `EMPLOYEE.employment_status` "Thử việc/Chính thức/Nghỉ việc". */
export const EMPLOYMENT_STATUSES = ['Probation', 'Official', 'Resigned'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const EMPLOYMENT_STATUS_LABEL: Readonly<Record<EmploymentStatus, string>> = {
  Probation: 'Thử việc',
  Official: 'Chính thức',
  Resigned: 'Nghỉ việc',
};

/** ERD `EMPLOYEE`. */
export interface Employee extends TenantScoped {
  employeeCode: string;
  fullName: string;
  email: string;
  hireDate: IsoDate;
  employmentStatus: EmploymentStatus;
  /**
   * Last working day — D7. Needed by the "left mid-period" rules (plan §8.1); the ERD only has the
   * status, which cannot say WHEN within a period someone left. `null` while employed.
   */
  leftOn: IsoDate | null;
}

/** ERD `EMPLOYEE_ASSIGNMENT` — unit + position + direct manager, dated. */
export interface EmployeeAssignment extends TenantScoped {
  employeeId: Id;
  orgUnitId: Id;
  positionId: Id;
  /** The direct line. Resolved at the time of a workflow action (BR-KPI-20). */
  managerEmployeeId: Id | null;
  /** `false` for a concurrent (kiêm nhiệm) assignment. */
  isPrimary: boolean;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
}

export const AUTH_PROVIDERS = ['Local', 'SSO'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];
export const AUTH_PROVIDER_LABEL: Readonly<Record<AuthProvider, string>> = {
  Local: 'Tài khoản nội bộ',
  SSO: 'Đăng nhập một lần (SSO)',
};

/** ERD `USER_ACCOUNT`. Sign-in is simulated in P1 — nothing here is a credential. */
export interface UserAccount extends TenantScoped {
  /** `null` for a system account with no person behind it. */
  employeeId: Id | null;
  login: string;
  /** D7 — a system account has no employee to take a name from. */
  displayName: string;
  authProvider: AuthProvider;
  status: RecordStatus;
  lastLoginAt: IsoDateTime | null;
}

/** Role codes — the ERD's `ROLE.code`. */
export const ROLE_CODES = ['EMPLOYEE', 'MANAGER', 'HR', 'CNB', 'BOD', 'ADMIN'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];
export const ROLE_LABEL: Readonly<Record<RoleCode, string>> = {
  EMPLOYEE: 'Nhân viên',
  MANAGER: 'Quản lý',
  HR: 'Nhân sự (HR)',
  CNB: 'C&B',
  BOD: 'Ban điều hành',
  ADMIN: 'Quản trị hệ thống',
};

/** ERD `ROLE`. One row per code per tenant. */
export interface Role extends TenantScoped {
  code: RoleCode;
  name: string;
}

/**
 * ERD `PERMISSION` — the system-wide catalogue (`goalplan.lock`, `form.launch`…). The only entity
 * without `tenantId`: it is the same list for every tenant. The codes, and the ids derived from them
 * (`perm.<code>`), are declared in `src/lib/permissionRules.ts`. The ERD's example `goal.approve` is
 * not adopted: approving is the workflow step's actor rule, never a permission (BR-KPI-61).
 */
export interface Permission {
  id: Id;
  code: string;
  module: string;
  description: string;
}

/** ERD `ROLE_PERMISSION`. Composite key (roleId, permissionId); `tenantId` comes with the role. */
export interface RolePermission {
  tenantId: Id;
  roleId: Id;
  permissionId: Id;
}

/** Data scope of a role assignment — the ERD's `USER_ROLE.scope_type`. */
export const SCOPE_TYPES = ['Self', 'DirectReports', 'OrgUnit', 'Tenant'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];
export const SCOPE_TYPE_LABEL: Readonly<Record<ScopeType, string>> = {
  Self: 'Bản thân',
  DirectReports: 'Cấp dưới trực tiếp',
  OrgUnit: 'Đơn vị',
  Tenant: 'Toàn công ty',
};

/** ERD `USER_ROLE`. */
export interface UserRole extends TenantScoped {
  userId: Id;
  roleId: Id;
  scopeType: ScopeType;
  /** Required when `scopeType` is `OrgUnit`, otherwise `null`. */
  scopeOrgUnitId: Id | null;
  includeChildren: boolean;
}

// ═══ G2 · Thư viện KPI ═════════════════════════════════════════════════════════════════════════

/** ERD `BSC_PERSPECTIVE.code`. The four BSC perspectives are fixed; their names are per tenant. */
export const BSC_PERSPECTIVE_CODES = ['FIN', 'CUS', 'PRO', 'LNG'] as const;
export type BscPerspectiveCode = (typeof BSC_PERSPECTIVE_CODES)[number];
export const BSC_PERSPECTIVE_LABEL: Readonly<Record<BscPerspectiveCode, string>> = {
  FIN: 'Tài chính',
  CUS: 'Khách hàng',
  PRO: 'Quy trình nội bộ',
  LNG: 'Học hỏi & phát triển',
};

/** ERD `BSC_PERSPECTIVE`. */
export interface BscPerspective extends TenantScoped {
  code: BscPerspectiveCode;
  name: string;
  sortOrder: number;
}

/** ERD `MEASURE_UNIT` (%, tỷ, người…). `code` is free text per tenant (PCT/VND/PERSON/COUNT/DAY…). */
export interface MeasureUnit extends TenantScoped {
  code: string;
  name: string;
  /** Decimal places shown and accepted on input. */
  decimals: number;
}

/**
 * ERD `CALC_METHOD.method_type` + D1 (`LEVELS`). The arithmetic of each is in
 * `src/lib/calcRules.ts` (Phase 1.5) — BR-KPI-30…33.
 */
export const CALC_METHOD_TYPES = ['RATIO_UP', 'RATIO_DOWN', 'TIERED', 'BINARY', 'FORMULA', 'LEVELS'] as const;
export type CalcMethodType = (typeof CALC_METHOD_TYPES)[number];
export const CALC_METHOD_TYPE_LABEL: Readonly<Record<CalcMethodType, string>> = {
  RATIO_UP: 'Càng cao càng tốt (thực tế / mục tiêu)',
  RATIO_DOWN: 'Càng thấp càng tốt (mục tiêu / thực tế)',
  TIERED: 'Bậc thang',
  BINARY: 'Đạt / Không đạt',
  FORMULA: 'Công thức',
  LEVELS: 'Định mức L1/L2/L3',
};

/** ERD `CALC_METHOD`. */
export interface CalcMethod extends TenantScoped {
  code: string;
  /** D7 — a short name for pickers; the ERD has only `description`. */
  name: string;
  methodType: CalcMethodType;
  /** Only for `FORMULA`. */
  formulaExpr: string | null;
  /** Cap on achievement %, e.g. `120`. `null` = no cap. */
  capPct: number | null;
  /** Floor on achievement %. `null` = no floor. */
  floorPct: number | null;
  description: string | null;
}

/** ERD `CALC_TIER` — the ranges of a `TIERED` method. Bound inclusivity is fixed by `calcRules`. */
export interface CalcTier extends TenantScoped {
  calcMethodId: Id;
  /** `null` = open below. */
  fromValue: number | null;
  /** `null` = open above. */
  toValue: number | null;
  achievementPct: number;
}

/** ERD `KPI_DEFINITION.frequency` "Tuần/Tháng/Quý/Năm". */
export const KPI_FREQUENCIES = ['Week', 'Month', 'Quarter', 'Year'] as const;
export type KpiFrequency = (typeof KPI_FREQUENCIES)[number];
export const KPI_FREQUENCY_LABEL: Readonly<Record<KpiFrequency, string>> = {
  Week: 'Tuần',
  Month: 'Tháng',
  Quarter: 'Quý',
  Year: 'Năm',
};

/** ERD `KPI_DEFINITION.aggregation` — how period actuals add up to a longer period. */
export const AGGREGATIONS = ['SUM', 'AVG', 'LAST'] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];
export const AGGREGATION_LABEL: Readonly<Record<Aggregation, string>> = {
  SUM: 'Cộng dồn',
  AVG: 'Trung bình',
  LAST: 'Lấy kỳ cuối',
};

/** ERD `KPI_DEFINITION.status`; also used by `KpiTemplate`. */
export const LIBRARY_STATUSES = ['Draft', 'Active', 'Archived'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];
export const LIBRARY_STATUS_LABEL: Readonly<Record<LibraryStatus, string>> = {
  Draft: 'Nháp',
  Active: 'Đang áp dụng',
  Archived: 'Lưu trữ',
};

/**
 * DATX's secondary classification "Hiệu quả / Khối lượng / Chi phí" — a TAG beside the BSC
 * perspective, never instead of it (`ASSUMPTION Q5`, BR-KPI-06). D7.
 */
export const KPI_CATEGORY_TAGS = ['EFFICIENCY', 'VOLUME', 'COST'] as const;
export type KpiCategoryTag = (typeof KPI_CATEGORY_TAGS)[number];
export const KPI_CATEGORY_TAG_LABEL: Readonly<Record<KpiCategoryTag, string>> = {
  EFFICIENCY: 'Hiệu quả',
  VOLUME: 'Khối lượng',
  COST: 'Chi phí',
};

/** ERD `KPI_DEFINITION` — one reusable library item. */
export interface KpiDefinition extends TenantScoped {
  code: string;
  name: string;
  perspectiveId: Id;
  unitId: Id;
  calcMethodId: Id;
  defaultDataSourceId: Id | null;
  /** Definition — how to read the KPI. */
  definition: string | null;
  /** The formula, explained in words. */
  formulaText: string | null;
  frequency: KpiFrequency;
  aggregation: Aggregation;
  /** Standard library item (`true`) or created by the tenant. */
  isSystem: boolean;
  categoryTag: KpiCategoryTag | null;
  status: LibraryStatus;
}

/** ERD `KPI_TEMPLATE` — a set of KPIs for a unit OR a position (at most one of the two). */
export interface KpiTemplate extends TenantScoped {
  name: string;
  orgUnitId: Id | null;
  positionId: Id | null;
  status: LibraryStatus;
}

/** ERD `KPI_TEMPLATE_ITEM`. */
export interface KpiTemplateItem extends TenantScoped {
  templateId: Id;
  kpiDefId: Id;
  defaultWeight: number;
  defaultTarget: number | null;
}

// ═══ G3 · Kế hoạch mục tiêu ════════════════════════════════════════════════════════════════════

export const CYCLE_STATUSES = ['Planning', 'Active', 'Evaluating', 'Closed'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];
export const CYCLE_STATUS_LABEL: Readonly<Record<CycleStatus, string>> = {
  Planning: 'Đang lập kế hoạch',
  Active: 'Đang thực hiện',
  Evaluating: 'Đang đánh giá',
  Closed: 'Đã đóng',
};

/** ERD `PERFORMANCE_CYCLE`, e.g. "KPI 2027". */
export interface PerformanceCycle extends TenantScoped {
  name: string;
  startDate: IsoDate;
  endDate: IsoDate;
  ratingScaleId: Id | null;
  status: CycleStatus;
}

export const PERIOD_TYPES = ['Month', 'Quarter', 'Half', 'Year'] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];
export const PERIOD_TYPE_LABEL: Readonly<Record<PeriodType, string>> = {
  Month: 'Tháng',
  Quarter: 'Quý',
  Half: 'Nửa năm',
  Year: 'Năm',
};

/** ERD `CYCLE_PERIOD` — T01…T12, Q1…Q4, H1, Y. */
export interface CyclePeriod extends TenantScoped {
  cycleId: Id;
  periodType: PeriodType;
  label: string;
  startDate: IsoDate;
  endDate: IsoDate;
  /** Deadline for entering actuals. */
  inputDeadline: IsoDate | null;
  /** Deadline for the evaluation. */
  evalDeadline: IsoDate | null;
  isLocked: boolean;
}

/** ERD `GOAL_PLAN.plan_type`. P2 adds `Probation`. */
export const PLAN_TYPES = ['KPI'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];
export const PLAN_TYPE_LABEL: Readonly<Record<PlanType, string>> = {
  KPI: 'KPI',
};

/** The three tiers (BR-KPI-01). Shared by `GoalPlan` and `PeriodResult`. */
export const OWNER_TYPES = ['Company', 'OrgUnit', 'Employee'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];
export const OWNER_TYPE_LABEL: Readonly<Record<OwnerType, string>> = {
  Company: 'Công ty',
  OrgUnit: 'Bộ phận',
  Employee: 'Cá nhân',
};

/**
 * ERD `GOAL_PLAN.status` + `Returned`. The ERD has Draft/Submitted/Approved/Locked; `Returned` is
 * added because the plan's seed (§6.4) and the registration flow (BR-KPI-12 step 3) need the owner
 * to SEE that a plan came back — a returned plan is editable like a draft but is not a new one.
 */
export const GOAL_PLAN_STATUSES = ['Draft', 'Submitted', 'Returned', 'Approved', 'Locked'] as const;
export type GoalPlanStatus = (typeof GOAL_PLAN_STATUSES)[number];
export const GOAL_PLAN_STATUS_LABEL: Readonly<Record<GoalPlanStatus, string>> = {
  Draft: 'Nháp',
  Submitted: 'Đã gửi',
  Returned: 'Bị trả lại',
  Approved: 'Đã duyệt',
  Locked: 'Đã khóa',
};

/**
 * ERD `GOAL_PLAN` — one owner's goals for one cycle. Exactly one of `ownerOrgUnitId` /
 * `ownerEmployeeId` is set for OrgUnit / Employee plans; a Company plan sets `ownerOrgUnitId` to
 * the root unit. The ERD's `total_weight` is NOT stored — it is `goalPlanRules` arithmetic.
 *
 * During an adjustment (GOAL_CHANGE) the plan STAYS `Locked`: the proposal lives in
 * `GoalChangeItem` rows until the form's final approval applies them. "Đang điều chỉnh" is derived
 * from an open GOAL_CHANGE form (at most one per plan), never a status.
 */
export interface GoalPlan extends TenantScoped {
  cycleId: Id;
  planType: PlanType;
  ownerType: OwnerType;
  ownerOrgUnitId: Id | null;
  ownerEmployeeId: Id | null;
  status: GoalPlanStatus;
  /** Set on lock, cleared on unlock; the full history is the audit log (BR-KPI-14). */
  lockedAt: IsoDateTime | null;
}

/** ERD `KGI` — one of the plan's 3–5 key goals (BR-KPI-02). */
export interface Kgi extends TenantScoped {
  goalPlanId: Id;
  name: string;
  description: string | null;
  sortOrder: number;
  /** Optional numeric target, never scored (`ASSUMPTION Q9`). D7. */
  targetValue: number | null;
  unitId: Id | null;
}

export const GOAL_STATUSES = ['Active', 'Changed', 'Cancelled'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const GOAL_STATUS_LABEL: Readonly<Record<GoalStatus, string>> = {
  Active: 'Đang áp dụng',
  Changed: 'Đã thay đổi',
  Cancelled: 'Đã hủy',
};

/** D2 — HR guide pp. 21–22. A private goal is visible to its owner and their managers only. */
export const GOAL_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;
export type GoalVisibility = (typeof GOAL_VISIBILITIES)[number];
export const GOAL_VISIBILITY_LABEL: Readonly<Record<GoalVisibility, string>> = {
  PUBLIC: 'Công khai',
  PRIVATE: 'Riêng tư',
};

/**
 * D4 — HR guide p. 22 "Loại": KRItc pairs only with Tài chính, KRIpt with any perspective. The
 * meaning of "tc"/"pt" is unconfirmed, so the field is stored but HIDDEN on screens
 * (`ASSUMPTION Q6`).
 */
export const KRI_TYPES = ['KRItc', 'KRIpt'] as const;
export type KriType = (typeof KRI_TYPES)[number];
export const KRI_TYPE_LABEL: Readonly<Record<KriType, string>> = {
  KRItc: 'KRItc',
  KRIpt: 'KRIpt',
};

/** D7 — HR guide p. 23 "Theo giá trị (%)" / "Theo trạng thái kết quả (Đạt/Không đạt)". */
export const TARGET_TYPES = ['NUMERIC', 'TEXT'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];
export const TARGET_TYPE_LABEL: Readonly<Record<TargetType, string>> = {
  NUMERIC: 'Theo giá trị',
  TEXT: 'Theo trạng thái (Đạt/Không đạt)',
};

/** ERD `GOAL` — one KPI in a Goal Plan. */
export interface Goal extends TenantScoped {
  goalPlanId: Id;
  kgiId: Id | null;
  /** `null` when typed in rather than picked from the library. */
  kpiDefId: Id | null;
  name: string;
  /** D7 — "Mô tả" (HR guide p. 22), inherited from the library item when picked. */
  description: string | null;
  /** D7 — "Công thức" in words (plan §5.1), inherited from the library item when picked. */
  formulaText: string | null;
  perspectiveId: Id;
  /** D4 — hidden until Q6 is answered. */
  kriType: KriType | null;
  /** D2. */
  visibility: GoalVisibility;
  unitId: Id;
  calcMethodId: Id;
  /** Required — "KPI phải đo được" (BR-KPI-05). */
  dataSourceId: Id;
  weight: number;
  /** D7 — numeric or text target (BR-KPI-10). Decides which of the two fields below is read. */
  targetType: TargetType;
  targetValue: number | null;
  targetText: string | null;
  /**
   * D3 — "Tự giao" (HR guide p. 24): the share of a cascaded goal the manager keeps for themself.
   * Only meaningful on a goal that has cascade children. `null` = none kept.
   */
  selfAssignedValue: number | null;
  /**
   * D7 — `true` when this KPI's actual is SUMMED from its children instead of measured on its own
   * (`ASSUMPTION Q8`, BR-KPI-36). Default `false`.
   */
  rollUpFromChildren: boolean;
  startDate: IsoDate;
  dueDate: IsoDate;
  ownerEmployeeId: Id | null;
  status: GoalStatus;
  /**
   * D7 — set on the goal an approved adjustment created to replace another (BR-KPI-15): the old one
   * becomes `Changed`, this one `Active`, and the link keeps the history readable.
   */
  replacesGoalId: Id | null;
  sortOrder: number;
}

/** D1 — the levels a goal can carry (HR guide p. 23 shows L1, L2 and "+" for more). */
export const TARGET_LEVEL_CODES = ['L1', 'L2', 'L3'] as const;
export type TargetLevelCode = (typeof TARGET_LEVEL_CODES)[number];
export const TARGET_LEVEL_LABEL: Readonly<Record<TargetLevelCode, string>> = {
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
};

/**
 * D1 — `GOAL_TARGET_LEVEL`, set per ASSIGNED goal (not per method): "Định mức · Mục tiêu ·
 * Nguyên tắc đánh giá" (HR guide pp. 23, 28; import columns P–T p. 63). Reaching `targetValue`
 * (or `targetText`, per the goal's `targetType`) earns `scorePct` — e.g. L1 → 0, L2 → 100.
 * Interpolation between levels is `ASSUMPTION Q1` in `calcRules`.
 */
export interface GoalTargetLevel extends TenantScoped {
  goalId: Id;
  levelCode: TargetLevelCode;
  targetValue: number | null;
  targetText: string | null;
  scorePct: number;
}

export const ALIGNMENT_TYPES = ['CASCADE', 'LINK'] as const;
export type AlignmentType = (typeof ALIGNMENT_TYPES)[number];
export const ALIGNMENT_TYPE_LABEL: Readonly<Record<AlignmentType, string>> = {
  CASCADE: 'Phân giao (cascade)',
  LINK: 'Liên kết (link)',
};

/**
 * ERD `GOAL_ALIGNMENT` + D3. A CASCADE carries `allocatedValue` (the part of the parent's target
 * handed to the child's owner); a LINK carries `contributionPct`.
 *
 * The four buckets a manager sees on a cascaded goal (HR guide p. 24):
 * - "Phân bổ nhân viên" = Σ `allocatedValue` of its CASCADE children — derived;
 * - "Tự giao / tự nhận" = the parent's `selfAssignedValue` — stored;
 * - "Chưa giao" = parent target − both of the above — derived (`alignmentRules`), never stored;
 * - "Tự thực hiện" (what the manager personally achieved) is NOT tracked in P1 (`ASSUMPTION Q11`).
 */
export interface GoalAlignment extends TenantScoped {
  childGoalId: Id;
  parentGoalId: Id;
  alignmentType: AlignmentType;
  contributionPct: number | null;
  allocatedValue: number | null;
}

/** ERD `GOAL_PERIOD_TARGET` — the goal's target split by month/quarter (BR-KPI-11). */
export interface GoalPeriodTarget extends TenantScoped {
  goalId: Id;
  periodId: Id;
  targetValue: number;
}

// ═══ G4 · Số liệu thực hiện ════════════════════════════════════════════════════════════════════

/** ERD `DATA_SOURCE.source_type` = `GOAL_ACTUAL.source_type`. */
export const SOURCE_TYPES = ['MANUAL', 'EXCEL', 'API'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const SOURCE_TYPE_LABEL: Readonly<Record<SourceType, string>> = {
  MANUAL: 'Nhập tay',
  EXCEL: 'Import Excel',
  API: 'Kết nối API',
};

/** ERD `DATA_SOURCE` — ERP Sale, HRIS, Excel, Thủ công… */
export interface DataSource extends TenantScoped {
  code: string;
  name: string;
  sourceType: SourceType;
  ownerOrgUnitId: Id | null;
}

export const CONNECTION_AUTH_TYPES = ['APIKey', 'OAuth2', 'Basic'] as const;
export type ConnectionAuthType = (typeof CONNECTION_AUTH_TYPES)[number];
export const CONNECTION_AUTH_TYPE_LABEL: Readonly<Record<ConnectionAuthType, string>> = {
  APIKey: 'API key',
  OAuth2: 'OAuth 2.0',
  Basic: 'Basic',
};

/** ERD `INTEGRATION_CONNECTION` — simulated in P1 (the ERP Sale connector, WBS 4.4.5). */
export interface IntegrationConnection extends TenantScoped {
  dataSourceId: Id;
  endpoint: string;
  authType: ConnectionAuthType;
  /** A reference to a vault key — never the secret itself. */
  secretRef: string;
  scheduleCron: string | null;
  status: RecordStatus;
}

/** ERD `DATA_MAPPING` — which query of a connection feeds which library KPI. */
export interface DataMapping extends TenantScoped {
  connectionId: Id;
  kpiDefId: Id;
  queryOrPath: string;
  /** The field that identifies the unit / employee in the source. */
  orgDimension: string;
  transformExpr: string | null;
}

export const SYNC_RUN_STATUSES = ['Running', 'Succeeded', 'PartiallyFailed', 'Failed'] as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];
export const SYNC_RUN_STATUS_LABEL: Readonly<Record<SyncRunStatus, string>> = {
  Running: 'Đang đồng bộ',
  Succeeded: 'Thành công',
  PartiallyFailed: 'Có dòng lỗi',
  Failed: 'Thất bại',
};

/** ERD `SYNC_RUN`. */
export interface SyncRun extends TenantScoped {
  connectionId: Id;
  /** D7 — the period the run loaded actuals for. */
  periodId: Id | null;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  recordsOk: number;
  recordsError: number;
  status: SyncRunStatus;
  errorLog: string | null;
}

/** ERD `IMPORT_BATCH.import_type`. */
export const IMPORT_TYPES = ['Actual', 'GoalPlan', 'OrgData', 'Library'] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];
export const IMPORT_TYPE_LABEL: Readonly<Record<ImportType, string>> = {
  Actual: 'Số thực tế',
  GoalPlan: 'Kế hoạch mục tiêu',
  OrgData: 'Tổ chức & nhân sự',
  Library: 'Thư viện KPI',
};

export const IMPORT_BATCH_STATUSES = ['Validating', 'Committed', 'Rejected'] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];
export const IMPORT_BATCH_STATUS_LABEL: Readonly<Record<ImportBatchStatus, string>> = {
  Validating: 'Đang kiểm tra',
  Committed: 'Đã ghi nhận',
  Rejected: 'Đã từ chối',
};

// Import rows (plan §5.2, §5.3) — the client parses the Excel file (exceljs) into these; the batch
// stores them until it is committed. Template headers are Vietnamese; these are the parsed values.
// `rowNo` is the sheet row (header = row 1), kept for error messages. A blank required cell stays
// `null`/absent and becomes a row error in `importRules` — it is never read as 0.

/** Plan §5.3 — one actual. The goal is `goalId`, or `login` + `kpiCode`; the period is `periodLabel` within the batch's cycle. */
export interface ActualImportRow {
  rowNo: number;
  goalId: Id | null;
  login: string | null;
  kpiCode: string | null;
  periodLabel: string;
  actualValue: number | null;
  actualText: string | null;
  note: string | null;
  evidenceUrl: string | null;
}

/** One level cell group of the Goal Plan template (L1/L2/L3: target + score). */
export interface ImportLevelCells {
  targetValue: number | null;
  targetText: string | null;
  scorePct: number | null;
}

/**
 * Plan §5.2 — one goal per row (CMC's three rows per goal are not needed). Defaulting rule: when
 * `kpiCode` resolves to a library item, a blank `unitCode` / `calcMethodCode` / `dataSourceCode`
 * takes the item's value (`dataSourceCode` from its default source); without a library item they
 * are required. `visibility` blank = PUBLIC.
 */
export interface GoalPlanImportRow {
  rowNo: number;
  login: string;
  perspectiveCode: string;
  goalName: string;
  kpiCode: string | null;
  unitCode: string | null;
  calcMethodCode: string | null;
  dataSourceCode: string | null;
  visibility: GoalVisibility | null;
  weight: number | null;
  description: string | null;
  startDate: IsoDate | null;
  dueDate: IsoDate | null;
  targetType: TargetType | null;
  targetValue: number | null;
  targetText: string | null;
  /** L1, L2, L3 in that order; an absent level is `null`. */
  levels: [ImportLevelCells | null, ImportLevelCells | null, ImportLevelCells | null];
}

/** WBS 4.1.7 — one employee with their primary assignment. */
export interface OrgDataImportRow {
  rowNo: number;
  employeeCode: string;
  fullName: string;
  email: string;
  hireDate: IsoDate | null;
  orgUnitCode: string;
  positionCode: string;
  managerEmployeeCode: string | null;
  login: string | null;
}

/** WBS 4.2.5 — one library KPI. Codes are resolved against the tenant's catalogues. */
export interface LibraryImportRow {
  rowNo: number;
  code: string;
  name: string;
  perspectiveCode: string;
  unitCode: string;
  calcMethodCode: string;
  definition: string | null;
  formulaText: string | null;
  frequency: string;
  aggregation: string;
}

export interface ImportRowsByType {
  Actual: ActualImportRow;
  GoalPlan: GoalPlanImportRow;
  OrgData: OrgDataImportRow;
  Library: LibraryImportRow;
}

/** One problem on one row of an import file (row numbers are the sheet's, header = row 1). */
export interface ImportRowError {
  rowNo: number;
  /** The column header as written in the template, or `null` for a whole-row problem. */
  column: string | null;
  code: ErrorCode;
  detail: string | null;
}

/**
 * ERD `IMPORT_BATCH`. The staged rows and their errors are stored WITH the batch (D7; jsonb later),
 * so a commit applies exactly what was previewed, even after a reload.
 */
export type ImportBatch = {
  [K in ImportType]: ImportBatchBase & { importType: K; rows: ImportRowsByType[K][] };
}[ImportType];

interface ImportBatchBase extends TenantScoped {
  /** The cycle period labels / plans resolve in (Actual, GoalPlan); `null` otherwise. */
  cycleId: Id | null;
  fileId: Id;
  uploadedBy: Id;
  rowsTotal: number;
  rowsError: number;
  errors: ImportRowError[];
  status: ImportBatchStatus;
  createdAt: IsoDateTime;
}

/**
 * ERD `GOAL_ACTUAL` — a SNAPSHOT: recording a new value for (goal, period) adds a row and flips the
 * previous one's `isCurrent` to `false` (BR-KPI-52). A missing actual is the absence of a row —
 * never a row with 0 (BR-KPI-32).
 */
export interface GoalActual extends TenantScoped {
  goalId: Id;
  periodId: Id;
  actualValue: number | null;
  actualText: string | null;
  sourceType: SourceType;
  batchId: Id | null;
  syncRunId: Id | null;
  /** The user who entered it; `null` for an API sync. */
  enteredBy: Id | null;
  /** D7 — "ghi chú" column of the actuals import (plan §5.3). */
  note: string | null;
  recordedAt: IsoDateTime;
  isCurrent: boolean;
}

/** ERD `EVIDENCE` — a file or an external link backing a goal's result. */
export interface Evidence extends TenantScoped {
  goalId: Id;
  periodId: Id | null;
  actualId: Id | null;
  fileId: Id | null;
  url: string | null;
  note: string | null;
  uploadedBy: Id;
  uploadedAt: IsoDateTime;
}

// ═══ G5 · Quy trình phê duyệt & đánh giá ═══════════════════════════════════════════════════════

/** ERD `WORKFLOW_TEMPLATE.form_type`. P2 adds PROBATION_EVAL, CONTRACT_EVAL, REVIEW_360. */
export const FORM_TYPES = ['GOAL_SETTING', 'GOAL_CHANGE', 'KPI_EVAL'] as const;
export type FormType = (typeof FORM_TYPES)[number];
export const FORM_TYPE_LABEL: Readonly<Record<FormType, string>> = {
  GOAL_SETTING: 'Đăng ký KPI',
  GOAL_CHANGE: 'Điều chỉnh KPI',
  KPI_EVAL: 'Đánh giá KPI',
};

/** ERD `WORKFLOW_TEMPLATE`. */
export interface WorkflowTemplate extends TenantScoped {
  formType: FormType;
  name: string;
  isDefault: boolean;
}

/** ERD `WORKFLOW_STEP.actor_rule` (BR-KPI-20). */
export const ACTOR_RULES = ['SELF', 'DIRECT_MANAGER', 'MANAGER_L2', 'HR', 'CNB', 'ROLE'] as const;
export type ActorRule = (typeof ACTOR_RULES)[number];
export const ACTOR_RULE_LABEL: Readonly<Record<ActorRule, string>> = {
  SELF: 'Nhân viên',
  DIRECT_MANAGER: 'Quản lý trực tiếp',
  MANAGER_L2: 'Quản lý cấp 2',
  HR: 'Nhân sự (HR)',
  CNB: 'C&B',
  ROLE: 'Theo vai trò',
};

/**
 * ERD `FORM_STEP_ACTION.action` + D7.
 * - `SUBMIT/APPROVE/EDIT/RETURN` are what a step may ALLOW (`WorkflowStep.allowedActions`).
 * - **`EDIT` is a permission, never a history row**: it lets the step's actor change someone else's
 *   plan or scores (`saveGoal`, `saveEvaluationItems`); those edits are audited through
 *   `entity.changed`, and the form does not move.
 * - `AUTO_FORWARD` and `AUTO_LOCK` are recorded by the scheduler when a step runs over (BR-KPI-13),
 *   with `actorUserId = null`.
 * - `CANCEL` records HR/ADMIN cancelling a form at any non-terminal step — how a form reaches
 *   `Cancelled` with a trace of who did it.
 */
export const STEP_ACTIONS = ['SUBMIT', 'APPROVE', 'EDIT', 'RETURN', 'CANCEL', 'AUTO_FORWARD', 'AUTO_LOCK'] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];
export const STEP_ACTION_LABEL: Readonly<Record<StepAction, string>> = {
  SUBMIT: 'Gửi',
  APPROVE: 'Duyệt',
  EDIT: 'Chỉnh sửa',
  RETURN: 'Trả lại',
  CANCEL: 'Hủy phiếu',
  AUTO_FORWARD: 'Tự chuyển do quá hạn',
  AUTO_LOCK: 'Tự khóa do quá hạn',
};

/** The subset a step can offer a person. */
export const ALLOWED_STEP_ACTIONS = ['SUBMIT', 'APPROVE', 'EDIT', 'RETURN'] as const satisfies readonly StepAction[];
export type AllowedStepAction = (typeof ALLOWED_STEP_ACTIONS)[number];

/** What a person can record on a form through `forms.act` (EDIT is not recorded; AUTO_* are the system's). */
export const PERSON_FORM_ACTIONS = ['SUBMIT', 'APPROVE', 'RETURN', 'CANCEL'] as const satisfies readonly StepAction[];
export type PersonFormAction = (typeof PERSON_FORM_ACTIONS)[number];

/** ERD `WORKFLOW_STEP.on_overdue` + `LOCK` (BR-KPI-13: registration locks the plan when time runs out). */
export const OVERDUE_BEHAVIOURS = ['AUTO_FORWARD', 'REMIND', 'LOCK'] as const;
export type OverdueBehaviour = (typeof OVERDUE_BEHAVIOURS)[number];
export const OVERDUE_BEHAVIOUR_LABEL: Readonly<Record<OverdueBehaviour, string>> = {
  AUTO_FORWARD: 'Tự chuyển bước tiếp theo',
  REMIND: 'Chỉ nhắc hạn',
  LOCK: 'Khóa Goal Plan',
};

/**
 * Which score column of the evaluation form a step fills — D6. `formRules.canSubmit()` checks that
 * column (and the comment, when `requiresComment`) on every item before a submit is allowed.
 */
export const EVALUATION_COLUMNS = ['SELF', 'MANAGER', 'FINAL'] as const;
export type EvaluationColumn = (typeof EVALUATION_COLUMNS)[number];
export const EVALUATION_COLUMN_LABEL: Readonly<Record<EvaluationColumn, string>> = {
  SELF: 'Tự đánh giá',
  MANAGER: 'Quản lý đánh giá',
  FINAL: 'HR/C&B chốt',
};

/**
 * ERD `WORKFLOW_STEP`.
 *
 * The step's deadline = min(`FormInstance.currentStepEnteredAt` + `slaDays`, form `dueDate`), in the
 * tenant's time zone; with `slaDays = null` it is the form's `dueDate`. `onOverdue` applies once per
 * entry into the step (`FormInstance.overdueHandledAt`). `saveWorkflow` refuses: RETURN on step 1,
 * AUTO_FORWARD on the last step, `onOverdue` without a deadline, and LOCK on a KPI_EVAL workflow.
 */
export interface WorkflowStep extends TenantScoped {
  workflowId: Id;
  /** 1-based, contiguous within a workflow. */
  stepNo: number;
  /** D7 — the step's name on screen ("Tự đánh giá", "Quản lý duyệt"). */
  name: string;
  actorRule: ActorRule;
  /** Required when `actorRule` is `ROLE`. */
  actorRoleId: Id | null;
  allowedActions: readonly AllowedStepAction[];
  /** D7 — where RETURN sends the form; `null` = the previous step. */
  returnToStepNo: number | null;
  /** `null` = no SLA (the form's due date applies). */
  slaDays: number | null;
  onOverdue: OverdueBehaviour | null;
  /** D7 — send DEADLINE_REMIND this many days before the step's deadline; `null` = no reminder. */
  remindDaysBefore: number | null;
  /** D6 — `null` on steps that do not score (registration). */
  evaluationColumn: EvaluationColumn | null;
  /** D6 — a comment is mandatory on every item at this step. */
  requiresComment: boolean;
}

/**
 * ERD `FORM_INSTANCE.status`. "Overdue" is NOT a status: it is derived by `workflowRules` from the
 * due date and today, so it can never disagree with the clock.
 */
export const FORM_STATUSES = ['Open', 'InProgress', 'Completed', 'Cancelled'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];
export const FORM_STATUS_LABEL: Readonly<Record<FormStatus, string>> = {
  Open: 'Mới khởi chạy',
  InProgress: 'Đang xử lý',
  Completed: 'Hoàn thành',
  Cancelled: 'Đã hủy',
};

/**
 * ERD `FORM_INSTANCE` — one form for one subject (and one period, for an evaluation). Cancelling a
 * GOAL_SETTING form puts its plan back to `Draft`.
 */
export interface FormInstance extends TenantScoped {
  workflowId: Id;
  /** D7 — copied from the workflow at launch so lists filter without a join (a workflow's type never changes). */
  formType: FormType;
  subjectEmployeeId: Id;
  goalPlanId: Id | null;
  periodId: Id | null;
  /** `null` once the form is Completed or Cancelled. */
  currentStepId: Id | null;
  /** D7 — when the current step was entered; the step's SLA counts from here. */
  currentStepEnteredAt: IsoDateTime | null;
  /**
   * D7 — when the scheduler applied the current step's overdue behaviour; cleared whenever a step is
   * entered. `runDue` handles a step only while this is `null`, so REMIND / LOCK fire once, not on
   * every tick. A form whose plan was AUTO_LOCKed stays at its step, frozen, until HR unlocks the
   * plan with a new due date.
   */
  overdueHandledAt: IsoDateTime | null;
  status: FormStatus;
  dueDate: IsoDate;
  launchedAt: IsoDateTime;
  /** D5 — the launch that created it. `null` for a form created by hand. */
  launchId: Id | null;
}

/**
 * ERD `FORM_STEP_ACTION` — the form's history. A proxy action sets `onBehalfOfUserId`; a delegated
 * one sets it AND `delegationId` (D7). Both people are always recorded (BR-KPI-21).
 */
export interface FormStepAction extends TenantScoped {
  formId: Id;
  stepId: Id;
  /** `null` only for the system's `AUTO_FORWARD`. */
  actorUserId: Id | null;
  onBehalfOfUserId: Id | null;
  delegationId: Id | null;
  action: StepAction;
  comment: string | null;
  actedAt: IsoDateTime;
}

/** ERD `EVALUATION_ITEM` — one goal on one evaluation form (plan §5.5). */
export interface EvaluationItem extends TenantScoped {
  formId: Id;
  goalId: Id;
  /** Read-only copy of the current actual when the form opened (BR-KPI-17). */
  actualSnapshot: number | null;
  /** D7 — the text counterpart for TEXT goals. */
  actualTextSnapshot: string | null;
  selfAchievementPct: number | null;
  selfComment: string | null;
  managerAchievementPct: number | null;
  managerComment: string | null;
  finalAchievementPct: number | null;
  /** D7 — needed when the FINAL step `requiresComment`. */
  finalComment: string | null;
}

/**
 * ERD `DELEGATION` — valid only for its form type, inclusive of both dates, and not after
 * `revokedAt` (BR-KPI-21). Never deleted: past actions point at it.
 */
export interface Delegation extends TenantScoped {
  fromUserId: Id;
  toUserId: Id;
  formType: FormType;
  validFrom: IsoDate;
  validTo: IsoDate;
  /** D7 — set by `revokeDelegation`. */
  revokedAt: IsoDateTime | null;
}

/** D7 — what an adjustment (GOAL_CHANGE) proposes for one goal (BR-KPI-15). */
export const GOAL_CHANGE_TYPES = ['ADD', 'MODIFY', 'CANCEL'] as const;
export type GoalChangeType = (typeof GOAL_CHANGE_TYPES)[number];
export const GOAL_CHANGE_TYPE_LABEL: Readonly<Record<GoalChangeType, string>> = {
  ADD: 'Thêm chỉ tiêu',
  MODIFY: 'Sửa chỉ tiêu',
  CANCEL: 'Hủy chỉ tiêu',
};

/** The goal fields an adjustment may propose (D7). */
export type GoalDraft = Omit<Goal, 'id' | 'tenantId' | 'goalPlanId' | 'status' | 'replacesGoalId' | 'sortOrder'> & {
  targetLevels: Omit<GoalTargetLevel, 'id' | 'tenantId' | 'goalId'>[];
};

/**
 * D7 — `GOAL_CHANGE_ITEM`, one proposed change on a GOAL_CHANGE form. Nothing touches the locked
 * plan until the form's final APPROVE: then MODIFY creates a new `Active` goal (`replacesGoalId` =
 * the old one, which becomes `Changed`), CANCEL marks the goal `Cancelled`, ADD creates a goal.
 */
export interface GoalChangeItem extends TenantScoped {
  formId: Id;
  /** `null` for ADD. */
  goalId: Id | null;
  changeType: GoalChangeType;
  /** `null` for CANCEL. */
  proposed: GoalDraft | null;
  reason: string;
}

/** D5 — when a launch fires (HR guide p. 91: Ngay bây giờ / Sau đó / Định kỳ). */
export const LAUNCH_TIMINGS = ['NOW', 'SCHEDULED', 'RECURRING'] as const;
export type LaunchTiming = (typeof LAUNCH_TIMINGS)[number];
export const LAUNCH_TIMING_LABEL: Readonly<Record<LaunchTiming, string>> = {
  NOW: 'Ngay bây giờ',
  SCHEDULED: 'Hẹn ngày',
  RECURRING: 'Định kỳ',
};

export const LAUNCH_STATUSES = ['Scheduled', 'Launched', 'Cancelled'] as const;
export type LaunchStatus = (typeof LAUNCH_STATUSES)[number];
export const LAUNCH_STATUS_LABEL: Readonly<Record<LaunchStatus, string>> = {
  Scheduled: 'Chờ khởi chạy',
  Launched: 'Đã khởi chạy',
  Cancelled: 'Đã hủy',
};

/** D5 — recipients (HR guide p. 93): all active employees, or a filter. */
export const RECIPIENT_MODES = ['ALL', 'FILTER'] as const;
export type RecipientMode = (typeof RECIPIENT_MODES)[number];
export const RECIPIENT_MODE_LABEL: Readonly<Record<RecipientMode, string>> = {
  ALL: 'Tất cả nhân viên đang làm việc',
  FILTER: 'Theo bộ lọc',
};

/**
 * D5 — the recipient filter (HR guide p. 93: phòng ban, bộ phận, mã công việc, loại hợp đồng…).
 * Every list is AND-ed across fields and OR-ed within one; an empty list means "any". Stored as
 * one json column later. `employeeIds` lets HR pick people by hand.
 */
export interface RecipientFilter {
  orgUnitIds: Id[];
  includeChildUnits: boolean;
  positionIds: Id[];
  jobLevels: JobLevel[];
  employmentStatuses: EmploymentStatus[];
  employeeIds: Id[];
}

/**
 * D5 — `FORM_LAUNCH` — one launch that creates many `FormInstance`s (HR guide pp. 89–93).
 * - Recipients are resolved WHEN IT FIRES (not when it is scheduled).
 * - A subject who already has a non-Cancelled form of the same `formType` for the same period
 *   (KPI_EVAL) or the same cycle's plan (GOAL_SETTING) is skipped.
 * - A GOAL_SETTING launch creates the subject's `Draft` Employee plan for `cycleId` when there is
 *   none. Company / OrgUnit plans are registered with `forms.startForm`, subject = the unit head.
 * - A rule produces at most one launch per (`launchRuleId`, `periodId`).
 */
export interface FormLaunch extends TenantScoped {
  workflowId: Id;
  formType: FormType;
  name: string;
  /** NOW or SCHEDULED for a one-off launch; RECURRING for a launch produced by a `FormLaunchRule`. */
  timing: LaunchTiming;
  /** When it fires (NOW: the moment it was created). */
  scheduledAt: IsoDateTime;
  /** Set when this launch was produced by a recurring rule. */
  launchRuleId: Id | null;
  cycleId: Id | null;
  /** The evaluation period (KPI_EVAL); `null` for a registration. */
  periodId: Id | null;
  /** Due date = launch date + `dueDays` (HR guide p. 92: "7 ngày sau ngày khởi chạy"). */
  dueDays: number;
  recipientMode: RecipientMode;
  /** Required when `recipientMode` is `FILTER`. */
  recipientFilter: RecipientFilter | null;
  status: LaunchStatus;
  launchedAt: IsoDateTime | null;
  /** `null` when a recurring rule created it. */
  createdBy: Id | null;
  createdAt: IsoDateTime;
}

/**
 * ERD `FORM_LAUNCH_RULE.trigger_event`, P1 subset (D5). The monthly evaluation launches on day 1 of
 * the next month = `PERIOD_END` + 1 day. P2 adds HIRE_DATE and CONTRACT_END (probation, contracts).
 */
export const LAUNCH_TRIGGERS = ['PERIOD_END'] as const;
export type LaunchTrigger = (typeof LAUNCH_TRIGGERS)[number];
export const LAUNCH_TRIGGER_LABEL: Readonly<Record<LaunchTrigger, string>> = {
  PERIOD_END: 'Sau khi kết thúc kỳ',
};

/**
 * ERD `FORM_LAUNCH_RULE`, moved from P2 to P1 (D5) because the monthly evaluation must launch
 * itself. When a period of `periodType` in an Active cycle ends, the rule fires `offsetDays` later
 * and produces one `FormLaunch` (timing RECURRING).
 */
export interface FormLaunchRule extends TenantScoped {
  workflowId: Id;
  name: string;
  triggerEvent: LaunchTrigger;
  periodType: PeriodType;
  /** Days after the period ends; ≥ 0 (`1` = the first day of the next period). */
  offsetDays: number;
  dueDays: number;
  recipientMode: RecipientMode;
  recipientFilter: RecipientFilter | null;
  isActive: boolean;
}

// ═══ G6 · Kết quả & đãi ngộ ════════════════════════════════════════════════════════════════════

/** ERD `RATING_SCALE` — the sample A+/A/B/C/D is `ASSUMPTION Q2`. */
export interface RatingScale extends TenantScoped {
  name: string;
  status: RecordStatus;
}

/** ERD `RATING_LEVEL`. Range inclusivity is fixed by `ratingRules`. */
export interface RatingLevel extends TenantScoped {
  ratingScaleId: Id;
  code: string;
  label: string;
  minScore: number;
  maxScore: number;
  sortOrder: number;
}

/** ERD `PAYOUT_RULE.applies_to` "Tất cả/Khối/Chức danh". */
export const PAYOUT_SCOPES = ['All', 'OrgUnit', 'Position'] as const;
export type PayoutScope = (typeof PAYOUT_SCOPES)[number];
export const PAYOUT_SCOPE_LABEL: Readonly<Record<PayoutScope, string>> = {
  All: 'Tất cả',
  OrgUnit: 'Theo khối / đơn vị',
  Position: 'Theo chức danh',
};

/** ERD `PAYOUT_RULE` — rating level → % of the KPI pay component (`ASSUMPTION Q2`). */
export interface PayoutRule extends TenantScoped {
  ratingScaleId: Id;
  ratingLevelId: Id;
  appliesTo: PayoutScope;
  orgUnitId: Id | null;
  positionId: Id | null;
  payoutPct: number;
  effectiveFrom: IsoDate;
}

export const PERIOD_RESULT_STATUSES = ['Draft', 'Final', 'Locked'] as const;
export type PeriodResultStatus = (typeof PERIOD_RESULT_STATUSES)[number];
export const PERIOD_RESULT_STATUS_LABEL: Readonly<Record<PeriodResultStatus, string>> = {
  Draft: 'Tạm tính',
  Final: 'Đã chốt',
  Locked: 'Đã khóa',
};

/** ERD `PERIOD_RESULT` — a snapshot produced by `scoreRules` / `ratingRules` (BR-KPI-40). */
export interface PeriodResult extends TenantScoped {
  periodId: Id;
  goalPlanId: Id;
  ownerType: OwnerType;
  /** Weighted achievement %, `null` while no goal has an achievement. */
  totalScore: number | null;
  ratingLevelId: Id | null;
  payoutPct: number | null;
  /** Violations / attendance adjustment, in percentage points; `0` when none. */
  adjustmentPct: number;
  status: PeriodResultStatus;
  finalizedAt: IsoDateTime | null;
}

/** ERD `RESULT_DETAIL` — one goal's line in a result. */
export interface ResultDetail extends TenantScoped {
  resultId: Id;
  goalId: Id;
  achievementPct: number | null;
  weight: number;
  weightedScore: number | null;
}

/** ERD `PAYROLL_EXPORT`. */
export interface PayrollExport extends TenantScoped {
  periodId: Id;
  fileId: Id;
  exportedBy: Id;
  exportedAt: IsoDateTime;
}

// ═══ G7 · Hệ thống ═════════════════════════════════════════════════════════════════════════════

/** ERD `FILE_OBJECT` — simulated with a blob URL in P1 (WBS 4.8.3). */
export interface FileObject extends TenantScoped {
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: Id;
  uploadedAt: IsoDateTime;
}

/**
 * ERD `NOTIFICATION_TEMPLATE.event_code` + `STEP_ASSIGNED` (a form arrived in your inbox, D7).
 * The ERD's `KPI_ALERT` has no trigger in P1; Phase 3 (dashboard) adds it with its rule.
 */
export const NOTIFICATION_EVENTS = ['FORM_LAUNCHED', 'STEP_ASSIGNED', 'DEADLINE_REMIND', 'RETURNED'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export const NOTIFICATION_EVENT_LABEL: Readonly<Record<NotificationEvent, string>> = {
  FORM_LAUNCHED: 'Khởi chạy phiếu',
  STEP_ASSIGNED: 'Có phiếu cần xử lý',
  DEADLINE_REMIND: 'Nhắc hạn',
  RETURNED: 'Phiếu bị trả lại',
};

/** P1 delivers in-app only; an Email template can be written but is not sent (plan §1). */
export const NOTIFICATION_CHANNELS = ['InApp', 'Email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const NOTIFICATION_CHANNEL_LABEL: Readonly<Record<NotificationChannel, string>> = {
  InApp: 'Trong ứng dụng',
  Email: 'Email',
};

/** P1 is Vietnamese only (no i18n); `en` arrives with i18n. */
export const NOTIFICATION_LANGUAGES = ['vi'] as const;
export type NotificationLanguage = (typeof NOTIFICATION_LANGUAGES)[number];

/** ERD `NOTIFICATION_TEMPLATE`. `subject`/`body` hold `{{placeholders}}`. */
export interface NotificationTemplate extends TenantScoped {
  eventCode: NotificationEvent;
  channel: NotificationChannel;
  language: NotificationLanguage;
  subject: string;
  body: string;
}

export const NOTIFICATION_STATUSES = ['Queued', 'Sent', 'Read', 'Failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
export const NOTIFICATION_STATUS_LABEL: Readonly<Record<NotificationStatus, string>> = {
  Queued: 'Chờ gửi',
  Sent: 'Đã gửi',
  Read: 'Đã đọc',
  Failed: 'Gửi lỗi',
};

/** ERD `NOTIFICATION.ref_type` + `GoalPlan`, `Launch`. */
export const NOTIFICATION_REF_TYPES = ['Form', 'GoalPlan', 'Goal', 'Result', 'Launch'] as const;
export type NotificationRefType = (typeof NOTIFICATION_REF_TYPES)[number];

/**
 * ERD `NOTIFICATION`. The rendered `subject`/`body` are stored (D7): re-rendering from a template
 * edited later would rewrite what the recipient was actually told. Named `KpiNotification` so it
 * never collides with the DOM's global `Notification`.
 */
export interface KpiNotification extends TenantScoped {
  templateId: Id | null;
  eventCode: NotificationEvent;
  recipientUserId: Id;
  refType: NotificationRefType;
  refId: Id;
  subject: string;
  body: string;
  status: NotificationStatus;
  createdAt: IsoDateTime;
  sentAt: IsoDateTime | null;
  readAt: IsoDateTime | null;
}

export const AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOCK', 'UNLOCK'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_ACTION_LABEL: Readonly<Record<AuditAction, string>> = {
  CREATE: 'Tạo mới',
  UPDATE: 'Cập nhật',
  DELETE: 'Xóa',
  LOCK: 'Khóa',
  UNLOCK: 'Mở khóa',
};

/** The entities an audit entry or a change event can name — one per P1 table + D1/D5 tables. */
export const ENTITY_NAMES = [
  'Tenant', 'OrgUnit', 'JobPosition', 'Employee', 'EmployeeAssignment', 'UserAccount', 'Role',
  'RolePermission', 'UserRole',
  'BscPerspective', 'MeasureUnit', 'CalcMethod', 'CalcTier', 'KpiDefinition', 'KpiTemplate',
  'KpiTemplateItem',
  'PerformanceCycle', 'CyclePeriod', 'GoalPlan', 'Kgi', 'Goal', 'GoalTargetLevel', 'GoalAlignment',
  'GoalPeriodTarget',
  'DataSource', 'IntegrationConnection', 'DataMapping', 'SyncRun', 'ImportBatch', 'GoalActual',
  'Evidence',
  'WorkflowTemplate', 'WorkflowStep', 'FormInstance', 'FormStepAction', 'EvaluationItem',
  'Delegation', 'GoalChangeItem', 'FormLaunch', 'FormLaunchRule',
  'RatingScale', 'RatingLevel', 'PayoutRule', 'PeriodResult', 'ResultDetail', 'PayrollExport',
  'FileObject', 'NotificationTemplate', 'Notification',
] as const;
export type EntityName = (typeof ENTITY_NAMES)[number];

/** ERD `AUDIT_LOG` — append-only (BR-KPI-14 lock history lives here). */
export interface AuditLog extends TenantScoped {
  /** `null` for a system action (an auto-forward, a scheduled launch). */
  userId: Id | null;
  /** D7 — set when the action was taken as proxy / under delegation (BR-KPI-21). */
  onBehalfOfUserId: Id | null;
  entityName: EntityName;
  entityId: Id;
  action: AuditAction;
  beforeData: JsonValue | null;
  afterData: JsonValue | null;
  /** D7 — why, when the action asks for one (unlocking a Goal Plan, cancelling a form). */
  reason: string | null;
  createdAt: IsoDateTime;
}
