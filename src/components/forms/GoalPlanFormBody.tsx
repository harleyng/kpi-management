import { Target } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { GoalPlanStatusBadge, GoalStatusBadge, PlanAdjustingBadge } from '@/components/shared/StatusBadge';
import type { Goal } from '@/data/types';
import { useDataSources } from '@/hooks/queries/actuals';
import { useForms } from '@/hooks/queries/forms';
import { useGoalRows, useKgis, useTargetLevels } from '@/hooks/queries/goals';
import { useMeasureUnits, usePerspectives } from '@/hooks/queries/library';
import { canSubmit } from '@/lib/formRules';
import { submitCheckInput } from '@/lib/formViewRules';
import { activeGoals, totalWeight } from '@/lib/goalPlanRules';
import { combineQueries } from '@/lib/queryState';
import { formatNumber, formatPercent } from '@/lib/utils';
import { FormActionBar } from './FormActionBar';
import { GoalTarget } from './GoalTarget';
import { StartAdjustmentButton } from './StartAdjustmentButton';
import type { FormDetail } from './useFormDetail';

/**
 * A registration form (GOAL_SETTING, BR-KPI-12): the Goal Plan as it stands, read-only, with the
 * step's actions. Editing the goals is the Goal Plan editor's job (Track T3); this screen never
 * imports it (plan §6.3). The blockers (100%, 5–8 goals, every goal measurable) are `canSubmit` from
 * the owner's step on — the manager's step-1 hand-over may be unfinished.
 */
export function GoalPlanFormBody({ detail, title }: { detail: FormDetail; title: string }) {
  const form = detail.form!;
  const standing = detail.standing!;
  const plan = detail.plan ?? null;
  const planId = form.goalPlanId;
  const goalsQuery = useGoalRows({ goalPlanIds: planId ? [planId] : [] }, { enabled: planId !== null });
  const kgis = useKgis(planId);
  const levels = useTargetLevels(planId ? { goalPlanId: planId } : null);
  const perspectives = usePerspectives();
  const sources = useDataSources();
  const units = useMeasureUnits();
  const changes = useForms(planId ? { goalPlanId: planId, formType: 'GOAL_CHANGE' } : {}, { limit: 50 }, { enabled: planId !== null });

  const goals = goalsQuery.data;
  const shown = goals?.filter((g) => g.status !== 'Changed').sort((a, b) => a.sortOrder - b.sortOrder);
  const adjusting = changes.data?.items.some((f) => f.status === 'Open' || f.status === 'InProgress') ?? false;

  const forwardable = standing.actions.includes('SUBMIT') || standing.actions.includes('APPROVE');
  const check =
    standing.step && goals && kgis.data && forwardable
      ? canSubmit(submitCheckInput(form, standing.step, standing.steps, { goals, kgis: kgis.data, items: [], changeItems: [] }))
      : null;
  const blockers = check && !check.ok ? check.issues : [];

  const columns: DataTableColumn<Goal>[] = [
    {
      id: 'name',
      header: 'Chỉ tiêu',
      cell: (g) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{g.name}</span>
          {g.status !== 'Active' && <GoalStatusBadge status={g.status} />}
        </span>
      ),
      className: 'min-w-[14rem]',
    },
    { id: 'perspective', header: 'Viễn cảnh', cell: (g) => perspectives.data?.find((p) => p.id === g.perspectiveId)?.name ?? null },
    { id: 'weight', header: 'Trọng số (%)', numeric: true, cell: (g) => formatNumber(g.weight), sortValue: (g) => g.weight },
    {
      id: 'target',
      header: 'Mục tiêu / định mức',
      cell: (g) => <GoalTarget goal={g} levels={levels.data ?? []} unit={units.data?.find((u) => u.id === g.unitId)} />,
    },
    { id: 'source', header: 'Nguồn số liệu', cell: (g) => sources.data?.find((s) => s.id === g.dataSourceId)?.name ?? null },
  ];

  const summary = goals && (
    <dl className="flex flex-wrap gap-x-6 gap-y-1">
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Tổng trọng số</dt>
        <dd className="tabular font-medium">{formatPercent(totalWeight(goals))}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Số chỉ tiêu</dt>
        <dd className="tabular font-medium">{activeGoals(goals).length}</dd>
      </div>
    </dl>
  );

  return (
    <>
      <Card>
        <CardContent className="space-y-3 p-4">
          <SectionTitle
            icon={Target}
            title="Goal Plan"
            action={plan && plan.status === 'Locked' && form.status === 'Completed' ? <StartAdjustmentButton plan={plan} lookups={detail.lookups} /> : undefined}
          >
            {plan && (
              <span className="flex flex-wrap items-center gap-1.5">
                <GoalPlanStatusBadge status={plan.status} />
                {adjusting && <PlanAdjustingBadge />}
              </span>
            )}
          </SectionTitle>
          {kgis.data && kgis.data.length > 0 && (
            <div>
              <p className="text-sm font-medium">Mục tiêu chung (KGI)</p>
              <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
                {kgis.data.map((k) => (
                  <li key={k.id}>{k.name}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      <DataTable
        label="Các chỉ tiêu trong Goal Plan"
        columns={columns}
        rows={shown}
        query={combineQueries([goalsQuery, kgis, levels, perspectives, sources, units])}
        getRowId={(g) => g.id}
        empty="Goal Plan chưa có chỉ tiêu nào. Quản lý giao chỉ tiêu ở bước đầu, nhân viên bổ sung ở bước sau."
        pageSize={null}
      />
      <FormActionBar form={form} formTitle={title} standing={standing} blockers={blockers} summary={summary} />
    </>
  );
}
