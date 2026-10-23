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
  type EvaluationColumn,
  type EvaluationItem,
  type Goal,
  type Id,
} from '@/data/types';
import { useEvidence } from '@/hooks/queries/actuals';
import { useEvaluationItems, useSaveEvaluationItems, type UnsavedEdits } from '@/hooks/queries/forms';
import { useGoalRows, useTargetLevels } from '@/hooks/queries/goals';
import { useCalcMethods, useCalcTiers, useMeasureUnits } from '@/hooks/queries/library';
import { ERROR_CATALOG, errorSpecOf, type RuleIssue } from '@/lib/errorCatalog';
import {
  COLUMN_FIELDS,
  SYSTEM_COLUMN,
  canSubmit,
  columnComment,
  columnPct,
  computedItemAchievement,
  evaluationTotal,
  sameActual,
  samePct,
  validateScoreInput,
  withFormActual,
  type ItemCalcContext,
} from '@/lib/formRules';
import { parseNumberCell } from '@/lib/importRules';
import { submitCheckInput } from '@/lib/formViewRules';
import { totalWeight } from '@/lib/goalPlanRules';
import { combineQueries } from '@/lib/queryState';
import { formatNumber, formatPercent } from '@/lib/utils';
import { FormActionBar } from './FormActionBar';
import { formatInUnit } from './formCopy';
import { GoalTarget } from './GoalTarget';
import type { FormDetail } from './useFormDetail';

/** What the user typed on a row — text, so "85,5" can be typed as it reads; `actual` is the form's actual (PEND-06). */
type Draft = { pct?: string; comment?: string; actual?: string };

/** The % columns as the form names them: the SELF % is the system's (PEND-07), the FINAL one HR's record (PEND-08). */
const COLUMN_HEADER: Record<EvaluationColumn, string> = { SELF: 'Hệ thống tính', MANAGER: 'Quản lý đánh giá', FINAL: 'HR ghi nhận' };
/** The columns whose step may change the actual on the form. */
const ACTUAL_COLUMNS: readonly EvaluationColumn[] = ['SELF', 'MANAGER'];

/** A typed actual: text for a TEXT goal; for a number "1.250.000" or "12,5" — blank clears it, anything unreadable is NaN. */
function parseActual(text: string, goal: Goal | undefined): { actualValue: number | null; actualText: string | null } {
  if (goal?.targetType === 'TEXT') return { actualValue: null, actualText: text.trim() === '' ? null : text };
  const parsed = parseNumberCell(text);
  return { actualValue: parsed.ok ? parsed.value : Number.NaN, actualText: null };
}

/** The actual as an input shows it before anyone types ("12,5", "1250000"). */
const actualInputText = (item: EvaluationItem) => item.actualText ?? (item.actualValue === null ? '' : String(item.actualValue).replace('.', ','));

