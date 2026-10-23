import { useEffect, useMemo, useState } from 'react';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { KpiPicker } from '@/components/shared/KpiPicker';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Target } from 'lucide-react';
import {
  CALC_METHOD_TYPE_LABEL,
  GOAL_VISIBILITIES,
  GOAL_VISIBILITY_LABEL,
  TARGET_LEVEL_CODES,
  TARGET_TYPES,
  TARGET_TYPE_LABEL,
  type Goal,
  type GoalVisibility,
  type TargetLevelCode,
  type TargetType,
} from '@/data/types';
import { PartialGoalSaveError, useSaveGoal, type GoalLookups, type PlanWorkspaceData } from '@/hooks/queries/goals';
import { toastSaved } from '@/hooks/queries/toasts';
import { levelsMissingIssue, validateTargetLevels } from '@/lib/calcRules';
import { KpiError } from '@/lib/errorCatalog';
import { nextSortOrder, remainingWeight } from '@/lib/goalPlanRules';
import { isIsoDate } from '@/lib/isoDate';
import { pickableMethods } from '@/lib/libraryRules';
import { formatDecimalInput, parseDecimalInput } from '@/lib/numberInput';
import { firstIssueText, issueText } from './goalCopy';

interface LevelRow {
  enabled: boolean;
  target: string;
  score: string;
}

interface FormState {
  kpiDefId: string | null;
  name: string;
  perspectiveId: string;
  kgiId: string;
  unitId: string;
  weight: string;
  targetType: TargetType;
  targetValue: string;
  targetText: string;
  calcMethodId: string;
  dataSourceId: string;
  visibility: GoalVisibility;
  startDate: string;
  dueDate: string;
  description: string;
  formulaText: string;
  selfAssigned: string;
  levelsOn: boolean;
  levels: Record<TargetLevelCode, LevelRow>;
}

type Field = keyof FormState;
const NO_KGI = '__none';

function initialState(goal: Goal | null, data: PlanWorkspaceData): FormState {
  const levels = Object.fromEntries(
    TARGET_LEVEL_CODES.map((code) => {
      const stored = goal ? data.levels.find((l) => l.goalId === goal.id && l.levelCode === code) : undefined;
      return [
        code,
        {
          enabled: stored !== undefined,
          target: stored ? (goal?.targetType === 'TEXT' ? (stored.targetText ?? '') : formatDecimalInput(stored.targetValue)) : '',
          score: stored ? formatDecimalInput(stored.scorePct) : '',
        },
      ];
    }),
  ) as Record<TargetLevelCode, LevelRow>;
  return {
    kpiDefId: goal?.kpiDefId ?? null,
    name: goal?.name ?? '',
    perspectiveId: goal?.perspectiveId ?? '',
    kgiId: goal?.kgiId ?? NO_KGI,
    unitId: goal?.unitId ?? '',
    weight: formatDecimalInput(goal ? goal.weight : remainingWeight(data.goals)),
    targetType: goal?.targetType ?? 'NUMERIC',
    targetValue: formatDecimalInput(goal?.targetValue ?? null),
    targetText: goal?.targetText ?? '',
    calcMethodId: goal?.calcMethodId ?? '',
    dataSourceId: goal?.dataSourceId ?? '',
    visibility: goal?.visibility ?? 'PUBLIC',
    startDate: goal?.startDate ?? data.cycle.startDate,
    dueDate: goal?.dueDate ?? data.cycle.endDate,
    description: goal?.description ?? '',
    formulaText: goal?.formulaText ?? '',
    selfAssigned: formatDecimalInput(goal?.selfAssignedValue ?? null),
    levelsOn: Object.values(levels).some((l) => l.enabled),
    levels,
  };
}

