import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CycleActions, CycleFormDialog, CyclePlansPanel, PeriodsPanel } from '@/components/goals/CycleDetail';
import { cyclePlanUrl } from '@/components/goals/goalNav';
import { useFacetTab } from '@/components/goals/useFacetTab';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { CycleStatusBadge } from '@/components/shared/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCycles } from '@/hooks/queries/goals';
import { ERROR_CATALOG, errorSpecOf } from '@/lib/errorCatalog';
import { formatDate } from '@/lib/utils';

const CRUMBS = [{ label: 'Kỳ đánh giá', to: '/admin/cycles/list' }];
const TABS = ['periods', 'plans'] as const;

/**
 * One cycle (`/admin/cycles/list/:cycleId`, WBS 4.3.1, 4.3.6): name + status, "Sửa thông tin" and the
 * next status step, then facet tabs Đợt đánh giá / Goal Plan (`?tab=`) — the same panels as the
 * "Đợt đánh giá" and "Goal Plan" sub-pages, here for this one cycle. The cycle comes from the tenant's
 * (cached) cycle list — an id not in it reads as not found. A plan opens under "Goal Plan" (`cyclePlanUrl`).
 */
export default function CycleDetailPage() {
  const { cycleId = '' } = useParams();
  const navigate = useNavigate();
  const cycles = useCycles();
  const [tab, setTab] = useFacetTab(TABS);
  const [editing, setEditing] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const cycle = cycles.data?.find((c) => c.id === cycleId) ?? null;

  if (!cycle) {
    return (
      <>
        <PageHeader title="Kỳ đánh giá" breadcrumb={CRUMBS} />
        {cycles.error ? (
          <ErrorStateCard spec={errorSpecOf(cycles.error)} onAction={() => void cycles.refetch()} />
        ) : !cycles.data ? (
          <Skeleton className="h-64 w-full" aria-label="Đang tải" />
        ) : (
          <ErrorStateCard spec={ERROR_CATALOG['ERR-KPI-02']} />
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={cycle.name}
        breadcrumb={CRUMBS}
        status={<CycleStatusBadge status={cycle.status} />}
        description={`${formatDate(cycle.startDate)} – ${formatDate(cycle.endDate)}`}
        actions={<CycleActions cycle={cycle} onEdit={() => setEditing(true)} onError={setStatusError} />}
      />
      {statusError && (
        <p role="alert" className="-mt-3 mb-4 text-sm text-support-negative">
          {statusError}
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="periods">Đợt đánh giá</TabsTrigger>
          <TabsTrigger value="plans">Goal Plan</TabsTrigger>
        </TabsList>
        <TabsContent value="periods" className="mt-4">
          <PeriodsPanel cycle={cycle} />
        </TabsContent>
        <TabsContent value="plans" className="mt-4">
          <CyclePlansPanel cycle={cycle} onOpenPlan={(planId) => navigate(cyclePlanUrl(cycle.id, planId))} />
        </TabsContent>
      </Tabs>
      {editing && cycles.data && <CycleFormDialog cycle={cycle} cycles={cycles.data} onClose={() => setEditing(false)} onSaved={() => undefined} />}
    </>
  );
}
