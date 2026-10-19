import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { AuditEntryDialog } from '@/components/audit/AuditEntryDialog';
import { AuditActor, ShortId } from '@/components/audit/AuditActor';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EntityCombobox } from '@/components/shared/EntityCombobox';
import { LoadMoreFooter } from '@/components/shared/LoadMoreFooter';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/contexts/useSession';
import { AUDIT_ACTION_LABEL, ENTITY_NAMES, ENTITY_NAME_LABEL, type AuditLog, type EntityName } from '@/data/types';
import { useEmployees, useUserAccounts } from '@/hooks/queries/org';
import { useAuditLog } from '@/hooks/queries/system';
import type { AuditLogFilter } from '@/integrations/data/types';
import { auditSubjectName, dayRangeToInstants } from '@/lib/auditRules';
import { flattenPages } from '@/lib/pagination';
import { formatDateTime } from '@/lib/utils';

const ALL = 'all';
const ENTITY_OPTIONS = [...ENTITY_NAMES].sort((a, b) => ENTITY_NAME_LABEL[a].localeCompare(ENTITY_NAME_LABEL[b], 'vi'));
const EVERYONE = { includeResigned: true } as const;
const isEntityName = (value: string | null): value is EntityName => value !== null && (ENTITY_NAMES as readonly string[]).includes(value);

/**
 * Nhật ký (WBS 4.8.4, Track T7) — every change to the tenant's data, newest first: who (and for whom),
 * what, when and why, with the before/after of each entry. The filter lives in the URL, so another
 * screen can link to one record's history (`?entityName=GoalPlan&entityId=…`). The log is written by
 * the gateway in the same transaction as the change it records; this screen only reads it.
 */
