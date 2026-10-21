import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { toastError } from '@/components/shared/toastError';
import { useSession } from '@/contexts/useSession';
import type { GoalPlan } from '@/data/types';
import { useStartForm } from '@/hooks/queries/forms';
import { useStartFormContext } from '@/hooks/queries/startForm';
import { addDays } from '@/lib/isoDate';
import { resourceOfOwner } from '@/lib/permissionRules';
import { StartFormLoadError } from './StartFormLoadError';

/** The adjustment's due date when started from a screen: a week, like a launch's default. */
const ADJUSTMENT_DUE_DAYS = 7;

/**
 * "Bắt đầu điều chỉnh" on a Locked plan (BR-KPI-15): shown only when `canStartForm` — the gateway's
 * own check, with the same context (`useStartFormContext`) — has nothing against it, and the user
 * holds `form.start` over the plan's owner. An adjustment already open is linked instead of offered
 * twice; a failed read shows the catalogue's error with a retry.
 */
export function StartAdjustmentButton({ plan }: { plan: GoalPlan }) {
  const navigate = useNavigate();
  const { tenantId, can } = useSession();
  const ctx = useStartFormContext(plan, 'GOAL_CHANGE');
  const start = useStartForm();

  if (!can('form.start', resourceOfOwner(tenantId, plan))) return null;
  if (ctx.status === 'error') return <StartFormLoadError query={ctx.query} />;
  if (ctx.status === 'loading' || !ctx.workflow) return null;

  if (ctx.openForm) {
    const openId = ctx.openForm.id;
    return (
      <Button variant="outline" size="sm" onClick={() => navigate(`/forms/${openId}`)}>
        Xem phiếu điều chỉnh đang mở
      </Button>
    );
  }

  const dueDate = addDays(ctx.today, ADJUSTMENT_DUE_DAYS);
  const { workflow, ownerId } = ctx;
  if (ownerId === null || ctx.issuesFor(dueDate).length > 0) return null;

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={start.isPending}
      aria-busy={start.isPending || undefined}
      onClick={() =>
        start.mutate(
          { workflowId: workflow.id, subjectEmployeeId: ownerId, goalPlanId: plan.id, periodId: null, dueDate },
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
