import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/shared/FormField';
import { KpiPicker } from '@/components/shared/KpiPicker';
import { toastError, toastSuccess } from '@/components/shared/notify';
import {
  LIBRARY_STATUS_LABEL,
  LIBRARY_STATUSES,
  type Id,
  type JobPosition,
  type KpiDefinition,
  type KpiTemplate,
  type KpiTemplateItem,
  type LibraryStatus,
  type OrgUnit,
} from '@/data/types';
import { useSaveKpiTemplate } from '@/hooks/queries/library';
import { KpiError } from '@/lib/errorCatalog';
import { GOAL_COUNT } from '@/lib/goalPlanRules';
import {
  TEMPLATE_AUDIENCE_LABEL,
  templateAudience,
  templateIssues,
  templateWeightTotal,
  type TemplateAudience,
} from '@/lib/libraryRules';
import { formatPercent } from '@/lib/utils';
import { issueMessage, numberText, parseNumberInput, weightGapMessage } from './libraryCopy';

interface ItemRow {
  /** The stored item's id, or a local key for a new one. */
  key: string;
  stored: boolean;
  kpiDefId: Id;
  weight: string;
  target: string;
}

interface FormState {
  name: string;
  audience: TemplateAudience;
  orgUnitId: string;
  positionId: string;
  status: LibraryStatus;
  items: ItemRow[];
}

function initialState(template: KpiTemplate | null, items: readonly KpiTemplateItem[]): FormState {
  return {
    name: template?.name ?? '',
    audience: template ? templateAudience(template) : 'General',
    orgUnitId: template?.orgUnitId ?? '',
    positionId: template?.positionId ?? '',
    status: template?.status ?? 'Draft',
    items: items.map((i) => ({ key: i.id, stored: true, kpiDefId: i.kpiDefId, weight: numberText(i.defaultWeight), target: numberText(i.defaultTarget) })),
  };
}

function toTemplate(form: FormState) {
  return {
    name: form.name.trim(),
    orgUnitId: form.audience === 'OrgUnit' && form.orgUnitId ? form.orgUnitId : null,
    positionId: form.audience === 'Position' && form.positionId ? form.positionId : null,
    status: form.status,
  };
}

const toItems = (form: FormState) =>
  form.items.map((i) => ({ kpiDefId: i.kpiDefId, defaultWeight: parseNumberInput(i.weight) ?? Number.NaN, defaultTarget: parseNumberInput(i.target) }));

