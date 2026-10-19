import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ListChecks, Plus } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/contexts/useSession';
import type { Goal } from '@/data/types';
import { useDeleteGoal, useGoalLookups, usePlanWorkspace, type PlanWorkspaceData } from '@/hooks/queries/goals';
import { toastSaved } from '@/hooks/queries/toasts';
import { ERROR_CATALOG, errorSpecOf } from '@/lib/errorCatalog';
import { combineQueries } from '@/lib/queryState';
import { planOwnerOf } from '@/lib/planAccessRules';
import { CascadeDialog } from './CascadeDialog';
import { GoalEditorPanel } from './GoalEditorPanel';
import { EDIT_REASON_COPY, planOwnerName } from './goalCopy';
import { GoalTable, type GoalRowActions } from './GoalTable';
import { KgiSection } from './KgiSection';
import { LinkGoalPanel } from './LinkGoalPanel';
import { PeriodSplitPanel } from './PeriodSplitPanel';
import { PlanHeader } from './PlanHeader';
import { PlanLockActions } from './PlanLockActions';

type PanelMode = 'view' | 'edit' | 'split' | 'link';
const MODES: readonly PanelMode[] = ['view', 'edit', 'split', 'link'];

interface GoalPlanWorkspaceProps {
  goalPlanId: string;
  /** "← Quay lại danh sách" for a plan opened from a list (team, HR). */
  onBack?: () => void;
}

/**
 * One Goal Plan, end to end (WBS 4.3.2–4.3.5): header + readiness + "Gửi", KGI, the goal table, and
 * the inline goal panels (`?goal=<id|new>&mode=view|edit|split|link` — they keep the plan's URL, so a
 * reload or a shared link reopens the same panel). Every decision is the workspace's (rules).
 */
export function GoalPlanWorkspace({ goalPlanId, onBack }: GoalPlanWorkspaceProps) {
  const workspace = usePlanWorkspace(goalPlanId);
  const lookups = useGoalLookups();
  const state = combineQueries([workspace.state, lookups.state]);

  if (state.error) {
    return (
      <div className="space-y-3">
        {onBack && <BackButton onBack={onBack} />}
        <ErrorStateCard spec={errorSpecOf(state.error)} onAction={() => void state.refetch()} />
      </div>
    );
  }
  if (!workspace.data || !lookups.data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Đang tải Goal Plan">
        {onBack && <BackButton onBack={onBack} />}
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return <LoadedWorkspace data={workspace.data} lookups={lookups.data} onBack={onBack} />;
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onBack}>
      <ArrowLeft aria-hidden />
      Quay lại danh sách
    </Button>
  );
}

function LoadedWorkspace({ data, lookups, onBack }: { data: PlanWorkspaceData; lookups: NonNullable<ReturnType<typeof useGoalLookups>['data']>; onBack?: () => void }) {
  const { user, can } = useSession();
  const [params, setParams] = useSearchParams();
  const [cascadeFrom, setCascadeFrom] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const remove = useDeleteGoal();

  const editable = data.editability.decision.ok;
  const reason = EDIT_REASON_COPY[data.editability.reason];
  const goalParam = params.get('goal');
  const modeParam = params.get('mode') as PanelMode | null;
  const mode: PanelMode | null = goalParam && modeParam && MODES.includes(modeParam) ? modeParam : null;
  const panelGoal = goalParam && goalParam !== 'new' ? (data.goals.find((g) => g.id === goalParam) ?? null) : null;

  const openPanel = useCallback(
    (goalId: string, m: PanelMode) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set('goal', goalId);
        next.set('mode', m);
        return next;
      }),
    [setParams],
  );
  const closePanel = useCallback(
    () =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.delete('goal');
        next.delete('mode');
        return next;
      }),
    [setParams],
  );
  const focusGoal = (goalId: string) => {
    closePanel();
    window.setTimeout(() => document.getElementById(`goal-row-${goalId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  const ownerEmployeeId = planOwnerOf(data.plan, lookups.orgUnits);
  const mayCascade = ownerEmployeeId === user.employeeId || can('goalplan.lock');
  const inactive = (goal: Goal) => (goal.status !== 'Active' ? 'Chỉ tiêu đã thay đổi hoặc đã hủy — chỉ còn để xem.' : null);
  const notEditable = () => (editable ? null : (reason ?? 'Bạn không sửa được Goal Plan lúc này.'));
  const actions: GoalRowActions = {
    open: (goal) => openPanel(goal.id, editable && goal.status === 'Active' ? 'edit' : 'view'),
    edit: { run: (goal) => openPanel(goal.id, 'edit'), refusal: (goal) => notEditable() ?? inactive(goal) },
    split: {
      run: (goal) => openPanel(goal.id, 'split'),
      refusal: (goal) => notEditable() ?? inactive(goal) ?? (goal.targetType !== 'NUMERIC' ? 'Mục tiêu dạng chữ không phân bổ theo kỳ.' : null),
    },
    link: { run: (goal) => openPanel(goal.id, 'link'), refusal: (goal) => notEditable() ?? inactive(goal) },
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
    <Button size="sm" onClick={() => openPanel('new', 'edit')}>
      <Plus aria-hidden />
      Thêm chỉ tiêu
    </Button>
  ) : null;

  const panel =
    mode === null ? null : mode === 'split' && panelGoal ? (
      <PeriodSplitPanel data={data} lookups={lookups} goal={panelGoal} readOnly={!editable} onClose={closePanel} />
    ) : mode === 'link' && panelGoal ? (
      <LinkGoalPanel data={data} lookups={lookups} goal={panelGoal} readOnly={!editable} onClose={closePanel} />
    ) : goalParam === 'new' || panelGoal ? (
      <GoalEditorPanel
        key={`${goalParam}-${mode}`}
        data={data}
        lookups={lookups}
        goal={panelGoal}
        readOnly={mode === 'view' || !editable || (panelGoal !== null && panelGoal.status !== 'Active')}
        readOnlyReason={!editable ? reason : panelGoal && panelGoal.status !== 'Active' ? inactive(panelGoal) : null}
        onClose={closePanel}
        onCreated={(goalId) => openPanel(goalId, 'edit')}
      />
    ) : (
      <div className="space-y-3">
        <BackButton onBack={closePanel} />
        <ErrorStateCard spec={ERROR_CATALOG['ERR-KPI-02']} />
      </div>
    );

  return (
    <div className="space-y-5">
      {onBack && <BackButton onBack={onBack} />}
      <PlanHeader
        data={data}
        lookups={lookups}
        onFocusGoal={focusGoal}
        actions={<PlanLockActions plan={data.plan} cycle={data.cycle} registration={data.registration} planName={planName} />}
      />

      {panel ?? (
        <>
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
              emptyAction={addButton}
            />
          </section>
        </>
      )}

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
