import { useMemo, useState } from 'react';
import { ClipboardCheck, Scale, Sigma, Target } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { MissingValue } from '@/components/shared/DataTable';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { FormActionBar } from '@/components/forms/FormActionBar';
import type { FormDetail } from '@/components/forms/useFormDetail';
import { EVALUATION_COLUMN_LABEL, type EvaluationColumn, type WorkReview, type WorkReviewItem } from '@/data/types';
import type { WorkReviewPatch } from '@/integrations/data/types';
import { useSaveWorkReview, useMonthKpiReference, useWorkPlan, useWorkReview, useWorkReviewItems, useWorkScoring, useWorkTasks } from '@/hooks/queries/work';
import { toastError } from '@/components/shared/toastError';
import { errorSpecOf, issueText, type RuleIssue } from '@/lib/errorCatalog';
import { canSubmit } from '@/lib/formRules';
import { submitCheckInput } from '@/lib/formViewRules';
import { formatDecimalInput, parseDecimalInput } from '@/lib/numberInput';
import { combineQueries } from '@/lib/queryState';
import {
  WORK_REVIEW_COLUMN_FIELDS,
  columnTotals,
  displayWorkScore,
  effectiveWeights,
  hsnvRequired,
  reviewColumnsShown,
  workScoreIssue,
  type WorkScoring,
} from '@/lib/workRules';
import { cn, formatNumber, formatPercent } from '@/lib/utils';
import { monthText } from './workCopy';

type ItemDraft = { score?: string; comment?: string };
type ReviewDraft = { discipline?: string; comment?: string; hsnv?: string; hsnvReason?: string };

const score = (v: number | null, threshold: number | null = null) => {
  const shown = displayWorkScore(v, threshold);
  return shown === null ? <MissingValue /> : <span className="tabular">{formatNumber(shown, 2)}</span>;
};

/** A typed score: blank → `null` (cleared), a number, or `NaN` (the field says so). */
const parsed = (text: string | undefined): number | null | undefined => (text === undefined ? undefined : parseDecimalInput(text));

/**
 * The monthly work review (PEND-14, plan §7; CMC NV p. 73, QL p. 129): **Kết quả công việc** (each task 0–100,
 * effective weights), **Ý thức kỷ luật** (one criterion), **Tổng hợp** (KQcv, KLcv, Hsht per column; Hsnv with
 * its reason when Hsht is below the threshold) and **KPI tháng (tham khảo)** read only. The step's column is
 * edited in place; "Lưu nháp" saves it, Gửi / Duyệt saves then acts. Every number is a `workRules` answer.
 */
