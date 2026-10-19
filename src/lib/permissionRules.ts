/**
 * Permission rules — `can(profile, permission, resource)` (plan §3.3, business-rules.md §9).
 *
 * Pure functions with a co-located test, like every `src/lib/*Rules.ts`. No component checks a role
 * string itself; it asks this module, through `useSession().can`.
 *
 * Two questions, kept apart (BR-KPI-61):
 * - **`can`** — may this person use this capability on this data at all? (open a screen, see a plan,
 *   lock it, launch forms, act as proxy).
 * - **The workflow step's actor rule** (BR-KPI-20, `workflowRules`) — is this person the actor of the
 *   form's current step? That alone decides SUBMIT / APPROVE / RETURN. There is deliberately no
 *   `goal.approve` permission: it would duplicate, and sooner or later contradict, the actor rule.
 *
 * Permissions are DATA: `can` evaluates the ROLE_PERMISSION and USER_ROLE rows loaded from the
 * gateway, so a mapping edited on T1's "Người dùng & quyền" screen takes effect. This file declares
 * the catalogue and the DEFAULT matrix the seed builds those rows from — `can` never reads the
 * default matrix. Adding a code after Gate 1 is a Large change (fixtures are the contract).
 *
 * Every decision fails CLOSED: an unknown code, a row pointing at an unknown role or permission, a
 * row of another tenant, an inactive account, an owner that cannot be resolved — all deny.
 */

import {
  ROLE_CODES,
  type Employee,
  type EmployeeAssignment,
  type Id,
  type IsoDate,
  type OrgUnit,
  type OwnerType,
  type Permission,
  type Role,
  type RoleCode,
  type RolePermission,
  type ScopeType,
  type UserAccount,
  type UserRole,
} from '@/data/types';
import { isWithin } from './isoDate';
import { descendantUnitIds, isStillEmployedOn } from './orgRules';

// ─── The catalogue ─────────────────────────────────────────────────────────────────────────────

export const PERMISSION_CODES = [
  'org.view',
  'org.manage',
  'user.manage',
  'library.view',
  'library.manage',
  'cycle.manage',
  'team.view',
  'goalplan.view',
  'goalplan.edit',
  'goalplan.lock',
  'goalplan.import',
  'actual.view',
  'actual.enter',
  'actual.import',
  'evidence.upload',
  'form.launch',
  'form.start',
  'form.proxy',
  'form.cancel',
  'delegation.manage',
  'result.view',
  'result.finalize',
  'result.export',
  'rating.config',
  'dashboard.view',
  'datasource.manage',
  'notification.manage',
  'audit.view',
] as const;
export type PermissionCode = (typeof PERMISSION_CODES)[number];

export interface PermissionDefinition {
  code: PermissionCode;
  /** ERD `PERMISSION.module` — the part before the dot. */
  module: string;
  /** ERD `PERMISSION.description` — Vietnamese, shown on T1's role screen. */
  description: string;
  /**
   * `true`: checked against the resource's owner through the grant's scope (Self, DirectReports,
   * OrgUnit, Tenant). `false`: a tenant-wide capability — holding the code is enough.
   */
  scopeSensitive: boolean;
}

