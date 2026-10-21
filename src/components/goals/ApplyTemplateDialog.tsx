import { useMemo, useState } from 'react';
import { CheckCircle2, MinusCircle } from 'lucide-react';
import { FormField } from '@/components/shared/FormField';
import { InlineNotice } from '@/components/shared/InlineNotice';
import { StartFormLoadError } from '@/components/forms/StartFormLoadError';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/contexts/useSession';
import type { KpiTemplate } from '@/data/types';
import { TemplateApplyError, useApplyTemplate, useGoalRows, type GoalLookups, type PlanWorkspaceData } from '@/hooks/queries/goals';
import { useKpiTemplateItems, useKpiTemplates } from '@/hooks/queries/library';
import { useSessionDirectory } from '@/hooks/queries/session';
import { toastSaved } from '@/hooks/queries/toasts';
import { errorSpecOf } from '@/lib/errorCatalog';
import { GOAL_COUNT, isWeightComplete, nextSortOrder } from '@/lib/goalPlanRules';
import { primaryAssignmentOn, unitAncestry } from '@/lib/orgRules';
import { planOwnerOf } from '@/lib/planAccessRules';
import { combineQueries } from '@/lib/queryState';
import { templateApplication, templatesForPlan } from '@/lib/templateApplyRules';
import { formatNumber } from '@/lib/utils';
import { formatWeight, planOwnerName, TEMPLATE_SKIP_COPY } from './goalCopy';

interface ApplyTemplateDialogProps {
  data: PlanWorkspaceData;
  lookups: GoalLookups;
  onClose: () => void;
}

/**
 * "Thêm từ bộ mẫu" (WBS 4.2.4, BR-KPI-77): pick an Active template — the ones for the plan's position
 * and unit first (`templatesForPlan`) — preview what it adds (`templateApplication`: in template order,
 * skips with their reason, totals after adding) and add the goals (`useApplyTemplate`). Never replaces
 * a goal; weight and count are warnings, fixed on the plan before "Gửi". The plan's goals are read
 * whole here (private ones too) so a hidden goal of the same KPI is not added twice.
 */
