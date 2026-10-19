import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GoalEditorPanel } from '@/components/goals/GoalEditorPanel';
import { GoalPlanWorkspace } from '@/components/goals/GoalPlanWorkspace';
import { goalPageUrl, inactiveGoalReason, planNotEditableReason, type GoalTab, type PlanReturnState } from '@/components/goals/goalNav';
import { LinkGoalPanel } from '@/components/goals/LinkGoalPanel';
import { PeriodSplitPanel } from '@/components/goals/PeriodSplitPanel';
import { planOwnerName } from '@/components/goals/goalCopy';
import { useFacetTab } from '@/components/goals/useFacetTab';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { InlineNotice } from '@/components/shared/InlineNotice';
import { PageHeader, type Crumb } from '@/components/shared/PageHeader';
import { GoalStatusBadge } from '@/components/shared/StatusBadge';
import { UnsavedChangesGuard } from '@/components/shared/UnsavedChangesGuard';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/contexts/useSession';
import type { Goal, GoalPlan, PerformanceCycle } from '@/data/types';
import { useCycles, useGoalLookups, useGoalPlan, usePlanWorkspace, type GoalLookups, type PlanWorkspaceData } from '@/hooks/queries/goals';
import { ERROR_CATALOG, KpiError, errorSpecOf } from '@/lib/errorCatalog';
import { planRouteAllows, type PlanRouteKind } from '@/lib/planAccessRules';
import { resourceOfOwner } from '@/lib/permissionRules';

/**
 * The Goal Plan and goal DETAIL pages, mounted under four lists (`App.tsx`):
 * `/my/kpi/plans/:planId`, `/team/kpi/members/:planId`, `/team/kpi/unit/:planId`,
 * `/admin/cycles/:cycleId/plans/:planId` — each with `…/goals/:goalId` and `…/goals/new`.
 *
 * A plan id is typed into a URL and `getGoalPlan` checks only the tenant, so nothing of the plan is
 * shown before `planRouteAllows` (scope over the owner + the route fits the plan). A refusal reads
 * exactly like a missing plan (ERR-KPI-02).
 */

const enc = encodeURIComponent;

/** The plan page's URL from the route params — the ONE place it is built (goal pages open under it). */
function planBasePath(kind: PlanRouteKind, planId: string, cycleId: string | null): string {
  switch (kind) {
    case 'my':
      return `/my/kpi/plans/${enc(planId)}`;
    case 'members':
      return `/team/kpi/members/${enc(planId)}`;
    case 'unit':
      return `/team/kpi/unit/${enc(planId)}`;
    case 'cycles':
      return `/admin/cycles/${enc(cycleId ?? '')}/plans/${enc(planId)}`;
  }
}

/** The trail up to (not including) the plan: the list it was opened from, with the plan's cycle carried. */
function listCrumbs(kind: PlanRouteKind, cycleId: string | null, cycle: PerformanceCycle | null, plan: GoalPlan | null): Crumb[] {
  const carry = plan ? `?cycle=${enc(plan.cycleId)}` : '';
  switch (kind) {
    case 'my':
      return [{ label: 'KPI của tôi', to: `/my/kpi${carry}` }];
    case 'members':
      return [{ label: 'KPI nhân viên', to: `/team/kpi/members${carry}` }];
    case 'unit':
      return [{ label: 'KPI bộ phận', to: `/team/kpi/unit${carry}` }];
    case 'cycles':
      return [
        { label: 'Chu kỳ', to: '/admin/cycles' },
        { label: cycle?.name ?? 'Chu kỳ', to: `/admin/cycles/${enc(cycleId ?? '')}?tab=plans` },
      ];
  }
}

type PlanAccess =
  | { status: 'loading' | 'denied' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'ok'; plan: GoalPlan; lookups: GoalLookups };

