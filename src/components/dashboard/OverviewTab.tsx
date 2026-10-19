import { useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { InlineNotice } from '@/components/shared/InlineNotice';
import type { Id } from '@/data/types';
import { useResultLines, type DashboardRead, type DashboardSelection } from '@/hooks/queries/dashboard';
import { dashboardSnapshot, isOfficial, staffOfUnit, trendSeries, type UnitNode } from '@/lib/dashboardRules';
import { errorSpecOf } from '@/lib/errorCatalog';
import { loadPhase } from '@/lib/queryState';
import { InsightCard } from './InsightCard';
import { ATTENTION_HINT, AttentionList, Panel, PanelState, PerspectiveBars, TrendChart } from './SidePanels';
import { useFocusUnit } from './useDashboardSelection';
import { ChildUnitsTable, StaffTable } from './UnitTables';
import { UnitBreadcrumb, UnitSummary } from './UnitSummary';

/**
 * "Tổng quan" (WBS 4.7.1 executive + 4.7.2 manager): one drill-down whose root is the highest unit the
 * viewer's `dashboard.view` covers — the company for BOD / HR, their own unit for a manager. The unit
 * table is the main surface; the side column explains the unit in focus.
 */
export function OverviewTab({ selection, read, overdueForms }: { selection: DashboardSelection; read: DashboardRead; overdueForms: number | null }) {
  const { model } = read;
  const { focusId, setFocus } = useFocusUnit(model);
  const phase = loadPhase(read.query, model !== undefined);

  if (phase === 'error') return <ErrorStateCard spec={errorSpecOf(read.query.error)} onAction={() => void read.query.refetch()} />;
  if (phase === 'loading' || (phase === 'idle' && selection.cycle !== null)) return <Skeleton className="h-72 w-full" />;
  if (!model) return <EmptyStateCard>Chu kỳ này chưa có kỳ đánh giá nào.</EmptyStateCard>;
  const focus = focusId ? model.nodes.get(focusId) : undefined;
  if (!focus) return <EmptyStateCard>Bạn chưa được giao phạm vi đơn vị nào để xem dashboard.</EmptyStateCard>;

  return <FocusedUnit key={focus.unit.id} read={read} focus={focus} onSelect={setFocus} overdueForms={overdueForms} cycleResults={selection.cycleResults ?? []} />;
}

function FocusedUnit({
  read,
  focus,
  onSelect,
  overdueForms,
  cycleResults,
}: {
  read: DashboardRead;
  focus: UnitNode;
  onSelect: (unitId: Id) => void;
  overdueForms: number | null;
  cycleResults: NonNullable<DashboardSelection['cycleResults']>;
}) {
  const model = read.model!;
  const levels = read.data?.levels ?? [];
  const children = focus.childIds.map((id) => model.nodes.get(id)).filter((n): n is UnitNode => n !== undefined);
  const staff = staffOfUnit(model, focus.unit.id);
  const lines = useResultLines(focus.own, focus.ownPlan);
  const trend = useMemo(() => (focus.ownPlan && read.data ? trendSeries(cycleResults, read.data.periods, focus.ownPlan.id) : []), [focus.ownPlan, read.data, cycleResults]);
  const snapshot = useMemo(
    () => dashboardSnapshot(model.period.tenantId, model, focus.unit.id, focus.own && lines.view ? lines.view.attention.items : null, overdueForms),
    [model, focus.unit.id, focus.own, lines.view, overdueForms],
  );
  const periodHasOfficial = [...model.nodes.values()].some((n) => n.own !== null && isOfficial(n.own)) || model.staff.some((s) => s.result !== null && isOfficial(s.result));

  return (
    <div className="space-y-4">
      <UnitBreadcrumb model={model} focusId={focus.unit.id} onSelect={onSelect} />
      {!periodHasOfficial && (
        <InlineNotice tone="info" title={`Kỳ ${model.period.label} chưa chốt.`}>
          Điểm là tạm tính và chưa vào thống kê chính thức.
        </InlineNotice>
      )}
      <UnitSummary node={focus} previousLabel={model.previous?.label ?? null} />

      <div className="grid gap-4 min-[1536px]:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          {children.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">Đơn vị trực thuộc</h2>
              <ChildUnitsTable model={model} nodes={children} onSelect={onSelect} />
            </section>
          )}
          {(staff.length > 0 || children.length === 0) && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold">{children.length > 0 ? 'Nhân viên trực tiếp' : 'Nhân viên'}</h2>
              <StaffTable model={model} staff={staff} levels={levels} unitName={focus.unit.name} />
            </section>
          )}
          {model.unplaced.length > 0 && focus.unit.parentId === null && (
            <p className="text-xs text-muted-foreground">
              {model.unplaced.length} người có kế hoạch nhưng chưa xếp đơn vị trong kỳ — không tính vào đơn vị nào.
            </p>
          )}
        </div>

        {/* Under 1536px the panels stack below the tables, two by two — the tables keep the full width. */}
        <div className="grid content-start gap-4 md:grid-cols-2 min-[1536px]:grid-cols-1">
          <Panel title="Chỉ tiêu cần chú ý" hint={ATTENTION_HINT}>
            {focus.own === null ? (
              <p className="text-sm text-muted-foreground">{focus.ownPlan === null ? 'Đơn vị không có kế hoạch riêng.' : 'Chưa có kết quả kỳ này.'}</p>
            ) : (
              <PanelState query={lines.query} hasData={lines.view !== undefined}>
                {lines.view && <AttentionList items={lines.view.attention.items} hiddenCount={lines.view.attention.hiddenCount} />}
              </PanelState>
            )}
          </Panel>
          <Panel title="Theo viễn cảnh BSC" hint="% hoàn thành bình quân có trọng số của từng viễn cảnh — không cộng thành điểm tổng.">
            {focus.own === null ? (
              <p className="text-sm text-muted-foreground">Chưa có kết quả để chia theo viễn cảnh.</p>
            ) : (
              <PanelState query={lines.query} hasData={lines.view !== undefined}>
                {lines.view && <PerspectiveBars rows={lines.view.perspectives} names={lines.view.perspectiveNames} />}
              </PanelState>
            )}
          </Panel>
          <Panel title="Xu hướng">
            {focus.ownPlan === null ? <p className="text-sm text-muted-foreground">Đơn vị không có kế hoạch riêng.</p> : <TrendChart points={trend} name={focus.unit.name} />}
          </Panel>
          <InsightCard snapshot={snapshot} />
        </div>
      </div>
    </div>
  );
}
