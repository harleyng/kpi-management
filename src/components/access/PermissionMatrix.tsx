import { Fragment, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ROLE_CODES, ROLE_LABEL, type Role } from '@/data/types';
import { useAccessDirectory } from '@/hooks/queries/org';
import { errorSpecOf } from '@/lib/errorCatalog';
import { permissionId } from '@/lib/permissionRules';
import { MODULE_LABEL, permissionsByModule } from './accessContext';
import { RolePermissionSheet } from './RolePermissionSheet';

/**
 * "Vai trò & quyền" — the role × permission matrix as it is NOW (the rows `can()` reads), read-only;
 * each role's column is edited in its own sheet (`RolePermissionSheet`). WBS 4.1.6.
 */
export function PermissionMatrix() {
  const { data, query } = useAccessDirectory();
  const [editing, setEditing] = useState<Role | null>(null);
  const groups = useMemo(permissionsByModule, []);
  const roles = useMemo(() => [...(data?.roles ?? [])].sort((a, b) => ROLE_CODES.indexOf(a.code) - ROLE_CODES.indexOf(b.code)), [data]);
  const held = useMemo(() => new Set(data?.rolePermissions.map((rp) => `${rp.roleId}|${rp.permissionId}`)), [data]);

  if (query.error != null) return <ErrorStateCard spec={errorSpecOf(query.error)} onAction={() => query.refetch()} />;
  if (!data) {
    return (
      <Card className="space-y-2 p-4" aria-busy>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </Card>
    );
  }

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">Quyền của mỗi vai trò áp dụng trong phạm vi dữ liệu của từng lần gán vai trò. Sửa một vai trò để thay đổi các quyền của vai trò đó.</p>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <caption className="sr-only">Ma trận quyền theo vai trò</caption>
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b">
              <th scope="col" className="sticky left-0 z-20 w-64 bg-inherit px-3 py-2 text-left font-medium">
                Quyền
              </th>
              {roles.map((r) => (
                <th key={r.id} scope="col" className="w-24 px-1 py-2 text-center align-bottom font-medium">
                  <span className="block text-xs leading-tight">{ROLE_LABEL[r.code]}</span>
                  <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setEditing(r)} aria-label={`Sửa quyền — ${ROLE_LABEL[r.code]}`}>
                    Sửa
                  </Button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([module, permissions]) => (
              <Fragment key={module}>
                <tr className="bg-surface-alt">
                  <th scope="colgroup" colSpan={roles.length + 1} className="sticky left-0 px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground">
                    {MODULE_LABEL[module] ?? module}
                  </th>
                </tr>
                {permissions.map((p) => (
                  <tr key={p.code} className="border-b last:border-0">
                    <th scope="row" className="sticky left-0 bg-inherit px-3 py-1.5 text-left font-normal">
                      <span className="block">{p.description}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{p.code}</span>
                    </th>
                    {roles.map((r) =>
                      held.has(`${r.id}|${permissionId(p.code)}`) ? (
                        <td key={r.id} className="text-center">
                          <Check className="mx-auto h-4 w-4 text-primary" aria-label="Có quyền" />
                        </td>
                      ) : (
                        <td key={r.id} className="text-center text-muted-foreground">
                          <span aria-hidden>—</span>
                          <span className="sr-only">Không có quyền</span>
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>
      {editing && <RolePermissionSheet key={editing.id} role={editing} dir={data} onClose={() => setEditing(null)} />}
    </>
  );
}
