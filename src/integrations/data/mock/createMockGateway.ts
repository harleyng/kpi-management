import { buildSeed, SEED_NOW, SEED_VERSION } from '@/data/fixtures';
import type { Seed } from '@/data/fixtures/types';
import type { IsoDateTime } from '@/data/types';
import { KpiError } from '@/lib/errorCatalog';
import { createNotificationListener } from '../notificationListener';
import type { DataGateway } from '../types';
import { consoleDiagnostic, type DiagnosticSink } from './bus';
import { actualsGroup } from './groups/actuals';
import { formsGroup } from './groups/forms';
import { goalsGroup } from './groups/goals';
import { libraryGroup } from './groups/library';
import { orgGroup } from './groups/org';
import { platformGroup } from './groups/platform';
import { resultsGroup } from './groups/results';
import { schedulerGroup } from './groups/scheduler';
import { systemGroup } from './groups/system';
import { workGroup } from './groups/work';
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
  /**
   * Run T7's notification listener (default `true`). The shared test gateway turns it off unless a
   * test asks for it, so tests that collect every event do not see its asynchronous writes.
   */
  notifications?: boolean;
}

/** The mock adapter, plus its registry (which methods are deferred / guarded) for tests and Gate 1. */
export type MockDataGateway = DataGateway & {
  readonly registry: Registry;
  /** Resolves once the notification listener has handled every event so far (tests). */
  notificationsSettled(): Promise<void>;
};

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

  // Bumped by `resetSeed`: a notification still being prepared from the old data writes nothing.
  let generation = 0;
  let settled = () => Promise.resolve();

  const gateway: MockDataGateway = {
    adapter: 'mock',
    registry: rt.registry,
    notificationsSettled: () => settled(),
    clock: { now: () => rt.clock.now() },
    platform: platformGroup(rt),
    org: orgGroup(rt),
    library: libraryGroup(rt),
    goals: goalsGroup(rt),
    actuals: actualsGroup(rt),
    forms: formsGroup(rt),
    results: resultsGroup(rt),
    work: workGroup(rt),
    system: systemGroup(rt),
    scheduler: schedulerGroup(rt),
    events: {
      subscribe(tenantId, listener) {
        rt.tenantData(tenantId); // an unknown tenant fails loudly (ERR-KPI-02), synchronously
        return rt.bus.subscribe(tenantId, listener);
      },
    },
    dev: {
      async resetSeed() {
        generation += 1;
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

  // Notification rendering (T7, WBS 4.8.1–4.8.2): its system listener is registered here, once per
  // gateway — never in a React effect, which StrictMode runs twice. It hears every tenant and reads and
  // writes through the gateway itself. The audit trail is written by the runtime (`audit.ts`), in the
  // transaction of the change it records.
  if (options.notifications !== false) {
    const notifications = createNotificationListener(gateway, {
      onDiagnostic: options.onDiagnostic ?? consoleDiagnostic,
      generation: () => generation,
    });
    rt.bus.subscribeAll(notifications.listener);
    settled = () => notifications.settled();
  }
  return gateway;
}
