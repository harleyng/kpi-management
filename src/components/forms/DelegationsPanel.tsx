import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EntityCombobox } from '@/components/shared/EntityCombobox';
import { FormField } from '@/components/shared/FormField';
import { DelegationStateBadge } from '@/components/shared/StatusBadge';
import { toastError } from '@/components/shared/toastError';
import { useSession } from '@/contexts/useSession';
import { FORM_TYPES, FORM_TYPE_LABEL, type Delegation, type FormType, type Id } from '@/data/types';
import { useDelegations, useRevokeDelegation, useSaveDelegation } from '@/hooks/queries/forms';
import { useGatewayClock } from '@/hooks/queries/session';
import { ERROR_CATALOG, KpiError, type RuleIssue } from '@/lib/errorCatalog';
import { delegationState, isDelegationRevocable } from '@/lib/formViewRules';
import { addDays, todayOf } from '@/lib/isoDate';
import { resourceOfSubject } from '@/lib/permissionRules';
import { canRevokeDelegation, delegationIssues } from '@/lib/workflowRules';
import { formatDate } from '@/lib/utils';
import { useFormLookups } from './useFormLookups';

/** The field hint for each `delegationIssues` detail — the catalogue's ERR-KPI-06 heads the form. */
const ISSUE_HINT: Record<string, string> = {
  SELF_DELEGATION: 'Không thể ủy quyền cho chính mình.',
  TO_USER_INVALID: 'Chọn một tài khoản đang hoạt động.',
  DATES_INVALID: 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.',
  VALID_TO_PAST: 'Ngày kết thúc đã qua.',
  DELEGATION_CHAIN: 'Người này đang ủy quyền hoặc được ủy quyền trong cùng thời gian, nên không thể nhận thêm ủy quyền.',
  DELEGATION_DUPLICATE: 'Đã có ủy quyền cho người này, cùng loại phiếu, trùng thời gian.',
};

/**
 * "Ủy quyền" (WBS 4.5.5, BR-KPI-21): the delegations the user gave and received, their state today
 * (derived — `delegationState`), revoking, and a new one. A user delegates only their OWN steps; the
 * same checks the gateway runs (`delegationIssues`, `canRevokeDelegation`) run here first.
 */
export function DelegationsPanel() {
  const { tenantId, user, can } = useSession();
  const clock = useGatewayClock();
  const lookups = useFormLookups();
  const all = useDelegations();
  const revoke = useRevokeDelegation();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Delegation | null>(null);

  const mine = useMemo(
    () => all.data?.filter((d) => d.fromUserId === user.id || d.toUserId === user.id).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1)),
    [all.data, user.id],
  );
  const mayManageAll = can('delegation.manage', { kind: 'Tenant', tenantId });
  const mayDelegate = can('delegation.manage', resourceOfSubject(tenantId, user.employeeId));

  const columns: DataTableColumn<Delegation>[] = [
    { id: 'from', header: 'Người ủy quyền', cell: (d) => (d.fromUserId === user.id ? 'Bạn' : lookups.userName(d.fromUserId)) },
    { id: 'to', header: 'Người được ủy quyền', cell: (d) => (d.toUserId === user.id ? 'Bạn' : lookups.userName(d.toUserId)) },
    { id: 'type', header: 'Loại phiếu', cell: (d) => FORM_TYPE_LABEL[d.formType] },
    { id: 'from-date', header: 'Từ ngày', numeric: true, cell: (d) => formatDate(d.validFrom), sortValue: (d) => d.validFrom },
    { id: 'to-date', header: 'Đến ngày', numeric: true, cell: (d) => formatDate(d.validTo), sortValue: (d) => d.validTo },
    { id: 'state', header: 'Trạng thái', cell: (d) => <DelegationStateBadge state={delegationState(d, clock)} /> },
    {
      id: 'actions',
      header: 'Thao tác',
      cell: (d) =>
        isDelegationRevocable(delegationState(d, clock)) && canRevokeDelegation(d, { actorUserId: user.id, actorMayManage: mayManageAll }, clock).ok ? (
          <Button variant="ghost" size="sm" onClick={() => setRevoking(d)}>
            Thu hồi
          </Button>
        ) : (
          ''
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Người được ủy quyền xử lý thay các bước của bạn trong thời gian ủy quyền. Lịch sử ghi nhận cả hai người.</p>
        {mayDelegate && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Ủy quyền mới
          </Button>
        )}
      </div>
      <DataTable
        label="Ủy quyền của bạn"
        columns={columns}
        rows={lookups.ready ? mine : undefined}
        query={all}
        getRowId={(d) => d.id}
        empty="Bạn chưa ủy quyền cho ai. Khi bạn vắng mặt, người được ủy quyền sẽ xử lý các bước của bạn."
      />
      {creating && <DelegationDialog existing={all.data ?? []} onClose={() => setCreating(false)} />}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Thu hồi ủy quyền"
        body={`Thu hồi ủy quyền cho ${revoking ? lookups.userName(revoking.toUserId) : ''}? Người được ủy quyền mất quyền xử lý ngay.`}
        confirmLabel="Thu hồi"
        cancelLabel="Quay lại"
        destructive
        onConfirm={() => {
          if (!revoking) return;
          revoke.mutate(revoking.id, { onSuccess: () => toast.success('Đã thu hồi ủy quyền'), onError: toastError });
          setRevoking(null);
        }}
      />
    </div>
  );
}

