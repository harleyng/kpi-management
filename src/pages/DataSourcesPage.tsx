import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { SourceTypeTag } from '@/components/actuals/ActualValue';
import { ScheduleText, SYNC_URL } from '@/components/actuals/SyncTab';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { LaterPhaseNotice } from '@/components/shared/LaterPhaseNotice';
import { PageHeader, type Crumb } from '@/components/shared/PageHeader';
import { RecordStatusBadge } from '@/components/shared/StatusBadge';
import { useSession } from '@/contexts/useSession';
import { CONNECTION_AUTH_TYPE_LABEL, SOURCE_TYPE_LABEL, SOURCE_TYPES, type DataMapping, type DataSource, type IntegrationConnection, type SourceType } from '@/data/types';
import { useConnections, useDataSources, useMappings, useSaveConnection, useSaveDataSource } from '@/hooks/queries/actuals';
import { useKpiDefinitions } from '@/hooks/queries/library';
import { useOrgUnits } from '@/hooks/queries/org';
import { ERROR_CATALOG, errorSpecOf, ISSUE_DETAIL_COPY, KpiError } from '@/lib/errorCatalog';
import { combineQueries } from '@/lib/queryState';
import { toastWriteError } from '@/hooks/queries/writeFeedback';

const NO_UNIT = '__none__';

const CONNECTIONS_URL = '/system/data-sources/connections';

export type DataSourcesSection = 'catalogue' | 'connections';

const SECTIONS: Record<DataSourcesSection, { title: string; description: string }> = {
  catalogue: { title: 'Danh mục nguồn', description: 'Các hệ thống cung cấp số thực tế; mỗi chỉ tiêu lấy số từ một nguồn.' },
  connections: { title: 'Kết nối API', description: 'Các kết nối API đổ số tự động và KPI mà mỗi kết nối ánh xạ.' },
};

/**
 * "Nguồn dữ liệu" (WBS 4.4.1, 4.4.4) — Admin, one sub-page per section. The catalogue of the systems
 * actuals come from (every KPI names one, BR-KPI-05), and the API connections — each with its KPI
 * mappings on its own page. Connections are seeded and read-only in P1 (only switched on or off);
 * the run itself is on "Đồng bộ API".
 */
