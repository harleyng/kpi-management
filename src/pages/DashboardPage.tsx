import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { OperationsTab } from '@/components/dashboard/OperationsTab';
import { OverviewTab } from '@/components/dashboard/OverviewTab';
import { useDashboardSelection } from '@/components/dashboard/useDashboardSelection';
import { ResultPeriodPicker } from '@/components/results/ResultPeriodPicker';
import { useDashboardModel, useOperationsReport } from '@/hooks/queries/dashboard';
import { errorSpecOf } from '@/lib/errorCatalog';

const TABS = ['tong-quan', 'van-hanh'] as const;
type Tab = (typeof TABS)[number];

/**
 * "Dashboard" — WBS 4.7.1–4.7.4, Phase 3 (`dashboard.view`: BOD, managers, HR; scope-sensitive).
 * "Tổng quan" drills from the viewer's highest unit down to a person; "Vận hành" is the operational
 * report. The cycle, period, tab and unit live in the URL, so a link opens the same view.
 */
export default function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'tong-quan';
  const selection = useDashboardSelection();
  const read = useDashboardModel(selection);
  const operations = useOperationsReport(selection, read);

  const setTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Dashboard" description="Bức tranh KPI sống của công ty, bộ phận và cá nhân — số liệu trong phạm vi bạn được xem." />
      {selection.query.error && !selection.cycles ? (
        <ErrorStateCard spec={errorSpecOf(selection.query.error)} onAction={() => void selection.query.refetch()} />
      ) : selection.cycles && selection.cycles.length === 0 ? (
        <EmptyStateCard>Chưa có chu kỳ đánh giá nào.</EmptyStateCard>
      ) : (
        <div className="space-y-4">
          <ResultPeriodPicker selection={selection} />
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="tong-quan">Tổng quan</TabsTrigger>
              <TabsTrigger value="van-hanh">Vận hành</TabsTrigger>
            </TabsList>
            <TabsContent value="tong-quan" className="mt-4">
              <OverviewTab selection={selection} read={read} overdueForms={operations.report ? operations.report.overdue.length : null} />
            </TabsContent>
            <TabsContent value="van-hanh" className="mt-4">
              <OperationsTab selection={selection} read={read} report={operations.report} query={operations.query} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </>
  );
}
