import { useMemo, useRef, useState } from 'react';
import { Loader2, Lock, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { toastError, toastSuccess } from '@/components/shared/notify';
import { CALC_METHOD_TYPE_LABEL, CALC_METHOD_TYPES, type CalcMethod, type CalcMethodType, type CalcTier } from '@/data/types';
import { useSaveCalcMethod } from '@/hooks/queries/library';
import { validateCalcMethod } from '@/lib/calcRules';
import { KpiError } from '@/lib/errorCatalog';
import { calcMethodIssues, otherCodesOf } from '@/lib/libraryRules';
import { DiscardChangesDialog } from './DiscardChangesDialog';
import { issueMessage, methodLockedMessage, numberText, parseNumberInput } from './libraryCopy';

/** Methods whose result a cap / floor bounds (LEVELS is bounded by its top level, BINARY is 0 or 100). */
const BOUNDED: readonly CalcMethodType[] = ['RATIO_UP', 'RATIO_DOWN', 'FORMULA', 'TIERED'];

interface TierRow {
  /** The stored tier's id, or a local key for a new row. */
  key: string;
  stored: boolean;
  from: string;
  to: string;
  pct: string;
}

interface FormState {
  code: string;
  name: string;
  methodType: CalcMethodType;
  capPct: string;
  floorPct: string;
  formulaExpr: string;
  description: string;
  tiers: TierRow[];
}

function initialState(method: CalcMethod | null, tiers: readonly CalcTier[]): FormState {
  return {
    code: method?.code ?? '',
    name: method?.name ?? '',
    methodType: method?.methodType ?? 'RATIO_UP',
    capPct: numberText(method ? method.capPct : 120),
    floorPct: numberText(method ? method.floorPct : 0),
    formulaExpr: method?.formulaExpr ?? '',
    description: method?.description ?? '',
    tiers: [...tiers]
      .sort((a, b) => (a.fromValue ?? -Infinity) - (b.fromValue ?? -Infinity))
      .map((t) => ({ key: t.id, stored: true, from: numberText(t.fromValue), to: numberText(t.toValue), pct: numberText(t.achievementPct) })),
  };
}

/** What the form would save — numbers parsed (a non-number is NaN, which the rules refuse). */
function toMethod(form: FormState): Omit<CalcMethod, 'id' | 'tenantId'> {
  const bounded = BOUNDED.includes(form.methodType);
  return {
    code: form.code,
    name: form.name.trim(),
    methodType: form.methodType,
    capPct: bounded ? parseNumberInput(form.capPct) : null,
    floorPct: bounded ? parseNumberInput(form.floorPct) : null,
    formulaExpr: form.methodType === 'FORMULA' ? form.formulaExpr.trim() || null : null,
    description: form.description.trim() || null,
  };
}

const toTiers = (form: FormState) =>
  form.methodType === 'TIERED'
    ? form.tiers.map((t) => ({
        id: t.key,
        tenantId: '',
        calcMethodId: '',
        fromValue: parseNumberInput(t.from),
        toValue: parseNumberInput(t.to),
        achievementPct: parseNumberInput(t.pct) ?? Number.NaN,
      }))
    : [];

export interface CalcMethodSheetProps {
  editing: CalcMethod | 'new' | null;
  onClose: () => void;
  readOnly: boolean;
  methods: readonly CalcMethod[];
  tiers: readonly CalcTier[];
  /** Goals using each method; `null` when the count could not be read. */
  goalsUsing: (methodId: string) => number | null;
  returnFocus?: () => void;
}

/**
 * Edits one calculation method (WBS 4.2.2). The arithmetic of each type is `calcRules`'; the sheet
 * runs the same checks the gateway does (`validateCalcMethod` + `libraryRules.calcMethodIssues`), so a
 * tier overlap or a missing cap shows on the row before saving. A method that goals use keeps its
 * scoring fields (BR-KPI-80): they are read-only here, with the reason.
 */
export function CalcMethodSheet({ editing, ...rest }: CalcMethodSheetProps) {
  const key = editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id;
  return <CalcMethodSheetInner key={key} editing={editing} {...rest} />;
}

function CalcMethodSheetInner({ editing, onClose, readOnly, methods, tiers, goalsUsing, returnFocus }: CalcMethodSheetProps) {
  const stored = editing && editing !== 'new' ? editing : null;
  const storedTiers = useMemo(() => (stored ? tiers.filter((t) => t.calcMethodId === stored.id) : []), [stored, tiers]);
  const initial = useMemo(() => initialState(stored, storedTiers), [stored, storedTiers]);
  const [form, setForm] = useState<FormState>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const nextKey = useRef(0);
  const save = useSaveCalcMethod();

  const used = stored ? goalsUsing(stored.id) : 0;
  // Unknown count: assume used (the gateway decides); a NEW method is never locked.
  const locked = stored !== null && (used === null || used > 0);
  const scoringDisabled = readOnly || locked;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const method = toMethod(form);
  const draftTiers = toTiers(form);
  const { issues } = calcMethodIssues(method, draftTiers, stored, storedTiers, { otherCodes: otherCodesOf(methods, stored?.id), goalsUsing: 0 });
  const allIssues = [...issues, ...validateCalcMethod({ ...method, id: stored?.id ?? 'new', tenantId: '' }, draftTiers)];
  const errorFor = (ref: string) => {
    const issue = allIssues.find((i) => i.ref === ref);
    return submitted && issue ? issueMessage(issue) : undefined;
  };
  // validateCalcMethod names the METHOD by id for cap / floor / formula problems.
  const methodLevel = allIssues.filter((i) => i.ref === (stored?.id ?? 'new'));
  const capError = methodLevel.find((i) => i.detail === 'CAP_REQUIRED' || i.detail === 'CAP_NOT_POSITIVE') ?? allIssues.find((i) => i.ref === 'capPct');
  const floorError = methodLevel.find((i) => i.detail === 'FLOOR_NEGATIVE' || i.detail === 'FLOOR_ABOVE_CAP') ?? allIssues.find((i) => i.ref === 'floorPct');
  const formulaError = methodLevel.find((i) => i.detail === 'FORMULA_INVALID');
  const tiersRequired = methodLevel.find((i) => i.detail === 'TIERS_REQUIRED');

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    setServerError(null);
  };
  const setTier = (key: string, patch: Partial<TierRow>) => set('tiers', form.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  const requestClose = () => (dirty && !readOnly ? setConfirmDiscard(true) : onClose());

  const submit = async () => {
    setSubmitted(true);
    if (allIssues.length > 0) return;
    try {
      await save.mutateAsync({
        method: { ...(stored ? { id: stored.id } : {}), ...method },
        tiers: draftTiers.map(({ id, fromValue, toValue, achievementPct }) => ({
          ...(form.tiers.find((t) => t.key === id)?.stored ? { id } : {}),
          fromValue,
          toValue,
          achievementPct,
        })),
      });
      toastSuccess(stored ? 'Đã lưu phương pháp tính' : 'Đã thêm phương pháp tính');
      onClose();
    } catch (error) {
      const first = error instanceof KpiError ? error.issues[0] : undefined;
      setServerError(first ? issueMessage(first) : null);
      toastError(error);
    }
  };

  const bounded = BOUNDED.includes(form.methodType);
  const title = readOnly ? 'Chi tiết phương pháp tính' : stored ? 'Sửa phương pháp tính' : 'Thêm phương pháp tính';

  return (
    <>
      <Sheet open={editing !== null} onOpenChange={(open) => !open && requestClose()}>
        <SheetContent
          aria-describedby="method-sheet-desc"
          onCloseAutoFocus={(e) => {
            if (returnFocus) {
              e.preventDefault();
              returnFocus();
            }
          }}
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription id="method-sheet-desc">
              {stored ? stored.code : 'Cách quy đổi số thực tế thành % hoàn thành.'}
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <form
              id="calc-method-form"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {readOnly ? <p className="text-sm text-muted-foreground">Bạn chỉ có quyền xem thư viện KPI.</p> : <RequiredLegend />}
              {locked && (
                <p className="flex gap-2 rounded-md bg-surface-alt px-3 py-2 text-sm">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>{methodLockedMessage(used)}</span>
                </p>
              )}
              {serverError && (
                <p role="alert" className="rounded-md bg-support-negative-subtle px-3 py-2 text-sm text-support-negative">
                  {serverError}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                <FormField label="Mã" required error={errorFor('code')}>
                  {(control) => (
                    <Input {...control} className="font-mono uppercase" value={form.code} onChange={(e) => set('code', e.target.value)} disabled={readOnly} autoComplete="off" />
                  )}
                </FormField>
                <FormField label="Tên" required error={errorFor('name')}>
                  {(control) => <Input {...control} value={form.name} onChange={(e) => set('name', e.target.value)} disabled={readOnly} />}
                </FormField>
              </div>

              <FormField label="Loại" required>
                {(control) => (
                  <Select value={form.methodType} onValueChange={(v) => set('methodType', v as CalcMethodType)} disabled={scoringDisabled}>
                    <SelectTrigger {...control}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CALC_METHOD_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {CALC_METHOD_TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              {form.methodType === 'LEVELS' && (
                <p className="text-sm text-muted-foreground">
                  Định mức L1/L2/L3 đặt trên từng mục tiêu được giao, không đặt ở đây. Điểm nội suy tuyến tính giữa các mức, tối đa bằng điểm của mức cao nhất.
                </p>
              )}
              {form.methodType === 'BINARY' && <p className="text-sm text-muted-foreground">Đạt: 100%. Không đạt: 0%.</p>}

              {bounded && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Trần (%)"
                    required={form.methodType !== 'TIERED'}
                    error={submitted && capError ? issueMessage(capError) : undefined}
                    hint="% hoàn thành tối đa, ví dụ 120."
                  >
                    {(control) => (
                      <Input {...control} inputMode="decimal" className="tabular" value={form.capPct} onChange={(e) => set('capPct', e.target.value)} disabled={scoringDisabled} />
                    )}
                  </FormField>
                  <FormField label="Sàn (%)" error={submitted && floorError ? issueMessage(floorError) : undefined} hint="Để trống nếu không có sàn.">
                    {(control) => (
                      <Input {...control} inputMode="decimal" className="tabular" value={form.floorPct} onChange={(e) => set('floorPct', e.target.value)} disabled={scoringDisabled} />
                    )}
                  </FormField>
                </div>
              )}

              {form.methodType === 'FORMULA' && (
                <FormField
                  label="Công thức"
                  required
                  error={submitted && formulaError ? issueMessage(formulaError) : errorFor('formulaExpr')}
                  hint="Dùng actual (thực tế), target (mục tiêu), số, + - * /, ngoặc, min( ), max( ). Ví dụ: actual / target * 100."
                >
                  {(control) => (
                    <Input {...control} className="font-mono" value={form.formulaExpr} onChange={(e) => set('formulaExpr', e.target.value)} disabled={scoringDisabled} />
                  )}
                </FormField>
              )}

              {form.methodType === 'TIERED' && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Bậc</legend>
                  <p className="text-xs text-muted-foreground">Khoảng [từ, đến): lấy từ, không lấy đến. Để trống là không giới hạn.</p>
                  <div className="rounded-md border">
                    <Table aria-label="Các bậc của phương pháp">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="text-right">Từ</TableHead>
                          <TableHead className="text-right">Đến</TableHead>
                          <TableHead className="text-right">% hoàn thành</TableHead>
                          {!scoringDisabled && <TableHead className="w-12"><span className="sr-only">Xóa</span></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {form.tiers.length === 0 && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={4} className="py-4 text-center text-sm text-muted-foreground">
                              Chưa có bậc nào.
                            </TableCell>
                          </TableRow>
                        )}
                        {form.tiers.map((t, i) => {
                          const error = errorFor(t.key);
                          return (
                            <TableRow key={t.key} className="hover:bg-transparent align-top">
                              <TableCell className="p-1.5">
                                <Input aria-label={`Bậc ${i + 1}: từ`} inputMode="decimal" className="tabular h-8 text-right" value={t.from} onChange={(e) => setTier(t.key, { from: e.target.value })} disabled={scoringDisabled} />
                                {error && (
                                  <p role="alert" className="mt-1 text-xs text-support-negative">
                                    {error}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="p-1.5">
                                <Input aria-label={`Bậc ${i + 1}: đến`} inputMode="decimal" className="tabular h-8 text-right" value={t.to} onChange={(e) => setTier(t.key, { to: e.target.value })} disabled={scoringDisabled} />
                              </TableCell>
                              <TableCell className="p-1.5">
                                <Input aria-label={`Bậc ${i + 1}: % hoàn thành`} inputMode="decimal" className="tabular h-8 text-right" value={t.pct} onChange={(e) => setTier(t.key, { pct: e.target.value })} disabled={scoringDisabled} />
                              </TableCell>
                              {!scoringDisabled && (
                                <TableCell className="p-1.5">
                                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Xóa bậc ${i + 1}`} onClick={() => set('tiers', form.tiers.filter((x) => x.key !== t.key))}>
                                    <Trash2 className="h-4 w-4" aria-hidden />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  {submitted && tiersRequired && <p role="alert" className="text-xs text-support-negative">{issueMessage(tiersRequired)}</p>}
                  {!scoringDisabled && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const last = form.tiers[form.tiers.length - 1];
                        nextKey.current += 1;
                        set('tiers', [...form.tiers, { key: `new-${nextKey.current}`, stored: false, from: last?.to ?? '0', to: '', pct: '' }]);
                      }}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      Thêm bậc
                    </Button>
                  )}
                </fieldset>
              )}

              <FormField label="Mô tả">
                {(control) => <Textarea {...control} rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} disabled={readOnly} />}
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
                <Button type="submit" form="calc-method-form" disabled={save.isPending || (stored !== null && !dirty)} aria-busy={save.isPending || undefined}>
                  {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  {stored ? 'Lưu' : 'Thêm phương pháp'}
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
