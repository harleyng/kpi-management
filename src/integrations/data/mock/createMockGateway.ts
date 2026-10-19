import { buildSeed, SEED_NOW, SEED_VERSION } from '@/data/fixtures';
import type { Seed } from '@/data/fixtures/types';
import type { IsoDateTime } from '@/data/types';
import { KpiError } from '@/lib/errorCatalog';
import type { DataGateway } from '../types';
import { consoleDiagnostic, type DiagnosticSink } from './bus';
import { actualsGroup } from './groups/actuals';
import { formsGroup } from './groups/forms';
import { goalsGroup } from './groups/goals';
import { libraryGroup } from './groups/library';
import { orgGroup } from './groups/org';
import { platformGroup } from './groups/platform';
import { resultsGroup } from './groups/results';
import { systemGroup } from './groups/system';
import type { StorageLike } from './persistence';
import { Runtime, type Registry } from './runtime';

export interface MockGatewayOptions {
  /** `window.localStorage` in the app; `null` = memory only; a `MemoryStorage` in tests. */
  storage?: StorageLike | null;
  /** Simulated latency per call. Default 150 ms in the app, 0 under Vitest. */
  latencyMs?: number;
  /** The fixtures to load (default `buildSeed`). */
  seed?: () => Seed;
  seedVersion?: string;
  seedNow?: IsoDateTime;
  /** Real milliseconds, for tests that move time. */
  realNow?: () => number;
  /** Where listener failures go (default console.error). */
  onDiagnostic?: DiagnosticSink;
}

/** The mock adapter, plus its registry (which methods are deferred / guarded) for tests and Gate 1. */
export type MockDataGateway = DataGateway & { readonly registry: Registry };

const defaultLatency = () => (import.meta.env.MODE === 'test' ? 0 : 150);

export function createMockGateway(options: MockGatewayOptions = {}): MockDataGateway {
  const rt = new Runtime({
    storage: options.storage === undefined ? null : options.storage,
    latencyMs: options.latencyMs ?? defaultLatency(),
    seed: options.seed ?? buildSeed,
    seedVersion: options.seedVersion ?? SEED_VERSION,
    seedNow: options.seedNow ?? SEED_NOW,
    realNow: options.realNow,
    onDiagnostic: options.onDiagnostic ?? consoleDiagnostic,
  });

  const gateway: MockDataGateway = {
    adapter: 'mock',
    registry: rt.registry,
    clock: { now: () => rt.clock.now() },
    platform: platformGroup(rt),
    org: orgGroup(rt),
    library: libraryGroup(rt),
    goals: goalsGroup(rt),
    actuals: actualsGroup(rt),
    forms: formsGroup(rt),
    results: resultsGroup(rt),
    system: systemGroup(rt),
    scheduler: {
      runDue: rt.deferred('scheduler.runDue', 'write', 'Phase 1.5 workflowRules (SLA, overdue, recurring launches)'),
    },
    events: {
      subscribe(tenantId, listener) {
        rt.tenantData(tenantId); // an unknown tenant fails loudly (ERR-KPI-02), synchronously
        return rt.bus.subscribe(tenantId, listener);
      },
    },
    dev: {
      async resetSeed() {
        rt.resetSeed();
      },
      setNow(now) {
        rt.clock.set(now);
      },
      setLatency(ms) {
        if (!Number.isFinite(ms) || ms < 0) throw new KpiError('ERR-KPI-06', 'latency must be ≥ 0 ms');
        rt.latencyMs = ms;
      },
      setFailureMode(mode) {
        rt.setFailureMode(mode);
      },
    },
  };

  // Notification rendering (T7, WBS 4.8.1–4.8.2) registers its system listener here, once, with
  // `rt.bus.subscribeAll` — never in a React effect. The audit trail is written by the runtime itself
  // (`audit.ts`), in the transaction of the change it records.
  return gateway;
}
