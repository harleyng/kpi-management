import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { FormField } from '@/components/shared/FormField';
import { InlineNotice } from '@/components/shared/InlineNotice';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod } from '@/data/types';
import { useActuals, useRecordActual } from '@/hooks/queries/actuals';
import { useUserAccounts } from '@/hooks/queries/org';
import type { ActualEntryRow } from '@/lib/actualEntryRules';
import { valueIssues } from '@/lib/actualRules';
import { ERROR_CATALOG, errorSpecOf, ISSUE_DETAIL_COPY, issueText } from '@/lib/errorCatalog';
import { parseNumberCell } from '@/lib/importRules';
import { resourceOfOwner } from '@/lib/permissionRules';
import { loadPhase } from '@/lib/queryState';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { ActualValue, SourceTypeTag } from './ActualValue';
import { EvidencePanel } from './EvidencePanel';

/**
 * Entering one goal's number for one month (WBS 4.4.2) — a side sheet so the table stays in view.
 * Why entry is blocked is shown before anyone types (`row.blockers`, from `actualRules.entryBlockers`);
 * the history and the evidence stay readable either way. "Lưu & chỉ tiêu kế tiếp" moves down the
 * filtered list for month-start entry.
 */
export function ActualEntrySheet({
  row,
  period,
  onClose,
  onNext,
}: {
  row: ActualEntryRow | null;
  period: CyclePeriod;
  onClose: () => void;
  /** Present when there is a next row to move to. */
  onNext?: () => void;
}) {
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-4 overflow-y-auto p-6 sm:max-w-xl">
        {row && <EntryBody key={`${row.goal.id}|${period.id}`} row={row} period={period} onNext={onNext} />}
      </SheetContent>
    </Sheet>
  );
}

