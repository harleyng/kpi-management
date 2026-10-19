import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

const TABS = ['results', 'rating', 'payroll'] as const;
type Tab = (typeof TABS)[number];
const EMPTY_LEVELS: never[] = [];

/** "Kết quả & lương" — WBS 4.6.1–4.6.4, Track T6 (HR, C&B). */
export default function ResultsPayrollPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'results';
  const selection = useResultPeriod();
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

  const setTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Kết quả & lương"
        description="Tổng hợp điểm KPI, xếp loại, % hưởng lương KPI và chốt kết quả theo kỳ."
        actions={selection.cycles && selection.cycles.length > 0 ? <ResultPeriodPicker selection={selection} showPeriod={tab !== 'rating'} /> : undefined}
      />
      {phase === 'error' && <ErrorStateCard spec={errorSpecOf(base.error)} onAction={() => void base.refetch()} />}
      {phase === 'loading' && <Skeleton className="h-64 w-full" />}
      {ready && !cycle && <EmptyStateCard>Chưa có chu kỳ đánh giá nào. Tạo chu kỳ ở mục Chu kỳ trước.</EmptyStateCard>}
      {ready && cycle && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="results">Kết quả kỳ</TabsTrigger>
            <TabsTrigger value="rating">Xếp loại & quy đổi</TabsTrigger>
            <TabsTrigger value="payroll">Xuất file lương</TabsTrigger>
          </TabsList>
          <TabsContent value="results" className="mt-4">
            {period ? (
              <ResultsTab key={period.id} cycle={cycle} period={period} levels={levelRows} scaleName={scaleName} />
            ) : (
              <EmptyStateCard>Chu kỳ {cycle.name} chưa có kỳ đánh giá nào.</EmptyStateCard>
            )}
          </TabsContent>
          <TabsContent value="rating" className="mt-4">
            <RatingTab cycle={cycle} levels={levels.data} levelsQuery={levels} scaleName={scaleName} />
          </TabsContent>
          <TabsContent value="payroll" className="mt-4">
            {period ? (
              <PayrollExportTab key={period.id} cycle={cycle} period={period} />
            ) : (
              <EmptyStateCard>Chu kỳ {cycle.name} chưa có kỳ đánh giá nào.</EmptyStateCard>
            )}
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
