import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSession } from '@/contexts/useSession';
import type { AuditLog, Id, NotificationTemplate } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { AuditLogFilter, Upsert, UploadFileInput } from '@/integrations/data/types';
import { isInAppNotification } from '@/lib/notificationRules';
import { queryKey } from './keys';

/**
 * G7 · Hệ thống (T7) — notification templates, the signed-in user's notifications, the audit log
 * and files. Keys are `[tenantId, root, ...params]` (CLAUDE.md rule 7); every write here is announced
 * by the gateway (`entity.changed`), so `useGatewayEventInvalidation` refreshes the lists — the
 * mutations invalidate their own root as well, which only costs a second refetch.
 *
 * Never calls `system.recordNotification` / `recordAudit`: those are the listener's (`src/integrations`).
 */

const NOTIFICATION_PAGE = 20;
const AUDIT_PAGE = 50;
/** How many unread notices the bell counts before it says "500+" (the contract has no count). */
export const UNREAD_COUNT_LIMIT = 500;

// ─── Templates (WBS 4.8.1) ─────────────────────────────────────────────────────────────────────

export const notificationTemplatesKey = (tenantId: string) => queryKey(tenantId, 'notificationTemplates');

export function useNotificationTemplates() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: notificationTemplatesKey(tenantId),
    queryFn: () => getDataGateway().system.listNotificationTemplates(tenantId),
    staleTime: 5 * 60 * 1000,
  });
}

/** Rejects with the gateway's `KpiError` — its `issues` name the field (`templateIssues`). */
export function useSaveNotificationTemplate() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Upsert<NotificationTemplate>) => getDataGateway().system.saveNotificationTemplate(tenantId, user.id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationTemplatesKey(tenantId) }),
  });
}

// ─── The signed-in user's notifications (WBS 4.8.2) ────────────────────────────────────────────

export const notificationsKey = (tenantId: string, userId: Id, filter: { unreadOnly: boolean }) =>
  queryKey(tenantId, 'notifications', userId, filter);

/** Newest first, a page at a time (keyset — there is no total; "Tải thêm" asks for the next). */
export function useNotifications(unreadOnly: boolean, enabled = true) {
  const { tenantId, user } = useSession();
  return useInfiniteQuery({
    queryKey: notificationsKey(tenantId, user.id, { unreadOnly }),
    queryFn: ({ pageParam }) =>
      getDataGateway().system.listNotifications(tenantId, user.id, { unreadOnly }, { limit: NOTIFICATION_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export const unreadCountKey = (tenantId: string, userId: Id) => queryKey(tenantId, 'notifications', userId, 'unreadCount');

/**
 * The bell's number: the user's unread IN-APP notices (e-mail rows are delivery records, not notices).
 * `capped` when there are more than `UNREAD_COUNT_LIMIT` — the bell then never claims an exact count.
 */
export function useUnreadNotificationCount() {
  const { tenantId, user } = useSession();
  return useQuery({
    queryKey: unreadCountKey(tenantId, user.id),
    queryFn: async () => {
      const gateway = getDataGateway();
      const [page, templates] = await Promise.all([
        gateway.system.listNotifications(tenantId, user.id, { unreadOnly: true }, { limit: UNREAD_COUNT_LIMIT }),
        gateway.system.listNotificationTemplates(tenantId),
      ]);
      const byId = new Map(templates.map((t) => [t.id, t]));
      const unread = page.items.filter((n) => isInAppNotification(n, byId));
      return { count: unread.length, capped: page.nextCursor !== null, ids: unread.map((n) => n.id) };
    },
  });
}

export function useMarkNotificationRead() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: Id) => getDataGateway().system.markNotificationRead(tenantId, user.id, notificationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'notifications', user.id) }),
  });
}

/**
 * Marks every listed notice read, each on its own: one failure does not undo the others. Rejects with
 * the first failure (after the rest settled), so the screen can say some were not marked.
 */
