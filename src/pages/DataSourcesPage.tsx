import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { SourceTypeTag } from '@/components/actuals/ActualValue';
import { ScheduleText } from '@/components/actuals/SyncTab';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import { useSession } from '@/contexts/useSession';
import { CONNECTION_AUTH_TYPE_LABEL, SOURCE_TYPE_LABEL, SOURCE_TYPES, type DataMapping, type DataSource, type IntegrationConnection, type SourceType } from '@/data/types';
import { useConnections, useDataSources, useMappings, useSaveConnection, useSaveDataSource } from '@/hooks/queries/actuals';
import { useKpiDefinitions } from '@/hooks/queries/library';
import { useOrgUnits } from '@/hooks/queries/org';
import { errorSpecOf, ISSUE_DETAIL_COPY, KpiError } from '@/lib/errorCatalog';
import { combineQueries, loadPhase } from '@/lib/queryState';
import { toastWriteError } from '@/hooks/queries/writeFeedback';

const NO_UNIT = '__none__';

/**
 * "Nguồn dữ liệu" (WBS 4.4.1, 4.4.4) — Admin. The catalogue of the systems actuals come from (every
 * KPI names one, BR-KPI-05), and the API connections with their KPI mappings. Connections are seeded
 * and read-only in P1 (only switched on or off); the run itself is on "Số liệu & import".
 */
export default function DataSourcesPage() {
  return (
    <>
      <PageHeader title="Nguồn dữ liệu" description="Danh mục hệ thống cung cấp số thực tế, và các kết nối API đổ số tự động." />
      <div className="space-y-10">
        <SourceCatalogue />
        <Connections />
      </div>
    </>
  );
}

// ─── 4.4.1 The catalogue ─────────────────────────────────────────────────────────────────────────

