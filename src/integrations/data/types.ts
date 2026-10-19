/**
 * The `DataGateway` contract — the ONLY way the app reads or writes domain data.
 *
 *   components/pages → React Query hooks (src/hooks/queries/*) → DataGateway
 *                                                                ├── mockGateway     (now)
 *                                                                └── supabaseGateway (Phase 5)
 *
 * Obtain it with `getDataGateway()` from `./index`. No component, page or hook imports an adapter
 * file directly (CLAUDE.md, critical rule 3).
 *
 * Non-negotiables for every method added here (CLAUDE.md, critical rule 4):
 * - **It takes `tenantId` and filters by it.** There is no RLS in the prototype; this argument IS
 *   the tenant boundary, and the tenant-isolation tests check every read with tenant B.
 * - It is `async`, returns domain types from `@/data/types`, and throws `KpiError` on failure —
 *   never resolves with an empty list to hide one.
 *
 * TODO Phase 1.1 — one group of async functions per ERD group (org, library, goals, actuals,
 * forms, results, system), plus `resetSeed()` for the mock adapter and the event bus T7 listens on.
 */

export type DataAdapterName = 'mock' | 'supabase';

export interface DataGateway {
  /** Which adapter answered — shown beside the "Dữ liệu giả lập" banner. */
  readonly adapter: DataAdapterName;
}
