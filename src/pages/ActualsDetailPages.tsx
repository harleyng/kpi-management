import { useMemo, useState } from 'react';
import { LaterPhaseNotice } from '@/components/shared/LaterPhaseNotice';
import { useLocation, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BatchPreview, type ActualBatch } from '@/components/actuals/BatchPreview';
import { LastRun, RunHistory, RunSyncDialog, ScheduleText, SYNC_URL, SyncSimulationNote } from '@/components/actuals/SyncTab';
import { ACTUALS_PARAMS, useCyclePeriodParams } from '@/components/actuals/useCyclePeriodParams';
import { useCycleGoalData } from '@/components/actuals/useCycleGoalData';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { InlineNotice } from '@/components/shared/InlineNotice';
import { PageHeader, type Crumb } from '@/components/shared/PageHeader';
import { ImportBatchStatusBadge, RecordStatusBadge } from '@/components/shared/StatusBadge';
import { useSession } from '@/contexts/useSession';
import { CONNECTION_AUTH_TYPE_LABEL } from '@/data/types';
import { useConnections, useDataSources, useFileObject, useImportBatch, useRunSync, useSyncRuns } from '@/hooks/queries/actuals';
import { ERROR_CATALOG, errorSpecOf, KpiError } from '@/lib/errorCatalog';
import { carrySearch } from '@/lib/navRules';
import { combineQueries } from '@/lib/queryState';
import { formatDateTime } from '@/lib/utils';

const IMPORT_URL = '/admin/actuals/import';

/**
 * One actuals import batch (WBS 4.4.3) — opened from "Nhập từ Excel" (its history, or straight after
 * an upload). Only an actuals batch of this tenant opens here; anything else is ERR-KPI-02 under the
 * trail. Committing or rejecting keeps the page and shows the batch's new status.
 */
export function ImportBatchPage() {
  const { batchId } = useParams();
  const { search } = useLocation();
  const batch = useImportBatch(batchId ?? null);
  const file = useFileObject(batch.data?.fileId ?? null);
  const actualBatch = batch.data?.importType === 'Actual' ? (batch.data as ActualBatch) : null;
  const cycleData = useCycleGoalData(actualBatch?.cycleId ?? null);
  const names = useMemo(() => new Map((cycleData.data?.users ?? []).map((u) => [u.id, u.displayName])), [cycleData.data]);
  const trail: Crumb[] = [{ label: 'Nhập từ Excel', to: `${IMPORT_URL}${carrySearch(ACTUALS_PARAMS, search)}` }];

  const missing = batch.error instanceof KpiError && batch.error.code === 'ERR-KPI-02';
  if (batch.error != null && !missing) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Lô import" />
        <ErrorStateCard spec={errorSpecOf(batch.error)} onAction={() => void batch.refetch()} />
      </>
    );
  }
  if (missing || (batch.data && !actualBatch)) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Không tìm thấy lô import" />
        <ErrorStateCard spec={ERROR_CATALOG['ERR-KPI-02']} />
      </>
    );
  }
  if (!actualBatch) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Lô import" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={trail}
        title={file.data?.fileName ?? 'Lô import'}
        status={<ImportBatchStatusBadge status={actualBatch.status} />}
        description={`Tải lên bởi ${names.get(actualBatch.uploadedBy) ?? 'người dùng khác'}, ${formatDateTime(actualBatch.createdAt)}`}
      />
      <BatchPreview key={actualBatch.id} batch={actualBatch} cycleData={cycleData} />
    </>
  );
}

/**
 * One API connection's sync (WBS 4.4.4–4.4.5) — opened from "Đồng bộ API". The connection comes from
 * the tenant's (cached) connection list: still loading → skeleton; not in it → ERR-KPI-02. The run
 * history labels the months of the cycle in the URL (`?cycle=`), as the list does.
 */
export function SyncConnectionPage() {
  const { connectionId } = useParams();
  const { can } = useSession();
  const { cycleId, search } = useCyclePeriodParams({ withPeriod: false });
  const connections = useConnections();
  const sources = useDataSources();
  const runs = useSyncRuns(connectionId ?? null);
  const run = useRunSync();
  const [running, setRunning] = useState(false);
  const query = combineQueries([connections, sources]);
  const trail: Crumb[] = [{ label: 'Đồng bộ API', to: `${SYNC_URL}${search}` }];

  if (query.error != null) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Đồng bộ API" />
        <ErrorStateCard spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />
      </>
    );
  }
  if (!connections.data || !sources.data) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Đồng bộ API" />
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
  const inactive = connection.status !== 'Active';
  const mayRun = can('actual.import');
  const latest = [...(runs.data ?? [])].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
  const fresh = run.data?.connectionId === connection.id ? run.data : undefined;

  return (
    <>
      <PageHeader
        breadcrumb={trail}
        title={name}
        status={<RecordStatusBadge status={connection.status} />}
        description={connection.endpoint}
        actions={
          <Button type="button" onClick={() => setRunning(true)} disabled={inactive || !mayRun || run.isPending}>
            <RefreshCw className={`mr-2 h-4 w-4 ${run.isPending ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
            {run.isPending ? 'Đang đồng bộ…' : 'Chạy đồng bộ'}
          </Button>
        }
      />
      <div className="space-y-4">
        <LaterPhaseNotice />
        {inactive && (
          <InlineNotice tone="info" title="Kết nối đang ngừng hoạt động">
            Quản trị viên bật lại kết nối ở trang Kết nối API thì mới chạy đồng bộ được.
          </InlineNotice>
        )}
        {!inactive && !mayRun && <p className="text-sm text-muted-foreground">Bạn xem được lịch sử đồng bộ nhưng không chạy được đồng bộ.</p>}
        {fresh ? <LastRun run={fresh} fresh /> : latest ? <LastRun run={latest} /> : null}
        <Card>
          <CardContent className="space-y-3 p-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Xác thực</dt>
              <dd>{CONNECTION_AUTH_TYPE_LABEL[connection.authType]}</dd>
              <dt className="text-muted-foreground">Lịch đồng bộ</dt>
              <dd>
                <ScheduleText cron={connection.scheduleCron} />
              </dd>
            </dl>
            <SyncSimulationNote />
          </CardContent>
        </Card>
        <section className="space-y-2" aria-labelledby="sync-history">
          <h2 id="sync-history" className="text-base font-semibold">
            Lịch sử đồng bộ
          </h2>
          <RunHistory connectionId={connection.id} cycleId={cycleId} />
        </section>
      </div>
      {running && (
        <RunSyncDialog
          name={name}
          cycleId={cycleId}
          onClose={() => setRunning(false)}
          onConfirm={(period) => {
            setRunning(false);
            run.mutate({ connectionId: connection.id, periodId: period.id });
          }}
        />
      )}
    </>
  );
}
