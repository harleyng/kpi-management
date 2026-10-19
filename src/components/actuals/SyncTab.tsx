import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { InlineNotice } from '@/components/shared/InlineNotice';
import { RecordStatusBadge, SyncRunStatusBadge } from '@/components/shared/StatusBadge';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod, Id, IntegrationConnection, SyncRun } from '@/data/types';
import { useConnections, useDataSources, useRunSync, useSyncRuns } from '@/hooks/queries/actuals';
import { usePeriods } from '@/hooks/queries/goals';
import { monthlySchedule } from '@/lib/actualRules';
import { combineQueries } from '@/lib/queryState';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { MonthSelect } from './CyclePeriodPickers';

export const SYNC_URL = '/admin/actuals/sync';

interface ConnectionRow {
  connection: IntegrationConnection;
  name: string;
  lastRun: SyncRun | null;
}

/**
 * "Đồng bộ API" (WBS 4.4.4–4.4.5): the tenant's connections with their last run, a run for one month
 * started by hand from the row, and each connection's run history on its own page
 * (`/admin/actuals/sync/:connectionId`). The connector is simulated (BR-KPI-56): it never overwrites
 * a number a person entered, and a refused reading is listed in the run's log.
 */
export function SyncTab({ cycleId, search }: { cycleId: Id | null; search: string }) {
  const { can } = useSession();
  const navigate = useNavigate();
  const connections = useConnections();
  const sources = useDataSources();
  const runs = useSyncRuns(null);
  const run = useRunSync();
  const [running, setRunning] = useState<ConnectionRow | null>(null);
  const mayRun = can('actual.import');

  const rows = useMemo<ConnectionRow[] | undefined>(() => {
    if (!connections.data || !sources.data || !runs.data) return undefined;
    const sourceName = new Map(sources.data.map((s) => [s.id, s.name]));
    const last = new Map<Id, SyncRun>();
    for (const r of runs.data) {
      const seen = last.get(r.connectionId);
      if (!seen || r.startedAt > seen.startedAt) last.set(r.connectionId, r);
    }
    return connections.data.map((connection) => ({ connection, name: sourceName.get(connection.dataSourceId) ?? connection.endpoint, lastRun: last.get(connection.id) ?? null }));
  }, [connections.data, sources.data, runs.data]);

  const columns: DataTableColumn<ConnectionRow>[] = [
    {
      id: 'name',
      header: 'Kết nối',
      className: 'min-w-56',
      sortValue: (r) => r.name,
      cell: (r) => (
        <button type="button" className="text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:underline" onClick={() => navigate(`${SYNC_URL}/${r.connection.id}${search}`)}>
          {r.name}
        </button>
      ),
    },
    { id: 'status', header: 'Trạng thái', sortValue: (r) => r.connection.status, cell: (r) => <RecordStatusBadge status={r.connection.status} /> },
    { id: 'schedule', header: 'Lịch đồng bộ', cell: (r) => <ScheduleText cron={r.connection.scheduleCron} /> },
    {
      id: 'lastAt',
      header: 'Lần chạy gần nhất',
      sortValue: (r) => r.lastRun?.startedAt ?? null,
      cell: (r) => (r.lastRun ? <span className="tabular whitespace-nowrap">{formatDateTime(r.lastRun.startedAt)}</span> : null),
    },
    { id: 'lastStatus', header: 'Kết quả', cell: (r) => (r.lastRun ? <SyncRunStatusBadge status={r.lastRun.status} /> : null) },
    {
      id: 'run',
      header: 'Thao tác',
      cell: (r) => (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={r.connection.status !== 'Active' || !mayRun || run.isPending}
          onClick={() => setRunning(r)}
          aria-label={`Chạy đồng bộ ${r.name}`}
        >
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />
          Chạy đồng bộ
        </Button>
      ),
    },
  ];

  const ran = run.data;
  const ranName = ran ? rows?.find((r) => r.connection.id === ran.connectionId)?.name : undefined;

  return (
    <div className="space-y-4">
      {run.isPending && (
        <p className="text-sm text-muted-foreground" role="status">
          Đang đồng bộ…
        </p>
      )}
      {ran && <LastRun run={ran} name={ranName} fresh />}
      <DataTable
        label="Kết nối API"
        columns={columns}
        rows={rows}
        query={combineQueries([connections, sources, runs])}
        getRowId={(r) => r.connection.id}
        empty="Chưa có kết nối API nào. Quản trị viên khai báo kết nối ở trang Kết nối API."
        pageSize={null}
      />
      {!mayRun && <p className="text-sm text-muted-foreground">Bạn xem được lịch sử đồng bộ nhưng không chạy được đồng bộ.</p>}
      <SyncSimulationNote />
      {running && (
        <RunSyncDialog
          name={running.name}
          cycleId={cycleId}
          onClose={() => setRunning(null)}
          onConfirm={(period) => {
            setRunning(null);
            run.mutate({ connectionId: running.connection.id, periodId: period.id });
          }}
        />
      )}
    </div>
  );
}