const DEFINITIONS: Readonly<Record<PermissionCode, readonly [description: string, scopeSensitive: boolean]>> = {
  'org.view': ['Xem cơ cấu tổ chức và danh sách nhân sự', false],
  'org.manage': ['Quản lý công ty, cây tổ chức, chức danh, nhân sự và phân công', false],
  'user.manage': ['Quản lý tài khoản, vai trò, quyền và phạm vi dữ liệu', false],
  'library.view': ['Xem thư viện KPI và bộ mẫu', false],
  'library.manage': ['Quản lý thư viện KPI, phương pháp tính, bộ mẫu; import/export thư viện', false],
  'cycle.manage': ['Quản lý chu kỳ và kỳ đánh giá', false],
  'team.view': ['Mở khu vực Đội nhóm (KPI đội nhóm, duyệt và đánh giá)', false],
  'goalplan.view': ['Xem kế hoạch mục tiêu (Goal Plan) trong phạm vi dữ liệu', true],
  'goalplan.edit': ['Sửa Goal Plan đang Nháp hoặc Bị trả lại, ngoài phiếu', true],
  'goalplan.lock': ['Khóa và mở khóa Goal Plan', false],
  'goalplan.import': ['Import kế hoạch mục tiêu hàng loạt', false],
  'actual.view': ['Xem số liệu thực hiện trong phạm vi dữ liệu', true],
  'actual.enter': ['Nhập số liệu thực hiện thủ công trong phạm vi dữ liệu', true],
  'actual.import': ['Import số liệu thực hiện, chạy đồng bộ API', false],
  'evidence.upload': ['Tải lên bằng chứng cho chỉ tiêu trong phạm vi dữ liệu', true],
  'form.launch': ['Tạo đợt khởi chạy phiếu và lịch tự khởi chạy', false],
  'form.start': ['Khởi tạo phiếu thủ công (điều chỉnh KPI, đăng ký KPI đơn vị)', true],
  'form.proxy': ['Thao tác thay người xử lý trên phiếu trong phạm vi dữ liệu', true],
  'form.cancel': ['Hủy phiếu (kèm lý do) trong phạm vi dữ liệu', true],
  'delegation.manage': ['Ủy quyền xử lý các bước của chính mình', true],
  'result.view': ['Xem kết quả đánh giá trong phạm vi dữ liệu', true],
  'result.finalize': ['Chốt và khóa kết quả, xếp loại', false],
  'result.export': ['Xuất dữ liệu lương KPI', false],
  'rating.config': ['Cấu hình thang xếp loại và bảng quy đổi % lương', false],
  'dashboard.view': ['Xem dashboard điều hành trong phạm vi dữ liệu', true],
  'datasource.manage': ['Quản lý nguồn dữ liệu và kết nối', false],
  'notification.manage': ['Quản lý mẫu thông báo', false],
  'audit.view': ['Xem nhật ký hệ thống', false],
};

export const PERMISSION_CATALOGUE: readonly PermissionDefinition[] = PERMISSION_CODES.map((code) => ({
  code,
  module: code.slice(0, code.indexOf('.')),
  description: DEFINITIONS[code][0],
  scopeSensitive: DEFINITIONS[code][1],
}));

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSION_CODES);

export function isPermissionCode(value: string): value is PermissionCode {
  return PERMISSION_SET.has(value);
}

/**
 * The id of a permission row. `Permission` is the one system-wide catalogue (no `tenantId`), so its
 * ids must be identical in every tenant and across reseeds — persisted ROLE_PERMISSION rows and
 * `setRolePermissions` keep pointing at the same rows. Derived from the code, never random.
 */
export function permissionId(code: PermissionCode): Id {
  return `perm.${code}`;
}

/** The catalogue as `Permission` rows — what the seed stores and `org.listPermissions` returns. */
export function permissionRows(): Permission[] {
  return PERMISSION_CATALOGUE.map(({ code, module, description }) => ({
    id: permissionId(code),
    code,
    module,
    description,
  }));
}

// ─── The default matrix (ASSUMPTION Q12 — the sources are silent on roles and scopes) ──────────

const EVERYONE_READS: readonly PermissionCode[] = [
  'org.view',
  'library.view',
  'goalplan.view',
  'actual.view',
  'result.view',
  'delegation.manage',
];

