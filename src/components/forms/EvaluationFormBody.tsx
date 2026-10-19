import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { MissingValue } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { EvidenceAttach } from '@/components/shared/EvidenceAttach';
import { toastError } from '@/components/shared/toastError';
import { useSession } from '@/contexts/useSession';
import {
  EVALUATION_COLUMNS,
  EVALUATION_COLUMN_LABEL,
  type EvaluationColumn,
  type EvaluationItem,
  type Goal,
  type Id,
} from '@/data/types';
import { useEvidence } from '@/hooks/queries/actuals';
import { useEvaluationItems, useSaveEvaluationItems, type UnsavedEdits } from '@/hooks/queries/forms';
import { useGoals, useTargetLevels } from '@/hooks/queries/goals';
import { useCalcMethods, useMeasureUnits } from '@/hooks/queries/library';
import { ERROR_CATALOG, errorSpecOf, type RuleIssue } from '@/lib/errorCatalog';
import { COLUMN_FIELDS, canSubmit, columnComment, columnPct, evaluationTotal, validateScoreInput } from '@/lib/formRules';
import { submitCheckInput } from '@/lib/formViewRules';
import { totalWeight } from '@/lib/goalPlanRules';
import { combineQueries } from '@/lib/queryState';
import { formatNumber, formatPercent } from '@/lib/utils';
import { FormActionBar } from './FormActionBar';
import { formatInUnit } from './formCopy';
import { GoalTarget } from './GoalTarget';
import type { FormDetail } from './useFormDetail';

/** What the user typed in the editable column, per item — text, so "85,5" can be typed as it reads. */
type Draft = { pct?: string; comment?: string };

