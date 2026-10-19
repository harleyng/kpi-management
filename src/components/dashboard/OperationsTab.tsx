import { useId, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { OverdueBadge } from '@/components/shared/StatusBadge';
import { toastError } from '@/components/shared/toastError';
import { FORM_STATUS_LABEL, FORM_STATUSES, FORM_TYPE_LABEL, GOAL_PLAN_STATUS_LABEL, GOAL_PLAN_STATUSES, PERIOD_RESULT_STATUS_LABEL, PERIOD_RESULT_STATUSES } from '@/data/types';
import type { DashboardRead, DashboardSelection } from '@/hooks/queries/dashboard';
import { isOperationsReportEmpty, operationsSheets } from '@/lib/dashboardExport';
import type { FormProgress, OperationsReport, OverdueRow } from '@/lib/dashboardRules';
import { errorSpecOf } from '@/lib/errorCatalog';
import { loadPhase, type QueryState } from '@/lib/queryState';
import { statusCounts } from '@/lib/resultView';
import { downloadUrl, formatDate, formatNumber } from '@/lib/utils';

/**
 * "Vận hành" — the operational report (WBS 4.7.3, BR-KPI-88): registration progress of the cycle, the
 * period's evaluations, its results, and the overdue forms — counted only over the people and units the
 * viewer's `dashboard.view` covers. "Quá hạn" is T5's own test (`stepTiming`), so the counts here and on
 * "Duyệt & đánh giá" always agree.
 */
export function OperationsTab({
  selection,
  read,
  report,
  query,
}: {
  selection: DashboardSelection;
  read: DashboardRead;
  report: OperationsReport | undefined;
  query: QueryState;
}) {
  const phase = loadPhase(query, report !== undefined);
  if (phase === 'error') return <ErrorStateCard spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />;
  if (!report || !selection.period || !selection.cycle) return phase === 'loading' || selection.cycle ? <Skeleton className="h-72 w-full" /> : <EmptyStateCard>Chưa có chu kỳ đánh giá nào.</EmptyStateCard>;
  return <Report report={report} cycleName={selection.cycle.name} periodLabel={selection.period.label} read={read} />;
}

function Report({ report, cycleName, periodLabel, read }: { report: OperationsReport; cycleName: string; periodLabel: string; read: DashboardRead }) {
  const navigate = useNavigate();
  const people = new Map((read.data?.employees ?? []).map((e) => [e.id, e]));
  const periodLabels = new Map((read.data?.periods ?? []).map((p) => [p.id, p.label]));
  const resultCounts = statusCounts(report.results.all);

  const overdueColumns: DataTableColumn<OverdueRow>[] = [
    {
      id: 'person',
      header: 'Người được đánh giá',
      cell: (r) => (
        <button type="button" className="text-left font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none" onClick={() => navigate(`/forms/${r.form.id}`)}>
          {people.get(r.form.subjectEmployeeId)?.fullName ?? 'Không xác định'}
        </button>
      ),
      sortValue: (r) => people.get(r.form.subjectEmployeeId)?.fullName ?? '',
    },
    { id: 'type', header: 'Loại phiếu', cell: (r) => FORM_TYPE_LABEL[r.form.formType] },
    { id: 'period', header: 'Kỳ', cell: (r) => (r.form.periodId ? (periodLabels.get(r.form.periodId) ?? null) : null) },
    { id: 'step', header: 'Bước', cell: (r) => r.step.name },
    { id: 'deadline', header: 'Hạn bước', cell: (r) => <span className="tabular">{formatDate(r.deadline)}</span>, sortValue: (r) => r.deadline },
    {
      id: 'days',
      header: 'Quá hạn (ngày)',
      numeric: true,
      cell: (r) => (
        <span className="flex items-center justify-end gap-2">
          <span className="tabular">{r.daysOver}</span>
          <OverdueBadge />
        </span>
      ),
      sortValue: (r) => r.daysOver,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Số liệu trong phạm vi bạn được xem. "Quá hạn" tính theo hạn của bước hiện tại, như ở màn hình Duyệt & đánh giá.
        </p>
        <ExportButton report={report} cycleName={cycleName} periodLabel={periodLabel} read={read} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section title={`Đăng ký KPI — ${cycleName}`} hint="Kế hoạch mục tiêu cá nhân theo trạng thái">
          <CountList rows={GOAL_PLAN_STATUSES.map((s) => [GOAL_PLAN_STATUS_LABEL[s], report.plans.byStatus[s]])} total={['Tổng', report.plans.total]} />
          <OverdueLine count={report.registration.overdue} what="phiếu đăng ký" />
        </Section>
        <Section title={`Đánh giá kỳ ${periodLabel}`} hint="Phiếu đánh giá KPI theo trạng thái">
          <ProgressLine progress={report.evaluation} />
          <CountList rows={FORM_STATUSES.map((s) => [FORM_STATUS_LABEL[s], report.evaluation.byStatus[s]])} total={['Tổng', report.evaluation.total]} />
          {report.evaluation.byStep.length > 0 && (
            <CountList rows={report.evaluation.byStep.map((s) => [`Đang ở bước: ${s.name}`, s.count])} />
          )}
          <OverdueLine count={report.evaluation.overdue} what="phiếu đánh giá" />
        </Section>
        <Section title={`Kết quả kỳ ${periodLabel}`} hint="Xếp loại chỉ tính kết quả cá nhân đã chốt">
          <CountList rows={PERIOD_RESULT_STATUSES.map((s) => [PERIOD_RESULT_STATUS_LABEL[s], resultCounts[s]])} total={['Tổng', report.results.all.length]} />
          <CountList rows={[...report.results.ratings.levels.map((l) => [`Xếp loại ${l.level.code}`, l.count] as const), ['Chưa xếp loại', report.results.ratings.unrated] as const]} />
        </Section>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Phiếu quá hạn</h2>
        <DataTable
          label="Phiếu quá hạn"
          columns={overdueColumns}
          rows={report.overdue}
          query={{ isPending: false, fetchStatus: 'idle', error: null, refetch: () => undefined }}
          getRowId={(r) => r.form.id}
          empty="Không có phiếu quá hạn."
          pageSize={20}
        />
      </section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-md border bg-card px-4 py-3">
      <div>
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function CountList({ rows, total }: { rows: readonly (readonly [string, number])[]; total?: readonly [string, number] }) {
  return (
    <dl className="divide-y text-sm">
      {rows.map(([label, count]) => (
        <div key={label} className="flex justify-between gap-3 py-1">
          <dt>{label}</dt>
          <dd className="tabular">{count}</dd>
        </div>
      ))}
      {total && (
        <div className="flex justify-between gap-3 py-1 font-medium">
          <dt>{total[0]}</dt>
          <dd className="tabular">{total[1]}</dd>
        </div>
      )}
    </dl>
  );
}

function ProgressLine({ progress }: { progress: FormProgress }) {
  if (progress.completionPct === null) return <p className="text-sm text-muted-foreground">Chưa có phiếu nào trong kỳ.</p>;
  const label = `Hoàn thành ${progress.completed}/${progress.active} phiếu (${formatNumber(progress.completionPct, 1)}%)`;
  return (
    <div className="space-y-1">
      <p className="text-sm">{label}</p>
      <Progress value={progress.completionPct} aria-label={label} />
    </div>
  );
}

function OverdueLine({ count, what }: { count: number; what: string }) {
  return count === 0 ? (
    <p className="text-sm text-muted-foreground">Không có {what} quá hạn.</p>
  ) : (
    <p className="flex items-center gap-2 text-sm">
      <OverdueBadge />
      <span>
        {count} {what} quá hạn
      </span>
    </p>
  );
}

/** "Xuất báo cáo vận hành (Excel)" — not the payroll file. exceljs loads on click only. */
function ExportButton({ report, cycleName, periodLabel, read }: { report: OperationsReport; cycleName: string; periodLabel: string; read: DashboardRead }) {
  const [busy, setBusy] = useState(false);
  const reasonId = useId();
  const empty = isOperationsReportEmpty(report);

  const run = async () => {
    setBusy(true);
    try {
      const { writeSheets } = await import('@/lib/excel');
      const blob = await writeSheets(
        operationsSheets({ report, cycleName, period: { label: periodLabel }, employees: read.data?.employees ?? [], periods: read.data?.periods ?? [] }),
      );
      downloadUrl(URL.createObjectURL(blob), `bao-cao-van-hanh-${cycleName.replace(/\s+/g, '-')}-${periodLabel}.xlsx`);
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" onClick={() => void run()} disabled={busy || empty} aria-describedby={empty ? reasonId : undefined}>
        {busy ? <Loader2 className="motion-safe:animate-spin" aria-hidden /> : <Download aria-hidden />}
        Xuất báo cáo vận hành (Excel)
      </Button>
      {empty && (
        <span id={reasonId} className="text-xs text-muted-foreground">
          Không có số liệu để xuất trong kỳ này.
        </span>
      )}
    </div>
  );
}
