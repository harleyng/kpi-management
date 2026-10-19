import { useMutation } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { Id } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import { downloadUrl } from '@/lib/utils';

/**
 * G7 · Hệ thống — file download, added by T6 (payroll files). Track T7 owns this domain and appends
 * its hooks below (notifications, audit, templates).
 */

/** Opens a stored file as a download. Resolves with the file name; rejects with the gateway's error. */
export async function downloadFile(tenantId: Id, fileId: Id): Promise<string> {
  const gateway = getDataGateway();
  const file = await gateway.system.getFile(tenantId, fileId);
  // Mock files live in memory only: after a reload this rejects ERR-KPI-02 (export again).
  const url = await gateway.system.getFileUrl(tenantId, fileId);
  downloadUrl(url, file.fileName);
  return file.fileName;
}

/** A download as a mutation, so a screen can show its pending and failed state per row. */
export function useDownloadFile() {
  const { tenantId } = useSession();
  return useMutation({ mutationFn: (fileId: Id) => downloadFile(tenantId, fileId) });
}
