import { useMemo, useState } from 'react';
import { EntityCombobox, type ComboboxOption } from '@/components/shared/EntityCombobox';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/contexts/useSession';
import type { Goal } from '@/data/types';
import { useCascadeGoal, useCycles, useGoalRows, usePlansEditability, type GoalLookups, type PlanWorkspaceData } from '@/hooks/queries/goals';
import { useSessionDirectory } from '@/hooks/queries/session';
import { toastSaved } from '@/hooks/queries/toasts';
import { SHARE_SAFE_METHODS, allocationBuckets, cascadedGoalDraft, checkAlignment, type CascadeChild } from '@/lib/alignmentRules';
import { KpiError } from '@/lib/errorCatalog';
import { nextSortOrder, remainingWeight } from '@/lib/goalPlanRules';
import { formatDecimalInput, parseDecimalInput } from '@/lib/numberInput';
import { isEffectiveOn } from '@/lib/orgRules';
import { planOwnerOf } from '@/lib/planAccessRules';
import { formatNumber } from '@/lib/utils';
import { EDIT_REASON_COPY, firstIssueText, formatTarget } from './goalCopy';

interface CascadeDialogProps {
  data: PlanWorkspaceData;
  lookups: GoalLookups;
  parent: Goal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Phân giao cho nhân viên" (WBS 4.3.4, BR-KPI-07, BR-KPI-12 step 1): hand part of a goal down to a
 * direct report — a child goal in their plan plus a CASCADE alignment (`useCascadeGoal`). A report
 * whose plan the manager may not edit now is listed disabled with the reason (their registration
 * form must be at the manager's step). The buckets preview is `alignmentRules.allocationBuckets`.
 */
export function CascadeDialog({ data, lookups, parent, open, onOpenChange }: CascadeDialogProps) {
  const { tenantId, today } = useSession();
  const directory = useSessionDirectory(tenantId).data;
  const cycles = useCycles();
  const ownerEmployeeId = planOwnerOf(data.plan, lookups.orgUnits);

  const reports = useMemo(
    () =>
      ownerEmployeeId && directory
        ? directory.assignments
            .filter((a) => a.isPrimary && a.managerEmployeeId === ownerEmployeeId && isEffectiveOn(a, today))
            .map((a) => lookups.employee.get(a.employeeId))
            .filter((e): e is NonNullable<typeof e> => e !== undefined && e.employmentStatus !== 'Resigned')
        : [],
    [ownerEmployeeId, directory, today, lookups.employee],
  );
  const reportPlans = useMemo(
    () => [...data.relatedPlans.values()].filter((p) => p.cycleId === data.plan.cycleId && p.ownerType === 'Employee' && reports.some((r) => r.id === p.ownerEmployeeId)),
    [data.relatedPlans, data.plan.cycleId, reports],
  );
  const editability = usePlansEditability(reportPlans, cycles.data);

  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [weight, setWeight] = useState('');
  const [methodId, setMethodId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const targetPlan = reportPlans.find((p) => p.ownerEmployeeId === employeeId) ?? null;
  const targetGoals = useGoalRows({ goalPlanIds: targetPlan ? [targetPlan.id] : [] }, { enabled: targetPlan !== null });
  const cascade = useCascadeGoal();

  const parentMethod = lookups.method.get(parent.calcMethodId) ?? null;
  const shareSafe = parentMethod !== null && SHARE_SAFE_METHODS.includes(parentMethod.methodType);

  const options = useMemo<ComboboxOption[]>(
    () =>
      reports.map((r) => {
        const plan = reportPlans.find((p) => p.ownerEmployeeId === r.id);
        const decision = plan ? editability.byPlan.get(plan.id) : undefined;
        const reason = !plan ? 'Chưa có Goal Plan trong chu kỳ này' : decision && !decision.decision.ok ? (EDIT_REASON_COPY[decision.reason] ?? undefined) : undefined;
        return { id: r.id, label: r.fullName, description: reason ?? r.employeeCode, disabled: reason !== undefined };
      }),
    [reports, reportPlans, editability.byPlan],
  );

  const pick = (id: string | null) => {
    setEmployeeId(id);
    setError(null);
  };
  // Offer what is left to reach 100% in the report's plan, once their goals are known.
  const suggestedWeight = targetGoals.data ? remainingWeight(targetGoals.data) : null;
  const weightText = weight !== '' ? weight : suggestedWeight !== null ? formatDecimalInput(suggestedWeight) : '';

  const allocated = parseDecimalInput(value);
  const weightValue = parseDecimalInput(weightText);
  const existing: CascadeChild[] = (data.cascadeChildren.get(parent.id) ?? []).map((c) => ({
    ...c,
    childOwner: c.childGoal.ownerEmployeeId ? (lookups.employee.get(c.childGoal.ownerEmployeeId) ?? null) : null,
  }));
  const proposedValue = allocated !== null && !Number.isNaN(allocated) ? allocated : null;
  const preview = allocationBuckets(
    parent,
    proposedValue !== null && proposedValue > 0 ? [...existing, { alignment: { id: 'proposed', alignmentType: 'CASCADE', allocatedValue: proposedValue }, childGoal: { status: 'Active' }, childOwner: null }] : existing,
    today,
  );
  const issues = checkAlignment(
    { childGoalId: 'new-child', parentGoalId: parent.id, alignmentType: 'CASCADE', allocatedValue: proposedValue, contributionPct: null },
    { alignments: data.allAlignments, parentGoal: parent, existingChildren: existing, asOf: today },
  );
  const owner = employeeId ? (lookups.employee.get(employeeId) ?? null) : null;
  const draft =
    targetPlan && owner
      ? cascadedGoalDraft(parent, parentMethod, {
          goalPlanId: targetPlan.id,
          ownerEmployeeId: owner.id,
          allocatedValue: proposedValue ?? Number.NaN,
          weight: weightValue ?? Number.NaN,
          sortOrder: targetGoals.data ? nextSortOrder(targetGoals.data) : 0,
          calcMethodId: methodId,
          cycle: data.cycle,
          owner,
        })
      : null;
  const ready = draft?.ok === true && issues.length === 0 && targetGoals.data !== undefined;
  const unit = lookups.unit.get(parent.unitId);

  const onSubmit = () => {
    setError(null);
    if (!draft || !draft.ok || proposedValue === null) return;
    cascade.mutate(
      { parentGoalId: parent.id, child: draft.goal, allocatedValue: proposedValue },
      {
        onSuccess: () => {
          toastSaved('Đã phân giao chỉ tiêu', `${owner?.fullName}: ${formatNumber(proposedValue)}${unit ? ` ${unit.name}` : ''}`);
          onOpenChange(false);
        },
        onError: (e) => setError(e instanceof KpiError ? (firstIssueText(e.issues) ?? null) : null),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Phân giao: {parent.name}</DialogTitle>
          <DialogDescription>
            Giao một phần mục tiêu {formatTarget(parent, unit)} cho nhân viên trực tiếp. Hệ thống tạo chỉ tiêu tương ứng trong Goal Plan của nhân viên.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormField label="Nhân viên" required hint={reports.length === 0 ? 'Bạn chưa có nhân viên trực tiếp nào.' : 'Chỉ chọn được nhân viên có phiếu đăng ký đang ở bước phân giao của bạn.'}>
            {(control) => (
              <EntityCombobox
                {...control}
                options={options}
                query={editability.state}
                placeholder="Chọn nhân viên"
                searchPlaceholder="Tìm theo tên hoặc mã"
                emptyText="Không có nhân viên trực tiếp."
                value={employeeId}
                onChange={pick}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={`Phần giao${unit ? ` (${unit.name})` : ''}`} required error={value !== '' ? firstIssueText(issues) : undefined}>
              {(control) => <Input {...control} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}
            </FormField>
            <FormField label="Trọng số (%)" required hint="Trong Goal Plan của nhân viên; mặc định là phần còn thiếu để đủ 100%.">
              {(control) => <Input {...control} inputMode="decimal" value={weightText} onChange={(e) => setWeight(e.target.value)} />}
            </FormField>
          </div>
          {!shareSafe && (
            <FormField label="Phương pháp tính cho phần giao" required hint="Định mức, bậc thang hoặc công thức của chỉ tiêu cha viết cho cả mục tiêu, không áp dụng cho một phần.">
              {(control) => (
                <Select value={methodId ?? ''} onValueChange={setMethodId}>
                  <SelectTrigger {...control}>
                    <SelectValue placeholder="Chọn phương pháp" />
                  </SelectTrigger>
                  <SelectContent>
                    {lookups.methods
                      .filter((m) => SHARE_SAFE_METHODS.includes(m.methodType))
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}

          <dl className="grid grid-cols-2 gap-3 rounded-md border bg-surface-alt p-3 text-right text-sm sm:grid-cols-4" aria-label="Phân bổ sau khi giao">
            <div>
              <dt className="text-xs text-muted-foreground">Mục tiêu</dt>
              <dd className="tabular-nums">{formatNumber(preview.target)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Đã giao NV</dt>
              <dd className="tabular-nums">{formatNumber(preview.assigned)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Tự giao</dt>
              <dd className="tabular-nums">{formatNumber(preview.selfAssigned)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Chưa giao</dt>
              <dd className={`tabular-nums ${preview.overAllocated ? 'text-support-negative' : ''}`}>
                {formatNumber(preview.unassigned)}
                {preview.overAllocated && <span className="block text-xs">Vượt mục tiêu</span>}
              </dd>
            </div>
          </dl>

          {draft && !draft.ok && value !== '' && (
            <p className="text-sm text-support-negative" role="alert">
              {firstIssueText(draft.issues)}
            </p>
          )}
          {error && (
            <p className="text-sm text-support-negative" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cascade.isPending}>
            Hủy
          </Button>
          <Button onClick={onSubmit} disabled={!ready || cascade.isPending} aria-busy={cascade.isPending}>
            Phân giao
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
