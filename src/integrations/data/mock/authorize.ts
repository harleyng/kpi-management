import type { Id, UserAccount } from '@/data/types';
import { KpiError } from '@/lib/errorCatalog';
import type { Tx } from './store';

/**
 * The ONE authorization hook of the mock: the runtime calls it for every user write, before the
 * method body. Phase 1.2 checks only that the actor is an Active account OF THIS TENANT — another
 * tenant's user, an unknown id and an Inactive account all answer ERR-KPI-05 with the same detail.
 *
 * Phase 1.3 plugs `can(profile, permission, resource)` (`src/lib/permissionRules.ts`) in here — one
 * place, not one check per method — and this hook moves off the PENDING_GUARDS list.
 */
export function authorizeActor(tx: Tx, actorUserId: Id): UserAccount {
  const account = typeof actorUserId === 'string' ? tx.find('UserAccount', actorUserId) : undefined;
  if (!account || account.status !== 'Active') {
    throw new KpiError('ERR-KPI-05', `user ${String(actorUserId)} cannot act in this tenant`);
  }
  return account;
}
