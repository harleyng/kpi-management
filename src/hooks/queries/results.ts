import { useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod, GoalPlan, Id, PayoutRule, PeriodResult } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { PeriodResultFilter, Upsert } from '@/integrations/data/types';
import { KpiError } from '@/lib/errorCatalog';
import { payrollPreview } from '@/lib/payrollRules';
import { combineQueries, type QueryState } from '@/lib/queryState';
import { buildResultRows, statusCounts } from '@/lib/resultView';
import { scoreBreakdown } from '@/lib/scoreRules';
import { toastError } from '@/components/shared/toastError';
import { useGoalPlans, useGoalRows, useGoals } from './goals';
import { queryKey } from './keys';
import { useAssignments, useEmployees, useOrgUnits } from './org';
import { downloadFile } from './system';

/**
 * G6 · Kết quả & đãi ngộ (T6, WBS 4.6.1–4.6.4). Every number shown comes from the stored result or a
 * `*Rules.ts` function called in a selector here — never from a component.
 *
 * Invalidation: the gateway announces every row it writes (`entity.changed`), and
 * `useGatewayEventInvalidation` refreshes the roots that read it, so the mutations below only toast.
 */

const RATING_STALE_MS = 5 * 60 * 1000;

// ─── Rating scale and payout rules (4.6.3) ─────────────────────────────────────────────────────

export const ratingScalesKey = (tenantId: string) => queryKey(tenantId, 'ratingScales', 'scales');

export function useRatingScales() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: ratingScalesKey(tenantId),
    queryFn: () => getDataGateway().results.listRatingScales(tenantId),
    staleTime: RATING_STALE_MS,
  });
}

export const ratingLevelsKey = (tenantId: string, ratingScaleId: Id | null) => queryKey(tenantId, 'ratingScales', 'levels', ratingScaleId);

/** Disabled while the cycle has no scale. */
export function useRatingLevels(ratingScaleId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: ratingLevelsKey(tenantId, ratingScaleId),
    queryFn: () => getDataGateway().results.listRatingLevels(tenantId, ratingScaleId as Id),
    enabled: ratingScaleId !== null,
    staleTime: RATING_STALE_MS,
  });
}

export const payoutRulesKey = (tenantId: string, ratingScaleId: Id | null) => queryKey(tenantId, 'ratingScales', 'payoutRules', ratingScaleId);

export function usePayoutRules(ratingScaleId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: payoutRulesKey(tenantId, ratingScaleId),
    queryFn: () => getDataGateway().results.listPayoutRules(tenantId, ratingScaleId as Id),
    enabled: ratingScaleId !== null,
    staleTime: RATING_STALE_MS,
  });
}

/** The dialog shows the refusal inline (`mutation.error`); no toast, so the copy is not said twice. */
export function useSavePayoutRule() {
  const { tenantId, user } = useSession();
  return useMutation({
    mutationFn: (input: Upsert<PayoutRule>) => getDataGateway().results.savePayoutRule(tenantId, user.id, input),
    onSuccess: (_rule, input) => toast.success(input.id ? 'Đã cập nhật quy tắc quy đổi' : 'Đã thêm quy tắc quy đổi'),
  });
}

export function useDeletePayoutRule() {
  const { tenantId, user } = useSession();
  return useMutation({
    mutationFn: (payoutRuleId: Id) => getDataGateway().results.deletePayoutRule(tenantId, user.id, payoutRuleId),
    onSuccess: () => toast.success('Đã xóa quy tắc quy đổi'),
    onError: toastError,
  });
}

// ─── Period results (4.6.1, 4.6.2, 4.6.4) ──────────────────────────────────────────────────────

export const periodResultsKey = (tenantId: string, filter: PeriodResultFilter) => queryKey(tenantId, 'results', 'list', filter);

export function usePeriodResults(filter: PeriodResultFilter, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: periodResultsKey(tenantId, filter),
    queryFn: () => getDataGateway().results.listPeriodResults(tenantId, filter),
    enabled: options.enabled ?? true,
  });
}

/**
 * The results of several periods (one query per period, under `periodResultsKey` — the same cache the
 * results screens use). `data` only once every period has loaded: a trend drawn from half the months
 * would show gaps that are not real.
 */