/**
 * What each role holds when the seed is loaded (business-rules.md §9). Under this matrix the menu
 * reproduces plan §7.1 for every role except ADMIN, who holds every code (product owner, 2026-10-19).
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<RoleCode, readonly PermissionCode[]>> = {
  EMPLOYEE: [...EVERYONE_READS, 'goalplan.edit', 'evidence.upload'],
  MANAGER: [
    ...EVERYONE_READS,
    'team.view',
    'goalplan.edit',
    'actual.enter',
    'evidence.upload',
    'form.start',
    'dashboard.view',
  ],
  HR: [
    ...EVERYONE_READS,
    'library.manage',
    'cycle.manage',
    'goalplan.edit',
    'goalplan.lock',
    'goalplan.import',
    'actual.enter',
    'actual.import',
    'evidence.upload',
    'form.launch',
    'form.start',
    'form.proxy',
    'form.cancel',
    'result.finalize',
    'rating.config',
    'dashboard.view',
  ],
  CNB: [
    ...EVERYONE_READS,
    'library.manage',
    'cycle.manage',
    'actual.enter',
    'actual.import',
    'form.launch',
    'result.finalize',
    'result.export',
    'rating.config',
  ],
  BOD: [...EVERYONE_READS, 'dashboard.view'],
  ADMIN: PERMISSION_CODES,
};

/**
 * The scope the seed gives each role's USER_ROLE row. MANAGER's `OrgUnit` is the unit they head,
 * with `includeChildren: true`. DirectReports stays a valid scope (a team lead with no unit).
 */
export const DEFAULT_ROLE_SCOPE: Readonly<Record<RoleCode, ScopeType>> = {
  EMPLOYEE: 'Self',
  MANAGER: 'OrgUnit',
  HR: 'Tenant',
  CNB: 'Tenant',
  BOD: 'Tenant',
  ADMIN: 'Tenant',
};

/** `DEFAULT_ROLE_PERMISSIONS` as ROLE_PERMISSION rows for one tenant's roles (used by the seed). */
export function defaultRolePermissionRows(tenantId: Id, roles: readonly Role[]): RolePermission[] {
  return roles
    .filter((role) => role.tenantId === tenantId)
    .flatMap((role) =>
      DEFAULT_ROLE_PERMISSIONS[role.code].map((code) => ({ tenantId, roleId: role.id, permissionId: permissionId(code) })),
    );
}

// ─── Resources ─────────────────────────────────────────────────────────────────────────────────

/**
 * What a permission is checked against — the OWNER of the data, not the row itself:
 * - a Goal Plan → its owner (`resourceOfOwner`); goals, actuals, evidence and results of that plan
 *   → the same owner (the caller already holds the plan);
 * - a form → its plan's owner when it has one, else its subject (`resourceOfSubject`);
 * - a feature with no owner (launch forms, edit the library) → no resource at all.
 */
export type PermissionResource =
  | { kind: 'Tenant'; tenantId: Id }
  | { kind: 'Employee'; tenantId: Id; employeeId: Id }
  | { kind: 'OrgUnit'; tenantId: Id; orgUnitId: Id }
  | { kind: 'Company'; tenantId: Id };

/** The owner columns of a Goal Plan / period result. */
export interface OwnedRow {
  ownerType: OwnerType;
  ownerOrgUnitId: Id | null;
  ownerEmployeeId: Id | null;
}

/** A row's owner as a resource; `null` (→ `can` denies) when the owner column is unset. */
export function resourceOfOwner(tenantId: Id, row: OwnedRow): PermissionResource | null {
  switch (row.ownerType) {
    case 'Company':
      return { kind: 'Company', tenantId };
    case 'OrgUnit':
      return row.ownerOrgUnitId ? { kind: 'OrgUnit', tenantId, orgUnitId: row.ownerOrgUnitId } : null;
    case 'Employee':
      return row.ownerEmployeeId ? { kind: 'Employee', tenantId, employeeId: row.ownerEmployeeId } : null;
  }
}

/** A person as a resource (a form's subject when the form has no plan, an inbox). */
export function resourceOfSubject(tenantId: Id, employeeId: Id | null): PermissionResource | null {
  return employeeId ? { kind: 'Employee', tenantId, employeeId } : null;
}

// ─── The access profile ────────────────────────────────────────────────────────────────────────

