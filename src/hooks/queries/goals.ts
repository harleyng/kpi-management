import { useCallback, useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type {
  BscPerspective,
  CalcMethod,
  CyclePeriod,
  DataSource,
  Employee,
  CycleStatus,
  FormInstance,
  Goal,
  GoalAlignment,
  GoalPeriodTarget,
  GoalPlan,
  GoalTargetLevel,
  Id,
  IsoDate,
  Kgi,
  KpiDefinition,
  MeasureUnit,
  OrgUnit,
  PerformanceCycle,
} from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { AlignmentFilter, ChildInput, GoalFilter, GoalPlanFilter, GoalScope, Upsert } from '@/integrations/data/types';
import { allocationBuckets, type AllocationBuckets, type CascadedGoalDraft } from '@/lib/alignmentRules';
import type { Clock } from '@/lib/isoDate';
import { planSummaries, planSummary, type PlanSummary } from '@/lib/goalPlanRules';
import {
  UNKNOWN_EDITABILITY,
  openRegistrationOf,
  planEditabilityFrom,
  planReadiness,
  submitAvailabilityFrom,
  visibleGoals,
  type GoalViewer,
  type PlanAccessRows,
  type PlanEditability,
  type PlanReadiness,
  type SubmitAvailability,
  type VisibilityContext,
} from '@/lib/planAccessRules';
import { ownerStepNo } from '@/lib/goalPlanRules';
import { combineQueries, type QueryState } from '@/lib/queryState';
import type { ActorDirectory, ActorInput } from '@/lib/workflowRules';
import { useFormList, useDelegations, useWorkflowSteps } from './forms';
import { queryKey, type KeyRoot } from './keys';
import { useDataSources } from './actuals';
import { useCalcMethods, useKpiDefinitions, useMeasureUnits, usePerspectives } from './library';
import { useEmployees, useOrgUnits } from './org';
import { readGatewayNow, useSessionDirectory } from './session';
import { toastWriteError } from './toasts';

/**
 * G3 · Kế hoạch mục tiêu (Track T3) — cycles and periods, Goal Plans, KGIs, goals, levels, period
 * splits, cascade / link, lock / unlock. Keys are `[tenantId, root, ...params]` on the existing roots
 * (`cycles`, `goalPlans`, `kgis`, `goals` — which also covers levels and splits — `alignments`).
 *
 * - **PRIVATE goals (D2)** are filtered HERE and only here: `useGoals` returns what the viewer may see
 *   (`planAccessRules.canSeeGoal`) plus how many were hidden. `useGoalRows` returns every row, for
 *   aggregates only (totals, buckets) — never render its names. (UI enforcement; Phase 5 RLS.)
 * - **Writes** toast a failure in the catalogue's words and refresh their roots on EVERY outcome
 *   (`onSettled`), on top of the event bridge — a half-done two-write save is refreshed too.
 * - **Decisions** (may I edit, may I send, what blocks it) are `planAccessRules` calls; nothing is
 *   decided in a hook. While an input is loading or failed, editability is UNKNOWN (read-only).
 */

const CYCLE_STALE_MS = 60 * 1000;

// ─── Keys ──────────────────────────────────────────────────────────────────────────────────────

export const cyclesKey = (tenantId: Id) => queryKey(tenantId, 'cycles');
export const periodsKey = (tenantId: Id, cycleId: Id) => queryKey(tenantId, 'cycles', cycleId, 'periods');
export const goalPlansKey = (tenantId: Id, filter: GoalPlanFilter = {}) => queryKey(tenantId, 'goalPlans', filter);
export const goalPlanKey = (tenantId: Id, goalPlanId: Id) => queryKey(tenantId, 'goalPlans', 'one', goalPlanId);
export const kgisKey = (tenantId: Id, goalPlanId: Id) => queryKey(tenantId, 'kgis', goalPlanId);
export const goalsKey = (tenantId: Id, filter: GoalFilter = {}) => queryKey(tenantId, 'goals', filter);
export const targetLevelsKey = (tenantId: Id, scope: GoalScope) => queryKey(tenantId, 'goals', 'levels', scope);
export const periodTargetsKey = (tenantId: Id, scope: GoalScope) => queryKey(tenantId, 'goals', 'periodTargets', scope);
export const alignmentsKey = (tenantId: Id, filter: AlignmentFilter = {}) => queryKey(tenantId, 'alignments', filter);

/** Sorted copy of an id list, so the same set is the same key. */
const sortedIds = (ids: readonly Id[]) => [...ids].sort();

// ─── Reads ─────────────────────────────────────────────────────────────────────────────────────

export function useCycles() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: cyclesKey(tenantId),
    queryFn: () => getDataGateway().goals.listCycles(tenantId),
    staleTime: CYCLE_STALE_MS,
  });
}