export function useResultsOfPeriods(periodIds: readonly Id[] | undefined) {
  const { tenantId } = useSession();
  return useQueries({
    queries: (periodIds ?? []).map((periodId) => ({
      queryKey: periodResultsKey(tenantId, { periodId }),
      queryFn: () => getDataGateway().results.listPeriodResults(tenantId, { periodId }),
    })),
    combine: combineResults,
  });
}

function combineResults(queries: UseQueryResult<PeriodResult[]>[]): { data: PeriodResult[] | undefined; query: QueryState } {
  return {
    data: queries.every((q) => q.data !== undefined) ? queries.flatMap((q) => q.data ?? []) : undefined,
    query: combineQueries(queries),
  };
}

export const resultDetailsKey = (tenantId: string, resultId: Id | null) => queryKey(tenantId, 'results', 'details', resultId);

export function useResultDetails(resultId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: resultDetailsKey(tenantId, resultId),
    queryFn: () => getDataGateway().results.listResultDetails(tenantId, resultId as Id),
    enabled: resultId !== null,
  });
}

/**
 * The results table of one period: each result joined ONCE with its plan, owner, unit and level
 * (`resultView.buildResultRows`), plus the status counts. `query` combines every read it needs, so
 * the table shows loading / error for all of them, never a half-joined row.
 */
export function useResultRows(period: CyclePeriod | null, levels: Parameters<typeof buildResultRows>[0]['levels']) {
  const results = usePeriodResults({ periodId: period?.id }, { enabled: period !== null });
  const plans = useGoalPlans({ cycleId: period?.cycleId }, { enabled: period !== null });
  const employees = useEmployees({ includeResigned: true });
  const assignments = useAssignments();
  const units = useOrgUnits();
  const query = combineQueries([results, plans, employees, assignments, units]);
  const rows = useMemo(() => {
    if (!period || !results.data || !plans.data || !employees.data || !assignments.data || !units.data) return undefined;
    return buildResultRows({ results: results.data, plans: plans.data, employees: employees.data, assignments: assignments.data, units: units.data, levels, period });
  }, [period, results.data, plans.data, employees.data, assignments.data, units.data, levels]);
  const counts = useMemo(() => (results.data ? statusCounts(results.data) : null), [results.data]);
  return { rows, counts, query, results: results.data, plans: plans.data, employees: employees.data };
}

/** What the export tab shows before exporting (`payrollRules.payrollPreview`). */
export function usePayrollPreview(periodId: Id | null, cycleId: Id | null) {
  const results = usePeriodResults({ periodId: periodId ?? undefined }, { enabled: periodId !== null });
  const plans = useGoalPlans({ cycleId: cycleId ?? undefined }, { enabled: cycleId !== null });
  const employees = useEmployees({ includeResigned: true });
  const query = combineQueries([results, plans, employees]);
  const preview = useMemo(() => {
    if (periodId === null || !results.data || !plans.data || !employees.data) return undefined;
    return payrollPreview({ PeriodResult: results.data, GoalPlan: plans.data, Employee: employees.data }, periodId);
  }, [periodId, results.data, plans.data, employees.data]);
  return { preview, query };
}

/**
 * One result's goal lines with their names, and how its score is made up (`scoreBreakdown`).
 *
 * Without `plan`, every goal is named — for a viewer entitled to the whole plan (the person themself,
 * HR on the results screen). With `plan` (the dashboard, Phase 3), names follow goal visibility (D2,
 * BR-KPI-08): a PRIVATE goal the viewer may not see keeps its numbers but is marked `hidden`, never named.
 */
