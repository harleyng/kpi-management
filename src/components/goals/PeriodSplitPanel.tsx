import { useMemo, useState } from 'react';
import { ArrowLeft, CalendarRange, Info } from 'lucide-react';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AGGREGATION_LABEL, PERIOD_TYPE_LABEL, type Goal, type PeriodType } from '@/data/types';
import { useSetPeriodTargets, type GoalLookups, type PlanWorkspaceData } from '@/hooks/queries/goals';
import { toastSaved } from '@/hooks/queries/toasts';
import { evenSplit, periodTargetIssues } from '@/lib/goalPlanRules';
import { formatDecimalInput, parseDecimalInput } from '@/lib/numberInput';
import { formatDate } from '@/lib/utils';
import { formatTarget, issueText } from './goalCopy';

interface PeriodSplitPanelProps {
  data: PlanWorkspaceData;
  lookups: GoalLookups;
  goal: Goal;
  readOnly: boolean;
  onClose: () => void;
}

/**
 * "Phân bổ mục tiêu theo kỳ" (WBS 4.3.5, BR-KPI-11): the goal's target per month or quarter. "Chia
 * đều" is `goalPlanRules.evenSplit` by the KPI's aggregation; a mismatch is a WARNING (product owner)
 * — shown live, never blocking — because quarters and the year are built from these splits.
 */
export function PeriodSplitPanel({ data, lookups, goal, readOnly, onClose }: PeriodSplitPanelProps) {
  const stored = data.periodTargets.filter((t) => t.goalId === goal.id);
  const typesInCycle = useMemo(() => [...new Set(data.periods.map((p) => p.periodType))] as PeriodType[], [data.periods]);
  const storedType = data.periods.find((p) => p.id === stored[0]?.periodId)?.periodType;
  const [type, setType] = useState<PeriodType>(storedType ?? (typesInCycle.includes('Month') ? 'Month' : (typesInCycle[0] ?? 'Month')));
  const periods = useMemo(() => data.periods.filter((p) => p.periodType === type).sort((a, b) => (a.startDate < b.startDate ? -1 : 1)), [data.periods, type]);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(stored.map((t) => [t.periodId, formatDecimalInput(t.targetValue)])));
  const save = useSetPeriodTargets();
  const aggregation = goal.kpiDefId ? (lookups.kpi.get(goal.kpiDefId)?.aggregation ?? null) : null;

  const entered = periods.flatMap((p) => {
    const v = parseDecimalInput(values[p.id] ?? '');
    return v === null ? [] : [{ periodId: p.id, targetValue: v }];
  });
  const invalid = entered.some((t) => Number.isNaN(t.targetValue));
  const issues = invalid ? [] : periodTargetIssues(goal, aggregation, entered.map((t) => ({ goalId: goal.id, ...t })), data.periods);

  const fillEvenly = () => setValues(Object.fromEntries(evenSplit(goal, aggregation, periods).map((s) => [s.periodId, formatDecimalInput(s.targetValue)])));

  const onSave = () => {
    const targets = entered.map((t) => ({ ...t, id: stored.find((s) => s.periodId === t.periodId)?.id }));
    save.mutate({ goalId: goal.id, targets }, { onSuccess: () => { toastSaved(targets.length ? 'Đã lưu phân bổ theo kỳ' : 'Đã xóa phân bổ theo kỳ'); onClose(); } });
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft aria-hidden />
          Quay lại danh sách
        </Button>
        <SectionTitle icon={CalendarRange} title={`Phân bổ theo kỳ: ${goal.name}`}>
          Mục tiêu {formatTarget(goal, lookups.unit.get(goal.unitId))}
          {aggregation ? ` · cộng dồn kiểu "${AGGREGATION_LABEL[aggregation]}"` : ''}
        </SectionTitle>

        {goal.targetType !== 'NUMERIC' ? (
          <p className="text-sm text-muted-foreground">Chỉ tiêu có mục tiêu dạng chữ không phân bổ theo kỳ.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label htmlFor="split-type" className="text-sm font-medium">
                  Loại kỳ
                </label>
                <Select value={type} onValueChange={(v) => setType(v as PeriodType)} disabled={readOnly}>
                  <SelectTrigger id="split-type" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typesInCycle.map((t) => (
                      <SelectItem key={t} value={t}>
                        {PERIOD_TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!readOnly && (
                <Button variant="outline" onClick={fillEvenly} disabled={aggregation === null} title={aggregation === null ? 'KPI không thuộc thư viện nên không có kiểu cộng dồn để chia đều.' : undefined}>
                  Chia đều
                </Button>
              )}
            </div>
            {aggregation === null && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                KPI không thuộc thư viện — phân bổ chỉ áp dụng cho từng tháng; quý và năm dùng mục tiêu của chỉ tiêu.
              </p>
            )}

            <Table aria-label="Mục tiêu theo kỳ">
              <TableHeader>
                <TableRow>
                  <TableHead>Kỳ</TableHead>
                  <TableHead>Thời gian</TableHead>
                  <TableHead className="w-48 text-right">Mục tiêu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((p) => {
                  const raw = values[p.id] ?? '';
                  const bad = raw !== '' && Number.isNaN(parseDecimalInput(raw));
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.label}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(p.startDate)} – {formatDate(p.endDate)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          aria-label={`Mục tiêu kỳ ${p.label}`}
                          aria-invalid={bad || undefined}
                          inputMode="decimal"
                          className="ml-auto w-44 text-right tabular-nums"
                          value={raw}
                          disabled={readOnly}
                          onChange={(e) => setValues((v) => ({ ...v, [p.id]: e.target.value }))}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {invalid && (
              <p role="alert" className="text-sm text-support-negative">
                Có ô không phải số hợp lệ.
              </p>
            )}
            {issues.length > 0 && (
              <p role="status" className="flex items-start gap-2 text-sm">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-support-warning" aria-hidden />
                {issueText(issues[0])} Bạn vẫn lưu được; HR thấy cảnh báo này trên Goal Plan.
              </p>
            )}

            {!readOnly && (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                {stored.length > 0 && (
                  <Button variant="outline" onClick={() => setValues({})} disabled={save.isPending}>
                    Xóa phân bổ
                  </Button>
                )}
                <Button variant="outline" onClick={onClose} disabled={save.isPending}>
                  Hủy
                </Button>
                <Button onClick={onSave} disabled={save.isPending || invalid} aria-busy={save.isPending}>
                  Lưu phân bổ
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
