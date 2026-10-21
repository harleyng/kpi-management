import { useMemo, useState } from 'react';
import { EntityCombobox, type ComboboxOption } from '@/components/shared/EntityCombobox';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/contexts/useSession';
import type { Employee, Goal, GoalPlan } from '@/data/types';
import { useCascadeGoal, useCycles, useGoalRows, usePlansEditability, type GoalLookups, type PlanWorkspaceData } from '@/hooks/queries/goals';
import { useSessionDirectory } from '@/hooks/queries/session';
import { toastSaved } from '@/hooks/queries/toasts';
import { SHARE_SAFE_METHODS, allocationBuckets, cascadedGoalDraft, checkAlignment, type CascadeChild } from '@/lib/alignmentRules';
import { KpiError } from '@/lib/errorCatalog';
import { nextSortOrder, remainingWeight } from '@/lib/goalPlanRules';
import { formatDecimalInput, parseDecimalInput } from '@/lib/numberInput';
import { isEffectiveOn } from '@/lib/orgRules';
import { cascadeTargetPlans, planOwnerOf } from '@/lib/planAccessRules';
import { formatNumber } from '@/lib/utils';
import { EDIT_REASON_COPY, firstIssueText, formatTarget } from './goalCopy';

interface CascadeDialogProps {
  data: PlanWorkspaceData;
  lookups: GoalLookups;
  parent: Goal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CascadeMode = 'unit' | 'employee';

/** One plan a share can go to, with the person whose dates clip the child goal and why it is closed. */
interface CascadeTarget {
  key: string;
  plan: GoalPlan | null;
  owner: Employee | null;
  label: string;
  description: string | undefined;
  disabled: boolean;
}

/**
 * "Phân giao" (WBS 4.3.4, BR-KPI-07, BR-KPI-12 step 1): hand part of a goal down — a child goal in
 * the target plan plus a CASCADE alignment (`useCascadeGoal`). From an Employee plan the targets are
 * the owner's direct reports; from a Company / OrgUnit plan also the plans of the nearest planned
 * units below (`cascadeTargetPlans`), chosen with "Giao cho: Đơn vị | Nhân viên". A target whose plan
 * the user may not edit now is listed disabled with the reason (`usePlansEditability` — the gateway's
 * own decision; HR acting for a step's actor is named). A unit target's child goal belongs to the unit
 * head, like every goal of a unit plan. The buckets preview is `alignmentRules.allocationBuckets`.
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
  const unitPlans = useMemo(() => cascadeTargetPlans(data.plan, [...data.relatedPlans.values()], lookups.orgUnits, today), [data.plan, data.relatedPlans, lookups.orgUnits, today]);
  const targetPlans = useMemo(() => [...unitPlans, ...reportPlans], [unitPlans, reportPlans]);
  const editability = usePlansEditability(targetPlans, cycles.data);

  const [mode, setMode] = useState<CascadeMode>(unitPlans.length > 0 ? 'unit' : 'employee');
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [weight, setWeight] = useState('');
  const [methodId, setMethodId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Why a target plan cannot take the share now, else who the user acts for (HR as proxy). */
  const planNote = (plan: GoalPlan): { reason?: string; actingFor?: string } => {
    const decision = editability.byPlan.get(plan.id);
    if (decision && !decision.decision.ok) return { reason: EDIT_REASON_COPY[decision.reason] ?? undefined };
    const forUserId = decision?.standing?.onBehalfOfUserId ?? null;
    if (forUserId === null || !directory) return {};
    const account = directory.accounts.find((a) => a.id === forUserId);
    const person = account?.employeeId ? lookups.employee.get(account.employeeId) : undefined;
    return { actingFor: person?.fullName ?? account?.login };
  };

  const targets: CascadeTarget[] = (() => {
    if (mode === 'unit') {
      return unitPlans.map((plan) => {
        const unit = plan.ownerOrgUnitId ? lookups.orgUnit.get(plan.ownerOrgUnitId) : undefined;
        const head = unit?.headEmployeeId ? (lookups.employee.get(unit.headEmployeeId) ?? null) : null;
        const note = planNote(plan);
        const reason = head === null ? 'Đơn vị chưa có trưởng đơn vị — chỉ tiêu giao xuống cần người phụ trách.' : note.reason;
        const description = reason ?? (note.actingFor ? `Thao tác thay ${note.actingFor}` : `Trưởng đơn vị: ${head?.fullName}`);
        return { key: plan.id, plan, owner: head, label: unit?.name ?? '—', description, disabled: reason !== undefined };
      });
    }
    return reports.map((r) => {
      const plan = reportPlans.find((p) => p.ownerEmployeeId === r.id) ?? null;
      const note = plan ? planNote(plan) : {};
      const reason = !plan ? 'Chưa có Goal Plan trong chu kỳ này' : note.reason;
      const description = reason ?? (note.actingFor ? `${r.employeeCode} · thao tác thay ${note.actingFor}` : r.employeeCode);
      return { key: r.id, plan, owner: r, label: r.fullName, description, disabled: reason !== undefined };
    });
  })();