export function ScheduleText({ cron }: { cron: string | null }) {
  const s = monthlySchedule(cron);
  if (s) return <span className="tabular">{`${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')} ngày ${s.day} hằng tháng`}</span>;
  return cron ? <code className="text-xs">{cron}</code> : <span className="text-muted-foreground">Không đặt lịch</span>;
}

export function SyncSimulationNote() {
  return <p className="text-xs text-muted-foreground">Bản demo: kết nối là giả lập, số liệu đọc về được tạo cố định theo mục tiêu tháng. Số do người nhập tay hoặc import Excel không bị ghi đè.</p>;
}

/**
 * Pick the month, then confirm — one dialog for the list's row action and the connection page's
 * header action. The caller owns the `useRunSync` mutation, so its result outlives the dialog.
 */
export function RunSyncDialog({ name, cycleId, onClose, onConfirm }: { name: string; cycleId: Id | null; onClose: () => void; onConfirm: (period: CyclePeriod) => void }) {
  const [period, setPeriod] = useState<CyclePeriod | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Đồng bộ số liệu ${name}`}</DialogTitle>
          <DialogDescription>
            Số đọc được sẽ thay số hiện tại của các chỉ tiêu lấy từ kết nối này. Số do người nhập tay hoặc import Excel được giữ nguyên. Lần chạy được ghi vào lịch sử.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Kỳ đồng bộ</span>
          <MonthSelect cycleId={cycleId} value={period?.id ?? null} onChange={setPeriod} label="Kỳ đồng bộ" />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button type="button" disabled={!period} onClick={() => period && onConfirm(period)}>
            {`Chạy đồng bộ${period ? ` kỳ ${period.label}` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A run's outcome: the one that just finished (`fresh`), or the latest one on record. */
export function LastRun({ run, name, fresh = false }: { run: SyncRun; name?: string; fresh?: boolean }) {
  const tone = run.status === 'Succeeded' ? 'info' : run.status === 'PartiallyFailed' ? 'warning' : 'negative';
  const what = `${formatNumber(run.recordsOk)} chỉ tiêu cập nhật, ${formatNumber(run.recordsError)} lỗi`;
  const title = fresh ? `Lần chạy vừa xong${name ? ` (${name})` : ''}: ${what}` : `Lần chạy gần nhất, ${formatDateTime(run.startedAt)}: ${what}`;
  return (
    <InlineNotice tone={tone} title={title}>
      {run.errorLog ? 'Xem nhật ký của lần chạy trong lịch sử đồng bộ.' : 'Không có dòng nào bị bỏ qua hay lỗi.'}
    </InlineNotice>
  );
}

/** Every run of one connection, each with its log. */
export function RunHistory({ connectionId, cycleId }: { connectionId: Id; cycleId: Id | null }) {
  const runs = useSyncRuns(connectionId);
  const periods = usePeriods(cycleId);
  const label = useMemo(() => new Map((periods.data ?? []).map((p) => [p.id, p.label])), [periods.data]);
  const columns: DataTableColumn<SyncRun>[] = [
    { id: 'period', header: 'Kỳ', cell: (r) => (r.periodId ? (label.get(r.periodId) ?? 'Kỳ chu kỳ khác') : null) },
    { id: 'status', header: 'Kết quả', sortValue: (r) => r.status, cell: (r) => <SyncRunStatusBadge status={r.status} /> },
    { id: 'started', header: 'Thời điểm chạy', sortValue: (r) => r.startedAt, cell: (r) => <span className="tabular whitespace-nowrap">{formatDateTime(r.startedAt)}</span> },
    { id: 'ok', header: 'Cập nhật', numeric: true, sortValue: (r) => r.recordsOk, cell: (r) => formatNumber(r.recordsOk) },
    { id: 'error', header: 'Lỗi', numeric: true, sortValue: (r) => r.recordsError, cell: (r) => <span className={r.recordsError > 0 ? 'font-medium text-support-negative' : undefined}>{formatNumber(r.recordsError)}</span> },
    {
      id: 'log',
      header: 'Nhật ký',
      className: 'min-w-64',
      cell: (r) =>
        r.errorLog ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-primary underline-offset-4 hover:underline">{r.errorLog.split('\n').length} dòng nhật ký</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {r.errorLog.split('\n').map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </details>
        ) : null,
    },
  ];
  return (
    <DataTable label="Lịch sử đồng bộ" columns={columns} rows={runs.data} query={runs} getRowId={(r) => r.id} empty="Kết nối này chưa chạy lần nào." pageSize={10} />
  );
}
