import type { DataGateway } from './types';

/**
 * The database adapter — NOT IMPLEMENTED until Phase 5 (plan §6.2).
 *
 * It fails loudly on purpose: an adapter that quietly returned empty lists would render every
 * screen as "no data yet", which is the hardest failure to notice. Phase 5 replaces this with a
 * real implementation of the same contract; the tenant-isolation tests written against the mock
 * become its integration tests for RLS.
 */
export function createSupabaseGateway(): DataGateway {
  throw new Error(
    'supabaseGateway is not implemented (Phase 5). Set VITE_DATA_ADAPTER=mock or leave it unset.',
  );
}
