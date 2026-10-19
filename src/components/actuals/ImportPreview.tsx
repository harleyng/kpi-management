import { useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { InlineNotice } from '@/components/shared/InlineNotice';
import type { ImportRowError } from '@/data/types';
import { errorsByRow, previewOrder } from '@/lib/importRules';
import { issueText } from '@/lib/errorCatalog';

/** A settled, static list — the preview reads no query of its own. */
const SETTLED = { isPending: false, fetchStatus: 'idle', error: null, refetch: () => undefined } as const;

/**
 * The preview of an import (WBS 4.4.3, BR-KPI-54) — the same for every import type and both moments:
 * - `source: 'local'` — the file was read in the browser and has problems; it was NOT sent. A banner
 *   says so and there is nothing to confirm;
 * - `source: 'batch'` — a staged batch as the system stored it (errors from the row validation, or
 *   from a refused commit via `extraErrors`).
 * File-level problems (row 1: a missing header, an empty file) replace the table. Rows with errors come
 * first, "Chỉ dòng lỗi" keeps only them; every error names its column and says what is wrong; warnings
 * (never blocking) show in the same column. The type's own columns come from `columns`.
 */
export function ImportPreview<R extends { rowNo: number }>({
  source,
  rows,
  errors,
  columns,
  warnings,
  extraErrors = [],
  summary,
  footer,
}: {
  source: 'local' | 'batch';
  rows: readonly R[];
  errors: readonly ImportRowError[];
  columns: DataTableColumn<R>[];
  warnings?: ReadonlyMap<number, string[]>;
  /** Row problems found after staging (a refused commit) — marked on top of the stored ones. */
  extraErrors?: readonly ImportRowError[];
  /** The batch's own heading (file, status, who, when). */
  summary?: ReactNode;
  /** Actions, shown under the table with the reason they are blocked. */
  footer?: ReactNode;
}) {
  const allErrors = useMemo(() => [...errors, ...extraErrors], [errors, extraErrors]);
  const fileErrors = allErrors.filter((e) => e.rowNo === 1 && !rows.some((r) => r.rowNo === 1));
  const rowErrors = useMemo(() => errorsByRow(allErrors.filter((e) => !fileErrors.includes(e))), [allErrors, fileErrors]);
  const [onlyErrors, setOnlyErrors] = useState(rowErrors.size > 0);
  const ordered = useMemo(() => previewOrder(rows, [...rowErrors.keys()].map((rowNo) => ({ rowNo })), onlyErrors), [rows, rowErrors, onlyErrors]);

  const statusColumn: DataTableColumn<R> = {
    id: 'status',
    header: 'Kết quả kiểm tra',
    className: 'min-w-72',
    cell: (row) => {
      const list = rowErrors.get(row.rowNo);
      const notes = warnings?.get(row.rowNo) ?? [];
      if (list) {
        return (
          <ul className="space-y-1">
            {list.map((e, i) => (
              <li key={i} className="flex gap-1.5 text-support-negative">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="text-foreground">
                  <span className="font-medium">{e.column ?? 'Cả dòng'}:</span> {issueText(e.detail, e.code)}
                </span>
              </li>
            ))}
          </ul>
        );
      }
      return (
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-support-positive" aria-hidden />
            Hợp lệ
          </span>
          {notes.map((n, i) => (
            <p key={i} className="flex gap-1.5 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-support-warning" aria-hidden />
              <span>{n}</span>
            </p>
          ))}
        </div>
      );
    },
  };
  const rowNoColumn: DataTableColumn<R> = { id: 'rowNo', header: 'Dòng', numeric: true, className: 'w-16', cell: (r) => r.rowNo };

  return (
    <div className="space-y-3">
      {source === 'local' && (
        <InlineNotice tone="negative" title="Chưa gửi lên hệ thống: sửa tệp rồi tải lên lại" alert>
          Tệp có lỗi nên chưa tạo lô import. Không có số liệu nào được ghi.
        </InlineNotice>
      )}
      {summary}
      {fileErrors.length > 0 ? (
        <InlineNotice tone="negative" title="Tệp không đúng mẫu">
          <ul className="list-disc space-y-0.5 pl-4">
            {fileErrors.map((e, i) => (
              <li key={i}>
                {e.column ? <span className="font-medium">{e.column}: </span> : null}
                {issueText(e.detail, e.code)}
              </li>
            ))}
          </ul>
        </InlineNotice>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="tabular">
              <span className="font-medium">{rows.length}</span> dòng,{' '}
              <span className={rowErrors.size > 0 ? 'font-medium text-support-negative' : 'font-medium'}>{rowErrors.size}</span> dòng lỗi
              {warnings && warnings.size > 0 && (
                <>
                  , <span className="font-medium">{warnings.size}</span> dòng cần xem lại
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              <Switch id="only-errors" checked={onlyErrors} onCheckedChange={setOnlyErrors} disabled={rowErrors.size === 0} />
              <Label htmlFor="only-errors">Chỉ dòng lỗi</Label>
            </div>
          </div>
          <DataTable
            label="Xem trước dữ liệu import"
            columns={[rowNoColumn, ...columns, statusColumn]}
            rows={ordered}
            query={SETTLED}
            getRowId={(r) => String(r.rowNo)}
            empty="Không có dòng nào."
            pageSize={50}
            pageResetKey={onlyErrors}
          />
        </>
      )}
      {footer && <div className="sticky bottom-0 z-10 -mx-1 border-t bg-background px-1 py-3">{footer}</div>}
    </div>
  );
}
