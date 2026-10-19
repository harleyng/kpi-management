import { useMemo, useState } from 'react';
import { BlockedReason } from '@/components/shared/BlockedReason';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EditSheet } from '@/components/shared/EditSheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useSession } from '@/contexts/useSession';
import { ROLE_LABEL, type Role } from '@/data/types';
import { issuesOf, useSetRolePermissions, type AccessDirectory } from '@/hooks/queries/org';
import { ADMIN_LOCKED_PERMISSIONS } from '@/lib/accessAdminRules';
import { orgIssueText } from '@/lib/orgIssueCopy';
import { PERMISSION_CATALOGUE, permissionId } from '@/lib/permissionRules';
import { accessContextOf, MODULE_LABEL, permissionsByModule, railIssues } from './accessContext';

/**
 * One role's permissions, edited as a list and saved in one write (`setRolePermissions`, atomic).
 * The confirmation names exactly what is added and removed and how many accounts it reaches.
 */
export function RolePermissionSheet({ role, dir, onClose }: { role: Role; dir: AccessDirectory; onClose: () => void }) {
  const { tenantId, user, today } = useSession();
  const save = useSetRolePermissions();
  const initial = useMemo(() => new Set(dir.rolePermissions.filter((rp) => rp.roleId === role.id).map((rp) => rp.permissionId)), [dir.rolePermissions, role.id]);
  const [selected, setSelected] = useState<Set<string>>(initial);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const label = ROLE_LABEL[role.code];
  const locked = new Set<string>(role.code === 'ADMIN' ? ADMIN_LOCKED_PERMISSIONS.map(permissionId) : []);

  const holders = new Set(dir.userRoles.filter((r) => r.roleId === role.id).map((r) => r.userId));
  const reach = dir.accounts.filter((a) => holders.has(a.id) && a.status === 'Active').length;
  const nameOf = (id: string) => PERMISSION_CATALOGUE.find((p) => permissionId(p.code) === id)?.description ?? id;
  const added = [...selected].filter((id) => !initial.has(id));
  const removed = [...initial].filter((id) => !selected.has(id));
  const dirty = added.length + removed.length > 0;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const nextRows = () => [...dir.rolePermissions.filter((rp) => rp.roleId !== role.id), ...[...selected].map((permissionId) => ({ tenantId, roleId: role.id, permissionId }))];
  const review = () => {
    const first = railIssues(dir, accessContextOf(dir, tenantId, user.id, today), { rolePermissions: nextRows() })[0];
    setProblem(first ? orgIssueText(first) : null);
    if (!first) setConfirming(true);
  };
  const apply = () => {
    setConfirming(false);
    const ids = PERMISSION_CATALOGUE.map((p) => permissionId(p.code)).filter((id) => selected.has(id));
    save.mutate(
      { roleId: role.id, permissionIds: ids },
      { onSuccess: onClose, onError: (error) => setProblem(issuesOf(error)[0] ? orgIssueText(issuesOf(error)[0]) : null) },
    );
  };

  return (
    <>
      <EditSheet
        open
        onOpenChange={(open) => !open && onClose()}
        title={`Quyền của vai trò ${label}`}
        description={`Thay đổi áp dụng ngay cho ${reach} tài khoản đang giữ vai trò ${label}.`}
        dirty={dirty}
        onSubmit={dirty ? review : undefined}
        submitLabel="Lưu thay đổi"
        submitting={save.isPending}
        problems={problem ? [problem] : []}
      >
        {permissionsByModule().map(([module, permissions]) => (
          <fieldset key={module} className="space-y-2">
            <legend className="text-xs font-semibold text-muted-foreground">{MODULE_LABEL[module] ?? module}</legend>
            {permissions.map((p) => {
              const id = permissionId(p.code);
              const isLocked = locked.has(id);
              return (
                <div key={p.code} className="flex items-start gap-2">
                  <Checkbox id={`perm-${p.code}`} checked={selected.has(id)} disabled={isLocked} onCheckedChange={(v) => toggle(id, v === true)} className="mt-0.5" />
                  <div className="min-w-0">
                    <Label htmlFor={`perm-${p.code}`} className="font-normal leading-snug">
                      {p.description}
                    </Label>
                    <p className="font-mono text-xs text-muted-foreground">{p.code}</p>
                    {isLocked && <BlockedReason>Vai trò Quản trị hệ thống luôn giữ quyền này.</BlockedReason>}
                  </div>
                </div>
              );
            })}
          </fieldset>
        ))}
      </EditSheet>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Lưu thay đổi quyền của vai trò ${label}?`}
        body={`Thay đổi áp dụng ngay cho ${reach} tài khoản đang giữ vai trò ${label}.`}
        details={
          <div className="space-y-2">
            {added.length > 0 && (
              <div>
                <p className="font-medium">Thêm:</p>
                <ul className="list-disc pl-5">
                  {added.map((id) => (
                    <li key={id}>{nameOf(id)}</li>
                  ))}
                </ul>
              </div>
            )}
            {removed.length > 0 && (
              <div>
                <p className="font-medium">Bỏ:</p>
                <ul className="list-disc pl-5">
                  {removed.map((id) => (
                    <li key={id}>{nameOf(id)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        }
        confirmLabel="Lưu thay đổi"
        onConfirm={apply}
      />
    </>
  );
}
