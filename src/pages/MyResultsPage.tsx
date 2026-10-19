import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, MissingValue, type DataTableColumn } from '@/components/shared/DataTable';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { PeriodResultStatusBadge } from '@/components/shared/StatusBadge';
import { PayoutValue, RatingValue, ScoreValue } from '@/components/results/ResultCells';
import { ResultDetailDialog } from '@/components/results/ResultDetailDialog';
import { ResultPeriodPicker } from '@/components/results/ResultPeriodPicker';
import { useResultPeriod } from '@/components/results/useResultPeriod';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod, Id } from '@/data/types';
import { useGoalPlans } from '@/hooks/queries/goals';
import { usePeriodResults, useRatingLevels } from '@/hooks/queries/results';
import { errorSpecOf } from '@/lib/errorCatalog';
import { combineQueries, loadPhase } from '@/lib/queryState';
import { isShownToEmployee, payoutState, type ResultRow } from '@/lib/resultView';
import { formatDateTime } from '@/lib/utils';

interface MyRow extends ResultRow {
  period: CyclePeriod | null;
}

/**
 * "Kết quả của tôi" — WBS 4.6.4, Track T6 (every role with an employee record, BR-KPI-62). Only
 * finalised results show figures: a Draft may still be adjusted by HR, so it reads "Đang tổng hợp"
 * and no provisional number reaches the page.
 */
export default function MyResultsPage() {
  const { user } = useSession();
  return (
    <>
      <PageHeader title="Kết quả của tôi" description="Điểm KPI, xếp loại và % hưởng lương KPI theo từng kỳ, sau khi HR chốt." />
      {user.employeeId === null ? (
        <EmptyStateCard>Tài khoản này không gắn với nhân viên nên không có kết quả cá nhân.</EmptyStateCard>
      ) : (
        <MyResults employeeId={user.employeeId} name={user.name} />
      )}
    </>
  );
}

function MyResults({ employeeId, name }: { employeeId: Id; name: string }) {
  const selection = useResultPeriod({ withPeriod: false });
  const { cycle } = selection;
  const plans = useGoalPlans({ cycleId: cycle?.id, ownerType: 'Employee', ownerEmployeeIds: [employeeId] }, { enabled: cycle !== null });
  const planIds = useMemo(() => (plans.data ?? []).map((p) => p.id).sort(), [plans.data]);
  // Waits for the plans: "Chưa có kết quả" must never flash while they are still loading.
  const results = usePeriodResults({ goalPlanIds: planIds }, { enabled: plans.isSuccess && planIds.length > 0 });
  const levels = useRatingLevels(cycle?.ratingScaleId ?? null);
  const [openId, setOpenId] = useState<Id | null>(null);

  const rows = useMemo<MyRow[] | undefined>(() => {
    if (!plans.isSuccess || !selection.periods) return undefined;
    if (planIds.length === 0) return [];
    if (!results.data || (cycle?.ratingScaleId && !levels.data)) return undefined;
    const periods = new Map(selection.periods.map((p) => [p.id, p]));
    const levelById = new Map((levels.data ?? []).map((l) => [l.id, l]));
    return results.data
      .map((result) => ({
        result,
        ownerName: name,
        ownerCode: null,
        unitName: null,
        level: result.ratingLevelId ? (levelById.get(result.ratingLevelId) ?? null) : null,
        period: periods.get(result.periodId) ?? null,
      }))
      .sort((a, b) => ((a.period?.startDate ?? '') < (b.period?.startDate ?? '') ? 1 : -1));
  }, [plans.isSuccess, selection.periods, planIds, results.data, levels.data, cycle, name]);

  const query = combineQueries([selection.query, plans, results, levels]);
  const open = openId ? (rows?.find((r) => r.result.id === openId && isShownToEmployee(r.result)) ?? null) : null;

  const columns: DataTableColumn<MyRow>[] = [
    {
      id: 'period',
      header: 'Kỳ',
      cell: (r) =>
        isShownToEmployee(r.result) ? (
          <button
            type="button"
            className="font-medium hover:underline focus-visible:underline focus-visible:outline-none"
            onClick={() => setOpenId(r.result.id)}
            aria-label={`Xem chi tiết kết quả ${r.period?.label ?? ''}`}
          >
            {r.period?.label ?? 'Kỳ không còn'}
          </button>
        ) : (
          <span className="font-medium">{r.period?.label ?? 'Kỳ không còn'}</span>
        ),
    },
    {
      id: 'score',
      header: 'Điểm KPI',
      numeric: true,
      cell: (r) =>
        isShownToEmployee(r.result) ? (
          <ScoreValue result={r.result} />
        ) : (
          <span className="flex flex-col items-end">
            <span>Đang tổng hợp</span>
            <span className="text-xs text-muted-foreground">Chưa có số liệu để xem</span>
          </span>
        ),
    },
    { id: 'rating', header: 'Xếp loại', cell: (r) => (isShownToEmployee(r.result) ? <RatingValue result={r.result} level={r.level} /> : <MissingValue />) },
    {
      id: 'payout',
      header: '% hưởng lương KPI',
      numeric: true,
      cell: (r) => (isShownToEmployee(r.result) ? <PayoutValue state={payoutState(r.result, levels.data ?? [])} /> : <MissingValue />),
    },
    { id: 'status', header: 'Trạng thái', cell: (r) => <PeriodResultStatusBadge status={r.result.status} /> },
    {
      id: 'finalized',
      header: 'Thời điểm chốt',
      cell: (r) => (r.result.finalizedAt ? <span className="tabular">{formatDateTime(r.result.finalizedAt)}</span> : null),
    },
  ];

  if (selection.query.error) return <ErrorStateCard spec={errorSpecOf(selection.query.error)} onAction={() => void selection.query.refetch()} />;
  if (!selection.cycles) return loadPhase(selection.query, false) === 'loading' ? <Skeleton className="h-48 w-full" /> : null;
  if (!cycle) return <EmptyStateCard>Chưa có chu kỳ đánh giá nào.</EmptyStateCard>;

  return (
    <div className="space-y-4">
      <ResultPeriodPicker selection={selection} showPeriod={false} />
      <DataTable
        label={`Kết quả của tôi, ${cycle.name}`}
        columns={columns}
        rows={rows}
        query={query}
        getRowId={(r) => r.result.id}
        empty="Chưa có kết quả nào trong chu kỳ này. Kết quả có sau khi phiếu đánh giá hoàn thành và HR chốt."
        pageSize={null}
      />
      {rows && rows.some((r) => isShownToEmployee(r.result)) && <p className="text-xs text-muted-foreground">Bấm vào kỳ để xem chi tiết từng chỉ tiêu.</p>}
      <ResultDetailDialog row={open} period={open?.period ?? null} levels={levels.data ?? []} onOpenChange={(o) => !o && setOpenId(null)} canAdjust={false} />
    </div>
  );
}
