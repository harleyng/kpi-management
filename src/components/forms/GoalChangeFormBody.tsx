import { useId, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { MissingValue } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { KpiPicker } from '@/components/shared/KpiPicker';
import { toastError } from '@/components/shared/toastError';
import { GOAL_CHANGE_TYPE_LABEL, type Goal, type GoalChangeItem, type Id, type MeasureUnit } from '@/data/types';
import type { ChildInput } from '@/integrations/data/types';
import { useDataSources } from '@/hooks/queries/actuals';
import { useGoalChangeItems, useSaveGoalChangeItems } from '@/hooks/queries/forms';
import { useGoalRows, useKgis, useTargetLevels } from '@/hooks/queries/goals';
import { useKpiDefinitions, useMeasureUnits } from '@/hooks/queries/library';
import { ERROR_CATALOG, errorSpecOf, type RuleIssue } from '@/lib/errorCatalog';
import { canSubmit } from '@/lib/formRules';
import { goalDraftFromGoal, goalDraftFromKpi, submitCheckInput } from '@/lib/formViewRules';
import { activeGoals, planAfterChanges, totalWeight } from '@/lib/goalPlanRules';
import { combineQueries } from '@/lib/queryState';
import { formatNumber, formatPercent } from '@/lib/utils';
import { FormActionBar } from './FormActionBar';
import { formatInUnit } from './formCopy';
import type { FormDetail } from './useFormDetail';

type Proposal = ChildInput<GoalChangeItem, 'formId'>;
/** A proposal row on screen; `key` keeps a row stable before the gateway gives it an id. */
type Row = Proposal & { key: string };

/** "12,5" or "12.5" → 12.5 (no digit grouping); "" → null; anything else → NaN, refused before sending. */
function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}
const showNumber = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));

/**
 * An adjustment (GOAL_CHANGE, BR-KPI-15) — a THIN proposal editor (product owner, T5 phase 1):
 * CANCEL a goal, MODIFY its weight or target, ADD a goal from the library; each with a reason. The
 * plan stays Locked and untouched until the final approval. The footer shows the plan AFTER the
 * changes (`planAfterChanges`), and the blockers are `canSubmit` on that — the gateway's own check.
 */