/** Everything already loaded for ONE tenant. Rows of other tenants are ignored, never trusted. */
export interface AccessInputs {
  tenantId: Id;
  account: UserAccount;
  roles: readonly Role[];
  /** May hold every user's rows; only `account.id`'s are read. */
  userRoles: readonly UserRole[];
  /** The global catalogue (no tenant). */
  permissions: readonly Permission[];
  rolePermissions: readonly RolePermission[];
  orgUnits: readonly OrgUnit[];
  /** Every assignment, any date — the profile reads the ones effective on `asOf`. */
  assignments: readonly EmployeeAssignment[];
  employees: readonly Employee[];
  /** "Today" in the tenant's zone (from the gateway clock). Scopes resolve as of this date. */
  asOf: IsoDate;
}

export interface PermissionCoverage {
  /** A Tenant-scope grant: every resource of the tenant. */
  tenantWide: boolean;
  employeeIds: ReadonlySet<Id>;
  orgUnitIds: ReadonlySet<Id>;
  /** The Company resource (an OrgUnit scope whose subtree contains the single root unit). */
  company: boolean;
}

/** Precomputed once per session and day: `can` is then a few set lookups. */
export interface AccessProfile {
  tenantId: Id;
  userId: Id;
  employeeId: Id | null;
  /** `false` for an Inactive account or one outside the tenant: every check denies. */
  active: boolean;
  /** The roles held, in `ROLE_CODES` order — for display; access is `coverage`. */
  roleCodes: readonly RoleCode[];
  coverage: ReadonlyMap<PermissionCode, PermissionCoverage>;
  asOf: IsoDate;
}

/** The role codes a user holds in a tenant (the union of their USER_ROLE rows), in `ROLE_CODES` order. */
export function roleCodesOf(
  tenantId: Id,
  userId: Id,
  roles: readonly Role[],
  userRoles: readonly UserRole[],
): RoleCode[] {
  const codeById = new Map(roles.filter((r) => r.tenantId === tenantId).map((r) => [r.id, r.code]));
  const held = new Set<RoleCode>();
  for (const ur of userRoles) {
    if (ur.tenantId !== tenantId || ur.userId !== userId) continue;
    const code = codeById.get(ur.roleId);
    if (code) held.add(code);
  }
  return ROLE_CODES.filter((code) => held.has(code));
}

interface MutableCoverage {
  tenantWide: boolean;
  employeeIds: Set<Id>;
  orgUnitIds: Set<Id>;
  company: boolean;
}

const EMPTY_COVERAGE: ReadonlyMap<PermissionCode, PermissionCoverage> = new Map();

/**
 * Scope semantics (business-rules.md §9), all as of `asOf`:
 * - **Self** — the account's own employee. A system account (no employee) covers nobody.
 * - **DirectReports** — people with an effective assignment naming me as manager; one level, never me.
 * - **OrgUnit** — the unit (+ its subtree when `includeChildren`), the people with an effective
 *   assignment in it, and the Company resource when the subtree holds the tenant's single root.
 *   Inactive units are walked too: their history stays visible. Unset or unknown unit → nothing.
 * - **Tenant** — everything in the tenant.
 * Any effective assignment counts (a concurrent one too). Someone whose `leftOn` is before `asOf` — or
 * who is Resigned with no `leftOn` — is out of every scope even if an assignment was left open.
 */
