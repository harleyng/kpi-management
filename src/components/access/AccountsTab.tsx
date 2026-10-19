import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { SearchInput } from '@/components/shared/SearchInput';
import { RecordStatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AUTH_PROVIDER_LABEL, RECORD_STATUS_LABEL, RECORD_STATUSES, ROLE_CODES, ROLE_LABEL, SCOPE_TYPE_LABEL, type RoleCode, type ScopeType, type UserAccount } from '@/data/types';
import { useAccessDirectory } from '@/hooks/queries/org';
import { useSearchParamState } from '@/hooks/useSearchParamState';
import { widestScope } from '@/lib/accessAdminRules';
import { matchesSearch } from '@/lib/search';
import { formatDateTime } from '@/lib/utils';
import { AccountSheet } from './AccountSheet';

const ALL = 'all';

interface Row {
  account: UserAccount;
  person: string | null;
  roles: RoleCode[];
  widest: ScopeType | null;
}

/** "Tài khoản" — every account, its roles and widest scope (who holds wide access, at a glance). WBS 4.1.5. */
export function AccountsTab() {
  const { data, query } = useAccessDirectory();
  const [acctParam, setAcctParam] = useSearchParamState('acct');
  const [created, setCreated] = useState<UserAccount | null>(null);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<RoleCode | typeof ALL>(ALL);
  const [status, setStatus] = useState<'Active' | 'Inactive' | typeof ALL>('Active');

  const rows = useMemo<Row[] | undefined>(() => {
    if (!data) return undefined;
    const codeOf = new Map(data.roles.map((r) => [r.id, r.code]));
    return data.accounts.map((account) => {
      const own = data.userRoles.filter((r) => r.userId === account.id);
      const roles = [...new Set(own.map((r) => codeOf.get(r.roleId)).filter((c): c is RoleCode => c !== undefined))].sort((a, b) => ROLE_CODES.indexOf(a) - ROLE_CODES.indexOf(b));
      return { account, person: data.employees.find((e) => e.id === account.employeeId)?.fullName ?? null, roles, widest: widestScope(own) };
    });
  }, [data]);

  const filtered = rows?.filter(
    (r) =>
      (role === ALL || r.roles.includes(role)) &&
      (status === ALL || r.account.status === status) &&
      matchesSearch(search, [r.account.login, r.account.displayName, r.person ?? '']),
  );

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'login',
      header: 'Tên đăng nhập',
      cell: (r) => (
        <button type="button" className="font-mono text-xs font-medium text-primary hover:underline focus-visible:underline" onClick={() => setAcctParam(r.account.id)}>
          {r.account.login}
        </button>
      ),
      sortValue: (r) => r.account.login,
    },
    { id: 'name', header: 'Tên hiển thị', cell: (r) => <span className="block max-w-[14rem] truncate" title={r.account.displayName}>{r.account.displayName}</span>, sortValue: (r) => r.account.displayName },
    { id: 'person', header: 'Nhân viên', cell: (r) => r.person ?? <span className="text-muted-foreground">Tài khoản hệ thống</span>, sortValue: (r) => r.person },
    { id: 'roles', header: 'Vai trò', cell: (r) => r.roles.map((c) => ROLE_LABEL[c]).join(', ') },
    { id: 'widest', header: 'Phạm vi rộng nhất', cell: (r) => (r.widest ? SCOPE_TYPE_LABEL[r.widest] : null), sortValue: (r) => r.widest },
    { id: 'provider', header: 'Phương thức', cell: (r) => AUTH_PROVIDER_LABEL[r.account.authProvider] },
    { id: 'last', header: 'Lần đăng nhập cuối', cell: (r) => (r.account.lastLoginAt ? <span className="tabular-nums">{formatDateTime(r.account.lastLoginAt)}</span> : null), sortValue: (r) => r.account.lastLoginAt },
    { id: 'status', header: 'Trạng thái', cell: (r) => <RecordStatusBadge status={r.account.status} />, className: 'w-28' },
  ];

  const editing = acctParam === 'new' ? null : (data?.accounts.find((a) => a.id === acctParam) ?? (created?.id === acctParam ? created : null));

  return (
    <>
      <DataTable
        label="Danh sách tài khoản"
        columns={columns}
        rows={filtered}
        query={query}
        getRowId={(r) => r.account.id}
        empty="Chưa có tài khoản nào."
        isFiltered={search !== '' || role !== ALL || status !== 'Active'}
        onClearFilters={() => {
          setSearch('');
          setRole(ALL);
          setStatus('Active');
        }}
        pageResetKey={`${search}|${role}|${status}`}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Tìm theo tên đăng nhập hoặc tên" className="w-64" />
            <Select value={role} onValueChange={(v) => setRole(v as RoleCode | typeof ALL)}>
              <SelectTrigger className="h-9 w-48" aria-label="Lọc theo vai trò">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Mọi vai trò</SelectItem>
                {ROLE_CODES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {ROLE_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger className="h-9 w-40" aria-label="Lọc theo trạng thái">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECORD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {RECORD_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
                <SelectItem value={ALL}>Tất cả</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="ml-auto" onClick={() => setAcctParam('new')} disabled={!data}>
              <Plus aria-hidden />
              Tạo tài khoản
            </Button>
          </div>
        }
      />
      {acctParam !== null && data && (
        <AccountSheet
          key={acctParam}
          account={editing}
          notFound={acctParam !== 'new' && editing === null}
          dir={data}
          onClose={() => setAcctParam(null)}
          onCreated={(account) => {
            setCreated(account);
            setAcctParam(account.id);
          }}
        />
      )}
    </>
  );
}
