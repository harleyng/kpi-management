import { useId, useState } from 'react';
import { ExternalLink, FileText, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Evidence, Id } from '@/data/types';
import { useAttachEvidence, useOpenFile } from '@/hooks/queries/actuals';
import { formatDateTime } from '@/lib/utils';
import { toastError } from './toastError';

interface EvidenceAttachProps {
  goalId: Id;
  periodId: Id;
  /** Names the control for a screen reader ("Bằng chứng — Doanh thu"). */
  goalName: string;
  evidence: readonly Evidence[];
  /** `can('evidence.upload', owner)` on an open form — else the list is read-only. */
  canAdd: boolean;
}

const isWebLink = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * The evidence of one goal in one period (plan §5.5, BR-KPI-17): "N bằng chứng" opens the list, and —
 * for someone who may upload — a small form to attach a file or a link. Shared with T4's evidence
 * management (WBS 4.4.6), which adds removal.
 */
export function EvidenceAttach({ goalId, periodId, goalName, evidence, canAdd }: EvidenceAttachProps) {
  const id = useId();
  const attach = useAttachEvidence();
  const openFile = useOpenFile();
  const [kind, setKind] = useState<'file' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const linkError = kind === 'link' && tried && !isWebLink(url.trim()) ? 'Liên kết phải bắt đầu bằng http:// hoặc https://.' : null;
  const fileError = kind === 'file' && tried && file === null ? 'Chọn một tệp để đính kèm.' : null;

  const submit = () => {
    setTried(true);
    if (kind === 'file' ? file === null : !isWebLink(url.trim())) return;
    const common = { goalId, periodId, note: note.trim() === '' ? null : note.trim() };
    attach.mutate(kind === 'file' ? { ...common, kind, file: file! } : { ...common, kind, url: url.trim() }, {
      onSuccess: () => {
        toast.success('Đã thêm bằng chứng');
        setFile(null);
        setUrl('');
        setNote('');
        setTried(false);
      },
      onError: toastError,
    });
  };

  const open = (item: Evidence) => {
    if (item.fileId) {
      openFile.mutate(item.fileId);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" aria-label={`Bằng chứng — ${goalName}: ${evidence.length}`}>
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          <span className="tabular">{evidence.length}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="text-sm font-medium">Bằng chứng — {goalName}</p>
        {evidence.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có bằng chứng cho kỳ này.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {evidence.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-start gap-1.5 text-primary underline-offset-2 hover:underline">
                    <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="break-all">{item.note ?? item.url}</span>
                  </a>
                ) : (
                  <button type="button" onClick={() => open(item)} className="flex min-w-0 items-start gap-1.5 text-left text-primary underline-offset-2 hover:underline">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="break-words">{item.note ?? 'Tệp đính kèm'}</span>
                  </button>
                )}
                <span className="tabular ml-auto shrink-0 text-xs text-muted-foreground">{formatDateTime(item.uploadedAt)}</span>
              </li>
            ))}
          </ul>
        )}

        {canAdd && (
          <div className="space-y-2 border-t pt-3">
            <div role="group" aria-label="Loại bằng chứng" className="flex gap-1">
              {(['file', 'link'] as const).map((k) => (
                <Button key={k} type="button" size="sm" variant={kind === k ? 'secondary' : 'ghost'} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {k === 'file' ? 'Tệp' : 'Liên kết'}
                </Button>
              ))}
            </div>
            {kind === 'file' ? (
              <div className="space-y-1">
                <Label htmlFor={`${id}-file`}>Tệp</Label>
                <Input id={`${id}-file`} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-invalid={fileError ? true : undefined} />
                {fileError && <p role="alert" className="text-xs text-support-negative">{fileError}</p>}
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor={`${id}-url`}>Liên kết</Label>
                <Input id={`${id}-url`} type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={linkError ? true : undefined} />
                {linkError && <p role="alert" className="text-xs text-support-negative">{linkError}</p>}
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor={`${id}-note`}>Ghi chú</Label>
              <Input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button size="sm" onClick={submit} disabled={attach.isPending} aria-busy={attach.isPending || undefined}>
              Thêm bằng chứng
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