/** `cycleId` null → disabled (settle "is there a cycle" before waiting on it). */
export function usePeriods(cycleId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: periodsKey(tenantId, cycleId ?? ''),
    queryFn: () => getDataGateway().goals.listPeriods(tenantId, cycleId as Id),
    enabled: cycleId !== null,
    staleTime: CYCLE_STALE_MS,
  });
}

/**
 * Every period of every cycle — what a list of forms needs to name each form's period (T5). One query
 * per cycle under the same `periodsKey` the single-cycle hook uses (a handful of cycles per tenant).
 */
export function useAllPeriods(): { data: CyclePeriod[] | undefined; query: QueryState } {
  const { tenantId } = useSession();
  const cycles = useCycles();
  const results = useQueries({
    queries: (cycles.data ?? []).map((cycle) => ({
      queryKey: periodsKey(tenantId, cycle.id),
      queryFn: () => getDataGateway().goals.listPeriods(tenantId, cycle.id),
      staleTime: CYCLE_STALE_MS,
    })),
  });
  const query = combineQueries([cycles, ...results]);
  const data = cycles.data && results.every((r) => r.data) ? results.flatMap((r) => r.data ?? []) : undefined;
  return { data, query };
}

export function useGoalPlans(filter: GoalPlanFilter = {}, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  const normalized = filter.ownerEmployeeIds ? { ...filter, ownerEmployeeIds: sortedIds(filter.ownerEmployeeIds) } : filter;
  return useQuery({
    queryKey: goalPlansKey(tenantId, normalized),
    queryFn: () => getDataGateway().goals.listGoalPlans(tenantId, normalized),
    enabled: options.enabled ?? true,
  });
}

export function useGoalPlan(goalPlanId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: goalPlanKey(tenantId, goalPlanId ?? ''),
    queryFn: () => getDataGateway().goals.getGoalPlan(tenantId, goalPlanId as Id),
    enabled: goalPlanId !== null,
  });
}

export function useKgis(goalPlanId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: kgisKey(tenantId, goalPlanId ?? ''),
    queryFn: () => getDataGateway().goals.listKgis(tenantId, goalPlanId as Id),
    enabled: goalPlanId !== null,
  });
}

const normalizeGoalFilter = (filter: GoalFilter): GoalFilter => (filter.goalPlanIds ? { ...filter, goalPlanIds: sortedIds(filter.goalPlanIds) } : filter);

/**
 * EVERY goal row matching `filter`, unfiltered by visibility — for aggregates (totals, buckets), and for a
 * FORM's own plan, whose actors are already entitled to the whole plan (its weighted total needs every
 * goal; T5). Anywhere else, never render its names — use `useGoals`.
 */
export function useGoalRows(filter: GoalFilter = {}, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  const normalized = normalizeGoalFilter(filter);
  return useQuery({
    queryKey: goalsKey(tenantId, normalized),
    queryFn: () => getDataGateway().goals.listGoals(tenantId, normalized),
    enabled: options.enabled ?? true,
  });
}

/** The viewer and what `canSeeGoal` reads — the cached session directory; fail closed while it loads. */
function useGoalViewer(): { viewer: GoalViewer; ctx: VisibilityContext } {
  const { tenantId, user, access, today } = useSession();
  const directory = useSessionDirectory(tenantId).data;
  return useMemo(
    () => ({
      viewer: { employeeId: user.employeeId, access, tenantId },
      ctx: { assignments: directory?.assignments ?? [], units: directory?.orgUnits ?? [], today },
    }),
    [user.employeeId, access, tenantId, directory, today],
  );
}