export function GoalChangeFormBody({ detail, title }: { detail: FormDetail; title: string }) {
  const form = detail.form!;
  const standing = detail.standing!;
  const planId = form.goalPlanId;
  const stored = useGoalChangeItems(form.id);
  const goalsQuery = useGoalRows({ goalPlanIds: planId ? [planId] : [] }, { enabled: planId !== null });
  const kgis = useKgis(planId);
  const levels = useTargetLevels(planId ? { goalPlanId: planId } : null);
  const units = useMeasureUnits();
  const sources = useDataSources();
  const kpis = useKpiDefinitions();
  const save = useSaveGoalChangeItems();
  const editable = standing.canEdit;

  const [edited, setEdited] = useState<Row[] | null>(null);
  const [cancelGoal, setCancelGoal] = useState<Goal | null>(null);
  const [serverIssues, setServerIssues] = useState<readonly RuleIssue[]>([]);
  const rows: Row[] = useMemo(
    () => edited ?? (stored.data ?? []).map(({ id, goalId, changeType, proposed, reason }) => ({ key: id, id, goalId, changeType, proposed, reason })),
    [edited, stored.data],
  );
  const dirty = edited !== null;
  const proposals: Proposal[] = rows.map(({ key: _key, ...p }) => p);
  const asItems: GoalChangeItem[] = rows.map((r) => ({ ...r, id: r.id ?? r.key, tenantId: form.tenantId, formId: form.id }));

  const goals = goalsQuery.data;
  const unitById = new Map((units.data ?? []).map((u) => [u.id, u]));
  const touched = new Set(rows.map((r) => r.goalId).filter((id): id is Id => id !== null));
  const update = (key: string, patch: Partial<Row>) => {
    setServerIssues([]);
    setEdited(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const add = (row: Row) => {
    setServerIssues([]);
    setEdited([...rows, row]);
  };
  const remove = (key: string) => setEdited(rows.filter((r) => r.key !== key));

  // Issues name a stored row by id, a new one as `new:<index>` (the gateway's own refs).
  const rowIssues = (row: Row, index: number) =>
    [...serverIssues, ...(blockersFor() ?? [])].filter((i) => i.ref === row.id || i.ref === row.key || i.ref === `new:${index}`);
  const numberInvalid = rows.some((r) => r.proposed !== null && (Number.isNaN(r.proposed.weight) || Number.isNaN(r.proposed.targetValue ?? 0)));

  function blockersFor(): RuleIssue[] | null {
    const forwardable = standing.actions.includes('SUBMIT') || standing.actions.includes('APPROVE');
    if (!standing.step || !goals || !kgis.data || !forwardable) return null;
    const check = canSubmit(submitCheckInput(form, standing.step, standing.steps, { goals, kgis: kgis.data, items: [], changeItems: asItems }));
    return check.ok ? [] : check.issues;
  }
  const blockers = blockersFor() ?? [];

  const runSave = () =>
    save.mutate(
      { formId: form.id, items: proposals },
      {
        onSuccess: () => {
          setEdited(null);
          toast.success('Đã lưu nháp');
        },
        onError: (error) => {
          const issues = (error as { issues?: readonly RuleIssue[] }).issues ?? [];
          if (issues.length) setServerIssues(issues);
          toastError(error);
        },
      },
    );

  const query = combineQueries([stored, goalsQuery, kgis, levels, units, sources, kpis]);
  if (query.error != null) {
    return (
      <Card>
        <CardContent className="p-0">
          <ErrorState spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />
        </CardContent>
      </Card>
    );
  }
  if (!stored.data || !goals || !kgis.data || !levels.data || !units.data || !sources.data) return <Skeleton className="h-64 w-full" />;

  const current = activeGoals(goals).sort((a, b) => a.sortOrder - b.sortOrder);
  const after = planAfterChanges(goals, asItems);
  const goalName = (row: Row) => (row.changeType === 'ADD' ? (row.proposed?.name ?? '—') : (goals.find((g) => g.id === row.goalId)?.name ?? '—'));

  const summary = (
    <dl className="flex flex-wrap gap-x-6 gap-y-1">
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Tổng trọng số sau điều chỉnh</dt>
        <dd className="tabular font-medium">{numberInvalid ? '—' : formatPercent(totalWeight(after))}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Số chỉ tiêu sau điều chỉnh</dt>
        <dd className="tabular font-medium">{activeGoals(after).length}</dd>
      </div>
    </dl>
  );

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <Table aria-label="Chỉ tiêu hiện tại của Goal Plan">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">Chỉ tiêu hiện tại</TableHead>
                <TableHead className="w-28 text-right text-xs">Trọng số (%)</TableHead>
                <TableHead className="w-48 text-right text-xs">Mục tiêu</TableHead>
                {editable && <TableHead className="w-52 text-xs">Đề xuất</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {current.map((g) => (
                <TableRow key={g.id} className="hover:bg-surface-alt">
                  <TableCell className="px-3 py-2 font-medium">{g.name}</TableCell>
                  <TableCell className="tabular px-3 py-2 text-right">{formatNumber(g.weight)}</TableCell>
                  <TableCell className="tabular px-3 py-2 text-right">
                    {(g.targetType === 'TEXT' ? g.targetText : formatInUnit(g.targetValue, unitById.get(g.unitId))) ?? <MissingValue />}
                  </TableCell>
                  {editable && (
                    <TableCell className="px-3 py-1.5">
                      {touched.has(g.id) ? (
                        <span className="text-sm text-muted-foreground">Đã có trong đề xuất</span>
                      ) : (
                        <span className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => add({ key: `modify:${g.id}`, goalId: g.id, changeType: 'MODIFY', proposed: goalDraftFromGoal(g, levels.data), reason: '' })}
                          >
                            Sửa
                          </Button>
                          <Button size="sm" variant="ghost" className="text-support-negative" onClick={() => setCancelGoal(g)}>
                            Hủy chỉ tiêu
                          </Button>
                        </span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-base font-semibold">Đề xuất điều chỉnh</h2>
          {rows.length === 0 ? (
            <EmptyState>
              {editable ? 'Chưa có đề xuất nào. Chọn "Sửa" hoặc "Hủy chỉ tiêu" ở bảng trên, hoặc thêm chỉ tiêu mới.' : 'Phiếu chưa có đề xuất nào.'}
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {rows.map((row, index) => (
                <ProposalRow
                  key={row.key}
                  row={row}
                  name={goalName(row)}
                  unit={row.proposed ? unitById.get(row.proposed.unitId) : undefined}
                  editable={editable}
                  issues={rowIssues(row, index)}
                  onChange={(patch) => update(row.key, patch)}
                  onRemove={() => remove(row.key)}
                />
              ))}
            </ul>
          )}
          {editable && (
            <AddGoalForm
              excludeKpiIds={[...goals.map((g) => g.kpiDefId), ...rows.map((r) => r.proposed?.kpiDefId ?? null)].filter((id): id is Id => id !== null)}
              sources={sources.data}
              onAdd={(fields) => {
                const kpi = kpis.data?.find((k) => k.id === fields.kpiId);
                if (!kpi) return;
                const sample = current[0] ?? goals[0];
                add({
                  key: `add:${crypto.randomUUID()}`,
                  goalId: null,
                  changeType: 'ADD',
                  reason: fields.reason,
                  proposed: goalDraftFromKpi(kpi, {
                    weight: fields.weight,
                    targetValue: fields.target,
                    dataSourceId: fields.dataSourceId,
                    startDate: sample?.startDate ?? '',
                    dueDate: sample?.dueDate ?? '',
                    ownerEmployeeId: sample?.ownerEmployeeId ?? null,
                  }),
                });
              }}
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={cancelGoal !== null}
        onOpenChange={(open) => !open && setCancelGoal(null)}
        title="Hủy chỉ tiêu"
        body={`Hủy chỉ tiêu "${cancelGoal?.name ?? ''}"? Chỉ tiêu bị loại khỏi Goal Plan khi phiếu điều chỉnh được duyệt.`}
        confirmLabel="Hủy chỉ tiêu"
        cancelLabel="Quay lại"
        destructive
        onConfirm={() => {
          if (cancelGoal) add({ key: `cancel:${cancelGoal.id}`, goalId: cancelGoal.id, changeType: 'CANCEL', proposed: null, reason: '' });
          setCancelGoal(null);
        }}
      />

      <FormActionBar
        form={form}
        formTitle={title}
        standing={standing}
        blockers={blockers}
        summary={summary}
        unsaved={dirty ? { changeItems: proposals } : undefined}
        invalid={numberInvalid}
        saveDraft={editable ? { run: runSave, pending: save.isPending, dirty } : undefined}
        onIssues={setServerIssues}
        onActed={() => setEdited(null)}
        engaged={dirty || serverIssues.length > 0}
      />
    </>
  );
}

function ProposalRow({
  row,
  name,
  unit,
  editable,
  issues,
  onChange,
  onRemove,
}: {
  row: Row;
  name: string;
  unit: MeasureUnit | undefined;
  editable: boolean;
  issues: readonly RuleIssue[];
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const draft = row.proposed;
  const [weightText, setWeightText] = useState(showNumber(draft?.weight ?? null));
  const [targetText, setTargetText] = useState(draft?.targetType === 'TEXT' ? (draft.targetText ?? '') : showNumber(draft?.targetValue ?? null));
  const setDraft = (patch: Partial<NonNullable<Row['proposed']>>) => draft && onChange({ proposed: { ...draft, ...patch } });

  return (
    <li className="grid gap-2 py-3 md:grid-cols-[minmax(12rem,1fr)_7rem_10rem_minmax(14rem,1.5fr)_auto] md:items-start">
      <div className="min-w-0">
        <Badge variant={row.changeType === 'CANCEL' ? 'negative' : row.changeType === 'ADD' ? 'positive' : 'info'}>{GOAL_CHANGE_TYPE_LABEL[row.changeType]}</Badge>
        <p className="mt-1 font-medium">{name}</p>
        {issues.length > 0 && <p className="mt-0.5 text-xs text-support-negative">{ERROR_CATALOG[issues[0].code].title}</p>}
      </div>
      {draft ? (
        <>
          <div className="space-y-1">
            <Label htmlFor={`${id}-w`} className="text-xs text-muted-foreground">
              Trọng số (%)
            </Label>
            {editable ? (
              <Input
                id={`${id}-w`}
                inputMode="decimal"
                className="tabular h-8 text-right"
                value={weightText}
                onChange={(e) => {
                  setWeightText(e.target.value);
                  setDraft({ weight: parseNumber(e.target.value) ?? Number.NaN });
                }}
                aria-invalid={Number.isNaN(draft.weight) || undefined}
              />
            ) : (
              <p className="tabular text-sm">{formatNumber(draft.weight)}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-t`} className="text-xs text-muted-foreground">
              Mục tiêu{unit && draft.targetType === 'NUMERIC' ? ` (${unit.name})` : ''}
            </Label>
            {editable ? (
              <Input
                id={`${id}-t`}
                inputMode={draft.targetType === 'TEXT' ? 'text' : 'decimal'}
                className="tabular h-8"
                value={targetText}
                onChange={(e) => {
                  setTargetText(e.target.value);
                  if (draft.targetType === 'TEXT') setDraft({ targetText: e.target.value });
                  else setDraft({ targetValue: parseNumber(e.target.value) ?? Number.NaN });
                }}
              />
            ) : (
              <p className="tabular text-sm">{draft.targetType === 'TEXT' ? draft.targetText : formatInUnit(draft.targetValue, unit)}</p>
            )}
          </div>
        </>
      ) : (
        <div className="md:col-span-2" />
      )}
      <div className="space-y-1">
        <Label htmlFor={`${id}-r`} className="text-xs text-muted-foreground">
          Lý do<span aria-hidden className="ml-0.5 text-support-negative">*</span>
        </Label>
        {editable ? (
          <Input id={`${id}-r`} value={row.reason} onChange={(e) => onChange({ reason: e.target.value })} aria-required />
        ) : (
          <p className="text-sm">{row.reason || <MissingValue />}</p>
        )}
      </div>
      {editable && (
        <Button variant="ghost" size="icon" className="md:mt-5" onClick={onRemove} aria-label={`Bỏ đề xuất — ${name}`}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </li>
  );
}

interface NewGoal {
  kpiId: Id;
  weight: number;
  target: number | null;
  dataSourceId: Id;
  reason: string;
}

/** "Thêm chỉ tiêu" — a library KPI with its weight, target and data source (BR-KPI-05: measurable). */
function AddGoalForm({ excludeKpiIds, sources, onAdd }: { excludeKpiIds: readonly Id[]; sources: readonly { id: Id; name: string }[]; onAdd: (goal: NewGoal) => void }) {
  const id = useId();
  const kpis = useKpiDefinitions();
  const [open, setOpen] = useState(false);
  const [kpiId, setKpiId] = useState<Id | null>(null);
  const [weight, setWeight] = useState('');
  const [target, setTarget] = useState('');
  const [sourceId, setSourceId] = useState<Id | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);

  const w = parseNumber(weight);
  const t = parseNumber(target);
  const source = sourceId ?? kpis.data?.find((k) => k.id === kpiId)?.defaultDataSourceId ?? null;
  const problems = {
    kpi: kpiId === null,
    weight: w === null || Number.isNaN(w) || w <= 0,
    target: t === null || Number.isNaN(t),
    source: source === null,
  };
  const reset = () => {
    setOpen(false);
    setKpiId(null);
    setWeight('');
    setTarget('');
    setSourceId(null);
    setReason('');
    setTried(false);
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        Thêm chỉ tiêu
      </Button>
    );
  }
  return (
    <div className="space-y-3 rounded-md border bg-surface-alt/50 p-3">
      <p className="text-sm font-medium">Thêm chỉ tiêu mới</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>KPI trong thư viện</Label>
          <KpiPicker value={kpiId} onChange={setKpiId} excludeIds={excludeKpiIds} />
          {tried && problems.kpi && <p className="text-xs text-support-negative">Chọn một KPI.</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-src`}>Nguồn số liệu</Label>
          <Select value={source ?? undefined} onValueChange={setSourceId}>
            <SelectTrigger id={`${id}-src`}>
              <SelectValue placeholder="Chọn nguồn số liệu" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tried && problems.source && <p className="text-xs text-support-negative">Chọn nguồn số liệu (KPI phải đo được).</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-w`}>Trọng số (%)</Label>
          <Input id={`${id}-w`} inputMode="decimal" className="tabular" value={weight} onChange={(e) => setWeight(e.target.value)} />
          {tried && problems.weight && <p className="text-xs text-support-negative">Nhập trọng số lớn hơn 0.</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-t`}>Mục tiêu</Label>
          <Input id={`${id}-t`} inputMode="decimal" className="tabular" value={target} onChange={(e) => setTarget(e.target.value)} />
          {tried && problems.target && <p className="text-xs text-support-negative">Nhập mục tiêu bằng số.</p>}
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor={`${id}-r`}>Lý do</Label>
          <Input id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => {
            setTried(true);
            if (Object.values(problems).some(Boolean)) return;
            onAdd({ kpiId: kpiId!, weight: w!, target: t, dataSourceId: source!, reason: reason.trim() });
            reset();
          }}
        >
          Thêm vào đề xuất
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          Bỏ qua
        </Button>
      </div>
    </div>
  );
}
