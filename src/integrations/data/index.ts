import { mockGateway } from './mockGateway';
import { createSupabaseGateway } from './supabaseGateway';
import type { DataAdapterName, DataGateway } from './types';

export type { DataAdapterName, DataGateway } from './types';

/**
 * Resolve the adapter name from `VITE_DATA_ADAPTER` (inlined at BUILD time). Unset means `mock`.
 * An unknown value throws rather than falling back: a typo in Vercel's environment must not
 * silently serve the mock to someone who believes they are on the database.
 */
export function resolveAdapterName(raw: string | undefined): DataAdapterName {
  if (raw == null || raw === '' || raw === 'mock') return 'mock';
  if (raw === 'supabase') return 'supabase';
  throw new Error(`Unknown VITE_DATA_ADAPTER "${raw}". Expected "mock" or "supabase".`);
}

let cached: DataGateway | null = null;

/** The one entry point to domain data. Hooks in `src/hooks/queries/` call this; nothing else does. */
export function getDataGateway(): DataGateway {
  if (cached) return cached;
  const name = resolveAdapterName(import.meta.env.VITE_DATA_ADAPTER);
  cached = name === 'mock' ? mockGateway : createSupabaseGateway();
  return cached;
}