export function buildAccessProfile(inputs: AccessInputs): AccessProfile {
  const { tenantId, account, asOf } = inputs;
  const inTenant = <T extends { tenantId: Id }>(rows: readonly T[]) => rows.filter((row) => row.tenantId === tenantId);

  const roles = inTenant(inputs.roles);
  const sameTenant = account.tenantId === tenantId;
  const roleCodes = sameTenant ? roleCodesOf(tenantId, account.id, roles, inputs.userRoles) : [];
  const base = { tenantId, userId: account.id, employeeId: account.employeeId, roleCodes, asOf };

  if (!sameTenant || account.status !== 'Active') {
    return { ...base, active: false, coverage: EMPTY_COVERAGE };
  }

  // The global catalogue, narrowed to known codes: an unknown code never grants.
  const codeByPermissionId = new Map<Id, PermissionCode>();
  for (const p of inputs.permissions) if (isPermissionCode(p.code)) codeByPermissionId.set(p.id, p.code);

  const roleIds = new Set(roles.map((r) => r.id));
  const codesByRole = new Map<Id, Set<PermissionCode>>();
  for (const rp of inputs.rolePermissions) {
    if (rp.tenantId !== tenantId || !roleIds.has(rp.roleId)) continue;
    const code = codeByPermissionId.get(rp.permissionId);
    if (!code) continue;
    let codes = codesByRole.get(rp.roleId);
    if (!codes) codesByRole.set(rp.roleId, (codes = new Set()));
    codes.add(code);
  }

  // The org tree.
  const units = inTenant(inputs.orgUnits);
  const unitIds = new Set(units.map((u) => u.id));
  const roots = units.filter((u) => u.parentId === null);
  // Exactly one root, or the Company resource is reachable through a Tenant scope only.
  const rootId = roots.length === 1 ? roots[0].id : null;

  // Cycle-safe and Inactive units included — the one subtree walk, shared with workflowRules.
  const subtree = (top: Id): Set<Id> => descendantUnitIds(units, top);

  // People, as of `asOf`.
  const employeeById = new Map(inTenant(inputs.employees).map((e) => [e.id, e]));
  // Resigned without a last day recorded: out, rather than in forever (fail closed) — `orgRules`.
  const stillEmployed = (employeeId: Id) => {
    const person = employeeById.get(employeeId);
    return person !== undefined && isStillEmployedOn(person, asOf);
  };
  const effective = inTenant(inputs.assignments).filter(
    (a) => isWithin(asOf, a.effectiveFrom, a.effectiveTo) && stillEmployed(a.employeeId),
  );
  const me = account.employeeId !== null && employeeById.has(account.employeeId) ? account.employeeId : null;

  const coverage = new Map<PermissionCode, MutableCoverage>();
  for (const ur of inputs.userRoles) {
    if (ur.tenantId !== tenantId || ur.userId !== account.id) continue;
    const codes = codesByRole.get(ur.roleId);
    if (!codes) continue;

    const grant: MutableCoverage = { tenantWide: false, employeeIds: new Set(), orgUnitIds: new Set(), company: false };
    switch (ur.scopeType) {
      case 'Tenant':
        grant.tenantWide = true;
        break;
      case 'Self':
        if (me) grant.employeeIds.add(me);
        break;
      case 'DirectReports':
        if (me) {
          for (const a of effective) {
            if (a.managerEmployeeId === me && a.employeeId !== me) grant.employeeIds.add(a.employeeId);
          }
        }
        break;
      case 'OrgUnit': {
        if (ur.scopeOrgUnitId === null || !unitIds.has(ur.scopeOrgUnitId)) break;
        const scope = ur.includeChildren ? subtree(ur.scopeOrgUnitId) : new Set([ur.scopeOrgUnitId]);
        for (const id of scope) grant.orgUnitIds.add(id);
        for (const a of effective) if (scope.has(a.orgUnitId)) grant.employeeIds.add(a.employeeId);
        grant.company = rootId !== null && scope.has(rootId);
        break;
      }
    }

    // The union over every grant (BR-KPI-60).
    for (const code of codes) {
      const current = coverage.get(code);
      if (!current) {
        coverage.set(code, {
          tenantWide: grant.tenantWide,
          employeeIds: new Set(grant.employeeIds),
          orgUnitIds: new Set(grant.orgUnitIds),
          company: grant.company,
        });
        continue;
      }
      current.tenantWide ||= grant.tenantWide;
      current.company ||= grant.company;
      for (const id of grant.employeeIds) current.employeeIds.add(id);
      for (const id of grant.orgUnitIds) current.orgUnitIds.add(id);
    }
  }

  return { ...base, active: true, coverage };
}

// ─── The check ─────────────────────────────────────────────────────────────────────────────────

const SCOPE_SENSITIVE: ReadonlySet<PermissionCode> = new Set(
  PERMISSION_CATALOGUE.filter((p) => p.scopeSensitive).map((p) => p.code),
);