export default function AuditLogPage() {
  const { tenant } = useSession();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<AuditLog | null>(null);

  const entityName = isEntityName(params.get('entityName')) ? (params.get('entityName') as EntityName) : null;
  const entityId = params.get('entityId');
  const userId = params.get('userId');
  const fromDay = params.get('from');
  const toDay = params.get('to');

  const range = dayRangeToInstants(fromDay, toDay, tenant.timezone);
  const filter = useMemo<AuditLogFilter>(() => {
    const f: AuditLogFilter = {};
    if (entityName) f.entityName = entityName;
    if (entityId) f.entityId = entityId;
    if (userId) f.userId = userId;
    if (range?.from) f.from = range.from;
    if (range?.to) f.to = range.to;
    return f;
  }, [entityName, entityId, userId, range?.from, range?.to]);

  const log = useAuditLog(filter, range !== null);
  const accounts = useUserAccounts();
  const accountById = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.id, a])), [accounts.data]);
  const employees = useEmployees(EVERYONE);
  const employeeName = useMemo(() => {
    const byId = new Map((employees.data ?? []).map((e) => [e.id, e.fullName]));
    return (id: string) => byId.get(id);
  }, [employees.data]);
  const rows = useMemo(() => flattenPages(log.data?.pages), [log.data]);
  const isFiltered = Boolean(entityName || entityId || userId || fromDay || toDay);

  const setParam = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        // A different object type makes a single-record filter meaningless.
        if (key === 'entityName') next.delete('entityId');
        return next;
      },
      { replace: true },
    );
  const clearFilters = () => setParams(new URLSearchParams(), { replace: true });

  const columns: DataTableColumn<AuditLog>[] = [
    { id: 'time', header: 'Thời gian', className: 'w-40 whitespace-nowrap', cell: (a) => <span className="tabular">{formatDateTime(a.createdAt)}</span> },
    {
      id: 'actor',
      header: 'Người thực hiện',
      cell: (a) => <AuditActor userId={a.userId} onBehalfOfUserId={a.onBehalfOfUserId} accounts={accountById} />,
    },
    { id: 'action', header: 'Hành động', cell: (a) => AUDIT_ACTION_LABEL[a.action] },
    {
      id: 'entity',
      header: 'Đối tượng',
      cell: (a) => {
        const name = auditSubjectName(a, employeeName);
        return (
          <div className="space-y-0.5">
            <p>{ENTITY_NAME_LABEL[a.entityName]}</p>
            <p className="text-xs text-muted-foreground">{name ?? <ShortId id={a.entityId} />}</p>
          </div>
        );
      },
    },
    {
      id: 'reason',
      header: 'Lý do',
      className: 'max-w-[16rem]',
      cell: (a) =>
        a.reason && (
          <span className="line-clamp-2" title={a.reason}>
            {a.reason}
          </span>
        ),
    },
    {
      id: 'open',
      header: 'Chi tiết',
      className: 'w-20 text-right',
      cell: (a) => (
        <Button
          variant="outline"
          size="sm"
          aria-label={`Xem chi tiết, ${AUDIT_ACTION_LABEL[a.action]} ${ENTITY_NAME_LABEL[a.entityName]}, ${formatDateTime(a.createdAt)}`}
          onClick={() => setOpen(a)}
        >
          Xem
        </Button>
      ),
    },
  ];

  const toolbar = (
    <div className="flex w-full flex-wrap items-end gap-3 py-1">
      <div className="space-y-1">
        <Label htmlFor="audit-entity" className="text-xs text-muted-foreground">
          Đối tượng
        </Label>
        <Select value={entityName ?? ALL} onValueChange={(v) => setParam('entityName', v === ALL ? null : v)}>
          <SelectTrigger id="audit-entity" className="h-9 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tất cả đối tượng</SelectItem>
            {ENTITY_OPTIONS.map((e) => (
              <SelectItem key={e} value={e}>
                {ENTITY_NAME_LABEL[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-user" className="text-xs text-muted-foreground">
          Người thực hiện
        </Label>
        <EntityCombobox
          id="audit-user"
          className="w-56"
          options={accounts.data?.map((a) => ({ id: a.id, label: a.displayName, description: a.login }))}
          query={accounts}
          placeholder="Tất cả người thực hiện"
          searchPlaceholder="Tìm theo tên hoặc tài khoản…"
          emptyText="Chưa có tài khoản nào."
          value={userId}
          onChange={(id) => setParam('userId', id)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
          Từ ngày
        </Label>
        <Input id="audit-from" type="date" className="h-9 w-40" value={fromDay ?? ''} onChange={(e) => setParam('from', e.target.value || null)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
          Đến ngày
        </Label>
        <Input
          id="audit-to"
          type="date"
          className="h-9 w-40"
          value={toDay ?? ''}
          aria-invalid={range === null || undefined}
          aria-describedby={range === null ? 'audit-range-error' : undefined}
          onChange={(e) => setParam('to', e.target.value || null)}
        />
      </div>
      {entityId && (
        <Button variant="secondary" size="sm" className="h-9" onClick={() => setParam('entityId', null)} aria-label="Bỏ lọc theo một bản ghi">
          Một bản ghi: <ShortId id={entityId} />
          <X aria-hidden />
        </Button>
      )}
      {isFiltered && (
        <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
          Xóa bộ lọc
        </Button>
      )}
      {range === null && (
        <p id="audit-range-error" role="alert" className="w-full text-xs text-support-negative">
          “Đến ngày” phải bằng hoặc sau “Từ ngày”.
        </p>
      )}
    </div>
  );

  return (
    <>
      <PageHeader title="Nhật ký" description="Lịch sử thay đổi dữ liệu: ai làm gì, lúc nào, và vì sao." />
      <div className="space-y-3">
        <DataTable
          label="Nhật ký thay đổi"
          columns={columns}
          rows={range === null ? undefined : rows}
          // A failed "Tải thêm" keeps the rows on screen; the footer says it failed.
          query={{ isPending: log.isPending, fetchStatus: log.fetchStatus, error: log.isFetchNextPageError ? null : log.error, refetch: log.refetch }}
          getRowId={(a) => a.id}
          empty="Chưa có hoạt động nào được ghi lại."
          idle="Sửa khoảng ngày để xem nhật ký."
          isFiltered={isFiltered}
          onClearFilters={clearFilters}
          pageSize={null}
          toolbar={toolbar}
        />
        {range !== null && rows.length > 0 && (
          <LoadMoreFooter
            shown={rows.length}
            noun="dòng"
            hasNextPage={log.hasNextPage}
            isFetchingNextPage={log.isFetchingNextPage}
            isFetchNextPageError={log.isFetchNextPageError}
            fetchNextPage={log.fetchNextPage}
          />
        )}
      </div>
      {open && <AuditEntryDialog entry={open} accounts={accountById} employeeName={employeeName} onClose={() => setOpen(null)} />}
    </>
  );
}
