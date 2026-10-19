import { useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { ImportBatchStatusBadge } from '@/components/shared/StatusBadge';
import { InlineNotice } from '@/components/shared/InlineNotice';
import { useSession } from '@/contexts/useSession';
import type { ActualImportRow, CyclePeriod, Id, ImportBatch, ImportRowError } from '@/data/types';
import { useActuals, useCommitImport, useFileObject, useImportBatch, useImportBatches, useOpenFile, useRejectImport, useStageImport } from '@/hooks/queries/actuals';
import { usePeriodResults } from '@/hooks/queries/results';
import { usePeriods } from '@/hooks/queries/goals';
import { ACTUAL_IMPORT_SPEC, actualImportWarnings, actualTemplateRows, validateActualRows } from '@/lib/actualImportRules';
import { monthsOf } from '@/lib/actualEntryRules';
import { canCommitImport, canRejectImport } from '@/lib/importRules';
import { ERROR_CATALOG, errorSpecOf, ISSUE_DETAIL_COPY, KpiError } from '@/lib/errorCatalog';
import { writeTemplate } from '@/lib/excel';
import { loadPhase } from '@/lib/queryState';
import { downloadBlob, formatDateTime, formatNumber } from '@/lib/utils';
import { MonthSelect } from './CyclePeriodPickers';
import { ImportPreview } from './ImportPreview';
import { ImportUploadCard, type ParsedUpload } from './ImportUploadCard';
import { useCycleGoalData } from './useCycleGoalData';

type LocalUpload = ParsedUpload<'Actual'>;

/**
 * "Nhập từ Excel" (WBS 4.4.3) on the shared framework: the month's pre-filled template, the upload
 * (read in the browser; a file with problems is shown here and never sent), the staged batch's
 * preview, then "Ghi nhận" — all rows or none — or "Từ chối lô". The batch history lists every
 * actuals batch; one opens by `?batch=`.
 */
export function ActualImportTab({ cycleId, batchId, onOpenBatch }: { cycleId: Id | null; batchId: Id | null; onOpenBatch: (batchId: Id | null) => void }) {
  const { can } = useSession();
  const [templatePeriod, setTemplatePeriod] = useState<CyclePeriod | null>(null);
  const [local, setLocal] = useState<LocalUpload | null>(null);
  const cycleData = useCycleGoalData(cycleId);
  const periods = usePeriods(cycleId);
  const stage = useStageImport();

  const downloadTemplate = async () => {
    if (!cycleData.data || !templatePeriod) throw new Error('template data not loaded');
    const d = cycleData.data;
    const employees = new Map(d.employees.map((e) => [e.id, e.fullName]));
    const units = new Map(d.orgUnits.map((u) => [u.id, u.name]));
    const rootName = d.orgUnits.find((u) => u.parentId === null)?.name ?? '';
    const rows = actualTemplateRows({
      period: templatePeriod,
      goals: d.goals,
      plans: d.plans,
      employees: d.employees,
      users: d.users,
      kpiDefinitions: d.kpiDefinitions,
      units: d.units,
      periodTargets: d.periodTargets,
      ownerName: (p) => (p.ownerEmployeeId ? (employees.get(p.ownerEmployeeId) ?? '') : p.ownerOrgUnitId ? (units.get(p.ownerOrgUnitId) ?? '') : rootName),
    });
    const blob = await writeTemplate(ACTUAL_IMPORT_SPEC, rows, [{ title: 'Kỳ', values: monthsOf(periods.data ?? []).map((p) => p.label) }]);
    downloadBlob(blob, `${ACTUAL_IMPORT_SPEC.fileName}-${templatePeriod.label}.xlsx`);
  };

  const onParsed = (result: LocalUpload) => {
    if (result.errors.length > 0 || cycleId === null) {
      setLocal(result);
      onOpenBatch(null);
      return;
    }
    setLocal(null);
    stage.mutate({ file: result.file, input: { importType: 'Actual', cycleId, rows: result.rows } }, { onSuccess: (batch) => onOpenBatch(batch.id) });
  };

  const upload = (
    <ImportUploadCard
      spec={ACTUAL_IMPORT_SPEC}
      onDownloadTemplate={downloadTemplate}
      templateControls={<MonthSelect cycleId={cycleId} value={templatePeriod?.id ?? null} onChange={setTemplatePeriod} label="Kỳ của tệp mẫu" />}
      onParsed={onParsed}
      canUpload={can('actual.import') && can('evidence.upload')}
      notReady={cycleId === null ? 'Chọn chu kỳ trước khi tải tệp lên.' : null}
      busy={stage.isPending}
    />
  );

  if (batchId !== null) {
    return (
      <div className="space-y-4">
        <Button type="button" variant="ghost" size="sm" onClick={() => onOpenBatch(null)}>
          <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
          Danh sách lô import
        </Button>
        <BatchPreview key={batchId} batchId={batchId} cycleData={cycleData} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {upload}
      {local && (
        <ImportPreview
          source="local"
          rows={local.rows}
          errors={local.errors}
          columns={actualRowColumns(null)}
          summary={<p className="text-sm text-muted-foreground">Tệp {local.file.name}</p>}
        />
      )}
      <BatchHistory onOpen={(id) => onOpenBatch(id)} />
    </div>
  );
}

// ─── The batch preview ───────────────────────────────────────────────────────────────────────────

function BatchPreview({ batchId, cycleData }: { batchId: Id; cycleData: ReturnType<typeof useCycleGoalData> }) {
  const { can } = useSession();
  const mayAct = can('actual.import');
  const batch = useImportBatch(batchId);
  const file = useFileObject(batch.data?.fileId ?? null);
  const actuals = useActuals({});
  const commit = useCommitImport();
  const reject = useRejectImport();
  const [confirm, setConfirm] = useState<'commit' | 'reject' | null>(null);
  const [commitErrors, setCommitErrors] = useState<ImportRowError[]>([]);
  const names = useMemo(() => new Map((cycleData.data?.users ?? []).map((u) => [u.id, u.displayName])), [cycleData.data]);

  const phase = loadPhase(batch, batch.data !== undefined);
  if (phase === 'error') return <ErrorStateCard spec={errorSpecOf(batch.error)} onAction={() => void batch.refetch()} />;
  if (!batch.data) return <p className="text-sm text-muted-foreground">Đang tải lô import…</p>;
  const b = batch.data;
  const commitDecision = canCommitImport(b);
  const rejectDecision = canRejectImport(b);

  const summary = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 className="text-base font-semibold">{file.data?.fileName ?? 'Lô import'}</h2>
      <ImportBatchStatusBadge status={b.status} />
      <p className="text-sm text-muted-foreground">
        Tải lên bởi {names.get(b.uploadedBy) ?? 'người dùng khác'}, {formatDateTime(b.createdAt)}
      </p>
    </div>
  );

  const blocked =
    b.status !== 'Validating'
      ? null
      : !mayAct
        ? `${ERROR_CATALOG['ERR-KPI-05'].title}: bạn chỉ xem được lô này.`
        : b.rowsTotal === 0
          ? 'Lô không có dòng nào để ghi nhận.'
          : b.rowsError > 0
        ? `Còn ${b.rowsError} dòng lỗi, chưa thể ghi nhận. Sửa tệp rồi tải lên thành lô mới.`
        : commitErrors.length > 0
          ? 'Dữ liệu đã thay đổi từ lúc tải lên. Sửa tệp rồi tải lên thành lô mới.'
          : null;

  const footer =
    b.status === 'Validating' ? (
      <div className="flex flex-wrap items-center justify-end gap-3">
        {blocked && (
          <p className="mr-auto flex items-center gap-1.5 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0 text-support-negative" aria-hidden />
            {blocked}
          </p>
        )}
        <Button type="button" variant="outline" disabled={!mayAct || !rejectDecision.ok || reject.isPending} onClick={() => setConfirm('reject')}>
          Từ chối lô
        </Button>
        <Button type="button" disabled={!mayAct || !commitDecision.ok || commitErrors.length > 0 || commit.isPending} onClick={() => setConfirm('commit')}>
          {commit.isPending ? 'Đang ghi nhận…' : `Ghi nhận ${b.rowsTotal} dòng`}
        </Button>
      </div>
    ) : null;

  return (
    <>
      {commitErrors.length > 0 && (
        <InlineNotice tone="negative" title={`Dữ liệu đã thay đổi từ lúc tải lên: ${new Set(commitErrors.map((e) => e.rowNo)).size} dòng không còn hợp lệ`} alert>
          Lô chưa được ghi. Các dòng được đánh dấu bên dưới.
        </InlineNotice>
      )}
      {b.importType === 'Actual' ? (
        <ActualBatchPreview batch={b} cycleData={cycleData} actuals={actuals.data} summary={summary} footer={footer} extraErrors={commitErrors} />
      ) : (
        <ImportPreview source="batch" rows={b.rows as { rowNo: number }[]} errors={b.errors} columns={[]} summary={summary} footer={footer} />
      )}
      <ConfirmDialog
        open={confirm === 'commit'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Ghi nhận ${b.rowsTotal} dòng số liệu?`}
        body="Số liệu mới sẽ thay số hiện tại của từng chỉ tiêu theo kỳ. Lịch sử vẫn được giữ. Không thể ghi nhận một phần."
        confirmLabel={`Ghi nhận ${b.rowsTotal} dòng`}
        onConfirm={() => {
          setConfirm(null);
          commit.mutate(b.id, {
            onError: (error) => {
              if (error instanceof KpiError && error.issues.length > 0) {
                setCommitErrors(
                  error.issues.map((i) => ({ rowNo: Number(i.data?.rowNo ?? 0), column: i.data?.column ? String(i.data.column) : null, code: i.code, detail: i.detail })),
                );
              }
            },
          });
        }}
      />
      <ConfirmDialog
        open={confirm === 'reject'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Từ chối lô import này?"
        body="Lô sẽ không bao giờ được ghi. Sửa tệp rồi tải lên thành lô mới khi cần."
        confirmLabel="Từ chối lô"
        destructive
        onConfirm={() => {
          setConfirm(null);
          reject.mutate(b.id);
        }}
      />
      {commit.isError && !(commit.error instanceof KpiError && commit.error.issues.length > 0) && (
        <InlineNotice tone="negative" title={errorSpecOf(commit.error).title} alert>
          {errorSpecOf(commit.error).message}
        </InlineNotice>
      )}
    </>
  );
}

function ActualBatchPreview({
  batch,
  cycleData,
  actuals,
  summary,
  footer,
  extraErrors,
}: {
  batch: Extract<ImportBatch, { importType: 'Actual' }>;
  cycleData: ReturnType<typeof useCycleGoalData>;
  actuals: Parameters<typeof actualImportWarnings>[1]['actuals'] | undefined;
  summary: ReactNode;
  footer: ReactNode;
  extraErrors: ImportRowError[];
}) {
  const { today } = useSession();
  const periods = usePeriods(batch.cycleId);
  const results = usePeriodResults({});
  const warnings = useMemo(() => {
    const d = cycleData.data;
    if (batch.status !== 'Validating' || batch.cycleId === null || !d || !actuals || !periods.data || !results.data) return undefined;
    const { resolved } = validateActualRows(batch.rows, { cycleId: batch.cycleId, goals: d.goals, plans: d.plans, periods: periods.data, users: d.users, kpiDefinitions: d.kpiDefinitions, results: results.data, asOf: today });
    const map = new Map<number, string[]>();
    for (const w of actualImportWarnings(resolved, { goals: d.goals, actuals, periodTargets: d.periodTargets, units: d.units })) {
      const text =
        w.detail === 'OVERWRITES_ACTUAL' && w.previous
          ? `${ISSUE_DETAIL_COPY.OVERWRITES_ACTUAL} Số cũ: ${w.previous.actualValue !== null ? formatNumber(w.previous.actualValue) : (w.previous.actualText ?? '—')}.`
          : ISSUE_DETAIL_COPY[w.detail];
      map.set(w.rowNo, [...(map.get(w.rowNo) ?? []), text]);
    }
    return map;
  }, [batch, cycleData.data, actuals, periods.data, results.data, today]);

  return (
    <ImportPreview
      source="batch"
      rows={batch.rows}
      errors={batch.errors}
      extraErrors={extraErrors}
      columns={actualRowColumns(cycleData.data ?? null)}
      warnings={warnings}
      summary={summary}
      footer={footer}
    />
  );
}

/** The actuals row as the preview shows it: the goal by name when it resolves, else what the file said. */
function actualRowColumns(data: ReturnType<typeof useCycleGoalData>['data'] | null): DataTableColumn<ActualImportRow>[] {
  const goals = new Map((data?.goals ?? []).map((g) => [g.id, g]));
  const employees = new Map((data?.employees ?? []).map((e) => [e.id, e.fullName]));
  return [
    {
      id: 'goal',
      header: 'Chỉ tiêu',
      className: 'min-w-56',
      cell: (r) => {
        const goal = r.goalId ? goals.get(r.goalId) : undefined;
        if (goal) {
          return (
            <div>
              <p className="line-clamp-2">{goal.name}</p>
              {goal.ownerEmployeeId && <p className="text-xs text-muted-foreground">{employees.get(goal.ownerEmployeeId)}</p>}
            </div>
          );
        }
        const key = [r.login, r.kpiCode].filter(Boolean).join(', ');
        return <span className="break-all text-muted-foreground">{r.goalId ?? (key || null)}</span>;
      },
    },
    { id: 'period', header: 'Kỳ', cell: (r) => r.periodLabel || null },
    {
      id: 'value',
      header: 'Giá trị',
      numeric: true,
      cell: (r) => (r.actualValue !== null ? formatNumber(r.actualValue) : r.actualText),
    },
    { id: 'note', header: 'Ghi chú', className: 'min-w-32', cell: (r) => r.note },
  ];
}

// ─── The batch history ───────────────────────────────────────────────────────────────────────────

function BatchHistory({ onOpen }: { onOpen: (batchId: Id) => void }) {
  const batches = useImportBatches('Actual');
  const columns: DataTableColumn<ImportBatch>[] = [
    { id: 'file', header: 'Tệp', className: 'min-w-56', cell: (b) => <BatchFileName fileId={b.fileId} /> },
    { id: 'status', header: 'Trạng thái', sortValue: (b) => b.status, cell: (b) => <ImportBatchStatusBadge status={b.status} /> },
    { id: 'at', header: 'Thời điểm tải lên', sortValue: (b) => b.createdAt, cell: (b) => <span className="tabular whitespace-nowrap">{formatDateTime(b.createdAt)}</span> },
    { id: 'rows', header: 'Số dòng', numeric: true, sortValue: (b) => b.rowsTotal, cell: (b) => formatNumber(b.rowsTotal) },
    {
      id: 'errors',
      header: 'Dòng lỗi',
      numeric: true,
      sortValue: (b) => b.rowsError,
      cell: (b) => <span className={b.rowsError > 0 ? 'font-medium text-support-negative' : undefined}>{formatNumber(b.rowsError)}</span>,
    },
    {
      id: 'open',
      header: 'Thao tác',
      cell: (b) => (
        <Button type="button" size="sm" variant="outline" onClick={() => onOpen(b.id)}>
          {b.status === 'Validating' ? 'Xem và ghi nhận' : 'Xem'}
        </Button>
      ),
    },
  ];
  return (
    <section className="space-y-2" aria-labelledby="batch-history">
      <h2 id="batch-history" className="text-base font-semibold">
        Các lô import số thực tế
      </h2>
      <DataTable
        label="Các lô import số thực tế"
        columns={columns}
        rows={batches.data}
        query={batches}
        getRowId={(b) => b.id}
        empty="Chưa có lô import nào. Tải mẫu, điền số liệu rồi tải lên."
      />
    </section>
  );
}

function BatchFileName({ fileId }: { fileId: Id }) {
  const file = useFileObject(fileId);
  const open = useOpenFile();
  if (!file.data) return null;
  return (
    <button type="button" className="max-w-full truncate text-left text-primary underline-offset-4 hover:underline" onClick={() => open.mutate(fileId)}>
      {file.data.fileName}
    </button>
  );
}