  const target = targets.find((t) => t.key === targetKey && !t.disabled) ?? null;
  const targetPlan = target?.plan ?? null;
  const targetGoals = useGoalRows({ goalPlanIds: targetPlan ? [targetPlan.id] : [] }, { enabled: targetPlan !== null });
  const cascade = useCascadeGoal();

  const pickMode = (next: CascadeMode) => {
    setMode(next);
    setTargetKey(null);
    setWeight('');
    setError(null);
  };
  const pick = (key: string | null) => {
    setTargetKey(key);
    setWeight('');
    setError(null);
  };
  const parentMethod = lookups.method.get(parent.calcMethodId) ?? null;
  const shareSafe = parentMethod !== null && SHARE_SAFE_METHODS.includes(parentMethod.methodType);

  const options: ComboboxOption[] = targets.map((t) => ({ id: t.key, label: t.label, description: t.description, disabled: t.disabled }));
  const byUnit = mode === 'unit';

  // Offer what is left to reach 100% in the target plan, once its goals are known.
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
  const owner = target?.owner ?? null;
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
          toastSaved('Đã phân giao chỉ tiêu', `${target?.label}: ${formatNumber(proposedValue)}${unit ? ` ${unit.name}` : ''}`);
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
            Giao một phần mục tiêu {formatTarget(parent, unit)} cho {byUnit ? 'đơn vị cấp dưới' : 'nhân viên trực tiếp'}. Hệ thống tạo chỉ tiêu tương ứng trong Goal Plan
            {byUnit ? ' của đơn vị' : ' của nhân viên'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {unitPlans.length > 0 && (
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <legend className="float-left mr-4 text-sm font-medium">Giao cho</legend>
              {(['unit', 'employee'] as const).map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="cascade-mode" value={m} checked={mode === m} onChange={() => pickMode(m)} />
                  {m === 'unit' ? 'Đơn vị' : 'Nhân viên'}
                </label>
              ))}
            </fieldset>
          )}
          <FormField
            label={byUnit ? 'Đơn vị nhận' : 'Nhân viên'}
            required
            hint={
              byUnit
                ? 'Goal Plan của các đơn vị cấp dưới gần nhất trong chu kỳ. Chỉ chọn được Goal Plan bạn đang được sửa.'
                : reports.length === 0
                  ? 'Bạn chưa có nhân viên trực tiếp nào.'
                  : 'Chỉ chọn được nhân viên có phiếu đăng ký đang ở bước phân giao của bạn.'
            }
          >
            {(control) => (
              <EntityCombobox
                {...control}
                options={options}
                query={editability.state}
                placeholder={byUnit ? 'Chọn đơn vị' : 'Chọn nhân viên'}
                searchPlaceholder={byUnit ? 'Tìm theo tên đơn vị' : 'Tìm theo tên hoặc mã'}
                emptyText={byUnit ? 'Không có đơn vị cấp dưới nào có Goal Plan trong chu kỳ.' : 'Không có nhân viên trực tiếp.'}
                value={target?.key ?? null}
                onChange={pick}
              />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={`Phần giao${unit ? ` (${unit.name})` : ''}`} required error={value !== '' ? firstIssueText(issues) : undefined}>
              {(control) => <Input {...control} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />}
            </FormField>
            <FormField label="Trọng số (%)" required hint={`Trong Goal Plan ${byUnit ? 'của đơn vị' : 'của nhân viên'}; mặc định là phần còn thiếu để đủ 100%.`}>
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

          <dl className="grid grid-cols-2 gap-3 rounded-md border bg-surface-alt p-3 text-right text-sm" aria-label="Phân bổ sau khi giao">
            <div>
              <dt className="text-xs text-muted-foreground">Mục tiêu</dt>
              <dd className="tabular-nums">{formatNumber(preview.target)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Đã giao</dt>
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
