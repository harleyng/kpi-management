import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { Id } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { EvidenceFilter } from '@/integrations/data/types';
import { queryKey } from './keys';

/**
 * G4 · Số liệu thực hiện — what the evaluation form needs: data sources (the adjustment's new goal),
 * the evidence of a period and attaching one (plan §5.5, BR-KPI-17). Track T4 owns evidence
 * management (4.4.6) and adds its writes beside these.
 */

export const dataSourcesKey = (tenantId: Id) => queryKey(tenantId, 'dataSources');

export function useDataSources() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: dataSourcesKey(tenantId),
    queryFn: () => getDataGateway().actuals.listDataSources(tenantId),
    staleTime: 5 * 60 * 1000,
  });
}

/** `filter` null leaves it idle. The evaluation form reads one period's evidence and groups it by goal. */
export const evidenceKey = (tenantId: Id, filter: EvidenceFilter | null) => queryKey(tenantId, 'evidence', filter);

export function useEvidence(filter: EvidenceFilter | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: evidenceKey(tenantId, filter),
    queryFn: () => getDataGateway().actuals.listEvidence(tenantId, filter!),
    enabled: filter !== null,
  });
}

export type AttachEvidenceInput =
  | { kind: 'file'; goalId: Id; periodId: Id; file: File; note: string | null }
  | { kind: 'link'; goalId: Id; periodId: Id; url: string; note: string | null };

/**
 * Attach a file (uploaded first, then recorded) or a link to a goal's period. The two writes are not
 * one transaction: an upload whose record then fails leaves an unused file — the error still reaches
 * the screen, which offers to try again (system-architect, T5; a database adapter will make it one).
 */
export function useAttachEvidence() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AttachEvidenceInput) => {
      const gateway = getDataGateway();
      const fileId =
        input.kind === 'file'
          ? (await gateway.system.uploadFile(tenantId, user.id, { fileName: input.file.name, mimeType: input.file.type || 'application/octet-stream', data: input.file })).id
          : null;
      return gateway.actuals.addEvidence(tenantId, user.id, {
        goalId: input.goalId,
        periodId: input.periodId,
        actualId: null,
        fileId,
        url: input.kind === 'link' ? input.url : null,
        note: input.note,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [tenantId, 'evidence'] }),
  });
}

/** Opens an evidence file (a blob URL in the mock) — read on click, never cached: the URL is short-lived. */
export function useOpenFile() {
  const { tenantId } = useSession();
  return useMutation({
    mutationFn: (fileId: Id) => getDataGateway().system.getFileUrl(tenantId, fileId),
  });
}