export interface TemplateEditorProps {
  template: KpiTemplate | null;
  storedItems: readonly KpiTemplateItem[];
  definitions: readonly KpiDefinition[];
  orgUnits: readonly OrgUnit[];
  positions: readonly JobPosition[];
  readOnly: boolean;
  onSaved: (templateId: Id) => void;
  onCancelNew: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * The body of `/admin/templates/:templateId` (WBS 4.2.4): the template's header, its items with default
 * weights, and the footer every edit settles — the live weight total and item count. Those two are
 * WARNINGS (`ASSUMPTION Q26`): the template saves, and the Goal Plan made from it is what must reach
 * 100% and 5–8 KPIs (BR-KPI-03/04). Applying a template to a plan is track T3's.
 */
export function TemplateEditor(props: TemplateEditorProps) {
  return <TemplateEditorInner key={props.template?.id ?? 'new'} {...props} />;
}

function TemplateEditorInner({ template, storedItems, definitions, orgUnits, positions, readOnly, onSaved, onCancelNew, onDirtyChange }: TemplateEditorProps) {
  const initial = useMemo(() => initialState(template, storedItems), [template, storedItems]);
  const [form, setForm] = useState<FormState>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const nextKey = useRef(0);
  const save = useSaveKpiTemplate();

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const defById = useMemo(() => new Map(definitions.map((d) => [d.id, d])), [definitions]);
  const items = toItems(form);
  const check = templateIssues(toTemplate(form), items, defById, new Set(storedItems.map((i) => i.kpiDefId)));
  const total = templateWeightTotal(items);
  const targetMissing = (form.audience === 'OrgUnit' && !form.orgUnitId) || (form.audience === 'Position' && !form.positionId);
  const itemIssue = (kpiDefId: Id, list: typeof check.errors) => list.find((i) => i.ref === kpiDefId);

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    setServerError(null);
  };
  const setItem = (key: string, patch: Partial<ItemRow>) => set('items', form.items.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const addKpi = (kpiDefId: string | null) => {
    setPicker(null);
    if (!kpiDefId || form.items.some((i) => i.kpiDefId === kpiDefId)) return;
    nextKey.current += 1;
    set('items', [...form.items, { key: `new-${nextKey.current}`, stored: false, kpiDefId, weight: '', target: '' }]);
  };

  const submit = async () => {
    setSubmitted(true);
    if (check.errors.length > 0 || targetMissing) return;
    try {
      const saved = await save.mutateAsync({
        template: { ...(template ? { id: template.id } : {}), ...toTemplate(form) },
        items: form.items.map((row, index) => ({ ...(row.stored ? { id: row.key } : {}), ...items[index] })),
      });
      toastSuccess(template ? 'Đã lưu bộ mẫu' : 'Đã thêm bộ mẫu');
      onDirtyChange(false);
      onSaved(saved.parent.id);
    } catch (error) {
      const first = error instanceof KpiError ? error.issues[0] : undefined;
      setServerError(first ? issueMessage(first) : null);
      toastError(error);
    }
  };

  const nameError = submitted ? check.errors.find((i) => i.ref === 'name') : undefined;
  const weightWarning = check.warnings.find((w) => w.detail === 'WEIGHT_TOTAL');
  const countWarning = check.warnings.find((w) => w.detail === 'ITEM_COUNT');

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      aria-label={template ? `Bộ mẫu ${template.name}` : 'Bộ mẫu mới'}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-4 border-b p-4">
        {readOnly && <p className="text-sm text-muted-foreground">Bạn chỉ có quyền xem bộ mẫu.</p>}
        {serverError && (
          <p role="alert" className="rounded-md bg-support-negative-subtle px-3 py-2 text-sm text-support-negative">
            {serverError}
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_11rem]">
          <FormField label="Tên bộ mẫu" required error={nameError ? issueMessage(nameError) : undefined}>
            {(control) => <Input {...control} value={form.name} onChange={(e) => set('name', e.target.value)} disabled={readOnly} />}
          </FormField>
          <FormField label="Trạng thái" required hint="Chỉ bộ mẫu Đang áp dụng được chọn khi lập Goal Plan.">
            {(control) => (
              <Select value={form.status} onValueChange={(v) => set('status', v as LibraryStatus)} disabled={readOnly}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIBRARY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {LIBRARY_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <FormField label="Áp dụng cho" required>
            {(control) => (
              <Select value={form.audience} onValueChange={(v) => set('audience', v as TemplateAudience)} disabled={readOnly}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TEMPLATE_AUDIENCE_LABEL) as TemplateAudience[]).map((a) => (
                    <SelectItem key={a} value={a}>
                      {TEMPLATE_AUDIENCE_LABEL[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          {form.audience === 'OrgUnit' && (
            <FormField label="Đơn vị" required error={submitted && !form.orgUnitId ? 'Chọn đơn vị.' : undefined}>
              {(control) => (
                <Select value={form.orgUnitId} onValueChange={(v) => set('orgUnitId', v)} disabled={readOnly}>
                  <SelectTrigger {...control}>
                    <SelectValue placeholder="Chọn đơn vị" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgUnits.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}
          {form.audience === 'Position' && (
            <FormField label="Chức danh" required error={submitted && !form.positionId ? 'Chọn chức danh.' : undefined}>
              {(control) => (
                <Select value={form.positionId} onValueChange={(v) => set('positionId', v)} disabled={readOnly}>
                  <SelectTrigger {...control}>
                    <SelectValue placeholder="Chọn chức danh" />
                  </SelectTrigger>
                  <SelectContent>
                    {positions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}
          {form.audience === 'General' && <p className="self-end pb-2 text-sm text-muted-foreground">Dùng được cho mọi đơn vị và chức danh.</p>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table aria-label="Chỉ tiêu trong bộ mẫu">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[9.5rem] px-3">Mã</TableHead>
              <TableHead className="px-3">Tên chỉ tiêu</TableHead>
              <TableHead className="w-36 px-3 text-right">Trọng số mặc định (%)</TableHead>
              <TableHead className="w-36 px-3 text-right">Mục tiêu mặc định</TableHead>
              {!readOnly && <TableHead className="w-12"><span className="sr-only">Xóa</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {form.items.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Bộ mẫu chưa có chỉ tiêu. Chọn chỉ tiêu từ thư viện ở dưới để thêm.
                </TableCell>
              </TableRow>
            )}
            {form.items.map((row) => {
              const def = defById.get(row.kpiDefId);
              const error = itemIssue(row.kpiDefId, check.errors);
              const warning = itemIssue(row.kpiDefId, check.warnings);
              return (
                <TableRow key={row.key} className="align-top hover:bg-transparent">
                  <TableCell className="px-3 py-2 font-mono text-xs">{def?.code ?? '—'}</TableCell>
                  <TableCell className="px-3 py-2">
                    <span className="font-medium">{def?.name ?? 'Không còn trong thư viện'}</span>
                    {(error ?? warning) && (
                      <p className={error ? 'mt-1 text-xs text-support-negative' : 'mt-1 flex items-start gap-1 text-xs'} role={error ? 'alert' : undefined}>
                        {!error && <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-support-warning" aria-hidden />}
                        {issueMessage((error ?? warning) as NonNullable<typeof warning>)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-1.5">
                    <Input
                      aria-label={`Trọng số mặc định của ${def?.name ?? 'chỉ tiêu'}`}
                      inputMode="decimal"
                      className="tabular ml-auto h-8 w-24 text-right"
                      value={row.weight}
                      onChange={(e) => setItem(row.key, { weight: e.target.value })}
                      disabled={readOnly}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-1.5">
                    <Input
                      aria-label={`Mục tiêu mặc định của ${def?.name ?? 'chỉ tiêu'}`}
                      inputMode="decimal"
                      className="tabular ml-auto h-8 w-28 text-right"
                      value={row.target}
                      onChange={(e) => setItem(row.key, { target: e.target.value })}
                      disabled={readOnly}
                      placeholder="—"
                    />
                  </TableCell>
                  {!readOnly && (
                    <TableCell className="px-1 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Xóa chỉ tiêu ${def?.name ?? ''} khỏi bộ mẫu`}
                        onClick={() => set('items', form.items.filter((i) => i.key !== row.key))}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
            <span className="text-sm font-medium" id="add-kpi-label">
              Thêm chỉ tiêu
            </span>
            <KpiPicker
              aria-describedby="add-kpi-label"
              className="w-full sm:w-96"
              value={picker}
              onChange={addKpi}
              excludeIds={form.items.map((i) => i.kpiDefId)}
              clearable={false}
            />
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-b-[inherit] border-t bg-surface-alt px-4 py-3">
        <div aria-live="polite" className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5">
            {form.items.length === 0 ? null : weightWarning ? (
              <AlertTriangle className="h-4 w-4 text-support-warning" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-support-positive" aria-hidden />
            )}
            <span>
              Tổng trọng số <span className="tabular font-semibold">{form.items.length === 0 ? '—' : formatPercent(total)}</span>
            </span>
            {weightWarning && form.items.length > 0 && <span className="text-muted-foreground">{weightGapMessage(total)}</span>}
          </span>
          <span className="flex items-center gap-1.5">
            {countWarning && <AlertTriangle className="h-4 w-4 text-support-warning" aria-hidden />}
            <span>
              Số chỉ tiêu <span className="tabular font-semibold">{form.items.length}</span>
            </span>
            {countWarning && <span className="text-muted-foreground">Khuyến nghị {GOAL_COUNT.min}–{GOAL_COUNT.max}.</span>}
          </span>
          {(weightWarning || countWarning) && form.items.length > 0 && (
            <span className="basis-full text-xs text-muted-foreground">
              Bộ mẫu vẫn lưu được, nhưng Goal Plan lập từ bộ này cần tổng 100% và {GOAL_COUNT.min}–{GOAL_COUNT.max} chỉ tiêu mới gửi duyệt được.
            </span>
          )}
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending || (template !== null && !dirty)}
              onClick={() => {
                if (template) setForm(initial);
                else onCancelNew();
              }}
            >
              {template ? 'Hủy thay đổi' : 'Hủy'}
            </Button>
            <Button type="submit" disabled={save.isPending || (template !== null && !dirty)} aria-busy={save.isPending || undefined}>
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {template ? 'Lưu bộ mẫu' : 'Thêm bộ mẫu'}
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
