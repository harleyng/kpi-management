import { Skeleton } from '@/components/ui/skeleton';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { PayrollExportTab } from '@/components/results/PayrollExportTab';
import { RatingTab } from '@/components/results/RatingTab';
import { ResultPeriodPicker } from '@/components/results/ResultPeriodPicker';
import { ResultsTab } from '@/components/results/ResultsTab';
import { useResultPeriod } from '@/components/results/useResultPeriod';
import { useRatingLevels, useRatingScales } from '@/hooks/queries/results';
import { errorSpecOf } from '@/lib/errorCatalog';
import { combineQueries, loadPhase } from '@/lib/queryState';

export type ResultsSection = 'period' | 'rating' | 'payroll';

const SECTIONS: Record<ResultsSection, { title: string; description: string }> = {
  period: { title: 'Kết quả theo kỳ', description: 'Tổng hợp điểm KPI, xếp loại và % hưởng lương KPI của từng người; tính, chốt và khóa kết quả theo kỳ.' },
  rating: { title: 'Xếp loại & quy đổi', description: 'Thang xếp loại của chu kỳ và quy đổi từ xếp loại sang % hưởng lương KPI.' },
  payroll: { title: 'Xuất file lương', description: 'Xuất % hưởng lương KPI của kỳ đã chốt cho bộ phận C&B.' },
};
const EMPTY_LEVELS: never[] = [];

/**
 * "Kết quả & lương" — WBS 4.6.1–4.6.4, Track T6 (HR, C&B); one sub-page per section. Every section
 * shares the cycle/period in the URL and waits for the cycle's rating scale before showing a row.
 */
export default function ResultsPayrollPage({ section }: { section: ResultsSection }) {
  const { title, description } = SECTIONS[section];
  const selection = useResultPeriod({ paidOnly: section === 'payroll' });
  const { cycle, period } = selection;
  const scaleId = cycle?.ratingScaleId ?? null;
  const scales = useRatingScales();
  const levels = useRatingLevels(scaleId);
  const scaleName = scaleId === null ? null : (scales.data?.find((s) => s.id === scaleId)?.name ?? null);

  // The scale is needed before any row is shown, or a rated row would flash "Không tìm thấy xếp loại".
  const base = combineQueries(scaleId === null ? [selection.query, scales] : [selection.query, scales, levels]);
  const ready =
    selection.cycles !== undefined && scales.data !== undefined && (scaleId === null || levels.data !== undefined) && (!cycle || selection.periods !== undefined);
  const phase = loadPhase(base, ready);
  const levelRows = levels.data ?? EMPTY_LEVELS;

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={selection.cycles && selection.cycles.length > 0 ? <ResultPeriodPicker selection={selection} showPeriod={section !== 'rating'} /> : undefined}
      />
      {phase === 'error' && <ErrorStateCard spec={errorSpecOf(base.error)} onAction={() => void base.refetch()} />}
      {phase === 'loading' && <Skeleton className="h-64 w-full" />}
      {ready && !cycle && <EmptyStateCard>Chưa có chu kỳ đánh giá nào. Tạo chu kỳ ở mục Chu kỳ trước.</EmptyStateCard>}
      {ready && cycle && section === 'rating' && <RatingTab cycle={cycle} levels={levels.data} levelsQuery={levels} scaleName={scaleName} />}
      {ready && cycle && section !== 'rating' && !period && <EmptyStateCard>Chu kỳ {cycle.name} chưa có kỳ đánh giá nào.</EmptyStateCard>}
      {ready && cycle && section === 'period' && period && <ResultsTab key={period.id} cycle={cycle} period={period} levels={levelRows} scaleName={scaleName} />}
      {ready && cycle && section === 'payroll' && period && <PayrollExportTab key={period.id} cycle={cycle} period={period} />}
    </>
  );
}
