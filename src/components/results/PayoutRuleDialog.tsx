import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityCombobox } from '@/components/shared/EntityCombobox';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { useSession } from '@/contexts/useSession';
import { PAYOUT_SCOPES, PAYOUT_SCOPE_LABEL, type Id, type JobPosition, type OrgUnit, type PayoutRule, type PayoutScope, type RatingLevel } from '@/data/types';
import { useSavePayoutRule } from '@/hooks/queries/results';
import { errorSpecOf } from '@/lib/errorCatalog';
import type { QueryState } from '@/lib/queryState';
import { validatePayoutRule } from '@/lib/ratingRules';

interface PayoutRuleDialogProps {
  /** `null` = a new rule. */
  rule: PayoutRule | null;
  ratingScaleId: Id;
  levels: readonly RatingLevel[];
  units: readonly OrgUnit[];
  positions: readonly JobPosition[];
  unitsQuery: QueryState;
  onClose: () => void;
}

const parsePct = (text: string): number | null => {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(n) ? null : n;
};

/** Add or edit one payout rule (BR-KPI-42). Checked with `ratingRules.validatePayoutRule` before saving. */
export function PayoutRuleDialog({ rule, ratingScaleId, levels, units, positions, unitsQuery, onClose }: PayoutRuleDialogProps) {
  const { tenantId, today } = useSession();
  const save = useSavePayoutRule();
  const sortedLevels = useMemo(() => [...levels].sort((a, b) => b.minScore - a.minScore), [levels]);
  const [levelId, setLevelId] = useState<Id>(rule?.ratingLevelId ?? sortedLevels[0]?.id ?? '');
  const [scope, setScope] = useState<PayoutScope>(rule?.appliesTo ?? 'All');
  const [unitId, setUnitId] = useState<Id | null>(rule?.orgUnitId ?? null);
  const [positionId, setPositionId] = useState<Id | null>(rule?.positionId ?? null);
  const [pctText, setPctText] = useState(rule ? String(rule.payoutPct) : '');
  const [from, setFrom] = useState(rule?.effectiveFrom ?? today);
  const [tried, setTried] = useState(false);

  const pct = parsePct(pctText);
  const candidate: PayoutRule = {
    id: rule?.id ?? 'new',
    tenantId,
    ratingScaleId,
    ratingLevelId: levelId,
    appliesTo: scope,
    orgUnitId: scope === 'OrgUnit' ? unitId : null,
    positionId: scope === 'Position' ? positionId : null,
    payoutPct: pct ?? Number.NaN,
    effectiveFrom: from,
  };
  const issues = validatePayoutRule(candidate).map((i) => i.detail);
  const errors = {
    target: issues.includes('SCOPE_MISMATCH') ? (scope === 'OrgUnit' ? 'Chọn đơn vị áp dụng.' : 'Chọn chức danh áp dụng.') : undefined,
    pct: pct === null || issues.includes('PAYOUT_INVALID') ? 'Nhập % hưởng lương KPI, từ 0 trở lên (120 = 120%).' : undefined,
    from: /^\d{4}-\d{2}-\d{2}$/.test(from) ? undefined : 'Chọn ngày bắt đầu hiệu lực.',
  };
  const valid = !errors.target && !errors.pct && !errors.from && levelId !== '';

  const submit = () => {
    setTried(true);
    if (!valid || pct === null) return;
    const { id: _id, tenantId: _tenant, ...fields } = candidate;
    save.mutate({ ...fields, payoutPct: pct, ...(rule ? { id: rule.id } : {}) }, { onSuccess: onClose });
  };
  const show = (message: string | undefined) => (tried ? message : undefined);
  const saveError = save.error ? errorSpecOf(save.error) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rule ? 'Sửa quy tắc quy đổi' : 'Thêm quy tắc quy đổi'}</DialogTitle>
          <DialogDescription>Quy đổi một mức xếp loại thành % hưởng lương KPI, cho tất cả, một đơn vị hoặc một chức danh.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <RequiredLegend />
          <FormField label="Xếp loại" required>
            {(control) => (
              <Select value={levelId} onValueChange={setLevelId}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortedLevels.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.code} ({l.label})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Áp dụng cho" required hint={scope === 'All' ? 'Áp dụng cho mọi người, trừ nơi có quy tắc riêng theo đơn vị hoặc chức danh.' : undefined}>
            {(control) => (
              <Select value={scope} onValueChange={(v) => setScope(v as PayoutScope)}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYOUT_SCOPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PAYOUT_SCOPE_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          {scope === 'OrgUnit' && (
            <FormField label="Đơn vị" required hint="Áp dụng cho đơn vị này và các đơn vị con, trừ nơi có quy tắc gần hơn." error={show(errors.target)}>
              {() => (
                <EntityCombobox
                  options={units.map((u) => ({ id: u.id, label: u.name, description: u.code, keywords: [u.code] }))}
                  query={unitsQuery}
                  placeholder="Chọn đơn vị"
                  searchPlaceholder="Tìm đơn vị"
                  emptyText="Không có đơn vị nào khớp."
                  value={unitId}
                  onChange={setUnitId}
                />
              )}
            </FormField>
          )}
          {scope === 'Position' && (
            <FormField label="Chức danh" required error={show(errors.target)}>
              {(control) => (
                <Select value={positionId ?? ''} onValueChange={setPositionId}>
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
          <div className="grid grid-cols-2 gap-4">
            <FormField label="% hưởng lương KPI" required error={show(errors.pct)}>
              {(control) => (
                <div className="flex items-center gap-2">
                  <Input {...control} inputMode="decimal" className="tabular text-right" value={pctText} onChange={(e) => setPctText(e.target.value)} />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              )}
            </FormField>
            <FormField label="Hiệu lực từ" required error={show(errors.from)}>
              {(control) => <Input {...control} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
            </FormField>
          </div>
          {saveError && (
            <p role="alert" className="rounded-md bg-support-negative-subtle px-3 py-2 text-sm">
              <span className="font-medium">{saveError.title}.</span> {saveError.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" disabled={save.isPending} aria-busy={save.isPending || undefined}>
              {save.isPending ? 'Đang lưu…' : rule ? 'Lưu quy tắc' : 'Thêm quy tắc'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
