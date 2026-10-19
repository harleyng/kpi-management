/**
 * Which tenant and person the simulated session last used — client state, persisted.
 *
 * Only the CHOICE is stored (`kpi.session.v1`): ids, never rows, never roles. The provider resolves
 * them against freshly loaded data with `pickTenant` / `pickAccount` (`sessionRules.ts`), so a
 * reseed that removed someone, or an account turned Inactive, falls back instead of resurrecting a
 * ghost. `userIdByTenant` makes switching back to a tenant return to the person last used there.
 */
import { create } from 'zustand';
import type { Id } from '@/data/types';

const STORAGE_KEY = 'kpi.session.v1';

export interface SessionSelection {
  tenantId: Id | null;
  userIdByTenant: Readonly<Record<Id, Id>>;
}

const EMPTY: SessionSelection = { tenantId: null, userIdByTenant: {} };

/** Parses what was stored; anything that is not the expected shape is ignored, never trusted. */
export function parseStoredSelection(raw: string | null): SessionSelection {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return EMPTY;
    const { tenantId, userIdByTenant } = value as Record<string, unknown>;
    const users: Record<Id, Id> = {};
    if (typeof userIdByTenant === 'object' && userIdByTenant !== null) {
      for (const [tenant, user] of Object.entries(userIdByTenant)) if (typeof user === 'string') users[tenant] = user;
    }
    return { tenantId: typeof tenantId === 'string' ? tenantId : null, userIdByTenant: users };
  } catch {
    return EMPTY;
  }
}

function readStored(): SessionSelection {
  try {
    return parseStoredSelection(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Private browsing / storage disabled — start fresh rather than crash on first paint.
    return EMPTY;
  }
}

function remember(selection: SessionSelection) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Not remembering the choice is not worth breaking the switch over.
  }
}

export const useSessionStore = create<SessionSelection>(() => readStored());

function update(next: SessionSelection) {
  const current = useSessionStore.getState();
  if (current.tenantId === next.tenantId && current.userIdByTenant === next.userIdByTenant) return;
  useSessionStore.setState(next);
  remember(next);
}

export const sessionActions = {
  selectTenant(tenantId: Id) {
    const current = useSessionStore.getState();
    if (current.tenantId !== tenantId) update({ ...current, tenantId });
  },
  selectUser(tenantId: Id, userId: Id) {
    const current = useSessionStore.getState();
    if (current.tenantId === tenantId && current.userIdByTenant[tenantId] === userId) return;
    update({ tenantId, userIdByTenant: { ...current.userIdByTenant, [tenantId]: userId } });
  },
  /** Re-reads storage — for tests, and after a reseed clears it. */
  reload() {
    useSessionStore.setState(readStored());
  },
};
