import { useId, useMemo, useState } from 'react';
import { BlockedReason } from '@/components/shared/BlockedReason';
import { EditSheet } from '@/components/shared/EditSheet';
import { EmployeePicker } from '@/components/shared/EmployeePicker';
import { EmptyState } from '@/components/shared/EmptyState';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useSession } from '@/contexts/useSession';
import { AUTH_PROVIDER_LABEL, RECORD_STATUS_LABEL, RECORD_STATUSES, type RecordStatus, type UserAccount } from '@/data/types';
import { issuesOf, useSaveUserAccount, type AccessDirectory } from '@/hooks/queries/org';
import { accountIssues, type AccountDraft } from '@/lib/accessAdminRules';
import { fieldIssues, orgIssueText, otherIssues } from '@/lib/orgIssueCopy';
import { accessContextOf, railIssues, withAccount } from './accessContext';
import { RoleAssignments } from './RoleAssignments';

const FIELDS = ['employeeId', 'login', 'displayName', 'status'];

interface AccountSheetProps {
  account: UserAccount | null;
  notFound: boolean;
  dir: AccessDirectory;
  onClose: () => void;
  onCreated: (account: UserAccount) => void;
}

/** One account: who it is, its login and status (WBS 4.1.5), and its roles (4.1.6). Sign-in itself is simulated. */
export function AccountSheet({ account, notFound, dir, onClose, onCreated }: AccountSheetProps) {
  const { tenantId, user, today } = useSession();
  const save = useSaveUserAccount();
  const statusReasonId = useId();
  const systemId = useId();
  const initial: AccountDraft = useMemo(
    () => (account ? { id: account.id, employeeId: account.employeeId, login: account.login, displayName: account.displayName, authProvider: account.authProvider, status: account.status } : { employeeId: null, login: '', displayName: '', authProvider: 'Local', status: 'Active' }),
    [account],
  );
  const [draft, setDraft] = useState(initial);
  const [system, setSystem] = useState(account ? account.employeeId === null : false);
  const [shownIssues, setShownIssues] = useState<ReturnType<typeof issuesOf>>([]);
  const set = (patch: Partial<AccountDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // Deactivating is refused for the last ADMIN or yourself — say so before anyone tries.
  const ctx = accessContextOf(dir, tenantId, user.id, today);
  const deactivateBlock = account && account.status === 'Active' ? railIssues(dir, ctx, { accounts: withAccount(dir.accounts, { ...account, status: 'Inactive' }) })[0] : undefined;

  const pickEmployee = (employeeId: string | null) => {
    const person = dir.employees.find((e) => e.id === employeeId);
    set({ employeeId, displayName: person?.fullName ?? draft.displayName, login: draft.login || (person?.email.split('@')[0] ?? '') });
  };

  const submit = () => {
    const missing = !account && !system && draft.employeeId === null ? [{ code: 'ERR-KPI-06' as const, ref: 'employeeId', detail: 'REQUIRED', data: null }] : [];
    const issues = [...missing, ...accountIssues(draft, account, { accounts: dir.accounts, employees: dir.employees, today })];
    setShownIssues(issues);
    if (issues.length > 0) return;
    save.mutate(draft, {
      onSuccess: (saved) => (account ? undefined : onCreated(saved)),
      onError: (error) => setShownIssues(issuesOf(error)),
    });
  };
  const errors = fieldIssues(shownIssues);

  if (notFound) {
    return (
      <EditSheet open onOpenChange={(open) => !open && onClose()} title="Không tìm thấy tài khoản" dirty={false}>
        <EmptyState>Tài khoản này không tồn tại hoặc không thuộc công ty hiện tại.</EmptyState>
      </EditSheet>
    );
  }
  const person = dir.employees.find((e) => e.id === draft.employeeId);

  return (
    <EditSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={account ? account.displayName : 'Tạo tài khoản'}
      description={account ? (person ? `Nhân viên ${person.employeeCode}` : 'Tài khoản hệ thống') : 'Đăng nhập trong bản thử nghiệm là giả lập: không có mật khẩu.'}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      onSubmit={submit}
      submitLabel={account ? 'Lưu thay đổi' : 'Tạo tài khoản'}
      submitting={save.isPending}
      problems={otherIssues(shownIssues, FIELDS)}
      wide
    >
      <section aria-labelledby="acct-main" className="space-y-4">
        <h3 id="acct-main" className="text-sm font-semibold">
          Tài khoản
        </h3>
        <RequiredLegend />
        {!account && (
          <div className="flex items-center gap-2">
            <Switch
              id={systemId}
              checked={system}
              onCheckedChange={(on) => {
                setSystem(on);
                if (on) set({ employeeId: null });
              }}
            />
            <Label htmlFor={systemId} className="font-normal">
              Tài khoản hệ thống (không gắn với nhân viên)
            </Label>
          </div>
        )}
        {!system && (
          <FormField label="Nhân viên" required error={errors.employeeId} hint={account ? 'Không đổi được nhân viên của một tài khoản đã tạo.' : undefined}>
            {(c) => <EmployeePicker {...c} value={draft.employeeId} onChange={pickEmployee} disabled={account !== null} />}
          </FormField>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Tên đăng nhập" required error={errors.login}>
            {(c) => <Input {...c} value={draft.login} onChange={(e) => set({ login: e.target.value.trim() })} className="font-mono" autoComplete="off" />}
          </FormField>
          <FormField label="Tên hiển thị" required error={errors.displayName}>
            {(c) => <Input {...c} value={draft.displayName} onChange={(e) => set({ displayName: e.target.value })} />}
          </FormField>
          <div className="space-y-1.5 text-sm">
            <p className="font-medium">Phương thức đăng nhập</p>
            <p className="text-muted-foreground">{AUTH_PROVIDER_LABEL[draft.authProvider]}</p>
          </div>
          <FormField
            label="Trạng thái"
            required
            error={errors.status}
            hint={deactivateBlock ? <BlockedReason id={statusReasonId}>{orgIssueText(deactivateBlock)}</BlockedReason> : undefined}
          >
            {(c) => (
              <Select value={draft.status} onValueChange={(v) => set({ status: v as RecordStatus })}>
                <SelectTrigger {...c}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECORD_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} disabled={s === 'Inactive' && deactivateBlock !== undefined}>
                      {RECORD_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        </div>
      </section>
      {account ? (
        <RoleAssignments account={account} dir={dir} />
      ) : (
        <p className="text-sm text-muted-foreground">Tài khoản của nhân viên tự có vai trò Nhân viên (bản thân). Gán thêm vai trò sau khi tạo.</p>
      )}
    </EditSheet>
  );
}