function DelegationDialog({ existing, onClose }: { existing: readonly Delegation[]; onClose: () => void }) {
  const { user, people } = useSession();
  const clock = useGatewayClock();
  const lookups = useFormLookups();
  const save = useSaveDelegation();
  const today = todayOf(clock);
  const [toUserId, setToUserId] = useState<Id | null>(null);
  const [formType, setFormType] = useState<FormType>('KPI_EVAL');
  const [validFrom, setValidFrom] = useState(today);
  const [validTo, setValidTo] = useState(addDays(today, 7));
  const [tried, setTried] = useState(false);
  const [serverIssues, setServerIssues] = useState<readonly RuleIssue[]>([]);

  const draft = { fromUserId: user.id, toUserId: toUserId ?? '', formType, validFrom, validTo };
  const issues = [
    ...delegationIssues(draft, { existing, users: lookups.directory?.accounts ?? [], editingId: null, clock }),
    ...serverIssues,
  ];
  const hint = (ref: string) => {
    if (!tried) return undefined;
    if (ref === 'toUserId' && toUserId === null) return 'Chọn người được ủy quyền.';
    const issue = issues.find((i) => i.ref === ref);
    return issue ? (ISSUE_HINT[issue.detail ?? ''] ?? ERROR_CATALOG[issue.code].title) : undefined;
  };
  const options = people
    .filter((p) => p.userId !== user.id)
    .map((p) => ({ id: p.userId, label: p.name, description: [p.email, p.orgUnitName].filter(Boolean).join(', ') }));

  const submit = () => {
    setTried(true);
    if (toUserId === null || issues.length > 0) return;
    save.mutate(
      { toUserId, formType, validFrom, validTo },
      {
        onSuccess: () => {
          toast.success('Đã ủy quyền');
          onClose();
        },
        onError: (error) => {
          if (error instanceof KpiError && error.issues.length) setServerIssues(error.issues);
          toastError(error);
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ủy quyền mới</DialogTitle>
          <DialogDescription>Người được ủy quyền xử lý thay các bước của bạn, cho một loại phiếu, trong khoảng ngày đã chọn.</DialogDescription>
        </DialogHeader>
        {tried && issues.length > 0 && <p className="text-sm text-support-negative">{ERROR_CATALOG['ERR-KPI-06'].title}. {ERROR_CATALOG['ERR-KPI-06'].message}</p>}
        <div className="space-y-3">
          <FormField label="Người được ủy quyền" required error={hint('toUserId')}>
            {(control) => (
              <EntityCombobox
                {...control}
                options={options}
                query={{ isPending: false, fetchStatus: 'idle', error: null, refetch: () => undefined }}
                value={toUserId}
                onChange={(v) => {
                  setServerIssues([]);
                  setToUserId(v);
                }}
                placeholder="Chọn người"
                searchPlaceholder="Tìm theo tên hoặc email"
                emptyText="Không có người phù hợp."
              />
            )}
          </FormField>
          <FormField label="Loại phiếu" required>
            {(control) => (
              <Select value={formType} onValueChange={(v) => setFormType(v as FormType)}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORM_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {FORM_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Từ ngày" required>
              {(control) => <Input {...control} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />}
            </FormField>
            <FormField label="Đến ngày" required error={hint('validTo')}>
              {(control) => <Input {...control} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />}
            </FormField>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Quay lại
          </Button>
          <Button onClick={submit} disabled={save.isPending} aria-busy={save.isPending || undefined}>
            Ủy quyền
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
