import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { InlineNotice } from '@/components/shared/InlineNotice';
import { RecordStatusBadge, SyncRunStatusBadge } from '@/components/shared/StatusBadge';
import { useSession } from '@/contexts/useSession';
import { CONNECTION_AUTH_TYPE_LABEL, type CyclePeriod, type Id, type IntegrationConnection, type SyncRun } from '@/data/types';
import { useConnections, useDataSources, useRunSync, useSyncRuns } from '@/hooks/queries/actuals';
import { usePeriods } from '@/hooks/queries/goals';
import { monthlySchedule } from '@/lib/actualRules';
import { errorSpecOf } from '@/lib/errorCatalog';
import { combineQueries, loadPhase } from '@/lib/queryState';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { MonthSelect } from './CyclePeriodPickers';

/**
 * "Đồng bộ API" (WBS 4.4.4–4.4.5): the tenant's connections, a run for one month started by hand,
 * and every run with its log. The connector is simulated (BR-KPI-56): it never overwrites a number a
 * person entered, and a refused reading is listed in the run's log.
 */
export function SyncTab({ cycleId }: { cycleId: Id | null }) {
  const connections = useConnections();
  const sources = useDataSources();
  const query = combineQueries([connections, sources]);
  const phase = loadPhase(query, connections.data !== undefined && sources.data !== undefined);
  if (phase === 'error') return <ErrorStateCard spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />;
  if (phase !== 'ready') return <Skeleton className="h-40 w-full" />;
  if (!connections.data || connections.data.length === 0) {
    return <EmptyStateCard>Chưa có kết nối API nào. Quản trị viên khai báo kết nối ở trang Nguồn dữ liệu.</EmptyStateCard>;
  }
  const sourceName = new Map((sources.data ?? []).map((s) => [s.id, s.name]));
  return (
    <div className="space-y-8">
      {connections.data.map((c) => (
        <ConnectionSection key={c.id} connection={c} name={sourceName.get(c.dataSourceId) ?? c.endpoint} cycleId={cycleId} />
      ))}
    </div>
  );
}

export function ScheduleText({ cron }: { cron: string | null }) {
  const s = monthlySchedule(cron);
  if (s) return <span className="tabular">{`${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')} ngày ${s.day} hằng tháng`}</span>;
  return cron ? <code className="text-xs">{cron}</code> : <span className="text-muted-foreground">Không đặt lịch</span>;
}

function ConnectionSection({ connection, name, cycleId }: { connection: IntegrationConnection; name: string; cycleId: Id | null }) {
  const { can } = useSession();
  const [period, setPeriod] = useState<CyclePeriod | null>(null);
  const [confirming, setConfirming] = useState(false);
  const run = useRunSync();
  const inactive = connection.status !== 'Active';
  const mayRun = can('actual.import');

  return (
    <section className="space-y-4" aria-labelledby={`conn-${connection.id}`}>
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 id={`conn-${connection.id}`} className="text-base font-semibold">
                {name}
              </h2>
              <RecordStatusBadge status={connection.status} />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Địa chỉ</dt>
              <dd className="break-all">{connection.endpoint}</dd>
              <dt className="text-muted-foreground">Xác thực</dt>
              <dd>{CONNECTION_AUTH_TYPE_LABEL[connection.authType]}</dd>
              <dt className="text-muted-foreground">Lịch đồng bộ</dt>
              <dd>
                <ScheduleText cron={connection.scheduleCron} />
              </dd>
            </dl>
          </div>
          <div className="flex items-end gap-2">
            <MonthSelect cycleId={cycleId} value={period?.id ?? null} onChange={setPeriod} label="Kỳ đồng bộ" />
            <Button type="button" onClick={() => setConfirming(true)} disabled={!period || inactive || !mayRun || run.isPending}>
              <RefreshCw className={`mr-2 h-4 w-4 ${run.isPending ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
              {run.isPending ? 'Đang đồng bộ…' : `Chạy đồng bộ${period ? ` kỳ ${period.label}` : ''}`}
            </Button>
          </div>
        </div>
        {inactive && (
          <InlineNotice tone="info" title="Kết nối đang ngừng hoạt động" className="mt-3">
            Quản trị viên bật lại kết nối ở trang Nguồn dữ liệu thì mới chạy đồng bộ được.
          </InlineNotice>
        )}
        {!inactive && !mayRun && <p className="mt-3 text-sm text-muted-foreground">Bạn xem được lịch sử đồng bộ nhưng không chạy được đồng bộ.</p>}
        <p className="mt-3 text-xs text-muted-foreground">Bản demo: kết nối là giả lập, số liệu đọc về được tạo cố định theo mục tiêu tháng. Số do người nhập tay hoặc import Excel không bị ghi đè.</p>
      </div>
      {run.data && run.data.connectionId === connection.id && <LastRun run={run.data} />}
      <RunHistory connectionId={connection.id} cycleId={cycleId} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Đồng bộ số liệu ${name} kỳ ${period?.label ?? ''}?`}
        body="Số đọc được sẽ thay số hiện tại của các chỉ tiêu lấy từ kết nối này. Số do người nhập tay hoặc import Excel được giữ nguyên. Lần chạy được ghi vào lịch sử."
        confirmLabel="Chạy đồng bộ"
        onConfirm={() => {
          setConfirming(false);
          if (period) run.mutate({ connectionId: connection.id, periodId: period.id });
        }}
      />
    </section>
  );
}

function LastRun({ run }: { run: SyncRun }) {
  const tone = run.status === 'Succeeded' ? 'info' : run.status === 'PartiallyFailed' ? 'warning' : 'negative';
  return (
    <InlineNotice tone={tone} title={`Lần chạy vừa xong: ${formatNumber(run.recordsOk)} chỉ tiêu cập nhật, ${formatNumber(run.recordsError)} lỗi`}>
      {run.errorLog ? 'Xem nhật ký của lần chạy trong bảng bên dưới.' : 'Không có dòng nào bị bỏ qua hay lỗi.'}
    </InlineNotice>
  );
}

function RunHistory({ connectionId, cycleId }: { connectionId: Id; cycleId: Id | null }) {
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
