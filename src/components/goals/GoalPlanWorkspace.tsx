import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ListChecks, Plus } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/contexts/useSession';
import type { Goal } from '@/data/types';
import { useDeleteGoal, useGoalLookups, usePlanWorkspace, type PlanWorkspaceData } from '@/hooks/queries/goals';
import { toastSaved } from '@/hooks/queries/toasts';
import { errorSpecOf } from '@/lib/errorCatalog';
import { combineQueries } from '@/lib/queryState';
import { planOwnerOf } from '@/lib/planAccessRules';
import { CascadeDialog } from './CascadeDialog';
import { planOwnerName } from './goalCopy';
import { goalPageUrl, inactiveGoalReason, planNotEditableReason, type GoalTab, type PlanReturnState } from './goalNav';
import { GoalTable, type GoalRowActions } from './GoalTable';
import { KgiSection } from './KgiSection';
import { PlanHeader } from './PlanHeader';
import { PlanLockActions } from './PlanLockActions';

/** Bring a goal row into view and put focus on its name (rows carry `id="goal-row-<id>"`; `<main>` scrolls). */
function focusGoalRow(goalId: string) {
  const row = document.getElementById(`goal-row-${goalId}`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
}

interface GoalPlanWorkspaceProps {
  goalPlanId: string;
  /** The plan page's URL, derived once from the route by the page — goal pages open under it. */
  basePath: string;
}

/**
 * One Goal Plan, end to end (WBS 4.3.2–4.3.5): header + readiness + "Gửi", KGI and the goal table.
 * A goal opens on its own page under `basePath` (Thông tin / Phân bổ theo kỳ / Liên kết) — the table
 * is never replaced. Cascade and delete stay dialogs. Every decision is the workspace's (rules).
 * The caller has already checked the person may see this plan on this route (`planRouteAllows`).
 */
export function GoalPlanWorkspace({ goalPlanId, basePath }: GoalPlanWorkspaceProps) {
  const workspace = usePlanWorkspace(goalPlanId);
  const lookups = useGoalLookups();
  const state = combineQueries([workspace.state, lookups.state]);

  if (state.error) return <ErrorStateCard spec={errorSpecOf(state.error)} onAction={() => void state.refetch()} />;
  if (!workspace.data || !lookups.data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Đang tải Goal Plan">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return <LoadedWorkspace data={workspace.data} lookups={lookups.data} basePath={basePath} />;
}

function LoadedWorkspace({ data, lookups, basePath }: { data: PlanWorkspaceData; lookups: NonNullable<ReturnType<typeof useGoalLookups>['data']>; basePath: string }) {
  const { user, can } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [cascadeFrom, setCascadeFrom] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const remove = useDeleteGoal();

  const editable = data.editability.decision.ok;
  const openGoal = (goalId: string | 'new', tab: GoalTab = 'info') => navigate(goalPageUrl(basePath, goalId, tab));

  // Back from a goal page: bring its row into view — after the shell's own scroll reset and heading
  // focus on navigation (AppShell, ~150 ms).
  const returnFocus = (location.state as PlanReturnState | null)?.focusId ?? null;
  useEffect(() => {
    if (!returnFocus) return;
    const timer = window.setTimeout(() => focusGoalRow(returnFocus), 200);
    return () => window.clearTimeout(timer);
  }, [returnFocus, location.key]);

  const ownerEmployeeId = planOwnerOf(data.plan, lookups.orgUnits);
  const mayCascade = ownerEmployeeId === user.employeeId || can('goalplan.lock');
  const inactive = inactiveGoalReason;
  const notEditable = () => planNotEditableReason(data);
  const actions: GoalRowActions = {
    open: (goal) => openGoal(goal.id),
    edit: { run: (goal) => openGoal(goal.id), refusal: (goal) => notEditable() ?? inactive(goal) },
    split: {
      run: (goal) => openGoal(goal.id, 'split'),
      refusal: (goal) => notEditable() ?? inactive(goal) ?? (goal.targetType !== 'NUMERIC' ? 'Mục tiêu dạng chữ không phân bổ theo kỳ.' : null),
    },
    link: { run: (goal) => openGoal(goal.id, 'link'), refusal: (goal) => notEditable() ?? inactive(goal) },
    cascade: mayCascade
      ? {
          run: (goal) => setCascadeFrom(goal),
          refusal: (goal) => inactive(goal) ?? (goal.targetType !== 'NUMERIC' ? 'Chỉ phân giao được chỉ tiêu có mục tiêu dạng số.' : null),
        }
      : null,
    remove: {
      run: (goal) => setDeleting(goal),
      refusal: (goal) =>
        notEditable() ??
        inactive(goal) ??
        (data.plan.status !== 'Draft' && data.plan.status !== 'Returned'
          ? 'Sau khi gửi, chỉ tiêu chỉ hủy được qua phiếu điều chỉnh KPI.'
          : (data.cascadeChildren.get(goal.id)?.length ?? 0) > 0
            ? 'Chỉ tiêu đã phân giao cho nhân viên — bỏ phân giao trước.'
            : null),
    },
  };

  const planName = `Goal Plan của ${planOwnerName(data.plan, lookups)}`;
  const addButton = editable ? (
    <Button size="sm" onClick={() => openGoal('new')}>
      <Plus aria-hidden />
      Thêm chỉ tiêu
    </Button>
  ) : null;

  return (
    <div className="space-y-5">
      <PlanHeader
        data={data}
        lookups={lookups}
        onFocusGoal={focusGoalRow}
        actions={<PlanLockActions plan={data.plan} cycle={data.cycle} registration={data.registration} planName={planName} />}
      />

      <KgiSection data={data} lookups={lookups} editable={editable} />
      <section className="space-y-3" aria-labelledby="goals-title">
        <div id="goals-title">
          <SectionTitle icon={ListChecks} title="Chỉ tiêu" action={addButton} />
        </div>
        <GoalTable
          data={data}
          lookups={lookups}
          query={{ isPending: false, fetchStatus: 'idle', error: null, refetch: () => undefined }}
          actions={actions}
          showBuckets={data.buckets.size > 0}
        />
      </section>

      {cascadeFrom && <CascadeDialog data={data} lookups={lookups} parent={cascadeFrom} open onOpenChange={(o) => !o && setCascadeFrom(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Xóa chỉ tiêu "${deleting?.name ?? ''}"?`}
        body="Chỉ tiêu, định mức và phân bổ theo kỳ của nó bị xóa khỏi Goal Plan. Tổng trọng số sẽ giảm tương ứng."
        confirmLabel="Xóa chỉ tiêu"
        destructive
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => toastSaved('Đã xóa chỉ tiêu') })}
      />
    </div>
  );
}
