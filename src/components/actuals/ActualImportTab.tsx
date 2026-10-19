import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { ImportBatchStatusBadge } from '@/components/shared/StatusBadge';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod, Id, ImportBatch } from '@/data/types';
import { useFileObject, useImportBatches, useOpenFile, useStageImport } from '@/hooks/queries/actuals';
import { usePeriods } from '@/hooks/queries/goals';
import { ACTUAL_IMPORT_SPEC, actualTemplateRows } from '@/lib/actualImportRules';
import { monthsOf } from '@/lib/actualEntryRules';
import { writeTemplate } from '@/lib/excel';
import { downloadBlob, formatDateTime, formatNumber } from '@/lib/utils';
import { actualRowColumns } from './actualRowColumns';
import { MonthSelect } from './CyclePeriodPickers';
import { ImportPreview } from './ImportPreview';
import { ImportUploadCard, type ParsedUpload } from './ImportUploadCard';
import { useCycleGoalData } from './useCycleGoalData';

type LocalUpload = ParsedUpload<'Actual'>;

/**
 * "Nhập từ Excel" (WBS 4.4.3) on the shared framework: the month's pre-filled template, the upload
 * (read in the browser; a file with problems is shown here and never sent), and the history of every
 * actuals batch. A staged batch opens on its own page (`/admin/actuals/import/:batchId`) — straight
 * after the upload, or from the history — where it is checked and committed or rejected.
 */
export function ActualImportTab({ cycleId, search }: { cycleId: Id | null; search: string }) {
  const navigate = useNavigate();
  const openBatch = (batchId: Id) => navigate(`/admin/actuals/import/${batchId}${search}`);
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
      return;
    }
    setLocal(null);
    stage.mutate({ file: result.file, input: { importType: 'Actual', cycleId, rows: result.rows } }, { onSuccess: (batch) => openBatch(batch.id) });
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
      <BatchHistory onOpen={openBatch} />
    </div>
  );
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
