import { useId, useMemo, useState } from 'react';
import { Lock, Plus, X } from 'lucide-react';
import { BlockedReason } from '@/components/shared/BlockedReason';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/contexts/useSession';
import { ROLE_CODES, ROLE_LABEL, SCOPE_TYPE_LABEL, SCOPE_TYPES, type ScopeType, type UserAccount, type UserRole } from '@/data/types';
import { issuesOf, useDeleteUserRole, useSaveUserRole, type AccessDirectory } from '@/hooks/queries/org';
import { scopeCoverage, userRoleIssues, userRoleRemovalIssues } from '@/lib/accessAdminRules';
import { orgIssueText } from '@/lib/orgIssueCopy';
import type { Draft } from '@/lib/orgAdminRules';
import { accessContextOf, railIssues, withoutUserRole } from './accessContext';

/**
 * An account's role assignments, each with its data scope and how many people that scope reaches
 * (WBS 4.1.6). The EMPLOYEE / Self row of a person's account is fixed (BR-KPI-62); removing the
 * last company-wide ADMIN or your own `user.manage` is refused before it is tried (BR-KPI-72).
 */
export function RoleAssignments({ account, dir }: { account: UserAccount; dir: AccessDirectory }) {
  const { tenantId, user, today } = useSession();
  const remove = useDeleteUserRole();
  const rows = dir.userRoles.filter((r) => r.userId === account.id);
  const ctx = accessContextOf(dir, tenantId, user.id, today);
  const roleOf = (id: string) => dir.roles.find((r) => r.id === id);
  const unitName = (id: string | null) => (id ? (dir.units.find((u) => u.id === id)?.name ?? '—') : null);
  const ordered = [...rows].sort((a, b) => ROLE_CODES.indexOf(roleOf(a.roleId)?.code ?? 'ADMIN') - ROLE_CODES.indexOf(roleOf(b.roleId)?.code ?? 'ADMIN'));

  return (
    <section aria-labelledby="acct-roles" className="space-y-3">
      <h3 id="acct-roles" className="text-sm font-semibold">
        Vai trò và phạm vi dữ liệu
      </h3>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tài khoản chưa có vai trò nào.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {ordered.map((row) => {
            const role = roleOf(row.roleId);
            const blocked = [...userRoleRemovalIssues(row, dir), ...railIssues(dir, ctx, { userRoles: withoutUserRole(dir.userRoles, row.id) })];
            const reach = scopeCoverage(row, { ...dir, today });
            const label = role ? ROLE_LABEL[role.code] : '—';
            return (
              <li key={row.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">
                    {SCOPE_TYPE_LABEL[row.scopeType]}
                    {row.scopeType === 'OrgUnit' && `: ${unitName(row.scopeOrgUnitId)}${row.includeChildren ? ', gồm đơn vị trực thuộc' : ''}`}
                    {', '}
                    <span className="tabular-nums">{reach}</span> nhân viên
                  </p>
                  {blocked.length > 0 && <BlockedReason className="mt-1">{orgIssueText(blocked[0])}</BlockedReason>}
                </div>
                {blocked.length > 0 ? (
                  <Lock className="mt-1 h-4 w-4 text-muted-foreground" aria-label="Không gỡ được" />
                ) : (
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove.mutate(row.id)} disabled={remove.isPending} aria-label={`Gỡ vai trò ${label}`}>
                    <X aria-hidden />
                    Gỡ
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <AddRole account={account} dir={dir} />
    </section>
  );
}

const SCOPES_FOR = (isEmployeeRole: boolean): readonly ScopeType[] => (isEmployeeRole ? ['Self'] : SCOPE_TYPES.filter((s) => s !== 'Self'));

function AddRole({ account, dir }: { account: UserAccount; dir: AccessDirectory }) {
  const { tenantId, user, today } = useSession();
  const save = useSaveUserRole();
  const unitId = useId();
  const childrenId = useId();
  const [draft, setDraft] = useState<Draft<UserRole> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const role = draft ? dir.roles.find((r) => r.id === draft.roleId) : undefined;
  const units = useMemo(() => dir.units.filter((u) => u.status === 'Active').sort((a, b) => a.name.localeCompare(b.name, 'vi')), [dir.units]);

  if (!draft) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setProblem(null);
          setDraft({ userId: account.id, roleId: '', scopeType: 'Tenant', scopeOrgUnitId: null, includeChildren: false });
        }}
      >
        <Plus aria-hidden />
        Gán vai trò
      </Button>
    );
  }
  const set = (patch: Partial<Draft<UserRole>>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const ready = draft.roleId !== '' && (draft.scopeType !== 'OrgUnit' || draft.scopeOrgUnitId !== null);
  const reach = ready ? scopeCoverage(draft, { ...dir, today }) : null;

  const submit = () => {
    const issues = userRoleIssues(draft, null, dir);
    const rails = railIssues(dir, accessContextOf(dir, tenantId, user.id, today), { userRoles: [...dir.userRoles, { ...draft, id: 'new', tenantId }] });
    const first = [...issues, ...rails][0];
    if (first) return setProblem(orgIssueText(first));
    save.mutate(draft, {
      onSuccess: () => setDraft(null),
      onError: (error) => setProblem(issuesOf(error)[0] ? orgIssueText(issuesOf(error)[0]) : null),
    });
  };

  return (
    <div className="space-y-3 rounded-md border bg-surface-alt p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Vai trò</Label>
          <Select
            value={draft.roleId || undefined}
            onValueChange={(roleId) => {
              const isEmployee = dir.roles.find((r) => r.id === roleId)?.code === 'EMPLOYEE';
              set({ roleId, scopeType: isEmployee ? 'Self' : draft.scopeType === 'Self' ? 'Tenant' : draft.scopeType, scopeOrgUnitId: isEmployee ? null : draft.scopeOrgUnitId });
            }}
          >
            <SelectTrigger aria-label="Vai trò">
              <SelectValue placeholder="Chọn vai trò" />
            </SelectTrigger>
            <SelectContent>
              {[...dir.roles]
                .sort((a, b) => ROLE_CODES.indexOf(a.code) - ROLE_CODES.indexOf(b.code))
                .map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {ROLE_LABEL[r.code]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Phạm vi dữ liệu</Label>
          <Select value={draft.scopeType} onValueChange={(v) => set({ scopeType: v as ScopeType, scopeOrgUnitId: v === 'OrgUnit' ? draft.scopeOrgUnitId : null })} disabled={!role}>
            <SelectTrigger aria-label="Phạm vi dữ liệu">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCOPES_FOR(role?.code === 'EMPLOYEE').map((s) => (
                <SelectItem key={s} value={s}>
                  {SCOPE_TYPE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {draft.scopeType === 'OrgUnit' && (
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
          <div className="space-y-1">
            <Label htmlFor={unitId}>Đơn vị</Label>
            <Select value={draft.scopeOrgUnitId ?? undefined} onValueChange={(v) => set({ scopeOrgUnitId: v })}>
              <SelectTrigger id={unitId}>
                <SelectValue placeholder="Chọn đơn vị" />
              </SelectTrigger>
              <SelectContent>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox id={childrenId} checked={draft.includeChildren} onCheckedChange={(v) => set({ includeChildren: v === true })} />
            <Label htmlFor={childrenId} className="font-normal">
              Gồm đơn vị trực thuộc
            </Label>
          </div>
        </div>
      )}
      <p role="status" className="text-sm">
        {reach === null ? <span className="text-muted-foreground">Chọn vai trò và phạm vi để xem số nhân viên.</span> : <>Phạm vi này gồm <span className="tabular-nums font-medium">{reach}</span> nhân viên.</>}
      </p>
      {problem && (
        <p role="alert" className="text-sm text-support-negative">
          {problem}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)}>
          Hủy
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={!ready || save.isPending}>
          Gán vai trò
        </Button>
      </div>
    </div>
  );
}