/**
 * The goals matching `filter` that the signed-in person may SEE (D2) — every screen that lists
 * goals reads them through here. `plans` are the goals' plans (for their owners); a goal whose plan
 * is not among them shows only when PUBLIC (or to a Tenant scope).
 */
export function useGoals(filter: GoalFilter, plans: readonly GoalPlan[] | undefined, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  const normalized = normalizeGoalFilter(filter);
  const { viewer, ctx } = useGoalViewer();
  const select = useCallback((rows: Goal[]) => visibleGoals(rows, plans ?? [], viewer, ctx), [plans, viewer, ctx]);
  return useQuery({
    queryKey: goalsKey(tenantId, normalized),
    queryFn: () => getDataGateway().goals.listGoals(tenantId, normalized),
    enabled: options.enabled ?? true,
    select,
  });
}

export function useTargetLevels(scope: GoalScope | null) {
  const { tenantId } = useSession();
  const key = scope && 'goalIds' in scope ? { goalIds: sortedIds(scope.goalIds) } : scope;
  return useQuery({
    queryKey: targetLevelsKey(tenantId, key ?? { goalIds: [] }),
    queryFn: () => getDataGateway().goals.listTargetLevels(tenantId, key as GoalScope),
    enabled: scope !== null,
  });
}

export function usePeriodTargets(scope: GoalScope | null) {
  const { tenantId } = useSession();
  const key = scope && 'goalIds' in scope ? { goalIds: sortedIds(scope.goalIds) } : scope;
  return useQuery({
    queryKey: periodTargetsKey(tenantId, key ?? { goalIds: [] }),
    queryFn: () => getDataGateway().goals.listPeriodTargets(tenantId, key as GoalScope),
    enabled: scope !== null,
  });
}

export function useAlignments(filter: AlignmentFilter = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: alignmentsKey(tenantId, filter),
    queryFn: () => getDataGateway().goals.listAlignments(tenantId, filter),
  });
}

// ─── Writes ────────────────────────────────────────────────────────────────────────────────────

/** Refresh the roots a write touches, whatever its outcome. */
const refresh = (queryClient: QueryClient, tenantId: Id, roots: readonly KeyRoot[]) =>
  Promise.all(roots.map((root) => queryClient.invalidateQueries({ queryKey: [tenantId, root] })));

/**
 * A gateway write as a mutation: the session's tenant and actor, a catalogue toast on failure
 * (`toastError: false` when the caller shows the failure itself, e.g. a partial save), and a refresh
 * of `roots` on every outcome.
 */
function useGatewayWrite<TInput, TResult>(
  roots: readonly KeyRoot[],
  write: (ctx: { tenantId: Id; actorUserId: Id }, input: TInput) => Promise<TResult>,
  options: { toastError?: boolean } = {},
) {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => write({ tenantId, actorUserId: user.id }, input),
    onError: (error) => {
      // A partial two-write failure already toasted its own, persistent message.
      if (options.toastError !== false && !(error instanceof PartialGoalSaveError) && !(error instanceof CascadeOrphanError)) toastWriteError(error);
    },
    onSettled: () => refresh(queryClient, tenantId, roots),
  });
}

const goals = () => getDataGateway().goals;

export const useSaveCycle = () =>
  useGatewayWrite(['cycles'], ({ tenantId, actorUserId }, input: Upsert<PerformanceCycle, 'status'>) => goals().saveCycle(tenantId, actorUserId, input));

export const useSetCycleStatus = () =>
  useGatewayWrite(['cycles', 'goalPlans'], ({ tenantId, actorUserId }, input: { cycleId: Id; status: CycleStatus }) =>
    goals().setCycleStatus(tenantId, actorUserId, input.cycleId, input.status),
  );

export const useSavePeriods = () =>
  useGatewayWrite(['cycles'], ({ tenantId, actorUserId }, input: { cycleId: Id; periods: readonly ChildInput<CyclePeriod, 'cycleId'>[] }) =>
    goals().savePeriods(tenantId, actorUserId, input.cycleId, input.periods),
  );