interface GoalEditorPanelProps {
  data: PlanWorkspaceData;
  lookups: GoalLookups;
  /** `null` = a new goal. */
  goal: Goal | null;
  readOnly: boolean;
  /** Why the plan cannot be edited, shown at the top of a read-only panel. */
  readOnlyReason: string | null;
  /** Cancel, or after a save (`savedGoalId` = the goal written). */
  onClose: (savedGoalId?: string) => void;
  /** After a partial save created the goal: keep editing THAT goal (never create it twice). */
  onCreated: (goalId: string) => void;
  /** Whether the form holds edits not saved yet — for the page's unsaved-changes guard. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Add / edit one goal (plan §5.1, WBS 4.3.3, D1, D2): the "Thông tin" tab of the goal page
 * (`…/goals/:goalId`, `…/goals/new`), not a modal. Picking a library KPI fills the fields the person has not touched yet. KRI type is
 * hidden (`ASSUMPTION Q6`). The levels are a second write after the goal (`useSaveGoal`).
 */
export function GoalEditorPanel({ data, lookups, goal, readOnly, readOnlyReason, onClose, onCreated, onDirtyChange }: GoalEditorPanelProps) {
  const [initial] = useState<FormState>(() => initialState(goal, data));
  const [form, setForm] = useState<FormState>(initial);
  const dirty = !readOnly && JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const [touched, setTouched] = useState<Set<Field>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const save = useSaveGoal();
  const hasChildren = goal ? (data.cascadeChildren.get(goal.id)?.length ?? 0) > 0 : false;

  const set = <K extends Field>(field: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    setTouched((t) => new Set(t).add(field));
  };

  /** A library KPI fills what the person has not edited (UI/UX review: never overwrite their input). */
  const pickKpi = (kpiDefId: string | null) => {
    setForm((f) => {
      const kpi = kpiDefId ? lookups.kpi.get(kpiDefId) : undefined;
      if (!kpi) return { ...f, kpiDefId };
      const fill = <K extends Field>(field: K, value: FormState[K]) => (touched.has(field) && f[field] !== '' ? f[field] : value);
      return {
        ...f,
        kpiDefId,
        name: fill('name', kpi.name),
        perspectiveId: fill('perspectiveId', kpi.perspectiveId),
        unitId: fill('unitId', kpi.unitId),
        calcMethodId: fill('calcMethodId', kpi.calcMethodId),
        dataSourceId: fill('dataSourceId', kpi.defaultDataSourceId ?? f.dataSourceId),
        description: fill('description', kpi.definition ?? ''),
        formulaText: fill('formulaText', kpi.formulaText ?? ''),
      };
    });
  };

  const method = lookups.method.get(form.calcMethodId);
  const parsed = useMemo(() => {
    const errors: Partial<Record<Field, string>> = {};
    const weight = parseDecimalInput(form.weight);
    const targetValue = parseDecimalInput(form.targetValue);
    const selfAssigned = parseDecimalInput(form.selfAssigned);
    if (form.name.trim() === '') errors.name = 'Nhập tên chỉ tiêu.';
    if (!form.perspectiveId) errors.perspectiveId = 'Chọn viễn cảnh BSC.';
    if (!form.unitId) errors.unitId = 'Chọn đơn vị đo.';
    if (!form.calcMethodId) errors.calcMethodId = 'Chọn phương pháp tính.';
    if (!form.dataSourceId) errors.dataSourceId = 'Chọn nguồn số liệu — KPI phải đo được.';
    if (weight === null || Number.isNaN(weight) || weight <= 0) errors.weight = 'Nhập trọng số lớn hơn 0.';
    if (form.targetType === 'NUMERIC' && (targetValue === null || Number.isNaN(targetValue))) errors.targetValue = 'Nhập mục tiêu dạng số.';
    if (form.targetType === 'TEXT' && form.targetText.trim() === '') errors.targetText = 'Nhập mục tiêu, ví dụ "Đạt".';
    if (!isIsoDate(form.startDate)) errors.startDate = 'Chọn ngày bắt đầu.';
    if (!isIsoDate(form.dueDate)) errors.dueDate = 'Chọn ngày kết thúc.';
    else if (isIsoDate(form.startDate) && form.dueDate < form.startDate) errors.dueDate = 'Ngày kết thúc phải sau ngày bắt đầu.';
    if (selfAssigned !== null && (Number.isNaN(selfAssigned) || selfAssigned < 0)) errors.selfAssigned = '"Tự giao" phải là số không âm.';

    const levels = form.levelsOn
      ? TARGET_LEVEL_CODES.filter((code) => form.levels[code].enabled).map((code) => {
          const row = form.levels[code];
          const value = form.targetType === 'NUMERIC' ? parseDecimalInput(row.target) : null;
          const score = parseDecimalInput(row.score);
          return {
            levelCode: code,
            targetValue: value !== null && !Number.isNaN(value) ? value : null,
            targetText: form.targetType === 'TEXT' ? row.target.trim() || null : null,
            scorePct: score !== null && !Number.isNaN(score) ? score : Number.NaN,
          };
        })
      : [];
    const levelIssues = validateTargetLevels(
      form.targetType,
      levels.map((l) => ({ ...l, id: l.levelCode, tenantId: data.plan.tenantId, goalId: goal?.id ?? 'new' })),
    );
    const missing = levelsMissingIssue(method?.methodType, levels.length, null);
    if (missing) levelIssues.unshift(missing);
    return { errors, weight, targetValue, selfAssigned, levels, levelIssues };
  }, [form, method, data.plan.tenantId, goal?.id]);

  const show = (field: Field) => (submitted || touched.has(field) ? parsed.errors[field] : undefined);
  const canSave = !readOnly && Object.keys(parsed.errors).length === 0 && parsed.levelIssues.length === 0;

  const onSave = () => {
    setSubmitted(true);
    setServerError(null);
    if (!canSave) return;
    const input = {
      ...(goal ? { id: goal.id } : {}),
      goalPlanId: data.plan.id,
      kgiId: form.kgiId === NO_KGI ? null : form.kgiId,
      kpiDefId: form.kpiDefId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      formulaText: form.formulaText.trim() || null,
      perspectiveId: form.perspectiveId,
      kriType: goal?.kriType ?? null, // hidden until Q6 is answered: kept as stored
      visibility: form.visibility,
      unitId: form.unitId,
      calcMethodId: form.calcMethodId,
      dataSourceId: form.dataSourceId,
      weight: parsed.weight as number,
      targetType: form.targetType,
      targetValue: form.targetType === 'NUMERIC' ? parsed.targetValue : null,
      targetText: form.targetType === 'TEXT' ? form.targetText.trim() : null,
      selfAssignedValue: hasChildren ? parsed.selfAssigned : (goal?.selfAssignedValue ?? null),
      rollUpFromChildren: goal?.rollUpFromChildren ?? false,
      startDate: form.startDate,
      dueDate: form.dueDate,
      ownerEmployeeId: goal?.ownerEmployeeId ?? data.plan.ownerEmployeeId,
      sortOrder: goal?.sortOrder ?? nextSortOrder(data.goals),
    };
    const storedLevels = goal ? data.levels.filter((l) => l.goalId === goal.id) : [];
    const levels = parsed.levels.map((l) => ({ ...l, id: storedLevels.find((s) => s.levelCode === l.levelCode)?.id }));
    const levelsChanged = goal === null ? levels.length > 0 : true;
    save.mutate(
      { goal: input, levels: levelsChanged ? levels : undefined },
      {
        onSuccess: (saved) => {
          toastSaved(goal ? 'Đã lưu chỉ tiêu' : 'Đã thêm chỉ tiêu');
          onClose(saved.id);
        },
        onError: (error) => {
          if (error instanceof PartialGoalSaveError) {
            setServerError(error.cause instanceof KpiError ? (firstIssueText(error.cause.issues) ?? error.cause.message) : 'Định mức chưa lưu được.');
            if (!goal) onCreated(error.goal.id);
          } else if (error instanceof KpiError && error.issues.length) {
            setServerError(issueText(error.issues[0]));
          }
        },
      },
    );
  };

  const disabled = readOnly || save.isPending;
  const title = readOnly ? 'Chi tiết chỉ tiêu' : goal ? 'Sửa chỉ tiêu' : 'Thêm chỉ tiêu';

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        {!readOnly && (
          <div className="flex justify-end">
            <RequiredLegend />
          </div>
        )}
        <SectionTitle icon={Target} title={title}>
          {readOnly && readOnlyReason}
        </SectionTitle>

        {!readOnly && (
          <FormField label="Chọn từ thư viện KPI" hint="Chọn một KPI để điền sẵn tên, viễn cảnh, đơn vị, phương pháp tính và nguồn số liệu. Bỏ trống nếu tự nhập.">
            {(control) => <KpiPicker {...control} value={form.kpiDefId} onChange={pickKpi} clearable />}
          </FormField>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Tên chỉ tiêu" required error={show('name')} className="md:col-span-2">
            {(control) => <Input {...control} value={form.name} disabled={disabled} onChange={(e) => set('name', e.target.value)} />}
          </FormField>
          <FormField label="Viễn cảnh BSC" required error={show('perspectiveId')}>
            {(control) => (
              <Select value={form.perspectiveId} onValueChange={(v) => set('perspectiveId', v)} disabled={disabled}>
                <SelectTrigger {...control}>
                  <SelectValue placeholder="Chọn viễn cảnh" />
                </SelectTrigger>
                <SelectContent>
                  {lookups.perspectives.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="KGI" hint="KGI của Goal Plan mà chỉ tiêu này phục vụ (không bắt buộc).">
            {(control) => (
              <Select value={form.kgiId} onValueChange={(v) => set('kgiId', v)} disabled={disabled}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_KGI}>Không gắn KGI</SelectItem>
                  {data.kgis.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Đơn vị đo" required error={show('unitId')}>
            {(control) => (
              <Select value={form.unitId} onValueChange={(v) => set('unitId', v)} disabled={disabled}>
                <SelectTrigger {...control}>
                  <SelectValue placeholder="Chọn đơn vị" />
                </SelectTrigger>
                <SelectContent>
                  {lookups.units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Trọng số (%)" required error={show('weight')} hint="Tổng trọng số các chỉ tiêu phải bằng 100% mới gửi được.">
            {(control) => <Input {...control} inputMode="decimal" value={form.weight} disabled={disabled} onChange={(e) => set('weight', e.target.value)} />}
          </FormField>
          <FormField label="Kiểu mục tiêu" required>
            {(control) => (
              <Select value={form.targetType} onValueChange={(v) => set('targetType', v as TargetType)} disabled={disabled || hasChildren}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TARGET_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          {form.targetType === 'NUMERIC' ? (
            <FormField label="Mục tiêu" required error={show('targetValue')} hint={hasChildren ? 'Không được thấp hơn phần đã phân giao và tự giao.' : undefined}>
              {(control) => <Input {...control} inputMode="decimal" value={form.targetValue} disabled={disabled} onChange={(e) => set('targetValue', e.target.value)} />}
            </FormField>
          ) : (
            <FormField label="Mục tiêu" required error={show('targetText')}>
              {(control) => <Input {...control} value={form.targetText} placeholder="Đạt" disabled={disabled} onChange={(e) => set('targetText', e.target.value)} />}
            </FormField>
          )}
          <FormField label="Phương pháp tính" required error={show('calcMethodId')} hint={method ? `${CALC_METHOD_TYPE_LABEL[method.methodType]}${method.capPct !== null ? ` · trần ${method.capPct}%` : ''}` : undefined}>
            {(control) => (
              <Select value={form.calcMethodId} onValueChange={(v) => set('calcMethodId', v)} disabled={disabled}>
                <SelectTrigger {...control}>
                  <SelectValue placeholder="Chọn phương pháp" />
                </SelectTrigger>
                <SelectContent>
                  {pickableMethods(lookups.methods, initial.calcMethodId || null).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Nguồn số liệu" required error={show('dataSourceId')}>
            {(control) => (
              <Select value={form.dataSourceId} onValueChange={(v) => set('dataSourceId', v)} disabled={disabled}>
                <SelectTrigger {...control}>
                  <SelectValue placeholder="Chọn nguồn" />
                </SelectTrigger>
                <SelectContent>
                  {lookups.dataSources.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Hiển thị" required hint="Riêng tư: chỉ bạn, quản lý các cấp của bạn và HR xem được.">
            {(control) => (
              <Select value={form.visibility} onValueChange={(v) => set('visibility', v as GoalVisibility)} disabled={disabled}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GOAL_VISIBILITIES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {GOAL_VISIBILITY_LABEL[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Ngày bắt đầu" required error={show('startDate')}>
            {(control) => <Input {...control} type="date" value={form.startDate} disabled={disabled} onChange={(e) => set('startDate', e.target.value)} />}
          </FormField>
          <FormField label="Ngày kết thúc" required error={show('dueDate')}>
            {(control) => <Input {...control} type="date" value={form.dueDate} disabled={disabled} onChange={(e) => set('dueDate', e.target.value)} />}
          </FormField>
          {hasChildren && (
            <FormField label="Tự giao" error={show('selfAssigned')} hint="Phần mục tiêu bạn tự nhận. Phần đã giao + tự giao không được vượt mục tiêu.">
              {(control) => <Input {...control} inputMode="decimal" value={form.selfAssigned} disabled={disabled} onChange={(e) => set('selfAssigned', e.target.value)} />}
            </FormField>
          )}
          <FormField label="Mô tả" className="md:col-span-2">
            {(control) => <Textarea {...control} rows={2} value={form.description} disabled={disabled} onChange={(e) => set('description', e.target.value)} />}
          </FormField>
          <FormField label="Công thức" className="md:col-span-2">
            {(control) => <Textarea {...control} rows={2} value={form.formulaText} disabled={disabled} onChange={(e) => set('formulaText', e.target.value)} />}
          </FormField>
        </div>

        <LevelsSection form={form} disabled={disabled} issues={submitted || form.levelsOn ? parsed.levelIssues : []} onChange={(levelsOn, levels) => setForm((f) => ({ ...f, levelsOn, levels }))} />

        {serverError && (
          <p role="alert" className="text-sm text-support-negative">
            {serverError}
          </p>
        )}
        {!readOnly && (
          <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => onClose()} disabled={save.isPending}>
              Hủy
            </Button>
            <Button onClick={onSave} disabled={save.isPending || (submitted && !canSave)} aria-busy={save.isPending}>
              {goal ? 'Lưu chỉ tiêu' : 'Thêm chỉ tiêu'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * L1/L2/L3 (D1, BR-KPI-09, 33). The hint states `ASSUMPTION Q1` in full, so nobody reads a score the
 * engine will not give.
 */
function LevelsSection({
  form,
  disabled,
  issues,
  onChange,
}: {
  form: FormState;
  disabled: boolean;
  issues: ReturnType<typeof validateTargetLevels>;
  onChange: (levelsOn: boolean, levels: FormState['levels']) => void;
}) {
  const update = (code: TargetLevelCode, patch: Partial<LevelRow>) => onChange(form.levelsOn, { ...form.levels, [code]: { ...form.levels[code], ...patch } });
  return (
    <section className="space-y-3 rounded-md border p-4" aria-labelledby="levels-title">
      <div className="flex items-center justify-between gap-3">
        <h3 id="levels-title" className="text-sm font-semibold">
          Định mức L1/L2/L3
        </h3>
        <div className="flex items-center gap-2">
          <label htmlFor="levels-on" className="text-sm text-muted-foreground">
            Dùng định mức
          </label>
          <Switch
            id="levels-on"
            checked={form.levelsOn}
            disabled={disabled}
            onCheckedChange={(on) =>
              onChange(on, on && !Object.values(form.levels).some((l) => l.enabled) ? { ...form.levels, L1: { ...form.levels.L1, enabled: true }, L2: { ...form.levels.L2, enabled: true } } : form.levels)
            }
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Giả định Q1: giữa hai mức, điểm nội suy tuyến tính; vượt L3 giữ điểm của L3; dưới L1 được 0% (có thể là một bước hụt nếu L1 có điểm lớn hơn 0). Hướng tốt
        lên hay xuống suy ra từ thứ tự mục tiêu (L3 thấp hơn L1 = càng thấp càng tốt). Chưa có số thực tế thì là "chưa có số liệu", không phải 0.
      </p>
      {form.levelsOn && (
        <div className="space-y-2">
          {TARGET_LEVEL_CODES.map((code) => {
            const row = form.levels[code];
            return (
              <div key={code} className="grid grid-cols-[auto_1fr_8rem] items-center gap-3">
                <label className="flex w-14 items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={row.enabled} disabled={disabled} onChange={(e) => update(code, { enabled: e.target.checked })} />
                  {code}
                </label>
                <Input
                  aria-label={`Mục tiêu ${code}`}
                  inputMode={form.targetType === 'NUMERIC' ? 'decimal' : undefined}
                  placeholder={form.targetType === 'NUMERIC' ? 'Mục tiêu' : 'Kết quả, ví dụ "Đạt"'}
                  value={row.target}
                  disabled={disabled || !row.enabled}
                  onChange={(e) => update(code, { target: e.target.value })}
                />
                <Input aria-label={`Điểm ${code} (%)`} inputMode="decimal" placeholder="Điểm (%)" value={row.score} disabled={disabled || !row.enabled} onChange={(e) => update(code, { score: e.target.value })} />
              </div>
            );
          })}
        </div>
      )}
      {issues.length > 0 && (
        <p role="alert" className="text-xs text-support-negative">
          {issueLevelText(issues[0].detail)}
        </p>
      )}
    </section>
  );
}

const LEVEL_COPY: Readonly<Record<string, string>> = {
  LEVELS_MIN_TWO: 'Cần ít nhất 2 mức.',
  LEVELS_MISSING: 'Phương pháp định mức cần ít nhất 2 mức.',
  LEVEL_DUPLICATE: 'Mỗi mức chỉ dùng một lần.',
  LEVEL_SCORE_INVALID: 'Điểm mỗi mức phải là số không âm.',
  LEVEL_SCORES_ORDER: 'Điểm phải tăng dần từ L1 đến L3.',
  LEVEL_TARGET_MISSING: 'Mỗi mức cần có mục tiêu.',
  LEVEL_TARGETS_ORDER: 'Mục tiêu các mức phải cùng tăng hoặc cùng giảm.',
  LEVEL_TEXT_DUPLICATE: 'Hai mức không được trùng kết quả.',
};
const issueLevelText = (detail: string | null) => (detail && LEVEL_COPY[detail]) || 'Định mức chưa hợp lệ.';
