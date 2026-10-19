import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { FormInstance } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { FormFilter } from '@/integrations/data/types';
import { queryKey } from './keys';

/**
 * G5 · Phê duyệt & đánh giá — the READS T3 needs to decide who may edit a Goal Plan and send it
 * (`planAccessRules`). Track T5 owns the forms screens and their writes; it extends this file — the
 * one T3 write on a form ("Gửi") is `useSubmitPlanForm` in `goals.ts`.
 */

const PAGE_LIMIT = 500;

/**
 * Every form matching `filter` — all pages, read in one query (the T3 screens need the whole set to
 * find a plan's open registration). Put an id list in sorted order (README: keys).
 */
export const formListKey = (tenantId: string, filter: FormFilter) => queryKey(tenantId, 'forms', 'all', filter);

export function useFormList(filter: FormFilter, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: formListKey(tenantId, filter),
    queryFn: async () => {
      const gateway = getDataGateway();
      const items: FormInstance[] = [];
      let cursor: string | undefined;
      do {
        const page = await gateway.forms.listForms(tenantId, filter, { limit: PAGE_LIMIT, cursor });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return items;
    },
    enabled: options.enabled ?? true,
  });
}

/** Every workflow's steps (a handful of templates). */
export const workflowStepsKey = (tenantId: string) => queryKey(tenantId, 'workflows', 'steps');

export function useWorkflowSteps() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: workflowStepsKey(tenantId),
    queryFn: () => getDataGateway().forms.listWorkflowSteps(tenantId),
    staleTime: 5 * 60 * 1000,
  });
}

/** Every delegation of the tenant — who may act for whom (BR-KPI-21). */
export const delegationsKey = (tenantId: string) => queryKey(tenantId, 'delegations');

export function useDelegations() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: delegationsKey(tenantId),
    queryFn: () => getDataGateway().forms.listDelegations(tenantId),
  });
}
