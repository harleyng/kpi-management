import { useMemo, useState } from 'react';
import { ArrowLeft, Link2 } from 'lucide-react';
import { EntityCombobox, type ComboboxOption } from '@/components/shared/EntityCombobox';
import { FormField } from '@/components/shared/FormField';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useSession } from '@/contexts/useSession';
import { OWNER_TYPE_LABEL, type Goal, type GoalPlan } from '@/data/types';
import { useDeleteAlignment, useGoals, useSaveAlignment, type GoalLookups, type PlanWorkspaceData } from '@/hooks/queries/goals';
import { useSessionDirectory } from '@/hooks/queries/session';
import { toastSaved } from '@/hooks/queries/toasts';
import { checkAlignment } from '@/lib/alignmentRules';
import { KpiError } from '@/lib/errorCatalog';
import { parseDecimalInput } from '@/lib/numberInput';
import { linkCandidatePlans } from '@/lib/planAccessRules';
import { formatNumber } from '@/lib/utils';
import { firstIssueText, formatTarget } from './goalCopy';

interface LinkGoalPanelProps {
  data: PlanWorkspaceData;
  lookups: GoalLookups;
  goal: Goal;
  readOnly: boolean;
  onClose: () => void;
}

const planLabel = (plan: GoalPlan, lookups: GoalLookups) =>
  plan.ownerType === 'Employee'
    ? (lookups.employee.get(plan.ownerEmployeeId ?? '')?.fullName ?? 'Cá nhân')
    : plan.ownerType === 'Company'
      ? OWNER_TYPE_LABEL.Company
      : (lookups.orgUnit.get(plan.ownerOrgUnitId ?? '')?.name ?? OWNER_TYPE_LABEL.OrgUnit);

/**
 * "Liên kết lên chỉ tiêu cấp trên" (WBS 4.3.4, BR-KPI-07): an employee ties a goal they added to a
 * goal of their manager, their unit or the company (`planAccessRules.linkCandidatePlans`). Only goals
 * the person may SEE are offered (D2). The contribution % is informational in P1 (`ASSUMPTION Q31`).
 */
