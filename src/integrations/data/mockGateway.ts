import type { DataGateway } from './types';

/**
 * The mock adapter — in-memory + localStorage per tenant, seeded from `src/data/fixtures/`.
 *
 * ⚠️ Never import this file outside `src/integrations/data/`. Use `getDataGateway()`.
 *
 * TODO Phase 1.2:
 * - storage partitioned by `tenantId` (localStorage key `kpi.<tenantId>.<collection>`);
 * - `resetSeed()` reloading the fixtures;
 * - a simulated latency, and an error-injection switch (dev toolbar) so every screen's failure
 *   state can be exercised;
 * - business decisions delegated to `src/lib/*Rules.ts` — the mock must REUSE the rules, never
 *   copy them (common-pitfalls.md).
 */
export const mockGateway: DataGateway = {
  adapter: 'mock',
};
