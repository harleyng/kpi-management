import { useRef, useState, type ReactNode } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineNotice } from '@/components/shared/InlineNotice';
import type { ImportRowError, ImportRowsByType, ImportType } from '@/data/types';
import { ERROR_CATALOG } from '@/lib/errorCatalog';
import { readSheet } from '@/lib/excel';
import { importError, parseSheet, type ImportTemplateSpec } from '@/lib/importRules';

export interface ParsedUpload<K extends ImportType> {
  file: File;
  rows: ImportRowsByType[K][];
  /** File and cell problems found while reading — any → the file is not staged. */
  errors: ImportRowError[];
}

/**
 * Stages 1–2 of every import (WBS 4.4.3): download the template, choose a file, read it into typed
 * rows (`excel.readSheet` + `importRules.parseSheet`). The caller decides what to do with the result —
 * show the local errors, or stage it. A file that is not a workbook comes back as FILE_UNREADABLE.
 * Shared by T1, T2, T3: pass the type's spec and template builder.
 */
export function ImportUploadCard<K extends ImportType>({
  spec,
  onDownloadTemplate,
  templateControls,
  onParsed,
  canUpload,
  notReady = null,
  busy,
}: {
  spec: ImportTemplateSpec<K>;
  /** Builds and downloads the template (pre-filled when the type can). */
  onDownloadTemplate: () => Promise<void>;
  /** What the template is built for, e.g. the month — shown beside "Tải mẫu". */
  templateControls?: ReactNode;
  onParsed: (result: ParsedUpload<K>) => void;
  canUpload: boolean;
  /** Why the upload cannot start yet (e.g. no cycle chosen) — shown beside the button. */
  notReady?: string | null;
  /** Staging is under way. */
  busy: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [templateFailed, setTemplateFailed] = useState(false);

  const read = async (file: File) => {
    setReading(true);
    try {
      const matrix = await readSheet(await file.arrayBuffer());
      const parsed = parseSheet(spec, matrix);
      onParsed({ file, rows: parsed.rows, errors: parsed.errors });
    } catch {
      onParsed({ file, rows: [], errors: [importError(1, null, 'FILE_UNREADABLE')] });
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  };

  const download = async () => {
    setDownloading(true);
    setTemplateFailed(false);
    try {
      await onDownloadTemplate();
    } catch {
      setTemplateFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-surface-alt p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap items-end gap-2">
          {templateControls}
          <Button type="button" variant="outline" onClick={() => void download()} disabled={downloading}>
            <Download className="mr-2 h-4 w-4" aria-hidden />
            {downloading ? 'Đang tạo mẫu…' : 'Tải mẫu'}
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            id={`upload-${spec.importType}`}
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void read(file);
            }}
          />
          <Button type="button" onClick={() => input.current?.click()} disabled={!canUpload || notReady !== null || reading || busy}>
            <Upload className="mr-2 h-4 w-4" aria-hidden />
            {reading ? 'Đang đọc tệp…' : busy ? 'Đang kiểm tra…' : 'Tải tệp lên'}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Tệp .xlsx theo mẫu, tối đa {spec.maxRows.toLocaleString('vi-VN')} dòng. Hệ thống kiểm tra từng dòng trước; chỉ khi bạn bấm Ghi nhận thì số liệu mới được ghi, và ghi cả lô hoặc không ghi gì.
      </p>
      {canUpload && notReady && <p className="text-sm text-muted-foreground">{notReady}</p>}
      {!canUpload && (
        <InlineNotice tone="info" title={ERROR_CATALOG['ERR-KPI-05'].title}>
          Bạn chỉ xem được các lô import. Liên hệ HR hoặc Quản trị viên để tải tệp lên.
        </InlineNotice>
      )}
      {templateFailed && (
        <InlineNotice tone="negative" title="Không tạo được tệp mẫu" alert>
          {ERROR_CATALOG['ERR-KPI-01'].message}
        </InlineNotice>
      )}
    </div>
  );
}
