import { useState } from 'react';
import { Download, FileSpreadsheet, Info, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod, Id, PayrollExport, PerformanceCycle } from '@/data/types';
import { usePayrollExports, usePayrollPreview, useExportPayroll } from '@/hooks/queries/results';
import { useDownloadFile } from '@/hooks/queries/system';
import { KpiError, errorSpecOf } from '@/lib/errorCatalog';
import { loadPhase } from '@/lib/queryState';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/utils';

interface PayrollExportTabProps {
  cycle: PerformanceCycle;
  period: CyclePeriod;
}

/**
 * "Xuất file lương" (WBS 4.6.4, BR-KPI-45): what the file will hold, the export itself (C&B), and
 * every past export of the period. Exporting changes no result's status (`ASSUMPTION Q38`).
 */
export function PayrollExportTab({ cycle, period }: PayrollExportTabProps) {
  const { can, people } = useSession();
  const mayExport = can('result.export');
  const { preview, query } = usePayrollPreview(period.id, cycle.id);
  const exports = usePayrollExports(period.id);
  const exportPayroll = useExportPayroll();
  const download = useDownloadFile();
  const [lost, setLost] = useState<ReadonlySet<Id>>(new Set());
  const phase = loadPhase(query, preview !== undefined);

  const exporterName = (userId: Id) => people.find((p) => p.userId === userId)?.name ?? 'Tài khoản không còn hoạt động';

  const columns: DataTableColumn<PayrollExport>[] = [
    { id: 'at', header: 'Thời điểm', sortValue: (e) => e.exportedAt, cell: (e) => <span className="tabular">{formatDateTime(e.exportedAt)}</span> },
    { id: 'by', header: 'Người xuất', cell: (e) => exporterName(e.exportedBy) },
    {
      id: 'file',
      header: 'Tệp',
      cell: (e) => (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={download.isPending && download.variables === e.fileId}
            onClick={() =>
              download.mutate(e.fileId, {
                onError: (error) => {
                  if (error instanceof KpiError && error.code === 'ERR-KPI-02') setLost((prev) => new Set(prev).add(e.fileId));
                },
              })
            }
            aria-label={`Tải xuống file lương xuất lúc ${formatDateTime(e.exportedAt)}`}
          >
            <Download className="mr-1.5 h-4 w-4" aria-hidden />
            Tải xuống
          </Button>
          {lost.has(e.fileId) && <span className="text-xs text-support-warning">Tệp không còn sau khi tải lại trang. Xuất lại để tạo tệp mới.</span>}
        </div>
      ),
    },
  ];

  const downloadError = download.error && !(download.error instanceof KpiError && download.error.code === 'ERR-KPI-02') ? errorSpecOf(download.error) : null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle icon={FileSpreadsheet} title={`File lương kỳ ${period.label}`}>
          File Excel gồm kết quả cá nhân đã chốt hoặc đã khóa của kỳ. Xuất file không đổi trạng thái kết quả.
        </SectionTitle>

        {phase === 'error' && <ErrorState spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />}
        {phase === 'loading' && <Skeleton className="h-20 w-full" />}
        {preview && (
          <div className="space-y-2 text-sm">
            <p className="font-medium">
              {preview.exportable > 0 ? `${preview.exportable} kết quả cá nhân sẽ có trong file.` : 'Chưa có kết quả cá nhân đã chốt trong kỳ này.'}
            </p>
            {preview.noPayout > 0 && (
              <p className="flex items-start gap-2 text-support-warning">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="text-foreground">{preview.noPayout} kết quả chưa có % hưởng lương KPI (chưa có quy tắc quy đổi hoặc chưa xếp loại) nên cột % để trống trong file, kèm ghi chú.</span>
              </p>
            )}
            {preview.missingEmployee > 0 && (
              <p className="flex items-start gap-2 text-support-warning">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="text-foreground">{preview.missingEmployee} kết quả không tìm thấy thông tin nhân viên; dòng vẫn có trong file, kèm ghi chú.</span>
              </p>
            )}
            {(preview.drafts > 0 || preview.unitResults > 0) && (
              <p className="flex items-start gap-2 text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {[preview.drafts > 0 ? `${preview.drafts} bản tạm tính` : null, preview.unitResults > 0 ? `${preview.unitResults} kết quả bộ phận/công ty` : null].filter(Boolean).join(' và ')} không có trong file.
              </p>
            )}
            {cycle.status === 'Closed' && <p className="text-muted-foreground">Chu kỳ đã đóng nhưng vẫn xuất file lương được.</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {mayExport ? (
            <>
              <Button
                onClick={() => exportPayroll.mutate(period.id)}
                disabled={!preview || preview.exportable === 0 || exportPayroll.isPending}
                aria-busy={exportPayroll.isPending || undefined}
              >
                <FileSpreadsheet className="mr-1.5 h-4 w-4" aria-hidden />
                {exportPayroll.isPending ? 'Đang tạo file…' : 'Xuất file lương'}
              </Button>
              {preview && preview.exportable === 0 && <span className="text-sm text-muted-foreground">Chưa có kết quả đã chốt để xuất.</span>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Chỉ C&B xuất file lương.</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Dữ liệu giả lập: thang xếp loại và bảng quy đổi là mẫu (giả định Q2), không dùng để trả lương thật.</p>
      </section>

      <section className="space-y-3">
        <SectionTitle icon={Download} title="Lịch sử xuất file">
          Mỗi lần xuất là một file riêng. Tệp chỉ lưu trong phiên làm việc này (dữ liệu giả lập).
        </SectionTitle>
        {downloadError && (
          <p role="alert" className="text-sm text-support-negative">
            {downloadError.title}.{downloadError.message ? ` ${downloadError.message}` : ''}
          </p>
        )}
        <DataTable label="Lịch sử xuất file" columns={columns} rows={exports.data} query={exports} getRowId={(e) => e.id} empty="Chưa xuất file nào cho kỳ này." pageSize={null} />
      </section>
    </div>
  );
}
