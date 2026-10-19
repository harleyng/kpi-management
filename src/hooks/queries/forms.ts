import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { FormInstance, FormType, Id } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type {
  ChildInput,
  EvaluationItemPatch,
  FormActionInput,
  FormFilter,
  NewLaunchInput,
  PageRequest,
  StartFormInput,
  Upsert,
} from '@/integrations/data/types';
import type { Delegation, FormLaunchRule, GoalChangeItem, WorkflowStep, WorkflowTemplate } from '@/data/types';
import { queryKey, type KeyRoot } from './keys';

/**
 * G5 · Quy trình phê duyệt & đánh giá + D5 launches (Track T5).
 *
 * Keys are `[tenantId, root, ...params]`. Writes need no explicit invalidation for the entities the
 * gateway announces (`useGatewayEventInvalidation`): `forms.act` moves a form, a plan and other
 * people's inboxes, and every one of those is an `entity.changed` the bridge turns into refetches.
 * Each mutation still invalidates its own roots on success (CLAUDE.md rule 7), and `useActOnForm`
 * refetches the form it acted on even after a refusal — a stale step must show the new one.
 *
 * Mutations report failure to the caller — the screens map a `RuleIssue` with a `ref` inline and
 * toast the rest (`toastError`); nothing here swallows an error.
 */

/** Configuration changes rarely; forms and inboxes change under other users' hands. */
const CONFIG_STALE_MS = 5 * 60 * 1000;
const LIST_STALE_MS = 20 * 1000;

/** A write refreshes its own roots on success (the event bridge refreshes everything else it touched). */
function useInvalidateRoots(...roots: KeyRoot[]) {
  const queryClient = useQueryClient();
  const { tenantId } = useSession();
  return () => Promise.all(roots.map((root) => queryClient.invalidateQueries({ queryKey: [tenantId, root] })));
}

// ─── Workflows (WBS 4.5.1) ─────────────────────────────────────────────────────────────────────

export const workflowsKey = (tenantId: Id, formType?: FormType) => queryKey(tenantId, 'workflows', 'templates', formType ?? null);

export function useWorkflows(formType?: FormType) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: workflowsKey(tenantId, formType),
    queryFn: () => getDataGateway().forms.listWorkflows(tenantId, formType),
    staleTime: CONFIG_STALE_MS,
  });
}

/** Every step of the tenant (omit `workflowId`) — forms of any workflow resolve their step from it. */
export const workflowStepsKey = (tenantId: Id, workflowId?: Id) => queryKey(tenantId, 'workflows', 'steps', workflowId ?? null);

export function useWorkflowSteps(workflowId?: Id) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: workflowStepsKey(tenantId, workflowId),
    queryFn: () => getDataGateway().forms.listWorkflowSteps(tenantId, workflowId),
    staleTime: CONFIG_STALE_MS,
  });
}

export function useSaveWorkflow() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('workflows');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: (input: { workflow: Upsert<WorkflowTemplate>; steps: readonly ChildInput<WorkflowStep, 'workflowId' | 'stepNo'>[] }) =>
      getDataGateway().forms.saveWorkflow(tenantId, user.id, input.workflow, input.steps),
  });
}

// ─── Launches and recurring rules (D5) ─────────────────────────────────────────────────────────

export const launchesKey = (tenantId: Id) => queryKey(tenantId, 'launches', 'list');

export function useLaunches() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: launchesKey(tenantId),
    queryFn: () => getDataGateway().forms.listLaunches(tenantId),
    staleTime: LIST_STALE_MS,
  });
}

export function useCreateLaunch() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('launches', 'forms', 'inbox');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: (input: NewLaunchInput) => getDataGateway().forms.createLaunch(tenantId, user.id, input),
  });
}

export function useCancelLaunch() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('launches');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: (launchId: Id) => getDataGateway().forms.cancelLaunch(tenantId, user.id, launchId),
  });
}

export const launchRulesKey = (tenantId: Id) => queryKey(tenantId, 'launches', 'rules');

export function useLaunchRules() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: launchRulesKey(tenantId),
    queryFn: () => getDataGateway().forms.listLaunchRules(tenantId),
    staleTime: CONFIG_STALE_MS,
  });
}

export function useSaveLaunchRule() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('launches');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: (input: Upsert<FormLaunchRule>) => getDataGateway().forms.saveLaunchRule(tenantId, user.id, input),
  });
}

// ─── Forms ─────────────────────────────────────────────────────────────────────────────────────

/** `filter` and `page` go in as they are (sort id lists first: `sortedIds`). */
export const formsKey = (tenantId: Id, filter: FormFilter = {}, page: PageRequest = {}) => queryKey(tenantId, 'forms', 'list', filter, page);

/** A list the gateway pages. The previous page stays on screen while the next loads. */
export function useForms(filter: FormFilter = {}, page: PageRequest = {}, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: formsKey(tenantId, filter, page),
    queryFn: () => getDataGateway().forms.listForms(tenantId, filter, page),
    placeholderData: keepPreviousData,
    staleTime: LIST_STALE_MS,
    enabled: options.enabled ?? true,
  });
}

/**
 * Every form matching `filter` — all pages, read in one query (T3's plan screens need the whole set to
 * find a plan's open registration). Put an id list in sorted order (README: keys).
 */
export const formListKey = (tenantId: Id, filter: FormFilter) => queryKey(tenantId, 'forms', 'all', filter);

export function useFormList(filter: FormFilter, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: formListKey(tenantId, filter),
    queryFn: async () => {
      const gateway = getDataGateway();
      const items: FormInstance[] = [];
      let cursor: string | undefined;
      do {
        const page = await gateway.forms.listForms(tenantId, filter, { limit: 500, cursor });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return items;
    },
    enabled: options.enabled ?? true,
  });
}