export const useSetPeriodLocked = () =>
  useGatewayWrite(['cycles'], ({ tenantId, actorUserId }, input: { periodId: Id; locked: boolean }) =>
    goals().setPeriodLocked(tenantId, actorUserId, input.periodId, input.locked),
  );

export const useCreateGoalPlan = () =>
  useGatewayWrite(['goalPlans'], ({ tenantId, actorUserId }, input: Omit<Upsert<GoalPlan, 'status' | 'lockedAt'>, 'id'>) =>
    goals().createGoalPlan(tenantId, actorUserId, input),
  );

export const useLockGoalPlan = () =>
  useGatewayWrite(['goalPlans', 'forms', 'auditLog'], ({ tenantId, actorUserId }, goalPlanId: Id) => goals().lockGoalPlan(tenantId, actorUserId, goalPlanId));

export const useUnlockGoalPlan = () =>
  useGatewayWrite(['goalPlans', 'forms', 'auditLog'], ({ tenantId, actorUserId }, input: { goalPlanId: Id; reason: string; newDueDate: IsoDate }) =>
    goals().unlockGoalPlan(tenantId, actorUserId, input.goalPlanId, input.reason, input.newDueDate),
  );

export const useSaveKgi = () => useGatewayWrite(['kgis'], ({ tenantId, actorUserId }, input: Upsert<Kgi>) => goals().saveKgi(tenantId, actorUserId, input));

export const useDeleteKgi = () => useGatewayWrite(['kgis', 'goals'], ({ tenantId, actorUserId }, kgiId: Id) => goals().deleteKgi(tenantId, actorUserId, kgiId));

/**
 * A goal saved but its levels refused: the goal IS stored (`goal`), the levels are not (`cause`). The
 * editor stays open with what was typed and shows `cause` inline (CTO review, T3 design).
 */
export class PartialGoalSaveError extends Error {
  constructor(
    readonly goal: Goal,
    readonly cause: unknown,
  ) {
    super('The goal was saved but its target levels were not');
  }
}

export type GoalLevelsInput = readonly ChildInput<GoalTargetLevel, 'goalId'>[];

/**
 * "Lưu" on the goal editor: the goal, then its levels when given (`undefined` = leave them). Two
 * writes — the contract has no atomic one — so a refused levels write rejects with
 * `PartialGoalSaveError` (the caller shows it inline; the toast names it too).
 */
export function useSaveGoal() {
  return useGatewayWrite(
    ['goals', 'alignments'],
    async ({ tenantId, actorUserId }, input: { goal: Upsert<Goal, 'status' | 'replacesGoalId'>; levels?: GoalLevelsInput }) => {
      let saved: Goal;
      try {
        saved = await goals().saveGoal(tenantId, actorUserId, input.goal);
      } catch (error) {
        toastWriteError(error);
        throw error;
      }
      if (input.levels === undefined) return saved;
      try {
        await goals().setTargetLevels(tenantId, actorUserId, saved.id, input.levels);
      } catch (error) {
        toastWriteError(error, { persistent: true, description: 'Chỉ tiêu đã được lưu nhưng định mức chưa lưu được. Sửa định mức rồi lưu lại.' });
        throw new PartialGoalSaveError(saved, error);
      }
      return saved;
    },
    { toastError: false },
  );
}

export const useDeleteGoal = () =>
  useGatewayWrite(['goals', 'alignments'], ({ tenantId, actorUserId }, goalId: Id) => goals().deleteGoal(tenantId, actorUserId, goalId));

export const useSetPeriodTargets = () =>
  useGatewayWrite(['goals'], ({ tenantId, actorUserId }, input: { goalId: Id; targets: readonly ChildInput<GoalPeriodTarget, 'goalId'>[] }) =>
    goals().setPeriodTargets(tenantId, actorUserId, input.goalId, input.targets),
  );

export const useSaveAlignment = () =>
  useGatewayWrite(['alignments', 'goals'], ({ tenantId, actorUserId }, input: Upsert<GoalAlignment>) => goals().saveAlignment(tenantId, actorUserId, input));

export const useDeleteAlignment = () =>
  useGatewayWrite(['alignments', 'goals'], ({ tenantId, actorUserId }, alignmentId: Id) => goals().deleteAlignment(tenantId, actorUserId, alignmentId));