export function ApplyTemplateDialog({ data, lookups, onClose }: ApplyTemplateDialogProps) {
  const { tenantId, today } = useSession();
  const templates = useKpiTemplates();
  const items = useKpiTemplateItems();
  const planGoals = useGoalRows({ goalPlanIds: [data.plan.id] });
  const directory = useSessionDirectory(tenantId);
  const query = combineQueries([templates, items, planGoals, directory]);
  const apply = useApplyTemplate();
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ownerId = planOwnerOf(data.plan, lookups.orgUnits);
  const groups = useMemo(() => {
    if (!templates.data || !directory.data) return null;
    const assignment = data.plan.ownerType === 'Employee' && ownerId ? primaryAssignmentOn(ownerId, directory.data.assignments, today) : null;
    const unitId = data.plan.ownerType === 'Employee' ? (assignment?.orgUnitId ?? null) : data.plan.ownerOrgUnitId;
    return templatesForPlan(templates.data, {
      positionId: assignment?.positionId ?? null,
      unitIds: unitId ? unitAncestry(unitId, lookups.orgUnits) : [],
    });
  }, [templates.data, directory.data, data.plan, ownerId, today, lookups.orgUnits]);

  const itemCount = (t: KpiTemplate) => items.data?.filter((i) => i.templateId === t.id).length ?? 0;
  const audience = (t: KpiTemplate) =>
    t.positionId ? 'Theo chức danh' : t.orgUnitId ? (lookups.orgUnit.get(t.orgUnitId)?.name ?? 'Theo đơn vị') : 'Dùng chung';

  const kpis = useMemo(() => [...lookups.kpi.values()], [lookups.kpi]);
  const preview = useMemo(() => {
    if (!templateId || !items.data || !planGoals.data) return null;
    return templateApplication(
      items.data.filter((i) => i.templateId === templateId),
      kpis,
      planGoals.data,
      { goalPlanId: data.plan.id, ownerEmployeeId: ownerId, startDate: data.cycle.startDate, dueDate: data.cycle.endDate, firstSortOrder: nextSortOrder(planGoals.data) },
    );
  }, [templateId, items.data, planGoals.data, kpis, data.plan.id, data.cycle, ownerId]);

  const adding = preview?.toAdd.length ?? 0;
  const onAdd = () => {
    if (!preview || adding === 0) return;
    setError(null);
    apply.mutate(
      { goals: preview.toAdd },
      {
        onSuccess: (saved) => {
          toastSaved(`Đã thêm ${saved.length} chỉ tiêu từ bộ mẫu`, 'Kiểm tra trọng số và mục tiêu trước khi gửi.');
          onClose();
        },
        onError: (e) => {
          const spec = errorSpecOf(e instanceof TemplateApplyError ? e.cause : e);
          setError(
            e instanceof TemplateApplyError
              ? `Đã thêm ${e.saved.length}/${preview.toAdd.length} chỉ tiêu, dừng ở "${e.failed.name}". ${spec.title}.`
              : spec.title,
          );
        },
      },
    );
  };

  const unit = (id: string) => lookups.unit.get(id);
  return (
    <Dialog open onOpenChange={(o) => !o && !apply.isPending && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Thêm từ bộ mẫu</DialogTitle>
          <DialogDescription>Thêm các chỉ tiêu của bộ mẫu vào Goal Plan của {planOwnerName(data.plan, lookups)}. Chỉ tiêu hiện có được giữ nguyên.</DialogDescription>
        </DialogHeader>

        {query.error ? (
          <StartFormLoadError query={query} />
        ) : !groups || !items.data || !planGoals.data ? (
          <Skeleton className="h-48 w-full" />
        ) : groups.suggested.length + groups.others.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có bộ mẫu đang áp dụng. HR tạo bộ mẫu ở Quản trị KPI › Bộ mẫu.</p>
        ) : (
          <div className="space-y-4">
            <FormField label="Bộ mẫu" required>
              {(control) => (
                <Select value={templateId} onValueChange={(v) => { setTemplateId(v); setError(null); }}>
                  <SelectTrigger {...control}>
                    <SelectValue placeholder="Chọn bộ mẫu" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.suggested.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Gợi ý cho {planOwnerName(data.plan, lookups)}</SelectLabel>
                        {groups.suggested.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name} · {audience(t)} · {itemCount(t)} chỉ tiêu
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {groups.others.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Bộ mẫu khác</SelectLabel>
                        {groups.others.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name} · {audience(t)} · {itemCount(t)} chỉ tiêu
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              )}
            </FormField>

            {preview && (
              <>
                <div className="max-h-72 overflow-auto rounded-md border">
                  <Table aria-label="Chỉ tiêu trong bộ mẫu">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Chỉ tiêu</TableHead>
                        <TableHead className="text-right">Trọng số (%)</TableHead>
                        <TableHead className="text-right">Mục tiêu</TableHead>
                        <TableHead>Kết quả</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.map(({ item, kpi, skip }) => (
                        <TableRow key={item.id} className={skip ? 'text-muted-foreground' : undefined}>
                          <TableCell>
                            <div className="font-medium">{kpi?.name ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{kpi?.code}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(item.defaultWeight, 2)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {item.defaultTarget === null ? '—' : `${formatNumber(item.defaultTarget, 2)}${kpi && unit(kpi.unitId) ? ` ${unit(kpi.unitId)?.name}` : ''}`}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5 text-sm">
                              {skip ? <MinusCircle className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4 text-support-positive" aria-hidden />}
                              {skip ? TEMPLATE_SKIP_COPY[skip] : 'Thêm'}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-1 text-sm" aria-live="polite">
                  <p>
                    Sau khi thêm: tổng trọng số <b className="tabular-nums">{formatWeight(preview.weightAfter)}</b> · <b className="tabular-nums">{preview.countAfter}</b> chỉ tiêu
                  </p>
                  {!isWeightComplete(preview.weightAfter) && <p className="text-muted-foreground">Tổng trọng số chưa đúng 100% — chỉnh trọng số trên Goal Plan sau khi thêm.</p>}
                  {(preview.countAfter < GOAL_COUNT.min || preview.countAfter > GOAL_COUNT.max) && (
                    <p className="text-muted-foreground">Goal Plan cần {GOAL_COUNT.min}–{GOAL_COUNT.max} chỉ tiêu để gửi duyệt.</p>
                  )}
                  {preview.withoutTarget + preview.zeroWeight > 0 && (
                    <p className="text-muted-foreground">
                      {preview.withoutTarget > 0 && `${preview.withoutTarget} chỉ tiêu chưa có mục tiêu. `}
                      {preview.zeroWeight > 0 && `${preview.zeroWeight} chỉ tiêu có trọng số 0%. `}
                      Bổ sung trước khi gửi.
                    </p>
                  )}
                </div>
                {adding === 0 && <InlineNotice tone="info" title="Mọi chỉ tiêu của bộ mẫu đều bị bỏ qua." />}
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-support-negative">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>
            Hủy
          </Button>
          <Button onClick={onAdd} disabled={adding === 0 || apply.isPending} aria-busy={apply.isPending || undefined}>
            {adding > 0 ? `Thêm ${adding} chỉ tiêu` : 'Thêm chỉ tiêu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