export function useResultBreakdown(result: PeriodResult | null, options: { plan?: GoalPlan } = {}) {
  const details = useResultDetails(result?.id ?? null);
  const filter = { goalPlanIds: result ? [result.goalPlanId] : [] };
  const scoped = options.plan !== undefined;
  // Both read the same cached goal list (one fetch): the rows say a goal exists, `useGoals` whether it may be named.
  const rows = useGoalRows(filter, { enabled: result !== null });
  const visible = useGoals(filter, options.plan ? [options.plan] : undefined, { enabled: result !== null && scoped });
  const query = combineQueries(scoped ? [details, rows, visible] : [details, rows]);
  const view = useMemo(() => {
    if (!result || !details.data || !rows.data || (scoped && !visible.data)) return undefined;
    const exists = new Set(rows.data.map((g) => g.id));
    const names = new Map((scoped ? (visible.data?.goals ?? []) : rows.data).map((g) => [g.id, g.name]));
    return {
      lines: details.data.map((d) => ({ ...d, goalName: names.get(d.goalId) ?? null, hidden: exists.has(d.goalId) && !names.has(d.goalId) })),
      breakdown: scoreBreakdown(result, details.data),
    };
  }, [result, details.data, rows.data, visible.data, scoped]);
  return { view, query };
}

export function useCalculateResults() {
  const { tenantId, user } = useSession();
  return useMutation({
    mutationFn: (periodId: Id) => getDataGateway().results.calculateResults(tenantId, user.id, periodId),
    onSuccess: () => toast.success('Đã tính lại kết quả kỳ'),
    onError: toastError,
  });
}

export function useSetAdjustment() {
  const { tenantId, user } = useSession();
  return useMutation({
    mutationFn: ({ resultId, adjustmentPct }: { resultId: Id; adjustmentPct: number }) =>
      getDataGateway().results.setAdjustment(tenantId, user.id, resultId, adjustmentPct),
    onSuccess: () => toast.success('Đã lưu điều chỉnh điểm'),
    onError: toastError,
  });
}

/**
 * A refusal that lists the results still blocked (all-or-none, BR-KPI-43): the error carries every
 * issue, and the page shows them in a panel. Every other failure (permission, a closed cycle, the
 * store) has no per-result issues and is a toast in the catalogue's words.
 */
export const isBlockedFinalize = (error: unknown): error is KpiError =>
  error instanceof KpiError && error.issues.some((i) => i.data !== null && typeof i.data.resultId === 'string');

export function useFinalizeResults() {
  const { tenantId, user } = useSession();
  return useMutation({
    mutationFn: ({ periodId, resultIds }: { periodId: Id; resultIds?: readonly Id[] }) =>
      getDataGateway().results.finalizeResults(tenantId, user.id, periodId, resultIds),
    onSuccess: (results) => toast.success(`Đã chốt ${results.length} kết quả`),
    onError: (error) => {
      if (isBlockedFinalize(error)) toast.error('Không chốt được kết quả nào', { description: 'Xem danh sách kết quả còn vướng phía trên bảng.' });
      else toastError(error);
    },
  });
}

export function useLockResults() {
  const { tenantId, user } = useSession();
  return useMutation({
    mutationFn: (periodId: Id) => getDataGateway().results.lockResults(tenantId, user.id, periodId),
    onSuccess: (results) => toast.success(`Đã khóa ${results.length} kết quả`),
    onError: toastError,
  });
}

// ─── Payroll export (4.6.4) ────────────────────────────────────────────────────────────────────

export const payrollExportsKey = (tenantId: string, periodId: Id | null) => queryKey(tenantId, 'payrollExports', periodId);

export function usePayrollExports(periodId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: payrollExportsKey(tenantId, periodId),
    queryFn: () => getDataGateway().results.listPayrollExports(tenantId, periodId as Id),
    enabled: periodId !== null,
  });
}

/**
 * Exports, then downloads the new file. The export and the download fail separately: a recorded
 * export whose download failed says so, and the file stays in "Lịch sử xuất file".
 */
export function useExportPayroll() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (periodId: Id) => getDataGateway().results.exportPayroll(tenantId, user.id, periodId),
    onSuccess: async (record) => {
      void queryClient.invalidateQueries({ queryKey: payrollExportsKey(tenantId, record.periodId) });
      try {
        const fileName = await downloadFile(tenantId, record.fileId);
        toast.success('Đã xuất file lương', { description: fileName });
      } catch {
        toast.warning('Đã ghi nhận lần xuất nhưng chưa tải được tệp', { description: 'Bấm "Tải xuống" trong lịch sử xuất file.' });
      }
    },
    onError: toastError,
  });
}