/** "85,5" → 85.5; "" → null; anything else → NaN (refused before it is sent). */
function parsePct(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

const ROW_ISSUE: Record<string, string> = {
  SCORE_MISSING: 'Chưa chấm điểm',
  COMMENT_MISSING: 'Chưa nhận xét',
};

/**
 * The evaluation form (plan §5.5, BR-KPI-16/17/18): one row per goal — weight, target and levels, the
 * actual (a read-only snapshot, BR-KPI-17), the three score columns and the evidence. Only the current
 * step's column is editable, and only when `formStanding.canEdit`. The totals come from
 * `formRules.evaluationTotal`, the blockers from `canSubmit` on what is on screen — the same check the
 * gateway runs (`submitCheckInput`).
 */
export function EvaluationFormBody({ detail, title }: { detail: FormDetail; title: string }) {
  const { can } = useSession();
  const form = detail.form!;
  const standing = detail.standing!;
  const planId = form.goalPlanId;
  const itemsQuery = useEvaluationItems(form.id);
  const goalsQuery = useGoals(planId ? { goalPlanIds: [planId] } : null);
  const levelsQuery = useTargetLevels(planId ? { goalPlanId: planId } : null);
  const methods = useCalcMethods();
  const units = useMeasureUnits();
  const evidence = useEvidence(form.periodId ? { periodId: form.periodId } : null);
  const save = useSaveEvaluationItems();

  const column = standing.editColumn;
  const [drafts, setDrafts] = useState<{ column: EvaluationColumn | null; rows: Record<Id, Draft> }>({ column, rows: {} });
  const [serverIssues, setServerIssues] = useState<readonly RuleIssue[]>([]);
  /** Rows are marked once the user engages (an edit, the blocker link, a refusal) — an untouched form is not an error. */
  const [engaged, setEngaged] = useState(false);
  // Unsaved edits belong to the column they were typed in: if the step moved on, they are kept but not sent.
  const rows = useMemo(() => (drafts.column === column ? drafts.rows : {}), [drafts, column]);
  const dirty = Object.keys(rows).length > 0;

  const items = itemsQuery.data;
  const goals = goalsQuery.data;
  const goalById = useMemo(() => new Map((goals ?? []).map((g) => [g.id, g])), [goals]);
  const methodById = useMemo(() => new Map((methods.data ?? []).map((m) => [m.id, m])), [methods.data]);
  const unitById = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u])), [units.data]);

  /** The items as they are on screen: the stored row with the user's edits applied. */
  const effective: EvaluationItem[] = useMemo(() => {
    if (!items || !column) return items ?? [];
    const { pct, comment } = COLUMN_FIELDS[column];
    return items.map((item) => {
      const d = rows[item.id];
      if (!d) return item;
      return {
        ...item,
        ...(d.pct !== undefined ? { [pct]: parsePct(d.pct) } : {}),
        ...(d.comment !== undefined ? { [comment]: d.comment.trim() === '' ? null : d.comment } : {}),
      };
    });
  }, [items, rows, column]);

  const cellIssue = (item: EvaluationItem): string | null => {
    const d = rows[item.id];
    if (!column || d?.pct === undefined) return null;
    const value = parsePct(d.pct);
    if (value !== null && Number.isNaN(value)) return 'Nhập một số, ví dụ 85,5.';
    const goal = goalById.get(item.goalId);
    const issue = validateScoreInput(value, goal ? (methodById.get(goal.calcMethodId) ?? null) : null);
    return issue ? `Từ ${issue.data?.min ?? 0}${issue.data?.max !== undefined ? ` đến ${issue.data.max}` : ''}%.` : null;
  };
  const invalid = effective.some((item) => cellIssue(item) !== null);

  const patches = () =>
    column
      ? Object.keys(rows).map((itemId) => {
          const item = effective.find((i) => i.id === itemId)!;
          const { pct, comment } = COLUMN_FIELDS[column];
          return { itemId, [pct]: item[pct], [comment]: item[comment] };
        })
      : [];

  const step = standing.step;
  const forwardable = standing.actions.includes('SUBMIT') || standing.actions.includes('APPROVE');
  const check = step && goals && items && forwardable ? canSubmit(submitCheckInput(form, step, standing.steps, { goals, kgis: [], items: effective, changeItems: [] })) : null;
  const blockers = check && !check.ok ? check.issues : [];
  const issuesByRow = new Map<string, RuleIssue[]>();
  for (const issue of [...(engaged || dirty ? blockers : []), ...serverIssues]) {
    if (issue.ref) issuesByRow.set(issue.ref, [...(issuesByRow.get(issue.ref) ?? []), issue]);
  }

  const setDraft = (itemId: Id, patch: Draft) => {
    setServerIssues([]);
    setDrafts({ column, rows: { ...rows, [itemId]: { ...rows[itemId], ...patch } } });
  };
  const clear = () => setDrafts({ column, rows: {} });

  const runSave = () =>
    save.mutate(
      { formId: form.id, patches: patches() },
      {
        onSuccess: () => {
          clear();
          toast.success('Đã lưu nháp');
        },
        onError: (error) => {
          const issues = (error as { issues?: readonly RuleIssue[] }).issues ?? [];
          if (issues.length) setServerIssues(issues);
          toastError(error);
        },
      },
    );

  const query = combineQueries([itemsQuery, goalsQuery, levelsQuery, methods, units, evidence]);
  if (query.error != null) {
    return (
      <Card>
        <CardContent className="p-0">
          <ErrorState spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />
        </CardContent>
      </Card>
    );
  }
  if (!items || !goals || !levelsQuery.data || !units.data || !methods.data || (form.periodId && !evidence.data)) {
    return <Skeleton className="h-64 w-full" />;
  }

  const evidenceOf = (goalId: Id) => (evidence.data ?? []).filter((e) => e.goalId === goalId);
  const canAddEvidence = form.periodId !== null && standing.readOnlyReason !== 'CLOSED' && can('evidence.upload', detail.resource);
  const itemGoals = effective.map((i) => goalById.get(i.goalId)).filter((g): g is Goal => g !== undefined);
  const totals = Object.fromEntries(EVALUATION_COLUMNS.map((c) => [c, evaluationTotal(effective, goals, c)])) as Record<EvaluationColumn, ReturnType<typeof evaluationTotal>>;
  const unsaved: UnsavedEdits = { evaluation: patches() };
  /** The column being filled sits next to the goal's name (it must be reachable at 768 px); the others follow in process order. */
  const readColumns = EVALUATION_COLUMNS.filter((c) => c !== column);

  const summary = (
    <dl className="flex flex-wrap gap-x-6 gap-y-1">
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Tổng trọng số</dt>
        <dd className="tabular font-medium">{formatPercent(totalWeight(itemGoals))}</dd>
      </div>
      {EVALUATION_COLUMNS.map((c) => (
        <div key={c} className="flex gap-1.5">
          <dt className="text-muted-foreground">{EVALUATION_COLUMN_LABEL[c]}</dt>
          <dd className="tabular font-medium">
            {formatPercent(totals[c].score)}
            {totals[c].score !== null && !totals[c].complete && <span className="ml-1 font-normal text-muted-foreground">(tạm tính)</span>}
          </dd>
        </div>
      ))}
    </dl>
  );

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {effective.length === 0 ? (
            <EmptyState className="p-8">Phiếu chưa có chỉ tiêu nào để đánh giá.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table aria-label="Các chỉ tiêu đánh giá" className="min-w-[58rem]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="sticky left-0 z-[1] w-48 bg-background text-xs">Chỉ tiêu</TableHead>
                    {column && (
                      <TableHead className="w-56 bg-primary-subtle text-xs text-foreground">
                        {EVALUATION_COLUMN_LABEL[column]} (%)<span className="sr-only"> — cột bạn đang nhập</span>
                      </TableHead>
                    )}
                    <TableHead className="w-16 text-right text-xs">Trọng số (%)</TableHead>
                    <TableHead className="w-36 text-xs">Mục tiêu / định mức</TableHead>
                    <TableHead className="w-28 text-right text-xs">Thực tế</TableHead>
                    <TableHead className="w-16 text-xs">Bằng chứng</TableHead>
                    {readColumns.map((c) => (
                      <TableHead key={c} className="w-32 text-xs">
                        {EVALUATION_COLUMN_LABEL[c]} (%)
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {effective.map((item) => {
                    const goal = goalById.get(item.goalId);
                    const name = goal?.name ?? '—';
                    const unit = goal ? unitById.get(goal.unitId) : undefined;
                    const rowIssues = issuesByRow.get(item.id) ?? [];
                    const markerId = `row-issue-${item.id}`;
                    return (
                      <TableRow key={item.id} className="align-top hover:bg-surface-alt">
                        <TableCell className="sticky left-0 z-[1] bg-background px-3 py-2">
                          <div className="font-medium">{name}</div>
                          {rowIssues.length > 0 && (
                            <p id={markerId} className="mt-0.5 text-xs text-support-negative">
                              {[...new Set(rowIssues.map((i) => ROW_ISSUE[i.detail ?? ''] ?? ERROR_CATALOG[i.code].title))].join('. ')}
                            </p>
                          )}
                        </TableCell>
                        {column && (
                          <TableCell className="bg-primary-subtle/40 px-3 py-2">
                              <div className="space-y-1.5">
                                <Input
                                  id={`score-${item.id}`}
                                  inputMode="decimal"
                                  className="tabular h-8 w-24 text-right"
                                  value={rows[item.id]?.pct ?? (columnPct(item, column) === null ? '' : String(columnPct(item, column)).replace('.', ','))}
                                  onChange={(e) => setDraft(item.id, { pct: e.target.value })}
                                  aria-label={`${name} — ${EVALUATION_COLUMN_LABEL[column]} (%)`}
                                  aria-invalid={cellIssue(item) || rowIssues.length ? true : undefined}
                                  aria-describedby={rowIssues.length ? markerId : undefined}
                                />
                                {cellIssue(item) && <p className="text-xs text-support-negative">{cellIssue(item)}</p>}
                                <Textarea
                                  rows={2}
                                  className="min-h-0 text-sm"
                                  value={rows[item.id]?.comment ?? columnComment(item, column) ?? ''}
                                  onChange={(e) => setDraft(item.id, { comment: e.target.value })}
                                  aria-label={`${name} — ${column === 'SELF' ? 'Giải trình' : column === 'MANAGER' ? 'Nhận xét' : 'Ghi chú'}`}
                                  placeholder={column === 'SELF' ? 'Giải trình' : column === 'MANAGER' ? 'Nhận xét' : 'Ghi chú'}
                                />
                              </div>
                            </TableCell>
                        )}
                        <TableCell className="tabular px-3 py-2 text-right">{goal ? formatNumber(goal.weight) : <MissingValue />}</TableCell>
                        <TableCell className="px-3 py-2">{goal ? <GoalTarget goal={goal} levels={levelsQuery.data} unit={unit} /> : <MissingValue />}</TableCell>
                        <TableCell className="tabular bg-surface-alt/60 px-3 py-2 text-right text-muted-foreground">
                          {item.actualTextSnapshot ?? formatInUnit(item.actualSnapshot, unit) ?? <MissingValue />}
                        </TableCell>
                        <TableCell className="px-2 py-1.5">
                          {form.periodId && (
                            <EvidenceAttach goalId={item.goalId} periodId={form.periodId} goalName={name} evidence={evidenceOf(item.goalId)} canAdd={canAddEvidence} />
                          )}
                        </TableCell>
                        {readColumns.map((c) => (
                          <TableCell key={c} className="px-3 py-2">
                              <div className="tabular font-medium">{formatPercent(columnPct(item, c))}</div>
                              {columnComment(item, c) && (
                                <p className="mt-0.5 whitespace-pre-line break-words text-xs text-muted-foreground">
                                  {columnComment(item, c)}
                                </p>
                              )}
                            </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <FormActionBar
        form={form}
        formTitle={title}
        standing={standing}
        blockers={blockers}
        summary={summary}
        unsaved={unsaved}
        invalid={invalid}
        saveDraft={standing.canEdit && column ? { run: runSave, pending: save.isPending, dirty } : undefined}
        onIssues={setServerIssues}
        onFocusIssue={(issue) => {
          setEngaged(true);
          document.getElementById(`score-${issue.ref}`)?.focus();
        }}
        onActed={clear}
        engaged={engaged || dirty || serverIssues.length > 0}
      />
    </>
  );
}
