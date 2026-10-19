import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { toastError } from '@/components/shared/toastError';
import { useSession } from '@/contexts/useSession';
import type { GoalPlan, Id } from '@/data/types';
import { useForms, useStartForm, useWorkflows } from '@/hooks/queries/forms';
import { useCycles } from '@/hooks/queries/goals';
import { useGatewayClock } from '@/hooks/queries/session';
import { addDays, todayOf } from '@/lib/isoDate';
import { resourceOfOwner } from '@/lib/permissionRules';
import { canStartForm } from '@/lib/workflowRules';
import type { FormLookups } from './useFormLookups';

/** The adjustment's due date when started from a screen: a week, like a launch's default. */
const ADJUSTMENT_DUE_DAYS = 7;

/**
 * "Bắt đầu điều chỉnh" on a Locked plan (BR-KPI-15): shown only when `canStartForm` — the gateway's
 * own check, with the same context — has nothing against it, and the user holds `form.start` over the
 * plan's owner. An adjustment already open is linked instead of offered twice.
 */
export function StartAdjustmentButton({ plan, lookups }: { plan: GoalPlan; lookups: Pick<FormLookups, 'directory'> }) {
  const navigate = useNavigate();
  const { tenantId, can } = useSession();
  const clock = useGatewayClock();
  const workflows = useWorkflows('GOAL_CHANGE');
  const cycles = useCycles();
  const planForms = useForms({ goalPlanId: plan.id }, { limit: 200 });
  const start = useStartForm();

  const workflow = workflows.data?.find((w) => w.isDefault) ?? workflows.data?.[0];
  if (!can('form.start', resourceOfOwner(tenantId, plan)) || !workflow || !cycles.data || !planForms.data) return null;

  const openChange = planForms.data.items.find((f) => f.formType === 'GOAL_CHANGE' && (f.status === 'Open' || f.status === 'InProgress'));
  if (openChange) {
    return (
      <Button variant="outline" size="sm" onClick={() => navigate(`/forms/${openChange.id}`)}>
        Xem phiếu điều chỉnh đang mở
      </Button>
    );
  }

  const ownerId: Id | null =
    plan.ownerEmployeeId ?? lookups.directory?.orgUnits.find((u) => u.id === plan.ownerOrgUnitId)?.headEmployeeId ?? null;
  const dueDate = addDays(todayOf(clock), ADJUSTMENT_DUE_DAYS);
  const issues = ownerId
    ? canStartForm(
        { subjectEmployeeId: ownerId, goalPlanId: plan.id, periodId: null, dueDate },
        { formType: 'GOAL_CHANGE', plan, planOwnerEmployeeId: ownerId, cycle: cycles.data.find((c) => c.id === plan.cycleId) ?? null, forms: planForms.data.items, clock },
      )
    : [{ code: 'ERR-KPI-06' }];
  if (issues.length > 0) return null;

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={start.isPending}
      aria-busy={start.isPending || undefined}
      onClick={() =>
        start.mutate(
          { workflowId: workflow.id, subjectEmployeeId: ownerId!, goalPlanId: plan.id, periodId: null, dueDate },
          {
            onSuccess: (form) => {
              toast.success('Đã bắt đầu điều chỉnh');
              navigate(`/forms/${form.id}`);
            },
            onError: toastError,
          },
        )
      }
    >
      Bắt đầu điều chỉnh
    </Button>
  );
}
