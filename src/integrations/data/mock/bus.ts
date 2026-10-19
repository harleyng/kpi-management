import type { Id } from '@/data/types';
import type { DomainEvent, DomainEventListener, Unsubscribe } from '../types';

/**
 * The event bus (contract rule 6). Events are emitted only AFTER a write has committed, and a
 * listener can never undo or fail that write: a throw or a rejected promise goes to `onDiagnostic`
 * (console.error by default; the 1.4 dev toolbar can plug in there) and the other listeners still run.
 *
 * Two kinds of listener: a screen's, which hears only its tenant (`subscribe`), and the system's
 * (T7's audit / notification listeners), registered once at construction, which hear every tenant.
 */
export type DiagnosticSink = (message: string, error: unknown) => void;

export const consoleDiagnostic: DiagnosticSink = (message, error) => {
  console.error(`[mock gateway] ${message}`, error);
};

export interface EventBus {
  subscribe(tenantId: Id, listener: DomainEventListener): Unsubscribe;
  subscribeAll(listener: DomainEventListener): Unsubscribe;
  emit(events: readonly DomainEvent[]): void;
}

export function createBus(onDiagnostic: DiagnosticSink): EventBus {
  const byTenant = new Map<Id, Set<DomainEventListener>>();
  const system = new Set<DomainEventListener>();

  const call = (listener: DomainEventListener, event: DomainEvent) => {
    try {
      const result = listener(event);
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).catch((error) => onDiagnostic(`listener rejected on ${event.type}`, error));
      }
    } catch (error) {
      onDiagnostic(`listener threw on ${event.type}`, error);
    }
  };

  return {
    subscribe(tenantId, listener) {
      const set = byTenant.get(tenantId) ?? new Set();
      set.add(listener);
      byTenant.set(tenantId, set);
      return () => {
        set.delete(listener);
      };
    },
    subscribeAll(listener) {
      system.add(listener);
      return () => {
        system.delete(listener);
      };
    },
    emit(events) {
      for (const event of events) {
        for (const listener of [...system]) call(listener, event);
        for (const listener of [...(byTenant.get(event.tenantId) ?? [])]) call(listener, event);
      }
    },
  };
}
