import { CyclePicker } from '@/components/goals/CyclePicker';
import { useSelectedCycle } from '@/components/goals/useSelectedCycle';
import { GoalPlanWorkspace } from '@/components/goals/GoalPlanWorkspace';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/contexts/useSession';
import { useGoalPlans } from '@/hooks/queries/goals';
import { errorSpecOf } from '@/lib/errorCatalog';

/**
 * "KPI của tôi" (WBS 4.3.2–4.3.5, Track T3): the signed-in person's own Goal Plan in the chosen cycle —
 * goals, weights, levels, split, links — and "Gửi" at their registration step. Actuals (WBS 4.4.2)
 * arrive with Track T4.
 */
export default function MyKpiPage() {
  const { user } = useSession();
  const { cycles, cycle, setCycleId } = useSelectedCycle();
  const plans = useGoalPlans(
    { cycleId: cycle?.id, ownerType: 'Employee', ownerEmployeeIds: user.employeeId ? [user.employeeId] : [] },
    { enabled: cycle !== null && user.employeeId !== null },
  );
  const plan = plans.data?.[0] ?? null;

  let body;
  if (user.employeeId === null) {
    body = <EmptyStateCard>Tài khoản hệ thống không có KPI cá nhân.</EmptyStateCard>;
  } else if (cycles.error || plans.error) {
    body = <ErrorStateCard spec={errorSpecOf(cycles.error ?? plans.error)} onAction={() => void (cycles.error ? cycles.refetch() : plans.refetch())} />;
  } else if (!cycles.data || (cycle && !plans.data)) {
    body = <Skeleton className="h-64 w-full" aria-label="Đang tải" />;
  } else if (!cycle) {
    body = <EmptyStateCard>Chưa có chu kỳ KPI nào. HR tạo chu kỳ ở mục Quản trị KPI.</EmptyStateCard>;
  } else if (!plan) {
    body = <EmptyStateCard>Chưa có Goal Plan trong chu kỳ này. HR sẽ khởi chạy phiếu đăng ký.</EmptyStateCard>;
  } else {
    body = <GoalPlanWorkspace goalPlanId={plan.id} />;
  }

  return (
    <>
      <PageHeader
        title="KPI của tôi"
        description="Goal Plan của bạn trong chu kỳ: chỉ tiêu, trọng số, định mức, phân bổ theo kỳ và liên kết lên chỉ tiêu cấp trên."
        actions={<CyclePicker cycles={cycles.data} cycle={cycle} onChange={setCycleId} />}
      />
      {body}
    </>
  );
}