/** The route's plan, and whether this person may see it HERE (`planRouteAllows`). */
function usePlanRoute(kind: PlanRouteKind) {
  const { tenantId, user, can } = useSession();
  const params = useParams();
  const planId = params.planId ?? '';
  const cycleId = params.cycleId ?? null;
  const basePath = planBasePath(kind, planId, cycleId);
  const planQuery = useGoalPlan(planId || null);
  const lookups = useGoalLookups();
  const cycles = useCycles();
  const plan = planQuery.data ?? null;

  let access: PlanAccess;
  if (planQuery.error) {
    // A plan that does not exist (or is not in this tenant) is the same answer as one not allowed.
    access = planQuery.error instanceof KpiError && planQuery.error.code === 'ERR-KPI-02' ? { status: 'denied' } : { status: 'error', error: planQuery.error, retry: () => void planQuery.refetch() };
  } else if (!plan) {
    access = { status: 'loading' };
  } else if (!planRouteAllows(plan, kind, { mayView: can('goalplan.view', resourceOfOwner(tenantId, plan)), viewerEmployeeId: user.employeeId, routeCycleId: cycleId })) {
    access = { status: 'denied' };
  } else if (lookups.state.error) {
    access = { status: 'error', error: lookups.state.error, retry: () => void lookups.state.refetch() };
  } else if (!lookups.data) {
    access = { status: 'loading' };
  } else {
    access = { status: 'ok', plan, lookups: lookups.data };
  }

  const allowedPlan = access.status === 'ok' ? access.plan : null;
  // The route's cycle names the "Chu kỳ" crumb even before the plan is known; never a denied plan's cycle.
  const cycle = cycles.data?.find((c) => c.id === (allowedPlan?.cycleId ?? cycleId)) ?? null;
  const crumbs = listCrumbs(kind, cycleId, kind === 'cycles' ? cycle : null, allowedPlan);
  const planName = access.status === 'ok' ? `Goal Plan của ${planOwnerName(access.plan, access.lookups)}` : 'Goal Plan';
  return { planId, basePath, access, crumbs, planName, cycle: allowedPlan ? cycle : null };
}

/** Loading / failed / not found-or-not-allowed, under the header — `null` once the plan may be shown. */
function AccessState({ access }: { access: PlanAccess }) {
  switch (access.status) {
    case 'loading':
      return <Skeleton className="h-64 w-full" aria-label="Đang tải" />;
    case 'denied':
      return <ErrorStateCard spec={ERROR_CATALOG['ERR-KPI-02']} />;
    case 'error':
      return <ErrorStateCard spec={errorSpecOf(access.error)} onAction={access.retry} />;
    case 'ok':
      return null;
  }
}

/** One Goal Plan on its own page, under the list it was opened from. */
export function PlanPage({ kind }: { kind: PlanRouteKind }) {
  const route = usePlanRoute(kind);
  return (
    <>
      <PageHeader title={route.planName} breadcrumb={route.crumbs} description={route.cycle?.name} />
      {route.access.status === 'ok' ? <GoalPlanWorkspace goalPlanId={route.planId} basePath={route.basePath} /> : <AccessState access={route.access} />}
    </>
  );
}

/**
 * One goal of a plan: facet tabs Thông tin / Phân bổ theo kỳ / Liên kết (`?tab=`), editable in place
 * when the plan is editable for this person and the goal is Active; `…/goals/new` adds one.
 * Save / Hủy go back to the plan with the goal's row in view.
 */
export function GoalPage({ kind }: { kind: PlanRouteKind }) {
  const route = usePlanRoute(kind);
  const { goalId = '' } = useParams();
  const workspace = usePlanWorkspace(route.access.status === 'ok' ? route.planId : null);
  const data = workspace.data;
  const isNew = goalId === 'new';
  const goal = data && !isNew ? (data.goals.find((g) => g.id === goalId && g.goalPlanId === route.planId) ?? null) : null;

  const crumbs = [...route.crumbs, { label: route.planName, to: route.basePath }];
  const title = isNew ? 'Thêm chỉ tiêu' : (goal?.name ?? 'Chỉ tiêu');

  let body;
  if (route.access.status !== 'ok') body = <AccessState access={route.access} />;
  else if (workspace.state.error) body = <ErrorStateCard spec={errorSpecOf(workspace.state.error)} onAction={() => void workspace.state.refetch()} />;
  else if (!data) body = <Skeleton className="h-64 w-full" aria-label="Đang tải" />;
  else if (!isNew && !goal) body = <ErrorStateCard spec={ERROR_CATALOG['ERR-KPI-02']} />;
  // Keyed on the goal: "new" → the created goal's page is the same route element, with fresh state.
  else body = <GoalBody key={goalId} data={data} lookups={route.access.lookups} goal={goal} basePath={route.basePath} />;

  return (
    <>
      <PageHeader title={title} breadcrumb={crumbs} status={goal ? <GoalStatusBadge status={goal.status} /> : undefined} description={route.access.status === 'ok' ? route.planName : undefined} />
      {body}
    </>
  );
}