function EntryBody({ row, period, onNext }: { row: ActualEntryRow; period: CyclePeriod; onNext?: () => void }) {
  const { can } = useSession();
  const { goal } = row;
  const isText = goal.targetType === 'TEXT';
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const record = useRecordActual();
  const history = useActuals({ goalIds: [goal.id], periodId: period.id, currentOnly: false });
  const users = useUserAccounts();
  const names = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.displayName])), [users.data]);

  const parsed = isText ? null : parseNumberCell(value);
  const actual = isText
    ? { actualValue: null, actualText: value.trim() === '' ? null : value }
    : { actualValue: parsed?.ok ? parsed.value : null, actualText: null };
  const valueError = !touched
    ? undefined
    : parsed && !parsed.ok
      ? ISSUE_DETAIL_COPY.CELL_NOT_NUMBER
      : valueIssues(actual, goal).map((i) => issueText(i.detail))[0];
  const textOptions = [...new Set([goal.targetText ?? 'Đạt', 'Đạt', 'Không đạt'])];
  const notEntitled = row.blockers.length === 0 && !row.canEnter;

  const save = (next: boolean) => (event?: FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    if ((parsed && !parsed.ok) || valueIssues(actual, goal).length > 0) return;
    record.mutate(
      { goalId: goal.id, periodId: period.id, ...actual, note: note.trim() === '' ? null : note },
      {
        onSuccess: () => {
          setValue('');
          setNote('');
          setTouched(false);
          if (next) onNext?.();
        },
      },
    );
  };

  const historyPhase = loadPhase(history, history.data !== undefined);
  const snapshots = [...(history.data ?? [])].sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1));

  return (
    <div className="space-y-6">
      <SheetHeader className="pr-6">
        <SheetTitle className="leading-snug">{goal.name}</SheetTitle>
        <SheetDescription>
          {row.ownerName}
          {row.orgUnit && row.orgUnit.name !== row.ownerName ? `, ${row.orgUnit.name}` : ''}, kỳ {period.label}
        </SheetDescription>
      </SheetHeader>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Mục tiêu kỳ</dt>
        <dd className="tabular">
          {row.target === null ? '—' : typeof row.target === 'number' ? formatNumber(row.target) : row.target}
          {row.measureUnit && typeof row.target === 'number' && <span className="text-muted-foreground">{row.measureUnit === '%' ? '%' : ` ${row.measureUnit}`}</span>}
        </dd>
        <dt className="text-muted-foreground">Số hiện tại</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <ActualValue actual={row.current} className="font-medium" />
          {row.current && <SourceTypeTag sourceType={row.current.sourceType} />}
        </dd>
        <dt className="text-muted-foreground">Nguồn số liệu</dt>
        <dd>{row.dataSource?.name ?? '—'}</dd>
      </dl>

      {row.blockers.length > 0 && (
        <InlineNotice tone="warning" title="Không nhập được số cho chỉ tiêu này">
          <ul className="list-disc space-y-0.5 pl-4">
            {row.blockers.map((b) => (
              <li key={b.detail}>{issueText(b.detail, b.code)}</li>
            ))}
          </ul>
        </InlineNotice>
      )}
      {notEntitled && <InlineNotice tone="info" title={ERROR_CATALOG['ERR-KPI-05'].title}>Bạn chỉ xem được số liệu của chỉ tiêu này.</InlineNotice>}

      {row.canEnter && (
        <form onSubmit={save(false)} className="space-y-4" aria-label="Nhập số thực tế">
          <FormField label={isText ? 'Kết quả' : `Giá trị thực tế${row.measureUnit ? ` (${row.measureUnit})` : ''}`} required error={valueError} hint={[isText ? null : 'Được nhập số âm. Ô trống là chưa có số, không phải 0.', row.current ? 'Số mới thay số hiện tại; số cũ còn trong lịch sử.' : null].filter(Boolean).join(' ') || undefined}>
            {(control) =>
              isText ? (
                <Select value={value || undefined} onValueChange={(v) => setValue(v)}>
                  <SelectTrigger {...control} className="w-48">
                    <SelectValue placeholder="Chọn kết quả" />
                  </SelectTrigger>
                  <SelectContent>
                    {textOptions.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input {...control} autoFocus className="tabular w-48" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setTouched(true)} />
              )
            }
          </FormField>
          <FormField label="Ghi chú">{(control) => <Textarea {...control} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</FormField>
          <div className="flex flex-wrap justify-end gap-2">
            {onNext && (
              <Button type="button" variant="outline" disabled={record.isPending} onClick={() => save(true)()}>
                Lưu và sang chỉ tiêu kế tiếp
              </Button>
            )}
            <Button type="submit" disabled={record.isPending}>
              {record.isPending ? 'Đang lưu…' : 'Lưu số liệu'}
            </Button>
          </div>
        </form>
      )}

      <section aria-labelledby="history-title" className="space-y-2">
        <h3 id="history-title" className="text-sm font-semibold">
          Lịch sử số liệu kỳ {period.label}
        </h3>
        {historyPhase === 'error' && <ErrorState spec={errorSpecOf(history.error)} onAction={() => void history.refetch()} />}
        {historyPhase === 'loading' && <Skeleton className="h-16 w-full" />}
        {historyPhase === 'ready' &&
          (snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có số nào cho kỳ này.</p>
          ) : (
            <ol className="divide-y rounded-md border text-sm">
              {snapshots.map((s) => (
                <li key={s.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <ActualValue actual={s} className={s.isCurrent ? 'font-medium' : 'text-muted-foreground line-through'} />
                    <SourceTypeTag sourceType={s.sourceType} />
                    {s.isCurrent ? <span className="text-xs font-medium text-primary">Đang dùng</span> : <span className="text-xs text-muted-foreground">Đã thay thế</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDateTime(s.recordedAt)}</span>
                  <p className="col-span-2 text-xs text-muted-foreground">
                    {s.enteredBy ? (names.get(s.enteredBy) ?? 'Không rõ người nhập') : 'Hệ thống đồng bộ'}
                    {s.note ? `: ${s.note}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          ))}
      </section>

      <EvidencePanel goalId={goal.id} periodId={period.id} actualId={row.current?.id ?? null} canEdit={can('evidence.upload', resourceOfOwner(row.plan.tenantId, row.plan))} />
    </div>
  );
}