/**
 * The cascade's child goal was created, its alignment refused, and deleting the child failed too: the
 * child goal remains (`orphan`) and the person must remove it by hand. Never silent (CTO review).
 */
export class CascadeOrphanError extends Error {
  constructor(
    readonly orphan: Goal,
    readonly cause: unknown,
  ) {
    super(`Cascade failed and its child goal ${orphan.id} could not be removed`);
  }
}

/**
 * "Phân giao" (BR-KPI-07): the child goal (`alignmentRules.cascadedGoalDraft`), then the CASCADE
 * alignment. The contract has no atomic call (Phase 5: one `cascadeGoal` transaction), so a refused
 * alignment deletes the child goal again and rejects with the ALIGNMENT's error; if that delete fails
 * too, `CascadeOrphanError` names the goal left behind. The caller pre-checks with
 * `alignmentRules.checkAlignment`, so this path is rare. The audit log then shows the child's
 * CREATE and DELETE — the compensation is visible, not hidden.
 */
export function useCascadeGoal() {
  return useGatewayWrite(
    ['goals', 'alignments'],
    async ({ tenantId, actorUserId }, input: { parentGoalId: Id; child: CascadedGoalDraft; allocatedValue: number }) => {
      const child = await goals().saveGoal(tenantId, actorUserId, input.child);
      try {
        await goals().saveAlignment(tenantId, actorUserId, {
          childGoalId: child.id,
          parentGoalId: input.parentGoalId,
          alignmentType: 'CASCADE',
          allocatedValue: input.allocatedValue,
          contributionPct: null,
        });
        return child;
      } catch (error) {
        try {
          await goals().deleteGoal(tenantId, actorUserId, child.id);
        } catch (cleanup) {
          toastWriteError(cleanup, {
            persistent: true,
            description: `Phân giao không thành công và chưa xóa được chỉ tiêu "${child.name}" vừa tạo trong Goal Plan của nhân viên. Hãy xóa chỉ tiêu đó.`,
          });
          throw new CascadeOrphanError(child, error);
        }
        throw error;
      }
    },
  );
}

/**
 * "Gửi" / "Chuyển cho nhân viên" on the plan's registration form — the ONE form write T3 makes
 * (T5 owns the rest). Sends exactly the standing `submitAvailability` found, so a delegate's or a
 * proxy's click records both people (BR-KPI-21).
 */
export const useSubmitPlanForm = () =>
  useGatewayWrite(['forms', 'goalPlans', 'inbox'], ({ tenantId, actorUserId }, input: { form: FormInstance; actor: ActorInput }) =>
    getDataGateway().forms.act(tenantId, actorUserId, {
      formId: input.form.id,
      expectedStepId: input.form.currentStepId as Id,
      action: 'SUBMIT',
      comment: null,
      onBehalfOfUserId: input.actor.onBehalfOfUserId,
      delegationId: input.actor.delegationId,
    }),
  );

// ─── Composite reads ───────────────────────────────────────────────────────────────────────────

/** The gateway's one clock in the tenant's zone. */
function useClock(): () => Clock {
  const { tenant } = useSession();
  return useCallback(() => ({ now: readGatewayNow(), tz: tenant.timezone }), [tenant.timezone]);
}

/** The session directory as the actor rules read it (`null` until loaded). */
function useActorDirectory(): { dir: ActorDirectory | null; query: QueryState } {
  const { tenantId } = useSession();
  const query = useSessionDirectory(tenantId);
  const dir = useMemo<ActorDirectory | null>(
    () =>
      query.data
        ? { employees: query.data.employees, assignments: query.data.assignments, users: query.data.accounts, userRoles: query.data.userRoles, roles: query.data.roles, units: query.data.orgUnits }
        : null,
    [query.data],
  );
  return { dir, query };
}

