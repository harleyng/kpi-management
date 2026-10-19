import { useMemo, useState, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { InlineNotice } from '@/components/shared/InlineNotice';
import { useSession } from '@/contexts/useSession';
import type { ImportBatch, ImportRowError } from '@/data/types';
import { useActuals, useCommitImport, useRejectImport } from '@/hooks/queries/actuals';
import { usePeriodResults } from '@/hooks/queries/results';
import { usePeriods } from '@/hooks/queries/goals';
import { actualImportWarnings, validateActualRows } from '@/lib/actualImportRules';
import { canCommitImport, canRejectImport } from '@/lib/importRules';
import { ERROR_CATALOG, errorSpecOf, ISSUE_DETAIL_COPY, KpiError } from '@/lib/errorCatalog';
import { formatNumber } from '@/lib/utils';
import { actualRowColumns } from './actualRowColumns';
import { ImportPreview } from './ImportPreview';
import type { useCycleGoalData } from './useCycleGoalData';

export type ActualBatch = Extract<ImportBatch, { importType: 'Actual' }>;
type CycleData = ReturnType<typeof useCycleGoalData>;

/**
 * A staged actuals batch (WBS 4.4.3): every row with its check, the warnings, then "Ghi nhận" — all
 * rows or none — or "Từ chối lô". The batch's name, status and uploader are the page header's
 * (`ImportBatchPage`); after either action the page stays and shows the new status.
 */
export function BatchPreview({ batch: b, cycleData }: { batch: ActualBatch; cycleData: CycleData }) {
  const { can } = useSession();
  const mayAct = can('actual.import');
  const actuals = useActuals({});
  const commit = useCommitImport();
  const reject = useRejectImport();
  const [confirm, setConfirm] = useState<'commit' | 'reject' | null>(null);
  const [commitErrors, setCommitErrors] = useState<ImportRowError[]>([]);
  const commitDecision = canCommitImport(b);
  const rejectDecision = canRejectImport(b);

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
    <div className="space-y-3">
      {commitErrors.length > 0 && (
        <InlineNotice tone="negative" title={`Dữ liệu đã thay đổi từ lúc tải lên: ${new Set(commitErrors.map((e) => e.rowNo)).size} dòng không còn hợp lệ`} alert>
          Lô chưa được ghi. Các dòng được đánh dấu bên dưới.
        </InlineNotice>
      )}
      <ActualBatchPreview batch={b} cycleData={cycleData} actuals={actuals.data} footer={footer} extraErrors={commitErrors} />
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
    </div>
  );
}

function ActualBatchPreview({
  batch,
  cycleData,
  actuals,
  footer,
  extraErrors,
}: {
  batch: ActualBatch;
  cycleData: CycleData;
  actuals: Parameters<typeof actualImportWarnings>[1]['actuals'] | undefined;
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
      footer={footer}
    />
  );
}
