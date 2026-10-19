import type { UserAccount, UserRole } from '@/data/types';
import type { AccessDirectory } from '@/hooks/queries/org';
import { accessIssues, type AccessContext, type AccessState } from '@/lib/accessAdminRules';
import type { RuleIssue } from '@/lib/errorCatalog';
import { PERMISSION_CATALOGUE, type PermissionDefinition } from '@/lib/permissionRules';

/** The rule inputs a screen builds from the loaded rows — the same ones the gateway builds from its transaction. */
export function accessContextOf(dir: AccessDirectory, tenantId: string, actorUserId: string, today: string): AccessContext {
  return { tenantId, actorUserId, roles: dir.roles, permissions: dir.permissions, units: dir.units, employees: dir.employees, assignments: dir.assignments, today };
}

export const accessStateOf = (dir: AccessDirectory): AccessState => ({ accounts: dir.accounts, userRoles: dir.userRoles, rolePermissions: dir.rolePermissions });

/** What the admin rails say about a change, before it is sent (the gateway decides again). */
export function railIssues(dir: AccessDirectory, ctx: AccessContext, change: Partial<AccessState>): RuleIssue[] {
  const before = accessStateOf(dir);
  return accessIssues(before, { ...before, ...change }, ctx);
}

export const withAccount = (accounts: readonly UserAccount[], next: UserAccount) => accounts.map((a) => (a.id === next.id ? next : a));
export const withoutUserRole = (rows: readonly UserRole[], id: string) => rows.filter((r) => r.id !== id);

/** Module codes as people read them on this screen. */
export const MODULE_LABEL: Readonly<Record<string, string>> = {
  org: 'Tổ chức',
  user: 'Người dùng',
  library: 'Thư viện KPI',
  cycle: 'Chu kỳ',
  team: 'Đội nhóm',
  goalplan: 'Kế hoạch mục tiêu',
  actual: 'Số liệu thực hiện',
  evidence: 'Bằng chứng',
  form: 'Phiếu',
  delegation: 'Ủy quyền',
  result: 'Kết quả',
  rating: 'Xếp loại',
  dashboard: 'Dashboard',
  datasource: 'Nguồn dữ liệu',
  notification: 'Thông báo',
  audit: 'Nhật ký',
};

export function permissionsByModule(): [string, PermissionDefinition[]][] {
  const groups = new Map<string, PermissionDefinition[]>();
  for (const p of PERMISSION_CATALOGUE) groups.set(p.module, [...(groups.get(p.module) ?? []), p]);
  return [...groups.entries()];
}
