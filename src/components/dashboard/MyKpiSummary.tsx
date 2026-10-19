import { useMemo } from 'react';
import { MissingValue } from '@/components/shared/DataTable';
import { PayoutValue, RatingValue } from '@/components/results/ResultCells';
import type { CyclePeriod, GoalPlan, PeriodResult, RatingLevel } from '@/data/types';
import { useResultLines } from '@/hooks/queries/dashboard';
import { latestOfficialResult, trendSeries } from '@/lib/dashboardRules';
import { payoutState } from '@/lib/resultView';
import { formatNumber } from '@/lib/utils';
import { DeltaValue, Figure } from './DashboardFigures';
import { ATTENTION_HINT, AttentionList, PanelState } from './SidePanels';

/**
 * "KPI của tôi" on "Kết quả của tôi" (WBS 4.7.2, Phase 3): the latest FINALISED result of the cycle —
 * score, rating, % lương KPI, the difference with the month before — the months as text, and the goals
 * that need attention. Nothing provisional ever shows here (BR-KPI-82).
 */
export function MyKpiSummary({
  results,
  periods,
  plans,
  levels,
}: {
  results: readonly PeriodResult[];
  periods: readonly CyclePeriod[];
  plans: readonly GoalPlan[];
  levels: readonly RatingLevel[];
}) {
  const latest = useMemo(() => latestOfficialResult(results, periods), [results, periods]);
  const plan = latest ? (plans.find((p) => p.id === latest.result.goalPlanId) ?? null) : null;
  const lines = useResultLines(latest?.result ?? null, plan);
  const months = useMemo(
    () => (latest ? trendSeries([...results], periods, latest.result.goalPlanId, { officialOnly: true }).filter((p) => p.score !== null) : []),
    [latest, results, periods],
  );

  if (!latest) {
    return (
      <section aria-labelledby="my-kpi-title" className="rounded-md border bg-card px-4 py-3">
        <h2 id="my-kpi-title" className="text-base font-semibold">
          KPI của tôi
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Kết quả kỳ này chưa được chốt. Số liệu hiện ở đây sau khi HR chốt kết quả.</p>
      </section>
    );
  }
  const level = latest.result.ratingLevelId ? (levels.find((l) => l.id === latest.result.ratingLevelId) ?? null) : null;

  return (
    <section aria-labelledby="my-kpi-title" className="space-y-3 rounded-md border bg-card px-4 py-3">
      <h2 id="my-kpi-title" className="text-base font-semibold">
        KPI của tôi — kỳ {latest.period.label}
      </h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Figure term="Điểm KPI">{latest.result.totalScore === null ? <MissingValue /> : <span className="tabular">{formatNumber(latest.result.totalScore, 2)}</span>}</Figure>
        <Figure term="Xếp loại">
          <RatingValue result={latest.result} level={level} />
        </Figure>
        <Figure term="% hưởng lương KPI">
          <span className="flex [&>span]:items-start">
            <PayoutValue state={payoutState(latest.result, levels)} />
          </span>
        </Figure>
        <Figure term={latest.previousPeriod ? `Chênh lệch so với ${latest.previousPeriod.label} (điểm)` : 'Chênh lệch so với kỳ trước (điểm)'}>
          <span className="flex [&>span]:items-start">
            {latest.previousPeriod && latest.previous === null ? (
              <span className="text-sm font-normal text-muted-foreground">Kỳ trước chưa chốt</span>
            ) : (
              <DeltaValue delta={latest.delta} hasPrevious={latest.previousPeriod !== null} />
            )}
          </span>
        </Figure>
      </dl>
      {months.length > 1 && (
        <p className="text-sm">
          <span className="text-muted-foreground">Các kỳ đã chốt: </span>
          {months.map((m) => `${m.label} ${formatNumber(m.score, 2)}`).join(' · ')}
        </p>
      )}
      <div>
        <h3 className="text-sm font-semibold">Chỉ tiêu cần chú ý</h3>
        <p className="text-xs text-muted-foreground">{ATTENTION_HINT}</p>
        <div className="mt-2">
          <PanelState query={lines.query} hasData={lines.view !== undefined}>
            {lines.view && <AttentionList items={lines.view.attention.items} hiddenCount={lines.view.attention.hiddenCount} />}
          </PanelState>
        </div>
      </div>
    </section>
  );
}
