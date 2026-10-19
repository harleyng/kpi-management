import type { IsoDateTime } from '@/data/types';
import type { DiagnosticSink } from './bus';
import { CLOCK_KEY, type Persistence } from './persistence';

/**
 * The mock's ONE clock (contract rule 3). It starts at the seed's moment (SEED_NOW, D-b) and moves
 * forward with real elapsed time while the app runs, so consecutive writes are ordered; `setNow`
 * jumps it (the dev toolbar), `setNow(null)` returns to the seed's moment.
 *
 * The simulated time is saved WITH every committed write (same batch), and a reload continues from there — time
 * the app spent closed does not count, so a demo left overnight does not wake up with every form
 * overdue. `now()` is strictly increasing within a session.
 */
export interface SimClock {
  now(): IsoDateTime;
  set(now: IsoDateTime | null): void;
  /** The value a commit saves under `kpi.clock`, in the same batch as its tables. */
  serialize(): string;
  /** Back to the seed's moment, forgetting any saved time (resetSeed, a reseed of an older seed). */
  reset(): void;
}

export function createSimClock(options: {
  seedNow: IsoDateTime;
  persistence: Persistence;
  /** Real milliseconds — injectable for tests. */
  realNow?: () => number;
  onDiagnostic?: DiagnosticSink;
}): SimClock {
  const realNow = options.realNow ?? (() => Date.now());
  const seedMs = Date.parse(options.seedNow);

  const saved = (() => {
    const raw = options.persistence.getRaw(CLOCK_KEY);
    if (!raw) return null;
    try {
      const ms = Date.parse((JSON.parse(raw) as { simulatedAt: string }).simulatedAt);
      if (Number.isFinite(ms)) return ms;
    } catch {
      // reported below
    }
    // A corrupt saved clock: say so (time may jump back to the seed's moment), never silently.
    options.onDiagnostic?.(`${CLOCK_KEY} is unreadable; the clock restarts at the seed's moment`, raw);
    return null;
  })();

  let anchorSim = saved ?? seedMs;
  let anchorReal = realNow();
  let last = anchorSim - 1;

  const nowMs = () => {
    let ms = anchorSim + (realNow() - anchorReal);
    if (ms <= last) ms = last + 1;
    last = ms;
    return ms;
  };

  const jump = (ms: number) => {
    anchorSim = ms;
    anchorReal = realNow();
    last = ms - 1;
  };

  return {
    now: () => new Date(nowMs()).toISOString(),
    set(now) {
      const ms = now === null ? seedMs : Date.parse(now);
      if (!Number.isFinite(ms)) throw new RangeError(`Not an ISO instant: ${now}`);
      jump(ms);
      options.persistence.setRaw(CLOCK_KEY, now === null ? null : JSON.stringify({ simulatedAt: new Date(ms).toISOString() }));
    },
    serialize() {
      const at = anchorSim + (realNow() - anchorReal);
      return JSON.stringify({ simulatedAt: new Date(Math.max(at, last)).toISOString() });
    },
    reset() {
      jump(seedMs);
      options.persistence.setRaw(CLOCK_KEY, null);
    },
  };
}
