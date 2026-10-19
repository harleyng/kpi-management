import { seedId } from '@/data/fixtures/ids';
import type { AuditLog, FileObject, Id, KpiNotification } from '@/data/types';
import { KpiError } from '@/lib/errorCatalog';
import { fileIssues } from '@/lib/fileRules';
import { templateIssues } from '@/lib/notificationRules';
import type { AuditLogFilter, EntityChangedEvent, NewNotificationInput, PageRequest, SystemGateway, UploadFileInput } from '../../types';
import { eqOpt, newId, upsert } from '../rows';
import type { Runtime } from '../runtime';
import { auditRowOf } from '../audit';
import { throwIssues } from '../workflowContext';
import { paginate } from './page';

/**
 * A notification's id is derived from (event, recipient), so the same event delivered twice writes
 * the same row once — the idempotency the contract promises, without a lookup column.
 */
export const notificationIdOf = (tenantId: Id, sourceEventId: Id, recipientUserId: Id) =>
  seedId('notification', tenantId, sourceEventId, recipientUserId);

/** The text a seeded file opens as (seeded files have rows but no stored content). */
const placeholderBlob = (file: FileObject) =>
  new Blob([`Tệp mẫu (dữ liệu giả lập): ${file.fileName}`], { type: 'text/plain;charset=utf-8' });

export function systemGroup(rt: Runtime): SystemGateway {
  const blobKey = (tenantId: Id, fileId: Id) => `${tenantId}/${fileId}`;

  return {
    uploadFile: rt.write('system.uploadFile', { permission: 'evidence.upload' }, (tx, input: UploadFileInput) => {
      if (!(input.data instanceof Blob)) throw new KpiError('ERR-KPI-06', 'file data must be a Blob');
      // Size and format (BR-KPI-48, ASSUMPTION Q20) — the upload button checked too; this is the authority.
      throwIssues(fileIssues({ fileName: String(input.fileName ?? ''), mimeType: String(input.mimeType ?? ''), sizeBytes: input.data.size }));
      const id = newId();
      const row: FileObject = {
        id,
        tenantId: tx.tenantId,
        storageKey: `mock/${id}`,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.data.size,
        uploadedBy: tx.ctx.actorUserId as Id,
        uploadedAt: tx.now,
      };
      // Memory only (decision in persistence.ts): a reload keeps the row, not the bytes.
      rt.blobs.set(blobKey(tx.tenantId, id), input.data);
      return tx.insert('FileObject', row);
    }),
    getFile: rt.read('system.getFile', (tx, fileId: Id) => tx.get('FileObject', fileId)),
    getFileUrl: rt.read('system.getFileUrl', (tx, fileId: Id) => {
      const file = tx.get('FileObject', fileId);
      const key = blobKey(tx.tenantId, fileId);
      let blob = rt.blobs.get(key);
      if (!blob && file.storageKey.startsWith('seed/')) {
        blob = placeholderBlob(file);
        rt.blobs.set(key, blob);
      }
      if (!blob) throw new KpiError('ERR-KPI-02', `the content of file ${fileId} is no longer available (lost on reload)`);
      return URL.createObjectURL(blob);
    }),

    listNotificationTemplates: rt.read('system.listNotificationTemplates', (tx) => tx.all('NotificationTemplate')),
    saveNotificationTemplate: rt.write('system.saveNotificationTemplate', { permission: 'notification.manage' }, (tx, input: Parameters<SystemGateway['saveNotificationTemplate']>[2]) => {
      const saved = upsert(tx, 'NotificationTemplate', input, { create: () => ({}) });
      // Checked on the row as saved (an update merges into the stored one): no unknown variable, no
      // open brace, no empty text (BR-KPI-47). Throwing here rolls the transaction back.
      throwIssues(templateIssues(saved));
      return saved;
    }),

    listNotifications: rt.read(
      'system.listNotifications',
      (tx, recipientUserId: Id, options: { unreadOnly?: boolean } = {}, page?: PageRequest) =>
        paginate(
          tx.all('Notification').filter((n) => n.recipientUserId === recipientUserId && (!options.unreadOnly || n.readAt === null)),
          (n) => n.createdAt,
          page,
        ),
    ),
    markNotificationRead: rt.write('system.markNotificationRead', 'actor', (tx, notificationId: Id) => {
      const notification = tx.get('Notification', notificationId);
      if (notification.recipientUserId !== tx.ctx.actorUserId) {
        throw new KpiError('ERR-KPI-05', `notification ${notificationId} is not addressed to this user`);
      }
      if (notification.readAt !== null) return notification;
      return tx.update('Notification', { ...notification, status: 'Read', readAt: tx.now });
    }),
    recordNotification: rt.system('system.recordNotification', (tx, input: NewNotificationInput) => {
      const id = notificationIdOf(tx.tenantId, input.sourceEventId, input.recipientUserId);
      const existing = tx.find('Notification', id);
      if (existing) return existing;
      // In-app delivery is immediate (P1 sends no email): the row is Sent when written.
      const row: KpiNotification = {
        id,
        tenantId: tx.tenantId,
        templateId: input.templateId,
        eventCode: input.eventCode,
        recipientUserId: input.recipientUserId,
        refType: input.refType,
        refId: input.refId,
        subject: input.subject,
        body: input.body,
        status: 'Sent',
        createdAt: tx.now,
        sentAt: tx.now,
        readAt: null,
      };
      return tx.insert('Notification', row);
    }),

    listAuditLog: rt.read('system.listAuditLog', (tx, filter: AuditLogFilter = {}, page?: PageRequest) =>
      paginate(
        tx
          .all('AuditLog')
          .filter(
            (a) =>
              eqOpt(filter.entityName, a.entityName) &&
              eqOpt(filter.entityId, a.entityId) &&
              (filter.userId === undefined || a.userId === filter.userId) &&
              (filter.from === undefined || a.createdAt >= filter.from) &&
              (filter.to === undefined || a.createdAt <= filter.to),
          ),
        (a) => a.createdAt,
        page,
      ),
    ),
    recordAudit: rt.system('system.recordAudit', (tx, event: EntityChangedEvent) => {
      if (event.tenantId !== tx.tenantId) throw new KpiError('ERR-KPI-06', `event ${event.id} belongs to another tenant`);
      const existing = tx.find('AuditLog', event.id);
      if (existing) return existing;
      // Built FROM the event, so no caller can forge who did it (contract, SystemGateway).
      const row: AuditLog = auditRowOf(event);
      return tx.insert('AuditLog', row);
    }),
  };
}