export interface PlanWorkspaceData {
  plan: GoalPlan;
  cycle: PerformanceCycle;
  periods: CyclePeriod[];
  /** Every goal of the plan, Active first by `sortOrder` — what the viewer may see. */
  goals: Goal[];
  /** Goals of the plan hidden from this viewer (PRIVATE, D2) — the screen says so. */
  hiddenCount: number;
  /** Totals over EVERY goal (private included). */
  summary: PlanSummary;
  kgis: Kgi[];
  levels: GoalTargetLevel[];
  periodTargets: GoalPeriodTarget[];
  /** Alignments touching the plan's goals, and the goals at their other end (visible ones only). */
  alignments: GoalAlignment[];
  /** Every alignment of the tenant — what the cycle check of a new link walks (ERR-KPI-10). */
  allAlignments: GoalAlignment[];
  relatedGoals: Map<Id, Goal>;
  relatedPlans: Map<Id, GoalPlan>;
  /** D3 buckets of every NUMERIC goal of the plan that has CASCADE children — over EVERY child (private too). */
  buckets: Map<Id, AllocationBuckets>;
  /** Active CASCADE children of each goal (rows, for aggregates and the cascade dialog's checks). */
  cascadeChildren: Map<Id, { alignment: GoalAlignment; childGoal: Goal }[]>;
  /** The plan's open registration form, if any. */
  registration: FormInstance | null;
  /** The open form's current step number and the owner's step (for the header). */
  registrationStep: { stepNo: number; stepCount: number; name: string; ownerStepNo: number } | null;
  editability: PlanEditability;
  /** `null` without an open registration form, or while an input it reads is missing. */
  submit: SubmitAvailability | null;
  readiness: PlanReadiness;
}

/**
 * Everything one Goal Plan screen reads, and the decisions over it (`planAccessRules`). Any failed
 * read fails the WHOLE workspace (`state.error`, one retry for all) — a plan that looks editable or
 * ready on partial data would be a silent failure; editability stays UNKNOWN until every input it
 * reads has loaded.
 */
