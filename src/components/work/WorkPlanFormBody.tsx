import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { Skeleton } from '@/components/ui/skeleton';
import type { FormDetail } from '@/components/forms/useFormDetail';
import { useFormDetail } from '@/components/forms/useFormDetail';
import type { Id, WorkPlan } from '@/data/types';
import { useWorkPlan } from '@/hooks/queries/work';
import { errorSpecOf } from '@/lib/errorCatalog';
import { WorkPlanPanel } from './WorkPlanPanel';

/** The WORK_PLAN form's body on `/forms/:formId` (PEND-14, 8.2): its month's plan, with the step's actions. */
export function WorkPlanFormBody({ detail, title }: { detail: FormDetail; title: string }) {
  const plan = useWorkPlan(detail.form?.workPlanId ?? null);
  if (plan.error) return <ErrorStateCard spec={errorSpecOf(plan.error)} onAction={() => void plan.refetch()} />;
  if (!plan.data) return <Skeleton className="h-64 w-full" />;
  return <WorkPlanPanel plan={plan.data} detail={detail} showHeader formTitle={title} />;
}

/** A plan with its month's WORK_PLAN form loaded here (the work pages): the form's standing drives the actions. */
export function WorkPlanWithForm({ plan, formId }: { plan: WorkPlan; formId: Id | null }) {
  if (formId === null) return <WorkPlanPanel plan={plan} detail={null} />;
  return <WithDetail plan={plan} formId={formId} />;
}

function WithDetail({ plan, formId }: { plan: WorkPlan; formId: Id }) {
  const detail = useFormDetail(formId);
  if (!detail.form || !detail.standing) return <Skeleton className="h-64 w-full" />;
  return <WorkPlanPanel plan={plan} detail={detail} />;
}
