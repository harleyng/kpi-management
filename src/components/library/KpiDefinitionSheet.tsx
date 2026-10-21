import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { InlineNotice } from '@/components/shared/InlineNotice';
import { toastError, toastSuccess } from '@/components/shared/notify';
import {
  AGGREGATION_LABEL,
  AGGREGATIONS,
  CALC_METHOD_TYPE_LABEL,
  KPI_CATEGORY_TAG_LABEL,
  KPI_CATEGORY_TAGS,
  KPI_FREQUENCIES,
  KPI_FREQUENCY_LABEL,
  LIBRARY_STATUS_LABEL,
  LIBRARY_STATUSES,
  type Aggregation,
  type BscPerspective,
  type CalcMethod,
  type DataSource,
  type KpiCategoryTag,
  type KpiDefinition,
  type KpiFrequency,
  type LibraryStatus,
  type MeasureUnit,
} from '@/data/types';
import { useSaveKpiDefinition } from '@/hooks/queries/library';
import { kpiDefinitionIssues, otherCodesOf } from '@/lib/libraryRules';
import { DiscardChangesDialog } from './DiscardChangesDialog';
import { fieldErrors, issueMessage } from './libraryCopy';

const NONE = '__none';

interface FormState {
  code: string;
  name: string;
  perspectiveId: string;
  unitId: string;
  calcMethodId: string;
  defaultDataSourceId: string;
  frequency: KpiFrequency;
  aggregation: Aggregation;
  categoryTag: string;
  definition: string;
  formulaText: string;
  status: LibraryStatus;
}

const FIELDS = ['code', 'name', 'perspectiveId', 'unitId', 'calcMethodId', 'defaultDataSourceId', 'frequency', 'aggregation', 'categoryTag', 'status'];

function initialState(def: KpiDefinition | null): FormState {
  return {
    code: def?.code ?? '',
    name: def?.name ?? '',
    perspectiveId: def?.perspectiveId ?? '',
    unitId: def?.unitId ?? '',
    calcMethodId: def?.calcMethodId ?? '',
    defaultDataSourceId: def?.defaultDataSourceId ?? NONE,
    frequency: def?.frequency ?? 'Month',
    aggregation: def?.aggregation ?? 'SUM',
    categoryTag: def?.categoryTag ?? NONE,
    definition: def?.definition ?? '',
    formulaText: def?.formulaText ?? '',
    status: def?.status ?? 'Draft',
  };
}

const orNull = (text: string) => (text.trim() === '' ? null : text.trim());

function toPayload(form: FormState, id: string | undefined) {
  return {
    ...(id ? { id } : {}),
    code: form.code,
    name: form.name.trim(),
    perspectiveId: form.perspectiveId,
    unitId: form.unitId,
    calcMethodId: form.calcMethodId,
    defaultDataSourceId: form.defaultDataSourceId === NONE ? null : form.defaultDataSourceId,
    frequency: form.frequency,
    aggregation: form.aggregation,
    categoryTag: form.categoryTag === NONE ? null : (form.categoryTag as KpiCategoryTag),
    definition: orNull(form.definition),
    formulaText: orNull(form.formulaText),
    status: form.status,
  };
}

export interface KpiDefinitionSheetProps {
  /** The item being edited, `'new'` for a new one, `null` when closed. */
  editing: KpiDefinition | 'new' | null;
  onClose: () => void;
  readOnly: boolean;
  definitions: readonly KpiDefinition[];
  perspectives: readonly BscPerspective[];
  units: readonly MeasureUnit[];
  methods: readonly CalcMethod[];
  dataSources: readonly DataSource[];
  /** Active templates holding each KPI, by KPI id (`libraryRules.activeTemplatesContaining`). */
  activeTemplatesOf: (kpiDefId: string) => string[];
  /** Where focus goes back when the sheet closes (the row's name button). */
  returnFocus?: () => void;
}

/**
 * The side sheet that edits one library item (WBS 4.2.3). The same `libraryRules` the gateway runs
 * explain a refusal BEFORE the save (status blocked by an Active template, a missing data source);
 * the gateway's refusal still wins and lands on the field it names. Closes only on success.
 */
export function KpiDefinitionSheet({ editing, ...rest }: KpiDefinitionSheetProps) {
  // Remount per item so the form starts from the row it edits.
  const key = editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id;
  return <KpiDefinitionSheetInner key={key} editing={editing} {...rest} />;
}

