import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { Id } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { WorkPlanFilter, WorkResultFilter, WorkReviewPatch, WorkScoringInput, WorkTaskInput, WorkTaskProgressInput } from '@/integrations/data/types';
import { DEFAULT_WORK_SCORING, type WorkScoring } from '@/lib/workRules';
import { queryKey, type KeyRoot } from './keys';

/**
 * G8 · Công việc tháng (PEND-14, Plan B step 8.1) — the reads and the content writes; the screens
 * arrive with 8.2 / 8.3. Every write refreshes its own roots on success (the event bridge refreshes
 * everything else it touched); a refusal is the caller's to show (`toastError` or inline).
 */

function useInvalidateRoots(...roots: KeyRoot[]) {
  const queryClient = useQueryClient();
  const { tenantId } = useSession();
  return () => Promise.all(roots.map((root) => queryClient.invalidateQueries({ queryKey: [tenantId, root] })));
}

export const workPlansKey = (tenantId: Id, filter: WorkPlanFilter = {}) =>
  queryKey(tenantId, 'workPlans', 'list', { ...filter, employeeIds: filter.employeeIds ? [...filter.employeeIds].sort() : undefined });

export function useWorkPlans(filter: WorkPlanFilter = {}) {
  const { tenantId } = useSession();
  return useQuery({ queryKey: workPlansKey(tenantId, filter), queryFn: () => getDataGateway().work.listWorkPlans(tenantId, filter) });
}

export const workPlanKey = (tenantId: Id, workPlanId: Id | null) => queryKey(tenantId, 'workPlans', 'one', workPlanId);

export function useWorkPlan(workPlanId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: workPlanKey(tenantId, workPlanId),
    queryFn: () => getDataGateway().work.getWorkPlan(tenantId, workPlanId as Id),
    enabled: workPlanId !== null,
  });
}

export const workTasksKey = (tenantId: Id, workPlanId: Id | null) => queryKey(tenantId, 'workPlans', 'tasks', workPlanId);

export function useWorkTasks(workPlanId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: workTasksKey(tenantId, workPlanId),
    queryFn: () => getDataGateway().work.listWorkTasks(tenantId, workPlanId as Id),
    enabled: workPlanId !== null,
  });
}

export const workTasksOfPlansKey = (tenantId: Id, workPlanIds: readonly Id[]) => queryKey(tenantId, 'workPlans', 'tasksOfPlans', [...workPlanIds].sort());

/** The tasks of several plans in one read (a team's month). Disabled while the list is empty. */
export function useWorkTasksOfPlans(workPlanIds: readonly Id[]) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: workTasksOfPlansKey(tenantId, workPlanIds),
    queryFn: () => getDataGateway().work.listWorkTasksOfPlans(tenantId, workPlanIds),
    enabled: workPlanIds.length > 0,
  });
}

export const workReviewKey = (tenantId: Id, formId: Id | null) => queryKey(tenantId, 'workReviews', 'review', formId);

export function useWorkReview(formId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: workReviewKey(tenantId, formId),
    queryFn: () => getDataGateway().work.getWorkReview(tenantId, formId as Id),
    enabled: formId !== null,
  });
}

export const workReviewItemsKey = (tenantId: Id, formId: Id | null) => queryKey(tenantId, 'workReviews', 'items', formId);

export function useWorkReviewItems(formId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: workReviewItemsKey(tenantId, formId),
    queryFn: () => getDataGateway().work.listWorkReviewItems(tenantId, formId as Id),
    enabled: formId !== null,
  });
}

export const workResultsKey = (tenantId: Id, filter: WorkResultFilter = {}) =>
  queryKey(tenantId, 'workResults', 'list', {
    periodIds: filter.periodIds ? [...filter.periodIds].sort() : undefined,
    employeeIds: filter.employeeIds ? [...filter.employeeIds].sort() : undefined,
  });

export function useWorkResults(filter: WorkResultFilter = {}) {
  const { tenantId } = useSession();
  return useQuery({ queryKey: workResultsKey(tenantId, filter), queryFn: () => getDataGateway().work.listWorkResults(tenantId, filter) });
}

export const workScoringKey = (tenantId: Id) => queryKey(tenantId, 'workScoring', 'config');

/** The tenant's settings; CMC's defaults (`DEFAULT_WORK_SCORING`) while HR has saved none. */
export function useWorkScoring() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: workScoringKey(tenantId),
    queryFn: () => getDataGateway().work.getWorkScoringConfig(tenantId),
    select: (config): WorkScoring => config ?? DEFAULT_WORK_SCORING,
  });
}

export function useSaveWorkTasks() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('workPlans');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: ({ workPlanId, tasks }: { workPlanId: Id; tasks: readonly WorkTaskInput[] }) => getDataGateway().work.saveWorkTasks(tenantId, user.id, workPlanId, tasks),
  });
}

export function useCancelWorkTask() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('workPlans');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: ({ taskId, reason }: { taskId: Id; reason: string }) => getDataGateway().work.cancelWorkTask(tenantId, user.id, taskId, reason),
  });
}

export function useUpdateTaskProgress() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('workPlans');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: ({ taskId, input }: { taskId: Id; input: WorkTaskProgressInput }) => getDataGateway().work.updateTaskProgress(tenantId, user.id, taskId, input),
  });
}

export function useSaveWorkReview() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('workReviews');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: ({ formId, patch }: { formId: Id; patch: WorkReviewPatch }) => getDataGateway().work.saveWorkReview(tenantId, user.id, formId, patch),
  });
}

export function useSaveWorkScoring() {
  const { tenantId, user } = useSession();
  const invalidate = useInvalidateRoots('workScoring');
  return useMutation({
    onSuccess: () => invalidate(),
    mutationFn: (input: WorkScoringInput) => getDataGateway().work.saveWorkScoringConfig(tenantId, user.id, input),
  });
}