function SourceCatalogue() {
  const { can } = useSession();
  const sources = useDataSources();
  const units = useOrgUnits();
  const unitName = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.name])), [units.data]);
  const [editing, setEditing] = useState<DataSource | 'new' | null>(null);
  const mayManage = can('datasource.manage');

  const columns: DataTableColumn<DataSource>[] = [
    { id: 'code', header: 'Mã', sortValue: (s) => s.code, cell: (s) => <span className="font-mono text-xs">{s.code}</span> },
    { id: 'name', header: 'Tên nguồn', sortValue: (s) => s.name, cell: (s) => <span className="font-medium">{s.name}</span> },
    { id: 'type', header: 'Kiểu nguồn', sortValue: (s) => s.sourceType, cell: (s) => <SourceTypeTag sourceType={s.sourceType} /> },
    { id: 'owner', header: 'Đơn vị phụ trách', cell: (s) => (s.ownerOrgUnitId ? unitName.get(s.ownerOrgUnitId) : null) },
    {
      id: 'edit',
      header: 'Thao tác',
      cell: (s) =>
        mayManage ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Sửa nguồn ${s.name}`}>
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
        ) : null,
    },
  ];

  return (
    <section className="space-y-3" aria-labelledby="catalogue-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="catalogue-title" className="text-base font-semibold">
          Danh mục nguồn dữ liệu
        </h2>
        {mayManage && (
          <Button type="button" onClick={() => setEditing('new')}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Thêm nguồn
          </Button>
        )}
      </div>
      <DataTable label="Danh mục nguồn dữ liệu" columns={columns} rows={sources.data} query={combineQueries([sources, units])} getRowId={(s) => s.id} empty="Chưa có nguồn dữ liệu nào. Mỗi chỉ tiêu cần một nguồn để đo được." />
      {editing !== null && <SourceDialog source={editing === 'new' ? null : editing} existing={sources.data ?? []} onClose={() => setEditing(null)} />}
    </section>
  );
}

function SourceDialog({ source, existing, onClose }: { source: DataSource | null; existing: readonly DataSource[]; onClose: () => void }) {
  const units = useOrgUnits();
  const save = useSaveDataSource();
  const [code, setCode] = useState(source?.code ?? '');
  const [name, setName] = useState(source?.name ?? '');
  const [sourceType, setSourceType] = useState<SourceType>(source?.sourceType ?? 'EXCEL');
  const [ownerOrgUnitId, setOwner] = useState<string | null>(source?.ownerOrgUnitId ?? null);
  const [touched, setTouched] = useState(false);

  const codeTaken = existing.some((s) => s.id !== source?.id && s.code.trim().toLowerCase() === code.trim().toLowerCase());
  const codeError = touched && code.trim() === '' ? ISSUE_DETAIL_COPY.FIELD_REQUIRED : codeTaken ? ISSUE_DETAIL_COPY.SOURCE_CODE_TAKEN : undefined;
  const nameError = touched && name.trim() === '' ? ISSUE_DETAIL_COPY.FIELD_REQUIRED : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (code.trim() === '' || name.trim() === '' || codeTaken) return;
    save.mutate(
      { id: source?.id, code: code.trim().toUpperCase(), name: name.trim(), sourceType, ownerOrgUnitId },
      {
        onSuccess: onClose,
        onError: (error) => {
          // A duplicate the list had not shown yet comes back as 06 — the field says so; anything else is a toast.
          if (!(error instanceof KpiError && error.code === 'ERR-KPI-06')) toastWriteError(error);
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{source ? `Sửa nguồn ${source.name}` : 'Thêm nguồn dữ liệu'}</DialogTitle>
            <DialogDescription>Nguồn cho biết số thực tế của chỉ tiêu lấy từ đâu: nhập tay, tệp Excel hay kết nối API.</DialogDescription>
          </DialogHeader>
          <RequiredLegend />
          <FormField label="Mã nguồn" required error={codeError ?? (save.error instanceof KpiError && save.error.code === 'ERR-KPI-06' ? ISSUE_DETAIL_COPY.SOURCE_CODE_TAKEN : undefined)} hint="Viết liền, ví dụ ERP_SALE.">
            {(control) => <Input {...control} value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} autoComplete="off" />}
          </FormField>
          <FormField label="Tên nguồn" required error={nameError}>
            {(control) => <Input {...control} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}
          </FormField>
          <FormField label="Kiểu nguồn" required>
            {(control) => (
              <Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {SOURCE_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Đơn vị phụ trách">
            {(control) => (
              <Select value={ownerOrgUnitId ?? NO_UNIT} onValueChange={(v) => setOwner(v === NO_UNIT ? null : v)}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_UNIT}>Không chỉ định</SelectItem>
                  {(units.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Đang lưu…' : 'Lưu nguồn'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── 4.4.4 Connections (read-only bar on / off) ──────────────────────────────────────────────────

function Connections() {
  const connections = useConnections();
  const sources = useDataSources();
  const query = combineQueries([connections, sources]);
  const phase = loadPhase(query, connections.data !== undefined && sources.data !== undefined);
  return (
    <section className="space-y-3" aria-labelledby="connections-title">
      <h2 id="connections-title" className="text-base font-semibold">
        Kết nối API
      </h2>
      {phase === 'error' && <ErrorStateCard spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />}
      {phase === 'loading' && <Skeleton className="h-40 w-full" />}
      {phase === 'ready' &&
        (connections.data && connections.data.length > 0 ? (
          connections.data.map((c) => <ConnectionCard key={c.id} connection={c} name={sources.data?.find((s) => s.id === c.dataSourceId)?.name ?? c.endpoint} />)
        ) : (
          <EmptyStateCard>Chưa có kết nối API nào.</EmptyStateCard>
        ))}
    </section>
  );
}

function ConnectionCard({ connection, name }: { connection: IntegrationConnection; name: string }) {
  const { can } = useSession();
  const navigate = useNavigate();
  const mappings = useMappings(connection.id);
  const kpis = useKpiDefinitions();
  const save = useSaveConnection();
  const kpiOf = useMemo(() => new Map((kpis.data ?? []).map((k) => [k.id, k])), [kpis.data]);
  const columns: DataTableColumn<DataMapping>[] = [
    { id: 'kpi', header: 'KPI trong thư viện', className: 'min-w-56', cell: (m) => kpiOf.get(m.kpiDefId)?.name },
    { id: 'code', header: 'Mã KPI', cell: (m) => <span className="font-mono text-xs">{kpiOf.get(m.kpiDefId)?.code}</span> },
    { id: 'path', header: 'Truy vấn', cell: (m) => <code className="break-all text-xs">{m.queryOrPath}</code> },
    { id: 'dim', header: 'Trường định danh', cell: (m) => <code className="text-xs">{m.orgDimension}</code> },
    { id: 'transform', header: 'Biến đổi', cell: (m) => (m.transformExpr ? <code className="text-xs">{m.transformExpr}</code> : null) },
  ];
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h3 className="font-semibold">{name}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Địa chỉ</dt>
            <dd className="break-all">{connection.endpoint}</dd>
            <dt className="text-muted-foreground">Xác thực</dt>
            <dd>{CONNECTION_AUTH_TYPE_LABEL[connection.authType]}</dd>
            <dt className="text-muted-foreground">Khóa bí mật</dt>
            <dd>
              <code className="text-xs">{connection.secretRef}</code> <span className="text-xs text-muted-foreground">(chỉ lưu tham chiếu, không lưu khóa)</span>
            </dd>
            <dt className="text-muted-foreground">Lịch đồng bộ</dt>
            <dd>
              <ScheduleText cron={connection.scheduleCron} />
            </dd>
          </dl>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id={`active-${connection.id}`}
              checked={connection.status === 'Active'}
              disabled={!can('datasource.manage') || save.isPending}
              onCheckedChange={(on) => save.mutate({ ...connection, status: on ? 'Active' : 'Inactive' })}
            />
            <label htmlFor={`active-${connection.id}`} className="text-sm">
              Đang hoạt động
            </label>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => navigate('/admin/actuals?tab=sync')}>
            Xem lịch sử đồng bộ
          </Button>
        </div>
      </div>
      <DataTable label={`Ánh xạ KPI của kết nối ${name}`} columns={columns} rows={mappings.data} query={combineQueries([mappings, kpis])} getRowId={(m) => m.id} empty="Kết nối chưa ánh xạ KPI nào, nên lần đồng bộ sẽ không đọc được số." pageSize={10} />
    </div>
  );
}