function warnDev(message: string) {
  if (import.meta.env.DEV && import.meta.env.MODE !== 'test') console.warn(`[permissionRules] ${message}`);
}

/**
 * - No `resource`: does the profile hold the code at all, under any scope? — a menu item, a button.
 * - With a resource: is it inside the scope of a grant holding the code? A scope-free code only needs
 *   the resource to be in the profile's tenant. A `Tenant` resource on a scope-sensitive code ("all
 *   of the tenant's plans") needs a Tenant-scope grant.
 * - `null` (an owner `resourceOfOwner` could not resolve), an unknown code, another tenant's
 *   resource, an inactive profile → `false`. Never throws: checks run during render.
 */
export function can(profile: AccessProfile, code: PermissionCode, resource?: PermissionResource | null): boolean {
  if (!isPermissionCode(code)) {
    warnDev(`unknown permission code "${String(code)}"`);
    return false;
  }
  if (!profile.active) return false;
  const coverage = profile.coverage.get(code);
  if (!coverage) return false;
  if (resource === undefined) return true;
  if (resource === null) return false;
  if (resource.tenantId !== profile.tenantId) {
    warnDev(`a resource of tenant ${resource.tenantId} was checked in tenant ${profile.tenantId}`);
    return false;
  }
  if (!SCOPE_SENSITIVE.has(code) || coverage.tenantWide) return true;

  switch (resource.kind) {
    case 'Tenant':
      return false;
    case 'Employee':
      return coverage.employeeIds.has(resource.employeeId);
    case 'OrgUnit':
      return coverage.orgUnitIds.has(resource.orgUnitId);
    case 'Company':
      // BR-KPI-63 — the company plan is readable by the whole tenant: every cascade starts from it.
      return coverage.company || code === 'goalplan.view';
  }
}

// ─── Navigation ────────────────────────────────────────────────────────────────────────────────

/** The slice of a nav item these rules read — `NavItem` in `navConfig.ts` satisfies it. */
export interface PermissionGatedItem {
  url: string;
  /** `null` = any signed-in user. */
  permission: PermissionCode | null;
}

export interface PermissionGatedGroup<I extends PermissionGatedItem = PermissionGatedItem> {
  items: readonly I[];
}

function itemVisible(item: PermissionGatedItem, profile: AccessProfile): boolean {
  return item.permission === null ? profile.active : can(profile, item.permission);
}

/**
 * The menu the profile sees: each group keeps its permitted items, in order; a group left with none
 * disappears. Hiding a link does NOT protect its route — that is `canOpenPath` (the AppShell guard).
 */
export function visibleNavGroups<I extends PermissionGatedItem, G extends PermissionGatedGroup<I>>(
  groups: readonly G[],
  profile: AccessProfile,
): G[] {
  return groups.flatMap((group) => {
    const items = group.items.filter((item) => itemVisible(item, profile));
    return items.length > 0 ? [{ ...group, items }] : [];
  });
}

/** `/admin/library/?x=1#y` → `/admin/library`. */
function normalisePath(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || '/';
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : path;
}

/**
 * May the profile open this path? The longest nav item whose url is the path or a parent segment of
 * it decides (`/admin/library/123` follows "Thư viện KPI"; `/admin/libraryX` matches nothing). A
 * path no item claims — `/`, the not-found page — is open; `navConfig.test.ts` keeps every route of
 * `App.tsx` claimed or explicitly public. A detail page still checks its own record with `can`.
 */
export function canOpenPath(
  pathname: string,
  groups: readonly PermissionGatedGroup[],
  profile: AccessProfile,
): boolean {
  const path = normalisePath(pathname);
  let match: PermissionGatedItem | null = null;
  let matchLength = -1;
  for (const group of groups) {
    for (const item of group.items) {
      const url = normalisePath(item.url);
      const claims = path === url || path.startsWith(url === '/' ? '/' : `${url}/`);
      if (claims && url.length > matchLength) {
        match = item;
        matchLength = url.length;
      }
    }
  }
  return match === null ? profile.active : itemVisible(match, profile);
}