export function usePlanWorkspace(goalPlanId: Id | null): { state: QueryState; data: PlanWorkspaceData | null } {
  const { user, access, today } = useSession();
  const clock = useClock();
  const planQuery = useGoalPlan(goalPlanId);
  const plan = planQuery.data ?? null;
  const cycles = useCycles();
  const periods = usePeriods(plan?.cycleId ?? null);
  const allPlans = useGoalPlans({}, { enabled: plan !== null });
  const allGoals = useGoalRows({}, { enabled: plan !== null });
  const kgis = useKgis(plan?.id ?? null);
  const scope = plan ? { goalPlanId: plan.id } : null;
  const levels = useTargetLevels(scope);
  const periodTargets = usePeriodTargets(scope);
  const alignments = useAlignments();
  const forms = useFormList({ goalPlanId: plan?.id ?? '' }, { enabled: plan !== null });
  const steps = useWorkflowSteps();
  const delegations = useDelegations();
  const methods = useCalcMethods();
  const kpis = useKpiDefinitions();
  const { dir, query: dirQuery } = useActorDirectory();
  const { viewer, ctx: visibility } = useGoalViewer();

  const queries = [planQuery, cycles, periods, allPlans, allGoals, kgis, levels, periodTargets, alignments, forms, steps, delegations, methods, kpis, dirQuery];
  const state = combineQueries(goalPlanId === null ? [] : queries);

  const data = useMemo<PlanWorkspaceData | null>(() => {
    const cycle = plan ? cycles.data?.find((c) => c.id === plan.cycleId) : undefined;
    if (
      !plan ||
      !cycle ||
      !periods.data ||
      !allPlans.data ||
      !allGoals.data ||
      !kgis.data ||
      !levels.data ||
      !periodTargets.data ||
      !alignments.data ||
      !forms.data ||
      !steps.data ||
      !delegations.data ||
      !methods.data ||
      !kpis.data ||
      !dir
    ) {
      return null;
    }
    const own = allGoals.data.filter((g) => g.goalPlanId === plan.id);
    const shown = visibleGoals(own, [plan], viewer, visibility);
    const ownIds = new Set(own.map((g) => g.id));
    const touching = alignments.data.filter((a) => ownIds.has(a.childGoalId) || ownIds.has(a.parentGoalId));
    const otherIds = new Set(touching.flatMap((a) => [a.childGoalId, a.parentGoalId]).filter((id) => !ownIds.has(id)));
    const others = allGoals.data.filter((g) => otherIds.has(g.id));
    const related = visibleGoals(others, allPlans.data, viewer, visibility).goals;

    const goalById = new Map(allGoals.data.map((g) => [g.id, g]));
    const employeeById = new Map(dir.employees.map((e) => [e.id, e]));
    const cascadeChildren = new Map<Id, { alignment: GoalAlignment; childGoal: Goal }[]>();
    const buckets = new Map<Id, AllocationBuckets>();
    for (const goal of own) {
      const children = alignments.data
        .filter((a) => a.parentGoalId === goal.id && a.alignmentType === 'CASCADE')
        .flatMap((a) => {
          const childGoal = goalById.get(a.childGoalId);
          return childGoal ? [{ alignment: a, childGoal }] : [];
        });
      if (children.length === 0) continue;
      cascadeChildren.set(goal.id, children);
      const withOwners = children.map((c) => ({ ...c, childOwner: c.childGoal.ownerEmployeeId ? (employeeById.get(c.childGoal.ownerEmployeeId) ?? null) : null }));
      if (goal.targetType === 'NUMERIC') buckets.set(goal.id, allocationBuckets(goal, withOwners, today));
    }

    const rows: PlanAccessRows = {
      plan,
      cycleStatus: cycle.status,
      forms: forms.data,
      steps: steps.data,
      delegations: delegations.data,
      dir,
      access,
      actor: { userId: user.id, employeeId: user.employeeId },
      clock: clock(),
    };
    const registration = openRegistrationOf(plan.id, forms.data);
    const regSteps = registration ? steps.data.filter((s) => s.workflowId === registration.workflowId).sort((a, b) => a.stepNo - b.stepNo) : [];
    const current = registration ? regSteps.find((s) => s.id === registration.currentStepId) : undefined;
    const registrationStep = current ? { stepNo: current.stepNo, stepCount: regSteps.length, name: current.name, ownerStepNo: ownerStepNo(regSteps) } : null;

    return {
      plan,
      cycle,
      periods: periods.data,
      goals: shown.goals,
      hiddenCount: shown.hiddenCount,
      summary: planSummary(own),
      kgis: kgis.data,
      levels: levels.data,
      periodTargets: periodTargets.data,
      alignments: touching,
      allAlignments: alignments.data,
      relatedGoals: new Map(related.map((g) => [g.id, g])),
      relatedPlans: new Map(allPlans.data.map((p) => [p.id, p])),
      buckets,
      cascadeChildren,
      registration,
      registrationStep,
      editability: planEditabilityFrom(rows),
      submit: submitAvailabilityFrom(rows, own, kgis.data),
      readiness: planReadiness(own, kgis.data, {
        levels: levels.data,
        periodTargets: periodTargets.data,
        periods: periods.data,
        methods: methods.data,
        kpiDefinitions: kpis.data,
        beforeOwnerStep: registrationStep !== null && registrationStep.stepNo < registrationStep.ownerStepNo,
      }),
    };
  }, [
    plan,
    cycles.data,
    periods.data,
    allPlans.data,
    allGoals.data,
    kgis.data,
    levels.data,
    periodTargets.data,
    alignments.data,
    forms.data,
    steps.data,
    delegations.data,
    methods.data,
    kpis.data,
    dir,
    viewer,
    visibility,
    access,
    user.id,
    user.employeeId,
    clock,
    today,
  ]);

  return { state, data: state.error ? null : data };
}

/** Each plan of `plans` with its totals (over every goal, private included) — one goals read. */
export function usePlanSummaries(plans: readonly GoalPlan[] | undefined) {
  const ids = useMemo(() => (plans ?? []).map((p) => p.id), [plans]);
  const rows = useGoalRows({ goalPlanIds: ids }, { enabled: plans !== undefined });
  const summaries = useMemo(() => (rows.data ? planSummaries(ids, rows.data) : null), [rows.data, ids]);
  return { query: rows, summaries };
}

/**
 * Whether the signed-in person may edit each EMPLOYEE plan of `plans` now (a cascade needs it for the
 * report's plan, BR-KPI-12 step 1) — UNKNOWN for all while an input is loading, and always UNKNOWN for a
 * Company / OrgUnit plan (its forms are not read here; use `usePlanWorkspace` for one).
 */
