/**
 * What the demo toolbar has switched on — a mirror of the mock gateway's `dev` settings, which has
 * setters but no getters (`DevControls` in `src/integrations/data/types.ts`).
 *
 * Deliberately NOT persisted: the mock keeps latency and failure mode in memory, so after a reload
 * they are back to their defaults and so is this mirror. A persisted failure mode would silently
 * break the next demo. (The simulated clock IS saved by the mock across a reload; the mirror then
 * forgets that it was moved — the clock reading itself always comes from the gateway.)
 *
 * Only `src/hooks/queries/dev.ts` writes here, after the gateway call succeeded, so the mirror
 * never claims a setting the gateway refused.
 */
import { create } from 'zustand';

/** The mock's own default: 150 ms in the app, 0 under Vitest (`createMockGateway`). */
export const DEFAULT_LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 150;

/** The latency choices the toolbar offers. */
export const LATENCY_CHOICES = [0, 150, 1000] as const;

export interface FailureMode {
  enabled: boolean;
  /** A `group.method` glob (`forms.*`); `null` = every call. */
  methodPattern: string | null;
}

export interface DevState {
  /** `true` once the clock was moved away from the seed's moment in this session. */
  clockOverridden: boolean;
  latencyMs: number;
  failure: FailureMode;
}

export const DEV_DEFAULTS: DevState = {
  clockOverridden: false,
  latencyMs: DEFAULT_LATENCY_MS,
  failure: { enabled: false, methodPattern: null },
};

export const useDevStore = create<DevState>(() => ({ ...DEV_DEFAULTS }));

export const devActions = {
  setClockOverridden: (clockOverridden: boolean) => useDevStore.setState({ clockOverridden }),
  setLatency: (latencyMs: number) => useDevStore.setState({ latencyMs }),
  setFailure: (failure: FailureMode) => useDevStore.setState({ failure }),
  reset: () => useDevStore.setState({ ...DEV_DEFAULTS }),
};

/** Any setting away from its default — the trigger then says "Đang bật". */
export function hasActiveOverride(state: DevState): boolean {
  return state.clockOverridden || state.latencyMs !== DEFAULT_LATENCY_MS || state.failure.enabled;
}
