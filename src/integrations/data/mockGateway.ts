import { KpiError } from '@/lib/errorCatalog';
import { GATEWAY_GROUPS, SYNC_GATEWAY_GROUPS, type DataGateway, type GatewayGroup } from './types';

/**
 * The mock adapter — in-memory + localStorage per tenant, seeded from `src/data/fixtures/`.
 *
 * ⚠️ Never import this file outside `src/integrations/data/`. Use `getDataGateway()`.
 *
 * Phase 1.1 state: the CONTRACT is fixed (`./types.ts`) but nothing is implemented. Every method of
 * an async group REJECTS with `KpiError('ERR-KPI-01')` — the same way a real adapter fails, so a
 * premature call shows the failed-read state instead of an empty list. `clock` and `events` are
 * synchronous in the contract, so theirs throw.
 *
 * TODO Phase 1.2:
 * - storage partitioned by `tenantId` (localStorage key `kpi.<tenantId>.<collection>`);
 * - the injected clock (`clock.now()`, `dev.setNow`) every timestamp is read from;
 * - `dev.resetSeed()` reloading the fixtures; simulated latency; the error-injection switch;
 * - business decisions delegated to `src/lib/*Rules.ts` — the mock must REUSE the rules, never
 *   copy them (common-pitfalls.md);
 * - the event bus (`events.subscribe`), T7's listeners registered once at construction, and
 *   `scheduler.runDue`.
 */

/** Property names that tooling probes on any object (thenables, JSON, test matchers, React). */
const PROBED_KEYS = new Set(['then', 'toJSON', 'asymmetricMatch', '$$typeof', 'constructor', 'nodeType']);

function notImplemented<G extends GatewayGroup>(group: G): DataGateway[G] {
  const sync = (SYNC_GATEWAY_GROUPS as readonly GatewayGroup[]).includes(group);
  return new Proxy({} as DataGateway[G], {
    get(_target, method) {
      if (typeof method !== 'string' || PROBED_KEYS.has(method)) return undefined;
      const detail = `mockGateway.${group}.${method} is not implemented yet (Phase 1.2)`;
      return sync
        ? () => {
            throw new KpiError('ERR-KPI-01', detail);
          }
        : async () => {
            throw new KpiError('ERR-KPI-01', detail);
          };
    },
  });
}

const groups = Object.fromEntries(GATEWAY_GROUPS.map((group) => [group, notImplemented(group)])) as {
  [G in GatewayGroup]: DataGateway[G];
};

export const mockGateway: DataGateway = {
  adapter: 'mock',
  ...groups,
};