export function usePlansEditability(plans: readonly GoalPlan[] | undefined, cycles: readonly PerformanceCycle[] | undefined) {
  const { user, access } = useSession();
  const clock = useClock();
  const subjectIds = useMemo(() => sortedIds([...new Set((plans ?? []).map((p) => p.ownerEmployeeId).filter((id): id is Id => id !== null))]), [plans]);
  const forms = useFormList({ formType: 'GOAL_SETTING', subjectEmployeeIds: subjectIds }, { enabled: plans !== undefined });
  const steps = useWorkflowSteps();
  const delegations = useDelegations();
  const { dir, query: dirQuery } = useActorDirectory();
  const state = combineQueries([forms, steps, delegations, dirQuery]);
  const byPlan = useMemo(() => {
    const result = new Map<Id, PlanEditability>();
    for (const plan of plans ?? []) {
      const cycle = cycles?.find((c) => c.id === plan.cycleId);
      if (!forms.data || !steps.data || !delegations.data || !dir || !cycle || plan.ownerEmployeeId === null) {
        result.set(plan.id, UNKNOWN_EDITABILITY);
        continue;
      }
      result.set(
        plan.id,
        planEditabilityFrom({
          plan,
          cycleStatus: cycle.status,
          forms: forms.data,
          steps: steps.data,
          delegations: delegations.data,
          dir,
          access,
          actor: { userId: user.id, employeeId: user.employeeId },
          clock: clock(),
        }),
      );
    }
    return result;
  }, [plans, cycles, forms.data, steps.data, delegations.data, dir, access, user.id, user.employeeId, clock]);
  const registrations = useMemo(() => {
    const result = new Map<Id, FormInstance>();
    for (const plan of plans ?? []) {
      const open = forms.data ? openRegistrationOf(plan.id, forms.data) : null;
      if (open) result.set(plan.id, open);
    }
    return result;
  }, [plans, forms.data]);
  return { state, byPlan, registrations, steps: steps.data };
}

export interface GoalLookups {
  perspectives: BscPerspective[];
  perspective: Map<Id, BscPerspective>;
  unit: Map<Id, MeasureUnit>;
  units: MeasureUnit[];
  method: Map<Id, CalcMethod>;
  methods: CalcMethod[];
  dataSource: Map<Id, DataSource>;
  dataSources: DataSource[];
  kpi: Map<Id, KpiDefinition>;
  employee: Map<Id, Employee>;
  orgUnit: Map<Id, OrgUnit>;
  orgUnits: OrgUnit[];
}

/** The catalogues a goal row is displayed with — one combined state, `null` until all have loaded. */
export function useGoalLookups(): { state: QueryState; data: GoalLookups | null } {
  const perspectives = usePerspectives();
  const units = useMeasureUnits();
  const methods = useCalcMethods();
  const dataSources = useDataSources();
  const kpis = useKpiDefinitions();
  const employees = useEmployees({ includeResigned: true });
  const orgUnits = useOrgUnits();
  const state = combineQueries([perspectives, units, methods, dataSources, kpis, employees, orgUnits]);
  const data = useMemo<GoalLookups | null>(() => {
    if (!perspectives.data || !units.data || !methods.data || !dataSources.data || !kpis.data || !employees.data || !orgUnits.data) return null;
    const sortedPerspectives = [...perspectives.data].sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      perspectives: sortedPerspectives,
      perspective: new Map(perspectives.data.map((p) => [p.id, p])),
      units: units.data,
      unit: new Map(units.data.map((u) => [u.id, u])),
      methods: methods.data,
      method: new Map(methods.data.map((m) => [m.id, m])),
      dataSources: dataSources.data,
      dataSource: new Map(dataSources.data.map((d) => [d.id, d])),
      kpi: new Map(kpis.data.map((k) => [k.id, k])),
      employee: new Map(employees.data.map((e) => [e.id, e])),
      orgUnit: new Map(orgUnits.data.map((u) => [u.id, u])),
      orgUnits: orgUnits.data,
    };
  }, [perspectives.data, units.data, methods.data, dataSources.data, kpis.data, employees.data, orgUnits.data]);
  return { state, data };
}
