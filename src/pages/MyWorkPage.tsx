import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { GoalPlanStatusBadge } from '@/components/shared/StatusBadge';
import { WorkMonthSelect, useWorkMonth } from '@/components/work/WorkMonthSelect';
import { WorkPlanWithForm } from '@/components/work/WorkPlanFormBody';
import { monthText } from '@/components/work/workCopy';
import { useSession } from '@/contexts/useSession';
import { useForms } from '@/hooks/queries/forms';
import { useWorkPlans } from '@/hooks/queries/work';
import { errorSpecOf } from '@/lib/errorCatalog';
import { combineQueries } from '@/lib/queryState';
import { currentMonthForm } from '@/lib/workRules';

const TITLE = 'Công việc tháng';
const DESCRIPTION = 'Việc bạn dự kiến làm trong tháng, trọng số và tiến độ.';

/**
 * "Công việc tháng" (`/my/work`, PEND-14 plan §6): the person's own month — write the task list and
 * send it, then track progress once the manager approved it. The month is `?month=`.
 */
export default function MyWorkPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const { months, month, setMonth, query: monthsQuery } = useWorkMonth();
  const me = user.employeeId;
  const enabled = me !== null && month !== null;
  const plans = useWorkPlans(enabled ? { periodId: month.id, employeeIds: [me] } : { employeeIds: [] });
  const planForms = useForms({ formType: 'WORK_PLAN', periodId: month?.id, subjectEmployeeIds: me ? [me] : [] }, { limit: 20 }, { enabled });
  const reviewForms = useForms({ formType: 'WORK_REVIEW', periodId: month?.id, subjectEmployeeIds: me ? [me] : [] }, { limit: 20 }, { enabled });

  const plan = plans.data?.[0] ?? null;
  const form = currentMonthForm(planForms.data?.items ?? []);
  const review = currentMonthForm(reviewForms.data?.items ?? []);
  const select = <WorkMonthSelect months={months} month={month} onChange={setMonth} />;

  if (me === null) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <EmptyStateCard>Tài khoản này không gắn với nhân viên nào, nên không có công việc tháng.</EmptyStateCard>
      </>
    );
  }

  const state = combineQueries([monthsQuery, plans, planForms, reviewForms]);
  const links = (
    <div className="flex flex-wrap gap-2">
      {form && (
        <Button variant="ghost" size="sm" onClick={() => navigate(`/forms/${form.id}`)}>
          Mở phiếu kế hoạch
        </Button>
      )}
      {review && (
        <Button variant="ghost" size="sm" onClick={() => navigate(`/forms/${review.id}`)}>
          Mở phiếu đánh giá
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title={TITLE} description={DESCRIPTION} actions={select} status={plan ? <GoalPlanStatusBadge status={plan.status} /> : undefined} />
      {state.error ? (
        <ErrorStateCard spec={errorSpecOf(state.error)} onAction={() => void Promise.all([plans.refetch(), planForms.refetch(), reviewForms.refetch()])} />
      ) : !plans.data || !planForms.data || !month ? (
        months.length === 0 && !monthsQuery.isPending ? (
          <EmptyStateCard>Chưa có kỳ tháng nào. HR tạo chu kỳ và các tháng ở Quản trị KPI.</EmptyStateCard>
        ) : (
          <Skeleton className="h-64 w-full" />
        )
      ) : plan === null ? (
        <EmptyStateCard>Chưa có kế hoạch công việc tháng {monthText(month)}. HR khởi chạy phiếu vào đầu tháng.</EmptyStateCard>
      ) : (
        <>
          {links}
          <WorkPlanWithForm key={`${plan.id}:${form?.id ?? ''}`} plan={plan} formId={form?.id ?? null} />
        </>
      )}
    </div>
  );
}