export function WorkReviewFormBody({ detail, title }: { detail: FormDetail; title: string }) {
  const form = detail.form!;
  const standing = detail.standing!;
  const reviewQ = useWorkReview(form.id);
  const itemsQ = useWorkReviewItems(form.id);
  const planQ = useWorkPlan(form.workPlanId);
  const tasksQ = useWorkTasks(form.workPlanId);
  const scoringQ = useWorkScoring();
  const period = detail.lookups.period(form.periodId);
  const kpis = useMonthKpiReference(form.subjectEmployeeId, period);
  const save = useSaveWorkReview();
  const [items, setItems] = useState<Record<string, ItemDraft>>({});
  const [draft, setDraft] = useState<ReviewDraft>({});
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  const [engaged, setEngaged] = useState(false);

  const column = standing.canEdit ? standing.editColumn : null;
  const config: WorkScoring | undefined = scoringQ.data;
  const query = combineQueries([reviewQ, itemsQ, planQ, tasksQ, scoringQ]);
  const stored = reviewQ.data && itemsQ.data ? { review: reviewQ.data, items: itemsQ.data } : null;

  // What is on screen: the stored column with the user's unsaved cells laid over it.
  const onScreen = useMemo(() => {
    if (!stored || column === null) return stored;
    const f = WORK_REVIEW_COLUMN_FIELDS[column];
    const review: WorkReview = { ...stored.review };
    const d = parsed(draft.discipline);
    if (d !== undefined) review[f.discipline] = d;
    if (draft.comment !== undefined) review[f.comment] = draft.comment;
    if (f.hsnv && f.hsnvReason) {
      const h = parsed(draft.hsnv);
      if (h !== undefined) review[f.hsnv] = h;
      if (draft.hsnvReason !== undefined) review[f.hsnvReason] = draft.hsnvReason;
    }
    const rows: WorkReviewItem[] = stored.items.map((i) => {
      const e = items[i.id];
      if (!e) return i;
      const next = { ...i };
      const s = parsed(e.score);
      if (s !== undefined) next[f.score] = s;
      if (e.comment !== undefined) next[f.itemComment] = e.comment;
      return next;
    });
    return { review, items: rows };
  }, [stored, column, draft, items]);

  if (query.error != null) return <ErrorStateCard spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />;
  if (!onScreen || !tasksQ.data || !config || !planQ.data) return <Skeleton className="h-96 w-full" />;

  const tasks = tasksQ.data;
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  const weights = new Map(effectiveWeights(tasks).map((w) => [w.taskId, w.weight]));
  const renormalised = tasks.some((t) => t.cancelledAt !== null);
  const shown = reviewColumnsShown(standing.steps, standing.step?.stepNo ?? null);
  const totals = (c: EvaluationColumn) => columnTotals(c, onScreen.review, onScreen.items, tasks, config);
  const rows = [...onScreen.items].sort((a, b) => (byTask.get(a.taskId)?.sortOrder ?? 0) - (byTask.get(b.taskId)?.sortOrder ?? 0));

  // Unsaved cells → the patch "Lưu nháp" / Gửi sends. A cell that is not a number on the scale blocks both.
  const patch: WorkReviewPatch | null = (() => {
    if (column === null) return null;
    const p: WorkReviewPatch = {};
    if (draft.discipline !== undefined) p.disciplineScore = parsed(draft.discipline) ?? null;
    if (draft.comment !== undefined) p.comment = draft.comment;
    if (draft.hsnv !== undefined) p.hsnv = parsed(draft.hsnv) ?? null;
    if (draft.hsnvReason !== undefined) p.hsnvReason = draft.hsnvReason;
    const changed = Object.entries(items).map(([itemId, e]) => ({
      itemId,
      ...(e.score !== undefined ? { score: parsed(e.score) ?? null } : {}),
      ...(e.comment !== undefined ? { comment: e.comment } : {}),
    }));
    if (changed.length) p.items = changed;
    return Object.keys(p).length ? p : null;
  })();
  const typed = [draft.discipline, draft.hsnv, ...Object.values(items).map((e) => e.score)].filter((s): s is string => s !== undefined);
  // A typed cell that is not a number on the scale: marked on the cell itself, and it blocks saving.
  const bad = (s: string | undefined) => {
    if (s === undefined) return false;
    const v = parseDecimalInput(s);
    return v !== null && (Number.isNaN(v) || workScoreIssue(v, config) !== null);
  };
  const invalid = typed.some(bad);
  const scaleHint = <p className="text-xs text-support-negative">Nhập số từ {config.scoreMin} đến {config.scoreMax}.</p>;

  const forwardable = standing.actions.some((a) => a === 'SUBMIT' || a === 'APPROVE');
  const blockers: RuleIssue[] =
    standing.step && forwardable
      ? (() => {
          const check = canSubmit(
            submitCheckInput(form, standing.step, standing.steps, {
              goals: [], kgis: [], items: [], changeItems: [],
              workTasks: tasks, workReviews: [onScreen.review], workReviewItems: onScreen.items, workScoring: config,
            }),
          );
          return check.ok ? [] : check.issues;
        })()
      : [];

  const clear = () => {
    setItems({});
    setDraft({});
  };
  const saveDraft = () =>
    patch &&
    save.mutate(
      { formId: form.id, patch },
      {
        onSuccess: clear,
        onError: (e) => {
          setEngaged(true);
          toastError(e);
        },
      },
    );

  const scoreInput = (value: string, onChange: (v: string) => void, label: string, issue?: boolean) => (
    <Input
      inputMode="decimal"
      value={value}
      onChange={(e) => {
        setEngaged(true);
        onChange(e.target.value);
      }}
      aria-label={label}
      aria-invalid={issue || undefined}
      className={cn('ml-auto h-8 w-20 text-right tabular', issue && 'border-support-negative')}
    />
  );
  const f = column ? WORK_REVIEW_COLUMN_FIELDS[column] : null;
  const threshold = config.hsnvThreshold;
  const editHsnv = column !== null && column !== 'SELF' && hsnvRequired(totals(column).hsht, config);

  return (
    <>
      <Card>
        <CardContent className="space-y-3 p-4">
          <SectionTitle icon={ClipboardCheck} title={`Kết quả công việc (${formatNumber(config.resultWeight)}%)`}>
            <span className="text-sm text-muted-foreground">Tháng {monthText(period)} · mỗi việc chấm {config.scoreMin}–{config.scoreMax}</span>
          </SectionTitle>
          <div className="overflow-x-auto">
            <Table aria-label="Điểm từng việc">
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-[1] min-w-[10rem] bg-inherit">Công việc</TableHead>
                  <TableHead className="text-right">Trọng số (%)</TableHead>
                  {shown.map((c) => (
                    <TableHead key={c} className="min-w-[9rem] text-right">
                      {EVALUATION_COLUMN_LABEL[c]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((i) => {
                  const task = byTask.get(i.taskId);
                  const w = weights.get(i.taskId) ?? null;
                  return (
                    <TableRow key={i.id} className={cn(flagged.has(i.taskId) && 'bg-support-negative-subtle')}>
                      <TableCell className="sticky left-0 z-[1] bg-inherit align-top font-medium">{task?.name ?? <MissingValue />}</TableCell>
                      <TableCell className="text-right align-top tabular" title={task && w !== null && Math.abs(w - task.weight) > 1e-9 ? `Trọng số đã lập: ${formatNumber(task.weight)}%` : undefined}>
                        {formatNumber(w, 2)}
                      </TableCell>
                      {shown.map((c) => {
                        const own = WORK_REVIEW_COLUMN_FIELDS[c];
                        if (c === column && f) {
                          const e = items[i.id] ?? {};
                          return (
                            <TableCell key={c} className="text-right align-top">
                              <div className="flex flex-col items-end gap-1">
                                {scoreInput(e.score ?? formatDecimalInput(i[f.score]), (v) => setItems((all) => ({ ...all, [i.id]: { ...all[i.id], score: v } })), `${EVALUATION_COLUMN_LABEL[c]} — ${task?.name ?? ''}`, flagged.has(i.taskId) || bad(e.score))}
                                {bad(e.score) && scaleHint}
                                <Input
                                  value={e.comment ?? i[f.itemComment] ?? ''}
                                  placeholder={c === 'FINAL' ? 'Lý do (khi khác quản lý)' : 'Nhận xét'}
                                  onChange={(ev) => setItems((all) => ({ ...all, [i.id]: { ...all[i.id], comment: ev.target.value } }))}
                                  aria-label={`Nhận xét ${EVALUATION_COLUMN_LABEL[c]} — ${task?.name ?? ''}`}
                                  className="h-8 w-full min-w-[8rem] text-sm"
                                />
                              </div>
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={c} className="text-right align-top">
                            {score(i[own.score])}
                            {i[own.itemComment] && <p className="mt-0.5 text-xs text-muted-foreground">{i[own.itemComment]}</p>}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {renormalised && <p className="text-xs text-muted-foreground">Có việc đã hủy trong tháng: trọng số các việc còn lại được tính lại cho đủ 100%.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <SectionTitle icon={Scale} title={`Ý thức kỷ luật (${formatNumber(config.disciplineWeight)}%)`} />
          <Table aria-label="Điểm kỷ luật">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[10rem]">Tiêu chí</TableHead>
                {shown.map((c) => (
                  <TableHead key={c} className="min-w-[9rem] text-right">
                    {EVALUATION_COLUMN_LABEL[c]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className={cn(f && flagged.has(f.discipline) && 'bg-support-negative-subtle')}>
                <TableCell>Ý thức chấp hành kỷ luật và thái độ làm việc</TableCell>
                {shown.map((c) => {
                  const own = WORK_REVIEW_COLUMN_FIELDS[c];
                  return (
                    <TableCell key={c} className="text-right">
                      {c === column && f ? (
                        <div className="flex flex-col items-end gap-1">
                          {scoreInput(draft.discipline ?? formatDecimalInput(onScreen.review[f.discipline]), (v) => setDraft((d) => ({ ...d, discipline: v })), `Kỷ luật — ${EVALUATION_COLUMN_LABEL[c]}`, flagged.has(f.discipline) || bad(draft.discipline))}
                          {bad(draft.discipline) && scaleHint}
                        </div>
                      ) : (
                        score(onScreen.review[own.discipline])
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <SectionTitle icon={Sigma} title="Tổng hợp">
            <span className="text-sm text-muted-foreground">
              Hsht = {formatNumber(config.resultWeight)}% × KQcv + {formatNumber(config.disciplineWeight)}% × KLcv. Dưới {formatNumber(threshold)}: quản lý quyết định Hsnv kèm giải trình.
            </span>
          </SectionTitle>
          <Table aria-label="Tổng hợp điểm">
            <TableHeader>
              <TableRow>
                <TableHead>Chỉ số</TableHead>
                {shown.map((c) => (
                  <TableHead key={c} className="text-right">
                    {EVALUATION_COLUMN_LABEL[c]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(['kqcv', 'klcv', 'hsht'] as const).map((k) => (
                <TableRow key={k}>
                  <TableCell className={cn(k === 'hsht' && 'font-medium')}>{k === 'kqcv' ? 'KQcv — kết quả công việc' : k === 'klcv' ? 'KLcv — kỷ luật' : 'Hsht — hoàn thành công việc tháng'}</TableCell>
                  {shown.map((c) => (
                    <TableCell key={c} className={cn('text-right', k === 'hsht' && 'font-medium')}>
                      {score(totals(c)[k], k === 'hsht' ? threshold : null)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow>
                <TableCell>Hsnv – xếp hạng</TableCell>
                {shown.map((c) => {
                  const own = WORK_REVIEW_COLUMN_FIELDS[c];
                  const required = c !== 'SELF' && hsnvRequired(totals(c).hsht, config);
                  return (
                    <TableCell key={c} className="text-right">
                      {c === 'SELF' ? <span className="text-xs text-muted-foreground">Quản lý quyết định</span> : required && own.hsnv ? score(onScreen.review[own.hsnv]) : <span className="text-xs text-muted-foreground">Không cần</span>}
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableBody>
          </Table>
          {editHsnv && f?.hsnv && f.hsnvReason && (
            <div className={cn('grid gap-3 rounded-md border p-3 sm:grid-cols-[8rem_1fr]', flagged.has(f.hsnv) || flagged.has(f.hsnvReason) ? 'border-support-negative' : '')}>
              <div className="space-y-1">
                <label htmlFor="hsnv" className="text-sm font-medium">
                  Hsnv<span className="text-support-negative"> *</span>
                </label>
                <Input
                  id="hsnv"
                  inputMode="decimal"
                  value={draft.hsnv ?? formatDecimalInput(onScreen.review[f.hsnv])}
                  onChange={(e) => {
                    setEngaged(true);
                    setDraft((d) => ({ ...d, hsnv: e.target.value }));
                  }}
                  aria-invalid={bad(draft.hsnv) || flagged.has(f.hsnv) || undefined}
                  className={cn('h-9 text-right tabular', (bad(draft.hsnv) || flagged.has(f.hsnv)) && 'border-support-negative')}
                />
                {bad(draft.hsnv) && scaleHint}
              </div>
              <div className="space-y-1">
                <label htmlFor="hsnv-reason" className="text-sm font-medium">
                  Giải trình<span className="text-support-negative"> *</span>
                </label>
                <Textarea
                  id="hsnv-reason"
                  rows={2}
                  value={draft.hsnvReason ?? onScreen.review[f.hsnvReason] ?? ''}
                  onChange={(e) => {
                    setEngaged(true);
                    setDraft((d) => ({ ...d, hsnvReason: e.target.value }));
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Hsht dưới {formatNumber(threshold)}: Hsnv thay Hsht làm điểm tháng. Hsnv có thể cao hoặc thấp hơn Hsht — ghi rõ lý do.
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {shown.map((c) => {
              const own = WORK_REVIEW_COLUMN_FIELDS[c];
              return (
                <div key={c} className="space-y-1">
                  <p className="text-sm font-medium">Nhận xét — {EVALUATION_COLUMN_LABEL[c]}</p>
                  {c === column && f ? (
                    <Textarea
                      rows={2}
                      aria-label={`Nhận xét chung — ${EVALUATION_COLUMN_LABEL[c]}`}
                      placeholder={c === 'FINAL' ? 'Lý do khi kỷ luật hoặc Hsnv khác quản lý' : undefined}
                      value={draft.comment ?? onScreen.review[f.comment] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
                      className={cn(flagged.has('finalComment') && c === 'FINAL' && 'border-support-negative')}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">{onScreen.review[own.comment] ?? '—'}</p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <SectionTitle icon={Target} title="KPI tháng (tham khảo)">
            <span className="text-sm text-muted-foreground">Chỉ để tham khảo — không chấm, không tính vào Hsht.</span>
          </SectionTitle>
          {kpis.query.error != null ? (
            <ErrorStateCard spec={errorSpecOf(kpis.query.error)} onAction={() => void kpis.query.refetch()} />
          ) : kpis.lines === undefined ? (
            <Skeleton className="h-24 w-full" />
          ) : kpis.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nhân viên chưa có Goal Plan đã duyệt trong chu kỳ của tháng này.</p>
          ) : (
            <Table aria-label="KPI tháng (tham khảo)">
              <TableHeader>
                <TableRow>
                  <TableHead>Chỉ tiêu</TableHead>
                  <TableHead className="text-right">Thực tế</TableHead>
                  <TableHead className="text-right">Mục tiêu tháng</TableHead>
                  <TableHead className="text-right">Hoàn thành</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kpis.lines.map((l) => (
                  <TableRow key={l.goalId}>
                    <TableCell>
                      {l.name}
                      {l.targetSource === 'GOAL' && <p className="text-xs text-muted-foreground">Chưa phân bổ theo tháng — dùng mục tiêu chung của chỉ tiêu.</p>}
                      {l.targetSource === 'DERIVED' && <p className="text-xs text-muted-foreground">Suy ra từ mục tiêu quý / năm đã phân bổ.</p>}
                    </TableCell>
                    <TableCell className="text-right tabular">{l.actualValue !== null ? formatNumber(l.actualValue) : l.actualText ?? <span className="text-muted-foreground">Chưa có số</span>}</TableCell>
                    <TableCell className="text-right tabular">{formatNumber(l.target)}</TableCell>
                    <TableCell className="text-right tabular">{l.achievementPct !== null ? formatPercent(l.achievementPct) : <span className="text-muted-foreground">Chưa có số</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <FormActionBar
        form={form}
        formTitle={title}
        standing={standing}
        blockers={blockers}
        engaged={engaged}
        invalid={invalid}
        unsaved={patch ? { workReview: patch } : undefined}
        saveDraft={column ? { run: saveDraft, pending: save.isPending, dirty: patch !== null } : undefined}
        describeBlockers={(issues) => [...new Set(issues.map((i) => issueText(i.detail, i.code)))]}
        onIssues={(issues) => {
          setEngaged(true);
          setFlagged(new Set(issues.map((i) => i.ref).filter((r): r is string => r !== null)));
        }}
        onActed={clear}
        summary={
          column ? (
            <span>
              Hsht ({EVALUATION_COLUMN_LABEL[column]}): <span className="font-medium">{score(totals(column).hsht, threshold)}</span>
              {editHsnv && (
                <button
                  type="button"
                  className="ml-2 text-sm font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    const el = document.getElementById('hsnv');
                    el?.scrollIntoView({ block: 'center' });
                    el?.focus();
                  }}
                >
                  Nhập Hsnv
                </button>
              )}
            </span>
          ) : undefined
        }
      />
    </>
  );
}
