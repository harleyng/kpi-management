import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSession } from '@/contexts/useSession';
import type { DataSource, Id, ImportType } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { ActualFilter, ActualsGateway, EvidenceFilter, RecordActualInput, StageImportInput } from '@/integrations/data/types';
import { queryKey } from './keys';
import { toastWriteError } from './writeFeedback';

/**
 * G4 · Số liệu thực hiện (Track T4). Keys are `[tenantId, root, ...params]` (rule 7). Writes take the
 * session's user as the actor, toast the catalogue copy on failure and invalidate the roots they
 * touch (the gateway's events invalidate them too — `useGatewayEventInvalidation`).
 */

// ─── Reads ───────────────────────────────────────────────────────────────────────────────────────

export const dataSourcesKey = (tenantId: string) => queryKey(tenantId, 'dataSources');
export function useDataSources() {
  const { tenantId } = useSession();
  return useQuery({ queryKey: dataSourcesKey(tenantId), queryFn: () => getDataGateway().actuals.listDataSources(tenantId) });
}

export const connectionsKey = (tenantId: string) => queryKey(tenantId, 'connections', 'list');
export function useConnections() {
  const { tenantId } = useSession();
  return useQuery({ queryKey: connectionsKey(tenantId), queryFn: () => getDataGateway().actuals.listConnections(tenantId) });
}

export const mappingsKey = (tenantId: string, connectionId: Id | null) => queryKey(tenantId, 'connections', 'mappings', connectionId);
export function useMappings(connectionId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({ queryKey: mappingsKey(tenantId, connectionId), queryFn: () => getDataGateway().actuals.listMappings(tenantId, connectionId ?? undefined) });
}

export const syncRunsKey = (tenantId: string, connectionId: Id | null) => queryKey(tenantId, 'connections', 'syncRuns', connectionId);
export function useSyncRuns(connectionId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({ queryKey: syncRunsKey(tenantId, connectionId), queryFn: () => getDataGateway().actuals.listSyncRuns(tenantId, connectionId ?? undefined) });
}

/** `filter` in the key as-is — sort its id list first. Disabled until the screen knows what to ask. */
export const actualsKey = (tenantId: string, filter: ActualFilter) => queryKey(tenantId, 'actuals', filter);
export function useActuals(filter: ActualFilter, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: actualsKey(tenantId, filter),
    queryFn: () => getDataGateway().actuals.listActuals(tenantId, filter),
    enabled: options.enabled ?? true,
  });
}

export const importBatchesKey = (tenantId: string, importType: ImportType | null) => queryKey(tenantId, 'importBatches', 'list', importType);
export function useImportBatches(importType: ImportType | null) {
  const { tenantId } = useSession();
  return useQuery({ queryKey: importBatchesKey(tenantId, importType), queryFn: () => getDataGateway().actuals.listImportBatches(tenantId, importType ?? undefined) });
}

export const importBatchKey = (tenantId: string, batchId: Id | null) => queryKey(tenantId, 'importBatches', 'one', batchId);
export function useImportBatch(batchId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: importBatchKey(tenantId, batchId),
    queryFn: () => getDataGateway().actuals.getImportBatch(tenantId, batchId as Id),
    enabled: batchId !== null,
  });
}

export const evidenceKey = (tenantId: string, filter: EvidenceFilter) => queryKey(tenantId, 'evidence', filter);
export function useEvidence(filter: EvidenceFilter, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: evidenceKey(tenantId, filter),
    queryFn: () => getDataGateway().actuals.listEvidence(tenantId, filter),
    enabled: options.enabled ?? true,
  });
}

// ─── Writes ──────────────────────────────────────────────────────────────────────────────────────

export function useSaveDataSource() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<ActualsGateway['saveDataSource']>[2]) => getDataGateway().actuals.saveDataSource(tenantId, user.id, input),
    onSuccess: (saved: DataSource) => {
      toast.success(`Đã lưu nguồn ${saved.name}`);
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'dataSources') });
    },
    // A duplicate code (06) is shown inline by the form; everything else as a toast.
  });
}

export function useRecordActual() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordActualInput) => getDataGateway().actuals.recordActual(tenantId, user.id, input),
    onSuccess: () => {
      toast.success('Đã lưu số thực tế');
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'actuals') });
    },
    onError: (error) => toastWriteError(error),
  });
}

/**
 * Upload the file, then stage its parsed rows — one action for the user. A failure names the step
 * that failed. The uploaded file id is remembered per `File`, so a retry after a failed stage does
 * not upload the same file again (an orphan FileObject after a failed stage is accepted, logged).
 */