const GOAL_TABS = ['info', 'split', 'link'] as const satisfies readonly GoalTab[];

interface Exit {
  to: string;
  replace?: boolean;
  state?: PlanReturnState;
}

function GoalBody({ data, lookups, goal, basePath }: { data: PlanWorkspaceData; lookups: GoalLookups; goal: Goal | null; basePath: string }) {
  const navigate = useNavigate();
  const [tab, setTab] = useFacetTab(GOAL_TABS);
  const [dirty, setDirty] = useState<Record<GoalTab, boolean>>({ info: false, split: false, link: false });
  // Leaving through the page's own Save / Hủy is not a loss: the guard is released first, then the
  // navigation runs on the next commit (the guard re-registers before this page's effect runs).
  const [exit, setExit] = useState<Exit | null>(null);
  useEffect(() => {
    if (exit) navigate(exit.to, { replace: exit.replace, state: exit.state });
  }, [exit, navigate]);

  const markDirty = (key: GoalTab, value: boolean) => setDirty((d) => (d[key] === value ? d : { ...d, [key]: value }));
  const onInfoDirty = useCallback((value: boolean) => markDirty('info', value), []);
  const onSplitDirty = useCallback((value: boolean) => markDirty('split', value), []);
  const onLinkDirty = useCallback((value: boolean) => markDirty('link', value), []);
  const backToPlan = (focusId: string | undefined) => setExit({ to: basePath, state: focusId ? { focusId } : undefined });

  const refusal = planNotEditableReason(data) ?? (goal ? inactiveGoalReason(goal) : null);
  const guard = <UnsavedChangesGuard when={exit === null && (dirty.info || dirty.split || dirty.link)} />;

  if (!goal) {
    if (refusal) return <EmptyStateCard>{refusal}</EmptyStateCard>;
    return (
      <>
        {guard}
        <GoalEditorPanel
          data={data}
          lookups={lookups}
          goal={null}
          readOnly={false}
          readOnlyReason={null}
          onClose={(savedId) => backToPlan(savedId)}
          onCreated={(id) => setExit({ to: goalPageUrl(basePath, id), replace: true })}
          onDirtyChange={onInfoDirty}
        />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {guard}
      {refusal && (
        <InlineNotice tone="info" title="Chỉ xem">
          {refusal}
        </InlineNotice>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="info">Thông tin</TabsTrigger>
          <TabsTrigger value="split">Phân bổ theo kỳ</TabsTrigger>
          <TabsTrigger value="link">Liên kết</TabsTrigger>
        </TabsList>
        {/* Mounted together (hidden when inactive) so switching tabs keeps what was typed. */}
        <TabsContent value="info" forceMount className="mt-4 data-[state=inactive]:hidden">
          <GoalEditorPanel
            data={data}
            lookups={lookups}
            goal={goal}
            readOnly={refusal !== null}
            readOnlyReason={null}
            onClose={(savedId) => backToPlan(savedId ?? goal.id)}
            onCreated={() => undefined}
            onDirtyChange={onInfoDirty}
          />
        </TabsContent>
        <TabsContent value="split" forceMount className="mt-4 data-[state=inactive]:hidden">
          <PeriodSplitPanel data={data} lookups={lookups} goal={goal} readOnly={refusal !== null} onClose={() => backToPlan(goal.id)} onDirtyChange={onSplitDirty} />
        </TabsContent>
        <TabsContent value="link" forceMount className="mt-4 data-[state=inactive]:hidden">
          <LinkGoalPanel data={data} lookups={lookups} goal={goal} readOnly={refusal !== null} onClose={() => backToPlan(goal.id)} onDirtyChange={onLinkDirty} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
