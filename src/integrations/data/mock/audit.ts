import type { AuditLog, EntityName, JsonValue } from '@/data/types';
import type { EntityChangedEvent } from '../types';

/**
 * The audit trail (WBS 4.8.4) of the mock: every `entity.changed` becomes an audit entry built FROM
 * the event — who, what, before/after, reason — so no caller can forge its author. The runtime
 * writes it IN THE SAME TRANSACTION as the change it records: the change and its audit entry are
 * saved together or not at all (a listener writing it afterwards could lose it on a storage error).
 * The entry's id is the event's id, so `system.recordAudit` with the same event is a no-op.
 *
 * Notifications are delivery records, not business changes, so they are not audited.
 */
export const NOT_AUDITED: ReadonlySet<EntityName> = new Set<EntityName>(['Notification']);

export function auditRowOf(event: EntityChangedEvent): AuditLog {
  return {
    id: event.id,
    tenantId: event.tenantId,
    userId: event.actorUserId,
    onBehalfOfUserId: event.onBehalfOfUserId,
    entityName: event.entityName,
    entityId: event.entityId,
    action: event.action,
    beforeData: event.before as JsonValue | null,
    afterData: event.after as JsonValue | null,
    reason: event.reason,
    createdAt: event.occurredAt,
  };
}
