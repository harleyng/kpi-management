import { createMockGateway } from './mock/createMockGateway';

/**
 * The mock adapter — in-memory + localStorage per tenant, seeded from `src/data/fixtures/`.
 *
 * ⚠️ Never import this file outside `src/integrations/data/`. Use `getDataGateway()`.
 *
 * How it works lives in `./mock/` (see `.agents/knowledge/architecture.md`, "Mock adapter"): the
 * per-call runtime (latency, failure injection, tenant check, transaction, integrity, save,
 * events), the schema the integrity check enforces, and one file per contract group. Business
 * decisions are `src/lib/*Rules.ts`; a method whose rule is not wired yet rejects with
 * `KpiDeferredError` (see `mockGateway.registry.deferred`) — the list must be empty at Gate 1.
 *
 * Nothing is read from storage until the first call, so importing this module is free.
 */
export const mockGateway = createMockGateway({
  storage: typeof window !== 'undefined' && import.meta.env.MODE !== 'test' ? window.localStorage : null,
});