export function useMarkAllNotificationsRead() {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (notificationIds: readonly Id[]) => {
      const gateway = getDataGateway();
      const results = await Promise.allSettled(notificationIds.map((id) => gateway.system.markNotificationRead(tenantId, user.id, id)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'notifications', user.id) }),
  });
}

// ─── Audit log (WBS 4.8.4) ─────────────────────────────────────────────────────────────────────

export const auditLogKey = (tenantId: string, filter: AuditLogFilter) => queryKey(tenantId, 'auditLog', filter);

/**
 * Newest first, a page at a time. Every write anywhere adds a row and refreshes this root, so a
 * short staleness window keeps an open log from refetching all its pages on every keystroke elsewhere.
 * `enabled: false` while the screen's filter is invalid (a backwards date range).
 */
export function useAuditLog(filter: AuditLogFilter, enabled = true) {
  const { tenantId } = useSession();
  return useInfiniteQuery({
    queryKey: auditLogKey(tenantId, filter),
    queryFn: ({ pageParam }) => getDataGateway().system.listAuditLog(tenantId, filter, { limit: AUDIT_PAGE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 30 * 1000,
    enabled,
  });
}

// ─── Files (WBS 4.8.3) ─────────────────────────────────────────────────────────────────────────

export const fileKey = (tenantId: string, fileId: Id) => queryKey(tenantId, 'files', fileId);

export function useFile(fileId: Id | null) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: fileKey(tenantId, fileId ?? ''),
    queryFn: () => getDataGateway().system.getFile(tenantId, fileId as Id),
    enabled: fileId !== null,
    staleTime: Infinity,
  });
}

/** Rejects with `KpiError` ERR-KPI-06 for a file over the limit or of a format not accepted. */
export function useUploadFile() {
  const { tenantId, user } = useSession();
  return useMutation({
    mutationFn: (input: UploadFileInput) => getDataGateway().system.uploadFile(tenantId, user.id, input),
  });
}

/** How long an opened file's blob URL lives — long enough for the new tab to load it. */
const BLOB_URL_LIFETIME_MS = 60 * 1000;

/**
 * Opens a stored file in a new tab. The tab is opened SYNCHRONOUSLY in the click (a popup opened
 * after an `await` is blocked), then pointed at the file's URL; if the browser blocked it anyway the
 * file is downloaded instead. Rejects (and closes the blank tab) when the URL cannot be had — e.g. the
 * mock lost an uploaded file's content on reload (ERR-KPI-02).
 */
export function useOpenFile() {
  const { tenantId } = useSession();
  return useCallback(
    async (fileId: Id, fileName: string) => {
      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      let url: string;
      try {
        url = await getDataGateway().system.getFileUrl(tenantId, fileId);
      } catch (error) {
        tab?.close();
        throw error;
      }
      if (tab) {
        tab.location.href = url;
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
      }
      if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_LIFETIME_MS);
    },
    [tenantId],
  );
}

// ─── One record's history (T3, WBS 4.3.6) ─────────────────────────────────────────────────────

/**
 * Every entry matching `filter`, all pages read at once — meant for one record's history (a plan's
 * lock / unlock trail), not the whole log. Its own key segment (`'all'`): `useAuditLog` caches PAGES
 * under `auditLogKey`, and the two shapes must never share a cache entry. The `auditLog` root refreshes
 * on every change, so mount it only while it is on screen (`enabled`).
 */
export const auditEntriesKey = (tenantId: string, filter: AuditLogFilter) => queryKey(tenantId, 'auditLog', 'all', filter);

export function useAuditEntries(filter: AuditLogFilter, options: { enabled?: boolean } = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: auditEntriesKey(tenantId, filter),
    queryFn: async () => {
      const items: AuditLog[] = [];
      let cursor: string | undefined;
      do {
        const page = await getDataGateway().system.listAuditLog(tenantId, filter, { limit: 500, cursor });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return items;
    },
    enabled: options.enabled ?? true,
  });
}