/** "85,5" → 85.5; "" → null; anything else → NaN (refused before it is sent). */
function parsePct(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

const ROW_ISSUE: Record<string, string> = {
  SCORE_MISSING: 'Chưa chấm điểm',
  COMMENT_MISSING: 'Chưa nhận xét',
  OVERRIDE_COMMENT_REQUIRED: 'Khác % hệ thống tính — cần nhận xét',
  ACTUAL_CHANGE_COMMENT_REQUIRED: 'Đã sửa số thực tế của nhân viên — cần nhận xét',
  OVERRIDE_REASON_REQUIRED: 'Khác kết quả của quản lý — cần lý do',
  ACTUAL_TYPE_MISMATCH: 'Số thực tế không đúng kiểu của chỉ tiêu',
  RESULT_FINAL: 'Kết quả kỳ đã chốt — không sửa số thực tế',
  PERIOD_LOCKED: 'Kỳ đã khóa nhập số liệu',
};

/**
 * The evaluation form (plan §5.5, BR-KPI-16/17/18): one row per goal — weight, the period's target and
 * levels, the actual on the form, the three % columns and the evidence (PEND-06/07/08):
 * - the employee (SELF step) enters the actual and explains; the % beside it is the system's
 *   (`formRules.computedItemAchievement`), recomputed as they type — never typed;
 * - the manager may correct the actual and decides the % (prefilled with the system's; a different
 *   one, or a corrected actual, needs a comment);
 * - HR records the manager's % (prefilled; a different one needs a reason).
 * Only the current step's column is editable, and only when `formStanding.canEdit`. The totals come
 * from `formRules.evaluationTotal`, the blockers from `canSubmit` on what is on screen — the same
 * check the gateway runs (`submitCheckInput`).
 */
export function EvaluationFormBody({ detail, title }: { detail: FormDetail; title: string }) {
  const { can, user } = useSession();
  const form = detail.form!;
  const standing = detail.standing!;
  const planId = form.goalPlanId;
  const itemsQuery = useEvaluationItems(form.id);
  const goalsQuery = useGoalRows({ goalPlanIds: planId ? [planId] : [] }, { enabled: planId !== null });
  const levelsQuery = useTargetLevels(planId ? { goalPlanId: planId } : null);
  const methods = useCalcMethods();
  const tiers = useCalcTiers();
  const units = useMeasureUnits();
  const evidence = useEvidence({ periodId: form.periodId ?? undefined }, { enabled: form.periodId !== null });
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

  const calcOf = useMemo(
    () =>
      (goal: Goal): ItemCalcContext => ({
        goal,
        method: methodById.get(goal.calcMethodId) ?? null,
        tiers: tiers.data ?? [],
        levels: levelsQuery.data ?? [],
      }),
    [methodById, tiers.data, levelsQuery.data],
  );

  /** The typed actual of a row, or `null` when it was not touched or cannot be read. */
  const typedActual = (item: EvaluationItem) => {
    const d = rows[item.id];
    if (d?.actual === undefined) return null;
    const actual = parseActual(d.actual, goalById.get(item.goalId));
    return Number.isNaN(actual.actualValue) ? null : actual;
  };

  /** The items as they are on screen: the stored row with the user's edits applied, the system's % recomputed. */
  const effective: EvaluationItem[] = useMemo(() => {
    if (!items || !column) return items ?? [];
    const { pct, comment } = COLUMN_FIELDS[column];
    return items.map((item) => {
      const d = rows[item.id];
      if (!d) return item;
      const goal = goalById.get(item.goalId);
      let next: EvaluationItem = item;
      const actual = d.actual !== undefined ? parseActual(d.actual, goal) : null;
      if (actual && !Number.isNaN(actual.actualValue) && goal && !sameActual(actual, item)) {
        const computed = computedItemAchievement({ ...item, ...actual }, calcOf(goal));
        next = withFormActual(item, actual, computed.status === 'SCORED' ? computed.pct : null, user.id);
      }
      return {
        ...next,
        ...(d.pct !== undefined && column !== SYSTEM_COLUMN ? { [pct]: parsePct(d.pct) } : {}),
        ...(d.comment !== undefined ? { [comment]: d.comment.trim() === '' ? null : d.comment } : {}),
      };
    });
  }, [items, rows, column, goalById, calcOf, user.id]);

  const cellIssue = (item: EvaluationItem): string | null => {
    const d = rows[item.id];
    if (!column || d?.pct === undefined) return null;
    const value = parsePct(d.pct);
    if (value !== null && Number.isNaN(value)) return 'Nhập một số, ví dụ 85,5.';
    const goal = goalById.get(item.goalId);
    const issue = goal ? validateScoreInput(value, methodById.get(goal.calcMethodId) ?? null, calcOf(goal)) : null;
    return issue ? `Từ ${issue.data?.min ?? 0}${issue.data?.max !== undefined ? ` đến ${issue.data.max}` : ''}%.` : null;
  };
  const actualIssue = (item: EvaluationItem): string | null => {
    const d = rows[item.id];
    if (d?.actual === undefined) return null;
    return Number.isNaN(parseActual(d.actual, goalById.get(item.goalId)).actualValue) ? 'Nhập một số, ví dụ 1.250.000 hoặc 12,5.' : null;
  };
  const invalid = effective.some((item) => cellIssue(item) !== null || actualIssue(item) !== null);

  /** Only what was typed: the actual, the column's % (never the system's), the comment. */
  const patches = () =>
    column
      ? Object.keys(rows).map((itemId) => {
          const d = rows[itemId];
          const item = effective.find((i) => i.id === itemId)!;
          const { pct, comment } = COLUMN_FIELDS[column];
          const actual = d.actual !== undefined ? typedActual(item) : null;
          return {
            itemId,
            ...(actual ? { actualValue: actual.actualValue, actualText: actual.actualText } : {}),
            ...(d.pct !== undefined && column !== SYSTEM_COLUMN ? { [pct]: item[pct] } : {}),
            ...(d.comment !== undefined ? { [comment]: item[comment] } : {}),
          };
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

  const query = combineQueries([itemsQuery, goalsQuery, levelsQuery, methods, tiers, units, evidence]);
  if (query.error != null) {
    return (
      <Card>
        <CardContent className="p-0">
          <ErrorState spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />
        </CardContent>
      </Card>
    );
  }
  if (!items || !goals || !levelsQuery.data || !units.data || !methods.data || !tiers.data || (form.periodId && !evidence.data)) {
    return <Skeleton className="h-64 w-full" />;
  }

  const evidenceOf = (goalId: Id) => (evidence.data ?? []).filter((e) => e.goalId === goalId);
  const canAddEvidence = form.periodId !== null && standing.readOnlyReason !== 'CLOSED' && can('evidence.upload', detail.resource);
  const itemGoals = effective.map((i) => goalById.get(i.goalId)).filter((g): g is Goal => g !== undefined);
  const totals = Object.fromEntries(EVALUATION_COLUMNS.map((c) => [c, evaluationTotal(effective, goals, c)])) as Record<EvaluationColumn, ReturnType<typeof evaluationTotal>>;
  const unsaved: UnsavedEdits = { evaluation: patches() };
  /** The column being filled sits next to the goal's name (it must be reachable at 768 px); the others follow in process order. */
  const readColumns = EVALUATION_COLUMNS.filter((c) => c !== column);
  const actualEditable = standing.canEdit && column !== null && ACTUAL_COLUMNS.includes(column);

  const summary = (
    <dl className="flex flex-wrap gap-x-6 gap-y-1">
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Tổng trọng số</dt>
        <dd className="tabular font-medium">{formatPercent(totalWeight(itemGoals))}</dd>
      </div>
      {EVALUATION_COLUMNS.map((c) => (
        <div key={c} className="flex gap-1.5">
          <dt className="text-muted-foreground">{COLUMN_HEADER[c]}</dt>
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
                    <TableHead className="sticky left-0 z-[1] w-48 bg-inherit text-xs">Chỉ tiêu</TableHead>
                    {column && (
                      <TableHead className="w-56 bg-primary text-xs">
                        {COLUMN_HEADER[column]} (%)<span className="sr-only"> — cột bạn đang nhập</span>
                      </TableHead>
                    )}
                    <TableHead className="w-16 text-right text-xs">Trọng số (%)</TableHead>
                    <TableHead className="w-36 text-xs">Mục tiêu kỳ / định mức</TableHead>
                    <TableHead className="w-36 text-right text-xs">Thực tế</TableHead>
                    <TableHead className="w-16 text-xs">Bằng chứng</TableHead>
                    {readColumns.map((c) => (
                      <TableHead key={c} className="w-32 text-xs">
                        {COLUMN_HEADER[c]} (%)
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
                        <TableCell className="sticky left-0 z-[1] bg-inherit px-3 py-2">
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
                              {column === SYSTEM_COLUMN ? (
                                <SystemPct item={item} goal={goal} calcOf={calcOf} />
                              ) : (
                                <>
                                  <Input
                                    id={`score-${item.id}`}
                                    inputMode="decimal"
                                    className="tabular h-8 w-24 text-right"
                                    value={rows[item.id]?.pct ?? (columnPct(item, column) === null ? '' : String(columnPct(item, column)).replace('.', ','))}
                                    onChange={(e) => setDraft(item.id, { pct: e.target.value })}
                                    aria-label={`${name} — ${COLUMN_HEADER[column]} (%)`}
                                    aria-invalid={cellIssue(item) || rowIssues.some((i) => !COMMENT_ISSUES.has(i.detail ?? '')) ? true : undefined}
                                    aria-describedby={[cellIssue(item) ? `score-err-${item.id}` : null, rowIssues.length ? markerId : null].filter(Boolean).join(' ') || undefined}
                                  />
                                  {cellIssue(item) && <p id={`score-err-${item.id}`} className="text-xs text-support-negative">{cellIssue(item)}</p>}
                                  <DefaultHint item={item} column={column} />
                                </>
                              )}
                              <Textarea
                                id={`comment-${item.id}`}
                                rows={2}
                                className="min-h-0 text-sm"
                                value={rows[item.id]?.comment ?? columnComment(item, column) ?? ''}
                                onChange={(e) => setDraft(item.id, { comment: e.target.value })}
                                aria-label={`${name} — ${COMMENT_LABEL[column]}`}
                                aria-invalid={rowIssues.some((i) => COMMENT_ISSUES.has(i.detail ?? '')) ? true : undefined}
                                aria-describedby={rowIssues.length ? markerId : undefined}
                                placeholder={COMMENT_LABEL[column]}
                              />
                              {column === 'FINAL' && <p className="text-xs text-muted-foreground">Bắt buộc nếu khác % của quản lý</p>}
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="tabular px-3 py-2 text-right">{goal ? formatNumber(goal.weight) : <MissingValue />}</TableCell>
                        <TableCell className="px-3 py-2">{goal ? <GoalTarget goal={goal} levels={levelsQuery.data} unit={unit} periodTarget={item.targetSnapshot} /> : <MissingValue />}</TableCell>
                        <TableCell className={actualEditable ? 'px-3 py-2 text-right' : 'tabular bg-surface-alt/60 px-3 py-2 text-right text-muted-foreground'}>
                          {actualEditable && goal ? (
                            <div className="flex flex-col items-end space-y-1">
                              <Input
                                id={`actual-${item.id}`}
                                inputMode={goal.targetType === 'TEXT' ? 'text' : 'decimal'}
                                className="tabular h-8 w-32 text-right"
                                value={rows[item.id]?.actual ?? actualInputText(item)}
                                onChange={(e) => setDraft(item.id, { actual: e.target.value })}
                                aria-label={`${name} — Thực tế`}
                                aria-invalid={actualIssue(item) ? true : undefined}
                                aria-describedby={actualIssue(item) ? `actual-err-${item.id}` : undefined}
                              />
                              {actualIssue(item) && <p id={`actual-err-${item.id}`} className="text-xs text-support-negative">{actualIssue(item)}</p>}
                            </div>
                          ) : (
                            (item.actualText ?? formatInUnit(item.actualValue, unit) ?? <MissingValue />)
                          )}
                          {!sameActual(item, { actualValue: item.actualSnapshot, actualText: item.actualTextSnapshot }) && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Số ban đầu: {item.actualTextSnapshot ?? formatInUnit(item.actualSnapshot, unit) ?? 'chưa có'}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="px-2 py-1.5">
                          {form.periodId && (
                            <EvidenceAttach goalId={item.goalId} periodId={form.periodId} goalName={name} evidence={evidenceOf(item.goalId)} canAdd={canAddEvidence} />
                          )}
                        </TableCell>
                        {readColumns.map((c) => (
                          <TableCell key={c} className="px-3 py-2">
                              <div className="tabular font-medium">{formatPercent(columnPct(item, c))}</div>
                              {c === 'MANAGER' && columnPct(item, c) !== null && !samePct(columnPct(item, c), item.selfAchievementPct) && (
                                <p className="text-xs text-muted-foreground">Khác hệ thống: {formatPercent(item.selfAchievementPct)}</p>
                              )}
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
          (document.getElementById(`score-${issue.ref}`) ?? document.getElementById(`comment-${issue.ref}`))?.focus();
        }}
        onActed={clear}
        engaged={engaged || dirty || serverIssues.length > 0}
      />
    </>
  );
}

const COMMENT_LABEL: Record<EvaluationColumn, string> = { SELF: 'Giải trình', MANAGER: 'Nhận xét', FINAL: 'Lý do (khi khác quản lý)' };

/** The row issues that the comment fixes, not the %. */
const COMMENT_ISSUES = new Set(['COMMENT_MISSING', 'OVERRIDE_COMMENT_REQUIRED', 'ACTUAL_CHANGE_COMMENT_REQUIRED', 'OVERRIDE_REASON_REQUIRED']);

const NOT_COMPUTABLE_COPY = 'Không tính được từ số này';

/** The system's % of the row (PEND-07), read-only: "—" with why when there is none — never 0. */
function SystemPct({ item, goal, calcOf }: { item: EvaluationItem; goal: Goal | undefined; calcOf: (goal: Goal) => ItemCalcContext }) {
  const computed = goal ? computedItemAchievement(item, calcOf(goal)) : null;
  return (
    <div aria-live="polite">
      <div className="tabular font-medium">
        <span className="sr-only">Hệ thống tính: </span>
        {computed?.status === 'SCORED' ? formatPercent(computed.pct) : <MissingValue />}
      </div>
      <p className="text-xs text-muted-foreground">
        {computed?.status === 'SCORED' ? 'Hệ thống tính từ số thực tế' : computed?.status === 'NO_ACTUAL' ? 'Chưa có số thực tế' : NOT_COMPUTABLE_COPY}
      </p>
    </div>
  );
}

/** Under the manager's / HR's input: the value it started from, when it was changed. */
function DefaultHint({ item, column }: { item: EvaluationItem; column: EvaluationColumn }) {
  const own = columnPct(item, column);
  const base = column === 'MANAGER' ? item.selfAchievementPct : column === 'FINAL' ? item.managerAchievementPct : null;
  if (column === 'SELF' || samePct(own, base)) return null;
  return (
    <p className="text-xs text-muted-foreground" aria-live="polite">
      {column === 'MANAGER' ? 'Hệ thống tính' : 'Quản lý ghi'}: {formatPercent(base)}
    </p>
  );
}