export function LinkGoalPanel({ data, lookups, goal, readOnly, onClose }: LinkGoalPanelProps) {
  const { tenantId, today } = useSession();
  const directory = useSessionDirectory(tenantId).data;
  const candidates = useMemo(
    () => (directory ? linkCandidatePlans(data.plan, [...data.relatedPlans.values()], { assignments: directory.assignments, units: directory.orgUnits, today }) : []),
    [directory, data.plan, data.relatedPlans, today],
  );
  const parentGoals = useGoals({ goalPlanIds: candidates.map((p) => p.id), status: 'Active' }, candidates, { enabled: candidates.length > 0 });
  const save = useSaveAlignment();
  const remove = useDeleteAlignment();
  const [parentId, setParentId] = useState<string | null>(null);
  const [pct, setPct] = useState('100');
  const [error, setError] = useState<string | null>(null);

  const existing = data.alignments.filter((a) => a.childGoalId === goal.id);
  const options = useMemo<ComboboxOption[] | undefined>(() => {
    if (!parentGoals.data) return undefined;
    const planById = new Map(candidates.map((p) => [p.id, p]));
    const linked = new Set(existing.map((a) => a.parentGoalId));
    return candidates.flatMap((plan) =>
      parentGoals.data.goals
        .filter((g) => g.goalPlanId === plan.id)
        .map((g) => ({
          id: g.id,
          label: g.name,
          description: formatTarget(g, lookups.unit.get(g.unitId)),
          group: planLabel(planById.get(g.goalPlanId) as GoalPlan, lookups),
          disabled: linked.has(g.id),
        })),
    );
  }, [parentGoals.data, candidates, existing, lookups]);

  const contribution = parseDecimalInput(pct);
  const parent = parentId && parentGoals.data ? parentGoals.data.goals.find((g) => g.id === parentId) : undefined;
  const preIssues = parent
    ? checkAlignment(
        { childGoalId: goal.id, parentGoalId: parent.id, alignmentType: 'LINK', allocatedValue: null, contributionPct: contribution !== null && !Number.isNaN(contribution) ? contribution : null },
        { alignments: data.allAlignments, parentGoal: parent, existingChildren: [], asOf: today },
      )
    : [];

  const onAdd = () => {
    setError(null);
    if (!parent || preIssues.length) return;
    save.mutate(
      { childGoalId: goal.id, parentGoalId: parent.id, alignmentType: 'LINK', contributionPct: contribution, allocatedValue: null },
      {
        onSuccess: () => {
          toastSaved('Đã liên kết chỉ tiêu');
          setParentId(null);
        },
        onError: (e) => setError(e instanceof KpiError ? (firstIssueText(e.issues) ?? null) : null),
      },
    );
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft aria-hidden />
          Quay lại danh sách
        </Button>
        <SectionTitle icon={Link2} title={`Liên kết: ${goal.name}`}>
          Liên kết chỉ tiêu này lên chỉ tiêu của quản lý, của bộ phận hoặc của công ty.
        </SectionTitle>

        <section aria-labelledby="links-now">
          <h3 id="links-now" className="mb-2 text-sm font-semibold">
            Đang liên kết
          </h3>
          {existing.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa liên kết với chỉ tiêu nào.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {existing.map((a) => {
                const p = data.relatedGoals.get(a.parentGoalId);
                const plan = p ? data.relatedPlans.get(p.goalPlanId) : undefined;
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      <span className="text-muted-foreground">{a.alignmentType === 'CASCADE' ? 'Phân giao từ' : 'Liên kết'}: </span>
                      {p ? p.name : 'Chỉ tiêu riêng tư'}
                      {plan && <span className="text-muted-foreground"> ({planLabel(plan, lookups)})</span>}
                      {a.alignmentType === 'LINK' && a.contributionPct !== null && <span className="tabular-nums text-muted-foreground"> · đóng góp {formatNumber(a.contributionPct)}%</span>}
                      {a.alignmentType === 'CASCADE' && a.allocatedValue !== null && <span className="tabular-nums text-muted-foreground"> · được giao {formatNumber(a.allocatedValue)}</span>}
                    </span>
                    {!readOnly && a.alignmentType === 'LINK' && (
                      <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(a.id, { onSuccess: () => toastSaved('Đã bỏ liên kết') })}>
                        Bỏ liên kết
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {existing.some((a) => a.alignmentType === 'CASCADE') && (
            <p className="mt-2 text-xs text-muted-foreground">Phân giao do quản lý tạo; chỉ quản lý (ở bước phân giao) mới bỏ được.</p>
          )}
        </section>

        {!readOnly && (
          <section aria-labelledby="link-new" className="space-y-3 border-t pt-4">
            <h3 id="link-new" className="text-sm font-semibold">
              Thêm liên kết
            </h3>
            {directory && candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có Goal Plan nào của quản lý, bộ phận hoặc công ty trong chu kỳ này để liên kết.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-[1fr_12rem]">
                <FormField label="Chỉ tiêu cấp trên" required error={preIssues.find((i) => i.code === 'ERR-KPI-10') ? firstIssueText(preIssues) : undefined}>
                  {(control) => (
                    <EntityCombobox
                      {...control}
                      options={options}
                      query={parentGoals}
                      placeholder="Chọn chỉ tiêu"
                      searchPlaceholder="Tìm theo tên chỉ tiêu"
                      emptyText="Không có chỉ tiêu nào để liên kết."
                      value={parentId}
                      onChange={setParentId}
                    />
                  )}
                </FormField>
                <FormField
                  label="Tỉ lệ đóng góp (%)"
                  required
                  hint="Giả định Q31: chỉ để tham khảo, chưa dùng để tính điểm."
                  error={preIssues.find((i) => i.detail === 'CONTRIBUTION_INVALID') ? firstIssueText(preIssues.filter((i) => i.detail === 'CONTRIBUTION_INVALID')) : undefined}
                >
                  {(control) => <Input {...control} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />}
                </FormField>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-support-negative">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Xong
              </Button>
              <Button onClick={onAdd} disabled={!parent || preIssues.length > 0 || save.isPending} aria-busy={save.isPending}>
                Liên kết
              </Button>
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
