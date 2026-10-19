import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { FormType, Id } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import { queryKey } from './keys';

/**
 * G5 · Quy trình mẫu — read-only (T7's "Lịch nhắc hạn" reads the steps' SLA and reminders). Track T5
 * adds the writes beside them. Workflows change rarely during a session.
 */

const WORKFLOW_STALE_MS = 5 * 60 * 1000;

export const workflowsKey = (tenantId: string, formType?: FormType) => queryKey(tenantId, 'workflows', 'templates', formType ?? null);

export function useWorkflows(formType?: FormType) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: workflowsKey(tenantId, formType),
    queryFn: () => getDataGateway().forms.listWorkflows(tenantId, formType),
    staleTime: WORKFLOW_STALE_MS,
  });
}

export const workflowStepsKey = (tenantId: string, workflowId?: Id) => queryKey(tenantId, 'workflows', 'steps', workflowId ?? null);

/** Every workflow's steps, or one workflow's. */
export function useWorkflowSteps(workflowId?: Id) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: workflowStepsKey(tenantId, workflowId),
    queryFn: () => getDataGateway().forms.listWorkflowSteps(tenantId, workflowId),
    staleTime: WORKFLOW_STALE_MS,
  });
}
