import { useId, useRef } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@/components/shared/toastError';
import { Button } from '@/components/ui/button';
import type { FileObject } from '@/data/types';
import { useUploadFile } from '@/hooks/queries/system';
import { KpiError, errorSpecOf, toKpiError } from '@/lib/errorCatalog';
import { FILE_ACCEPT, MAX_FILE_BYTES, fileIssues } from '@/lib/fileRules';

/** "PDF, ảnh, Word, Excel, CSV; tối đa 10 MB" — the limits of `fileRules` in words. */
export const FILE_LIMITS_HINT = `PDF, ảnh, Word, Excel, CSV; tối đa ${MAX_FILE_BYTES / (1024 * 1024)} MB`;

interface FileUploadButtonProps {
  /** Called with the stored file, e.g. to attach it as evidence. */
  onUploaded: (file: FileObject) => void;
  label?: string;
  /** Narrow the formats further (`.xlsx` for an import); defaults to every accepted format. */
  accept?: string;
  disabled?: boolean;
  /** Shown under the button; `null` hides it. */
  hint?: string | null;
}

/**
 * Uploads one attachment (WBS 4.8.3) — evidence, an import file. The file is checked against
 * `fileRules` before it is sent (quick feedback) and again by the gateway (the authority); a refusal
 * is told in the catalogue's words with the reason, and the button is usable again at once.
 */
export function FileUploadButton({ onUploaded, label = 'Tải tệp lên', accept = FILE_ACCEPT, disabled = false, hint = FILE_LIMITS_HINT }: FileUploadButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const upload = useUploadFile();

  const onPick = (file: File | undefined) => {
    if (input.current) input.current.value = ''; // the same file can be picked again after a refusal
    if (!file) return;
    const issues = fileIssues({ fileName: file.name, mimeType: file.type, sizeBytes: file.size });
    if (issues.length > 0) {
      toastFileRefusal(toKpiError(issues));
      return;
    }
    upload.mutate(
      { fileName: file.name, mimeType: file.type || 'application/octet-stream', data: file },
      {
        onSuccess: (stored) => {
          toast.success('Đã tải tệp lên.');
          onUploaded(stored);
        },
        onError: toastFileRefusal,
      },
    );
  };

  return (
    <div className="space-y-1">
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onPick(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || upload.isPending}
        aria-busy={upload.isPending}
        aria-describedby={hint ? hintId : undefined}
        onClick={() => input.current?.click()}
      >
        {upload.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
        {label}
      </Button>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

const FILE_REFUSAL_REASON: Readonly<Record<string, string>> = {
  FILE_TOO_LARGE: `Tệp lớn hơn ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
  FILE_TYPE_NOT_ALLOWED: 'Định dạng tệp không được hỗ trợ.',
  FILE_EMPTY: 'Tệp không có nội dung.',
};

/** The catalogue's title, with which limit the file broke — the one thing the user can fix. */
function toastFileRefusal(error: unknown) {
  const detail = error instanceof KpiError ? error.issues[0]?.detail : undefined;
  const reason = detail ? FILE_REFUSAL_REASON[detail] : undefined;
  if (!reason) return toastError(error);
  toast.error(errorSpecOf(error).title, { description: `${reason} Chấp nhận: ${FILE_LIMITS_HINT}.` });
}
