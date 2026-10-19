import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, FileText, Link2, Paperclip, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { FormField } from '@/components/shared/FormField';
import type { Evidence, Id } from '@/data/types';
import { useAddEvidence, useDeleteEvidence, useEvidence, useFileObject, useOpenFile } from '@/hooks/queries/actuals';
import { useUserAccounts } from '@/hooks/queries/org';
import { isEvidenceUrl } from '@/lib/actualRules';
import { errorSpecOf, ISSUE_DETAIL_COPY } from '@/lib/errorCatalog';
import { loadPhase } from '@/lib/queryState';
import { formatDateTime } from '@/lib/utils';

/**
 * Evidence for one goal in one month (WBS 4.4.6, BR-KPI-57): files and links, who added them and
 * when; add a link or a file, remove one. `canEdit` is the viewer's `evidence.upload` on the goal's
 * owner — without it the list is read-only. Track T5's evaluation form reuses this panel.
 */
export function EvidencePanel({ goalId, periodId, actualId = null, canEdit }: { goalId: Id; periodId: Id; actualId?: Id | null; canEdit: boolean }) {
  const evidence = useEvidence({ goalId, periodId });
  const users = useUserAccounts();
  const names = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.displayName])), [users.data]);
  const [removing, setRemoving] = useState<Evidence | null>(null);
  const remove = useDeleteEvidence();
  const phase = loadPhase(evidence, evidence.data !== undefined);

  return (
    <section aria-labelledby="evidence-title" className="space-y-3">
      <h3 id="evidence-title" className="text-sm font-semibold">
        Bằng chứng
      </h3>
      {phase === 'error' && <ErrorState spec={errorSpecOf(evidence.error)} onAction={() => void evidence.refetch()} />}
      {phase === 'loading' && <Skeleton className="h-12 w-full" />}
      {phase === 'ready' &&
        (evidence.data && evidence.data.length > 0 ? (
          <ul className="divide-y rounded-md border">
            {evidence.data.map((e) => (
              <EvidenceItem key={e.id} evidence={e} uploader={names.get(e.uploadedBy) ?? null} onRemove={canEdit ? () => setRemoving(e) : undefined} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Chưa có bằng chứng cho kỳ này.</p>
        ))}
      {canEdit && <AddEvidenceForm goalId={goalId} periodId={periodId} actualId={actualId} />}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Xóa bằng chứng này?"
        body="Bằng chứng sẽ bị gỡ khỏi chỉ tiêu trong kỳ. Thao tác được ghi vào nhật ký."
        confirmLabel="Xóa bằng chứng"
        destructive
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
          setRemoving(null);
        }}
      />
    </section>
  );
}

function EvidenceItem({ evidence, uploader, onRemove }: { evidence: Evidence; uploader: string | null; onRemove?: () => void }) {
  const file = useFileObject(evidence.fileId);
  const open = useOpenFile();
  const label = evidence.fileId ? (file.data?.fileName ?? 'Tệp đính kèm') : (evidence.url ?? '');
  return (
    <li className="flex items-start gap-3 px-3 py-2.5 text-sm">
      {evidence.fileId ? <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      <div className="min-w-0 flex-1 space-y-0.5">
        {evidence.fileId ? (
          <button type="button" className="max-w-full truncate text-left font-medium text-primary underline-offset-4 hover:underline" onClick={() => open.mutate(evidence.fileId as Id)}>
            {label}
          </button>
        ) : (
          <a href={evidence.url ?? undefined} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
            <span className="truncate">{label}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </a>
        )}
        {evidence.note && <p className="text-muted-foreground">{evidence.note}</p>}
        <p className="text-xs text-muted-foreground">
          {uploader ?? 'Không rõ người thêm'}, {formatDateTime(evidence.uploadedAt)}
        </p>
      </div>
      {onRemove && (
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onRemove} aria-label={`Xóa bằng chứng ${label}`}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </li>
  );
}

function AddEvidenceForm({ goalId, periodId, actualId }: { goalId: Id; periodId: Id; actualId: Id | null }) {
  const [kind, setKind] = useState<'url' | 'file'>('url');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const add = useAddEvidence();
  const urlError = kind === 'url' && touched && !isEvidenceUrl(url) ? ISSUE_DETAIL_COPY.EVIDENCE_URL_INVALID : undefined;
  const ready = kind === 'url' ? isEvidenceUrl(url) : file !== null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!ready) return;
    const common = { goalId, periodId, actualId, note: note.trim() === '' ? null : note.trim() };
    add.mutate(kind === 'url' ? { ...common, url: url.trim() } : { ...common, file: file as File }, {
      onSuccess: () => {
        setUrl('');
        setFile(null);
        setNote('');
        setTouched(false);
        if (fileInput.current) fileInput.current.value = '';
      },
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-md border bg-surface-alt p-3" aria-label="Thêm bằng chứng">
      <div className="flex gap-1" role="radiogroup" aria-label="Loại bằng chứng">
        {(['url', 'file'] as const).map((k) => (
          <Button key={k} type="button" size="sm" variant={kind === k ? 'secondary' : 'ghost'} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
            {k === 'url' ? <Link2 className="mr-1.5 h-4 w-4" aria-hidden /> : <Paperclip className="mr-1.5 h-4 w-4" aria-hidden />}
            {k === 'url' ? 'Đường dẫn' : 'Tệp'}
          </Button>
        ))}
      </div>
      {kind === 'url' ? (
        <FormField label="Đường dẫn" error={urlError}>
          {(control) => <Input {...control} type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => setTouched(true)} />}
        </FormField>
      ) : (
        <FormField label="Tệp" hint="Bản demo giữ tệp trong phiên làm việc; tải lại trang thì tệp không mở được nữa.">
          {(control) => <Input {...control} ref={fileInput} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
        </FormField>
      )}
      <FormField label="Ghi chú">
        {(control) => <Input {...control} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={add.isPending}>
          {add.isPending ? 'Đang thêm…' : 'Thêm bằng chứng'}
        </Button>
      </div>
    </form>
  );
}
