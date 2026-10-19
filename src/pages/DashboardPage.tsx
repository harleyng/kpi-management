import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { OperationsTab } from '@/components/dashboard/OperationsTab';
import { OverviewTab } from '@/components/dashboard/OverviewTab';
import { useDashboardSelection } from '@/components/dashboard/useDashboardSelection';
import { ResultPeriodPicker } from '@/components/results/ResultPeriodPicker';
import { useDashboardModel, useOperationsReport } from '@/hooks/queries/dashboard';
import { errorSpecOf } from '@/lib/errorCatalog';

export type DashboardSection = 'overview' | 'operations';

const SECTIONS: Record<DashboardSection, { title: string; description: string }> = {
  overview: { title: 'Tổng quan', description: 'Bức tranh KPI sống của công ty, bộ phận và cá nhân — số liệu trong phạm vi bạn được xem.' },
  operations: { title: 'Vận hành', description: 'Tiến độ đăng ký, đánh giá, kết quả và các phiếu quá hạn của kỳ — trong phạm vi bạn được xem.' },
};

/**
 * "Dashboard" — WBS 4.7.1–4.7.4, Phase 3 (`dashboard.view`: BOD, managers, HR; scope-sensitive); one
 * sub-page per section. "Tổng quan" drills from the viewer's highest unit down to a person; "Vận hành"
 * is the operational report. The cycle, period and unit live in the URL (`?cycle=&period=&unit=`), so
 * a link opens the same view; a unit link from "Vận hành" goes to "Tổng quan" with `?unit=`.
 */
export default function DashboardPage({ section }: { section: DashboardSection }) {
  const { title, description } = SECTIONS[section];
  const selection = useDashboardSelection();
  const read = useDashboardModel(selection);
  // "Tổng quan" also needs the report: its overdue-forms figure must agree with "Vận hành".
  const operations = useOperationsReport(selection, read);
  const failed = selection.query.error != null && !selection.cycles;
  const noCycles = selection.cycles !== undefined && selection.cycles.length === 0;

  return (
    <>
      <PageHeader title={title} description={description} actions={failed || noCycles ? undefined : <ResultPeriodPicker selection={selection} />} />
      {failed ? (
        <ErrorStateCard spec={errorSpecOf(selection.query.error)} onAction={() => void selection.query.refetch()} />
      ) : noCycles ? (
        <EmptyStateCard>Chưa có chu kỳ đánh giá nào.</EmptyStateCard>
      ) : section === 'overview' ? (
        <OverviewTab selection={selection} read={read} overdueForms={operations.report ? operations.report.overdue.length : null} />
      ) : (
        <OperationsTab selection={selection} read={read} report={operations.report} query={operations.query} />
      )}
    </>
  );
}