function KpiDefinitionSheetInner({
  editing,
  onClose,
  readOnly,
  definitions,
  perspectives,
  units,
  methods,
  dataSources,
  activeTemplatesOf,
  returnFocus,
}: KpiDefinitionSheetProps) {
  const stored = editing && editing !== 'new' ? editing : null;
  const initial = useMemo(() => initialState(stored), [stored]);
  const [form, setForm] = useState<FormState>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const save = useSaveKpiDefinition();

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const holding = stored ? activeTemplatesOf(stored.id) : [];
  const issues = kpiDefinitionIssues(
    { ...toPayload(form, stored?.id), code: form.code },
    stored,
    { otherCodes: otherCodesOf(definitions, stored?.id), activeTemplatesContaining: holding },
  );
  const liveErrors: Record<string, string> = {};
  for (const issue of issues) if (issue.ref) liveErrors[issue.ref] ??= issueMessage(issue);
  const errorOf = (field: string) => serverErrors[field] ?? (submitted ? liveErrors[field] : undefined);
  // A blocked status is explained as soon as it is chosen — not after a refused save.
  const statusBlocked = liveErrors.status;
  const sourceMissing = form.status === 'Active' && form.defaultDataSourceId === NONE;

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    setServerErrors((e) => {
      if (!(field in e) && !('_form' in e)) return e;
      const { [field]: _gone, _form: _f, ...others } = e;
      return others;
    });
  };

  const requestClose = () => {
    if (dirty && !readOnly) setConfirmDiscard(true);
    else onClose();
  };

  const submit = async () => {
    setSubmitted(true);
    if (issues.length > 0) return;
    try {
      await save.mutateAsync(toPayload(form, stored?.id));
      toastSuccess(stored ? 'Đã lưu chỉ tiêu' : 'Đã thêm chỉ tiêu');
      onClose();
    } catch (error) {
      setServerErrors(fieldErrors(error, FIELDS));
      toastError(error);
    }
  };

  const method = methods.find((m) => m.id === form.calcMethodId);
  const title = readOnly ? 'Chi tiết chỉ tiêu mẫu' : stored ? 'Sửa chỉ tiêu mẫu' : 'Thêm chỉ tiêu mẫu';

  return (
    <>
      <Sheet open={editing !== null} onOpenChange={(open) => !open && requestClose()}>
        <SheetContent
          onCloseAutoFocus={(e) => {
            if (returnFocus) {
              e.preventDefault();
              returnFocus();
            }
          }}
          aria-describedby="kpi-sheet-desc"
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription id="kpi-sheet-desc">
              {stored ? `${stored.code}${stored.isSystem ? ' (chỉ tiêu chuẩn)' : ''}` : 'Chỉ tiêu mới thuộc thư viện của công ty.'}
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <form
              id="kpi-definition-form"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {readOnly ? (
                <p className="text-sm text-muted-foreground">Bạn chỉ có quyền xem thư viện KPI.</p>
              ) : (
                <RequiredLegend />
              )}
              {serverErrors._form && (
                <p role="alert" className="rounded-md bg-support-negative-subtle px-3 py-2 text-sm text-support-negative">
                  {serverErrors._form}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                <FormField
                  label="Mã chỉ tiêu"
                  required
                  error={errorOf('code')}
                  hint={stored?.isSystem ? 'Mã của chỉ tiêu chuẩn không đổi được.' : undefined}
                >
                  {(control) => (
                    <Input
                      {...control}
                      className="font-mono uppercase"
                      value={form.code}
                      onChange={(e) => set('code', e.target.value)}
                      disabled={readOnly || Boolean(stored?.isSystem)}
                      autoComplete="off"
                    />
                  )}
                </FormField>
                <FormField label="Tên chỉ tiêu" required error={errorOf('name')}>
                  {(control) => <Input {...control} value={form.name} onChange={(e) => set('name', e.target.value)} disabled={readOnly} />}
                </FormField>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Viễn cảnh (BSC)" required error={errorOf('perspectiveId')}>
                  {(control) => (
                    <Select value={form.perspectiveId} onValueChange={(v) => set('perspectiveId', v)} disabled={readOnly}>
                      <SelectTrigger {...control}>
                        <SelectValue placeholder="Chọn viễn cảnh" />
                      </SelectTrigger>
                      <SelectContent>
                        {perspectives.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
                <FormField label="Đơn vị đo" required error={errorOf('unitId')}>
                  {(control) => (
                    <Select value={form.unitId} onValueChange={(v) => set('unitId', v)} disabled={readOnly}>
                      <SelectTrigger {...control}>
                        <SelectValue placeholder="Chọn đơn vị đo" />
                      </SelectTrigger>
                      <SelectContent>
                        {units.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name} ({u.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              </div>

              <FormField
                label="Phương pháp tính"
                required
                error={errorOf('calcMethodId')}
                hint={method ? `${CALC_METHOD_TYPE_LABEL[method.methodType]}${method.description ? `. ${method.description}` : ''}` : undefined}
              >
                {(control) => (
                  <Select value={form.calcMethodId} onValueChange={(v) => set('calcMethodId', v)} disabled={readOnly}>
                    <SelectTrigger {...control}>
                      <SelectValue placeholder="Chọn phương pháp tính" />
                    </SelectTrigger>
                    <SelectContent>
                      {methods.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField
                label="Nguồn dữ liệu mặc định"
                required={form.status === 'Active'}
                error={errorOf('defaultDataSourceId') ?? (sourceMissing ? issueMessage({ code: 'ERR-KPI-06', ref: null, detail: 'DATA_SOURCE_REQUIRED', data: null }) : undefined)}
                hint="Mục tiêu tạo từ chỉ tiêu này lấy nguồn này làm mặc định (KPI phải đo được)."
              >
                {(control) => (
                  <Select value={form.defaultDataSourceId} onValueChange={(v) => set('defaultDataSourceId', v)} disabled={readOnly}>
                    <SelectTrigger {...control}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Chưa chọn</SelectItem>
                      {dataSources.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <InlineNotice tone="warning" title="Phase 1: nguồn dữ liệu không phải kết nối">
                Nguồn chỉ ghi số lấy từ báo cáo hoặc hệ thống nào. Trong P1, số thực tế của mọi nguồn đều được nhập tay hoặc import Excel; chưa tích hợp API hay hệ thống khác.
              </InlineNotice>

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Tần suất" required error={errorOf('frequency')}>
                  {(control) => (
                    <Select value={form.frequency} onValueChange={(v) => set('frequency', v as KpiFrequency)} disabled={readOnly}>
                      <SelectTrigger {...control}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KPI_FREQUENCIES.map((f) => (
                          <SelectItem key={f} value={f}>
                            {KPI_FREQUENCY_LABEL[f]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
                <FormField label="Cách tổng hợp" required error={errorOf('aggregation')}>
                  {(control) => (
                    <Select value={form.aggregation} onValueChange={(v) => set('aggregation', v as Aggregation)} disabled={readOnly}>
                      <SelectTrigger {...control}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AGGREGATIONS.map((a) => (
                          <SelectItem key={a} value={a}>
                            {AGGREGATION_LABEL[a]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
                <FormField label="Nhóm phân loại" error={errorOf('categoryTag')}>
                  {(control) => (
                    <Select value={form.categoryTag} onValueChange={(v) => set('categoryTag', v)} disabled={readOnly}>
                      <SelectTrigger {...control}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Không phân loại</SelectItem>
                        {KPI_CATEGORY_TAGS.map((t) => (
                          <SelectItem key={t} value={t}>
                            {KPI_CATEGORY_TAG_LABEL[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              </div>

              <FormField label="Định nghĩa">
                {(control) => (
                  <Textarea {...control} rows={3} value={form.definition} onChange={(e) => set('definition', e.target.value)} disabled={readOnly} />
                )}
              </FormField>
              <FormField label="Công thức (diễn giải)" hint="Cách tính bằng lời, ví dụ: Lợi nhuận cuối cùng / doanh thu thuần × 100.">
                {(control) => (
                  <Textarea {...control} rows={2} value={form.formulaText} onChange={(e) => set('formulaText', e.target.value)} disabled={readOnly} />
                )}
              </FormField>

              <FormField
                label="Trạng thái"
                required
                error={serverErrors.status ?? statusBlocked}
                hint="Chỉ chỉ tiêu Đang áp dụng mới chọn được khi lập Goal Plan hoặc bộ mẫu. Lưu trữ không xóa chỉ tiêu và không ảnh hưởng mục tiêu đã giao."
              >
                {(control) => (
                  <Select value={form.status} onValueChange={(v) => set('status', v as LibraryStatus)} disabled={readOnly}>
                    <SelectTrigger {...control} className="sm:w-56">
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
            </form>
          </SheetBody>
          <SheetFooter>
            {readOnly ? (
              <Button variant="outline" onClick={onClose}>
                Đóng
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={requestClose} disabled={save.isPending}>
                  Hủy
                </Button>
                <Button type="submit" form="kpi-definition-form" disabled={save.isPending || (stored !== null && !dirty)} aria-busy={save.isPending || undefined}>
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {stored ? 'Lưu' : 'Thêm chỉ tiêu'}
                </Button>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <DiscardChangesDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        onDiscard={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    </>
  );
}