export const formKey = (tenantId: Id, formId: Id) => queryKey(tenantId, 'forms', 'one', formId);

export function useForm(formId: Id) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: formKey(tenantId, formId),
    queryFn: () => getDataGateway().forms.getForm(tenantId, formId),
  });
}

export const formActionsKey = (tenantId: Id, formId: Id) => queryKey(tenantId, 'forms', 'actions', formId);

export function useFormActions(formId: Id) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: formActionsKey(tenantId, formId),
    queryFn: () => getDataGateway().forms.listFormActions(tenantId, formId),
  });
}

export const evaluationItemsKey = (tenantId: Id, formId: Id) => queryKey(tenantId, 'forms', 'evaluationItems', formId);

export function useEvaluationItems(formId: Id, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: evaluationItemsKey(tenantId, formId),
    queryFn: () => getDataGateway().forms.listEvaluationItems(tenantId, formId),
    enabled: options.enabled ?? true,
  });
}

export const goalChangeItemsKey = (tenantId: Id, formId: Id) => queryKey(tenantId, 'forms', 'goalChangeItems', formId);

export function useGoalChangeItems(formId: Id, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: goalChangeItemsKey(tenantId, formId),
    queryFn: () => getDataGateway().forms.listGoalChangeItems(tenantId, formId),
    enabled: options.enabled ?? true,
  });
}

/** "Việc cần xử lý" — the signed-in user's inbox, most urgent first (the gateway's order). */
export const inboxKey = (tenantId: Id, userId: Id) => queryKey(tenantId, 'inbox', userId);

export function useInbox() {
  const { tenantId, user } = useSession();
  return useQuery({
    queryKey: inboxKey(tenantId, user.id),
    queryFn: () => getDataGateway().forms.listInbox(tenantId, user.id),
    staleTime: LIST_STALE_MS,
  });
}

/** Refetch what a form screen shows about `formId` — after its own write, before the next render reads it. */
function useRefreshForm() {
  const queryClient = useQueryClient();
  const { tenantId } = useSession();
  return (formId: Id) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: formKey(tenantId, formId) }),
      queryClient.invalidateQueries({ queryKey: formActionsKey(tenantId, formId) }),
    ]);
}

export function useStartForm() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('forms', 'inbox', 'goalPlans');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: (input: StartFormInput) => getDataGateway().forms.startForm(tenantId, user.id, input),
  });
}

/** What the screen has not saved yet — saved before the action, so the gateway checks what is on screen. */
export interface UnsavedEdits {
  /** Changed evaluation cells (KPI_EVAL). */
  evaluation?: readonly EvaluationItemPatch[];
  /** The whole proposal, when it changed (GOAL_CHANGE). */
  changeItems?: readonly ChildInput<GoalChangeItem, 'formId'>[];
}

/**
 * Acts on the current step. `unsaved` edits are saved FIRST and awaited, so the gateway's content
 * check reads what the user sees (cto, T5 phase 2) — one mutation, so the action bar's pending state
 * covers every write. CANCEL and RETURN never save: what they discard is not checked.
 */
export function useActOnForm() {
  const { tenantId, user } = useSession();
  const refresh = useRefreshForm();
  const invalidate = useInvalidateRoots('forms', 'inbox', 'goalPlans', 'goals');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: async ({ input, unsaved = {} }: { input: FormActionInput; unsaved?: UnsavedEdits }) => {
      const forms = getDataGateway().forms;
      const forward = input.action === 'SUBMIT' || input.action === 'APPROVE';
      if (forward && unsaved.evaluation && unsaved.evaluation.length > 0) {
        await forms.saveEvaluationItems(tenantId, user.id, input.formId, unsaved.evaluation);
      }
      if (forward && unsaved.changeItems) await forms.saveGoalChangeItems(tenantId, user.id, input.formId, unsaved.changeItems);
      return forms.act(tenantId, user.id, input);
    },
    onSettled: (_data, _error, { input }) => refresh(input.formId),
  });
}

export function useSaveEvaluationItems() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('forms');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: ({ formId, patches }: { formId: Id; patches: readonly EvaluationItemPatch[] }) =>
      getDataGateway().forms.saveEvaluationItems(tenantId, user.id, formId, patches),
  });
}

export function useSaveGoalChangeItems() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('forms');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: ({ formId, items }: { formId: Id; items: readonly ChildInput<GoalChangeItem, 'formId'>[] }) =>
      getDataGateway().forms.saveGoalChangeItems(tenantId, user.id, formId, items),
  });
}

// ─── Delegations (BR-KPI-21) ───────────────────────────────────────────────────────────────────

/** Every delegation of the tenant (`userId` omitted) or those `userId` gave or received. */
export const delegationsKey = (tenantId: Id, userId?: Id) => queryKey(tenantId, 'delegations', userId ?? null);

export function useDelegations(userId?: Id) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: delegationsKey(tenantId, userId),
    queryFn: () => getDataGateway().forms.listDelegations(tenantId, userId),
    staleTime: LIST_STALE_MS,
  });
}

export function useSaveDelegation() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('delegations', 'inbox');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: (input: Upsert<Delegation, 'fromUserId' | 'revokedAt'>) => getDataGateway().forms.saveDelegation(tenantId, user.id, input),
  });
}

export function useRevokeDelegation() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('delegations', 'inbox');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: (delegationId: Id) => getDataGateway().forms.revokeDelegation(tenantId, user.id, delegationId),
  });
}