export default function DataSourcesPage({ section }: { section: DataSourcesSection }) {
  const { title, description } = SECTIONS[section];
  return (
    <>
      <PageHeader title={title} description={description} />
      {section === 'catalogue' ? (
        <SourceCatalogue />
      ) : (
        <>
          <LaterPhaseNotice className="mb-4" />
          <Connections />
        </>
      )}
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
    <>
      <DataTable
        label="Danh mục nguồn dữ liệu"
        columns={columns}
        rows={sources.data}
        query={combineQueries([sources, units])}
        getRowId={(s) => s.id}
        empty="Chưa có nguồn dữ liệu nào. Mỗi chỉ tiêu cần một nguồn để đo được."
        actions={
          mayManage && (
            <Button type="button" onClick={() => setEditing('new')} disabled={!sources.data}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Thêm nguồn
            </Button>
          )
        }
      />
      {editing !== null && <SourceDialog source={editing === 'new' ? null : editing} existing={sources.data ?? []} onClose={() => setEditing(null)} />}
    </>
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

interface ConnectionRow {
  connection: IntegrationConnection;
  name: string;
  mappings: number;
}

function Connections() {
  const navigate = useNavigate();
  const connections = useConnections();
  const sources = useDataSources();
  const mappings = useMappings(null);
  const rows = useMemo<ConnectionRow[] | undefined>(() => {
    if (!connections.data || !sources.data || !mappings.data) return undefined;
    const sourceName = new Map(sources.data.map((s) => [s.id, s.name]));
    const count = new Map<string, number>();
    for (const m of mappings.data) count.set(m.connectionId, (count.get(m.connectionId) ?? 0) + 1);
    return connections.data.map((connection) => ({ connection, name: sourceName.get(connection.dataSourceId) ?? connection.endpoint, mappings: count.get(connection.id) ?? 0 }));
  }, [connections.data, sources.data, mappings.data]);
  const open = (c: IntegrationConnection) => navigate(`${CONNECTIONS_URL}/${c.id}`);

  const columns: DataTableColumn<ConnectionRow>[] = [
    {
      id: 'name',
      header: 'Nguồn',
      className: 'min-w-48',
      sortValue: (r) => r.name,
      cell: (r) => (
        <button type="button" className="text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:underline" onClick={() => open(r.connection)}>
          {r.name}
        </button>
      ),
    },
    { id: 'endpoint', header: 'Địa chỉ', className: 'min-w-56', cell: (r) => <span className="break-all">{r.connection.endpoint}</span> },
    { id: 'active', header: 'Đang hoạt động', sortValue: (r) => r.connection.status, cell: (r) => <ActiveSwitch connection={r.connection} name={r.name} /> },
    { id: 'mappings', header: 'Số KPI ánh xạ', numeric: true, sortValue: (r) => r.mappings, cell: (r) => r.mappings },
    {
      id: 'open',
      header: 'Thao tác',
      cell: (r) => (
        <Button type="button" size="sm" variant="outline" onClick={() => open(r.connection)} aria-label={`Xem kết nối ${r.name}`}>
          Xem
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      label="Kết nối API"
      columns={columns}
      rows={rows}
      query={combineQueries([connections, sources, mappings])}
      getRowId={(r) => r.connection.id}
      empty="Chưa có kết nối API nào."
      pageSize={null}
    />
  );
}

/** On / off — the only change P1 makes to a connection. */
function ActiveSwitch({ connection, name, withLabel = false }: { connection: IntegrationConnection; name: string; withLabel?: boolean }) {
  const { can } = useSession();
  const save = useSaveConnection();
  const id = `active-${connection.id}`;
  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        checked={connection.status === 'Active'}
        disabled={!can('datasource.manage') || save.isPending}
        onCheckedChange={(on) => save.mutate({ ...connection, status: on ? 'Active' : 'Inactive' })}
        aria-label={withLabel ? undefined : `Kết nối ${name} đang hoạt động`}
      />
      {withLabel && (
        <label htmlFor={id} className="text-sm">
          Đang hoạt động
        </label>
      )}
    </div>
  );
}

/**
 * One API connection (WBS 4.4.4) with its KPI mappings — opened from "Kết nối API". The connection
 * comes from the tenant's (cached) list: still loading → skeleton; not in it → ERR-KPI-02.
 */
export function ConnectionDetailPage() {
  const { connectionId } = useParams();
  const navigate = useNavigate();
  const connections = useConnections();
  const sources = useDataSources();
  const mappings = useMappings(connectionId ?? null);
  const kpis = useKpiDefinitions();
  const kpiOf = useMemo(() => new Map((kpis.data ?? []).map((k) => [k.id, k])), [kpis.data]);
  const query = combineQueries([connections, sources]);
  const trail: Crumb[] = [{ label: 'Kết nối API', to: CONNECTIONS_URL }];

  if (query.error != null) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Kết nối API" />
        <ErrorStateCard spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />
      </>
    );
  }
  if (!connections.data || !sources.data) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Kết nối API" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }
  const connection = connections.data.find((c) => c.id === connectionId);
  if (!connection) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Không tìm thấy kết nối" />
        <ErrorStateCard spec={ERROR_CATALOG['ERR-KPI-02']} />
      </>
    );
  }
  const name = sources.data.find((s) => s.id === connection.dataSourceId)?.name ?? connection.endpoint;

  const columns: DataTableColumn<DataMapping>[] = [
    { id: 'kpi', header: 'KPI trong thư viện', className: 'min-w-56', cell: (m) => kpiOf.get(m.kpiDefId)?.name },
    { id: 'code', header: 'Mã KPI', cell: (m) => <span className="font-mono text-xs">{kpiOf.get(m.kpiDefId)?.code}</span> },
    { id: 'path', header: 'Truy vấn', cell: (m) => <code className="break-all text-xs">{m.queryOrPath}</code> },
    { id: 'dim', header: 'Trường định danh', cell: (m) => <code className="text-xs">{m.orgDimension}</code> },
    { id: 'transform', header: 'Biến đổi', cell: (m) => (m.transformExpr ? <code className="text-xs">{m.transformExpr}</code> : null) },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={trail}
        title={name}
        status={<RecordStatusBadge status={connection.status} />}
        description={connection.endpoint}
        actions={
          <>
            <ActiveSwitch connection={connection} name={name} withLabel />
            <Button type="button" variant="outline" onClick={() => navigate(`${SYNC_URL}/${connection.id}`)}>
              Xem lịch sử đồng bộ
            </Button>
          </>
        }
      />
      <LaterPhaseNotice className="mb-4" />
      <div className="space-y-6">
        <Card>
          <CardContent className="p-4">
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
          </CardContent>
        </Card>
        <section className="space-y-2" aria-labelledby="mappings-title">
          <h2 id="mappings-title" className="text-base font-semibold">
            Ánh xạ KPI
          </h2>
          <DataTable
            label={`Ánh xạ KPI của kết nối ${name}`}
            columns={columns}
            rows={mappings.data}
            query={combineQueries([mappings, kpis])}
            getRowId={(m) => m.id}
            empty="Kết nối chưa ánh xạ KPI nào, nên lần đồng bộ sẽ không đọc được số."
            pageSize={10}
          />
        </section>
      </div>
    </>
  );
}