const uploadedFiles = new WeakMap<File, Id>();
export function useStageImport() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, input }: { file: File; input: Omit<StageImportInput, 'fileId'> }) => {
      const gateway = getDataGateway();
      let fileId = uploadedFiles.get(file);
      if (fileId === undefined) {
        try {
          fileId = (await gateway.system.uploadFile(tenantId, user.id, { fileName: file.name, mimeType: file.type || 'application/octet-stream', data: file })).id;
        } catch (error) {
          toastWriteError(error, 'Tải tệp lên');
          throw error;
        }
        uploadedFiles.set(file, fileId);
      }
      try {
        return await gateway.actuals.stageImport(tenantId, user.id, { ...input, fileId } as StageImportInput);
      } catch (error) {
        toastWriteError(error, 'Kiểm tra dữ liệu');
        throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'importBatches') });
    },
  });
}

/** Commit refusals (04 with row issues) are shown by the preview itself, not as a toast. */
export function useCommitImport() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: Id) => getDataGateway().actuals.commitImport(tenantId, user.id, batchId),
    onSuccess: (batch) => {
      toast.success(`Đã ghi nhận ${batch.rowsTotal} dòng số liệu`);
      for (const root of ['importBatches', 'actuals', 'evidence'] as const) void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, root) });
    },
  });
}

export function useRejectImport() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: Id) => getDataGateway().actuals.rejectImport(tenantId, user.id, batchId),
    onSuccess: () => {
      toast.success('Đã từ chối lô import');
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'importBatches') });
    },
    onError: (error) => toastWriteError(error),
  });
}

export function useRunSync() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, periodId }: { connectionId: Id; periodId: Id }) => getDataGateway().actuals.runSync(tenantId, user.id, connectionId, periodId),
    onSuccess: () => {
      for (const root of ['connections', 'actuals'] as const) void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, root) });
    },
    onError: (error) => toastWriteError(error),
  });
}

/** A link, or a file uploaded first (the uploaded id is kept per `File` for a retry). */
export function useAddEvidence() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { goalId: Id; periodId: Id | null; actualId: Id | null; note: string | null } & ({ url: string } | { file: File })) => {
      const gateway = getDataGateway();
      let fileId: Id | null = null;
      if ('file' in input) {
        fileId = uploadedFiles.get(input.file) ?? null;
        if (fileId === null) {
          try {
            fileId = (await gateway.system.uploadFile(tenantId, user.id, { fileName: input.file.name, mimeType: input.file.type || 'application/octet-stream', data: input.file })).id;
          } catch (error) {
            toastWriteError(error, 'Tải tệp lên');
            throw error;
          }
          uploadedFiles.set(input.file, fileId);
        }
      }
      try {
        return await gateway.actuals.addEvidence(tenantId, user.id, {
          goalId: input.goalId,
          periodId: input.periodId,
          actualId: input.actualId,
          fileId,
          url: 'url' in input ? input.url : null,
          note: input.note,
        });
      } catch (error) {
        toastWriteError(error, 'Thêm bằng chứng');
        throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'evidence') });
    },
  });
}

export function useDeleteEvidence() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (evidenceId: Id) => getDataGateway().actuals.deleteEvidence(tenantId, user.id, evidenceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'evidence') });
    },
    onError: (error) => toastWriteError(error),
  });
}

/** Opens a stored file (a blob URL in the mock) in a new tab. */
export function useOpenFile() {
  const { tenantId } = useSession();
  return useMutation({
    mutationFn: (fileId: Id) => getDataGateway().system.getFileUrl(tenantId, fileId),
    onSuccess: (url) => {
      window.open(url, '_blank', 'noopener');
    },
    onError: (error) => toastWriteError(error),
  });
}

/** One stored file's row (its name and size), for an evidence list. */
export const fileKey = (tenantId: string, fileId: Id | null) => queryKey(tenantId, 'files', fileId);
export function useFileObject(fileId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: fileKey(tenantId, fileId),
    queryFn: () => getDataGateway().system.getFile(tenantId, fileId as Id),
    enabled: fileId !== null,
    staleTime: Infinity,
  });
}

/** Admin switches a connection on or off (connection details stay seeded and read-only in P1). */
export function useSaveConnection() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<ActualsGateway['saveConnection']>[2]) => getDataGateway().actuals.saveConnection(tenantId, user.id, input),
    onSuccess: (saved) => {
      toast.success(saved.status === 'Active' ? 'Đã bật kết nối' : 'Đã tắt kết nối');
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'connections') });
    },
    onError: (error) => toastWriteError(error),
  });
}
