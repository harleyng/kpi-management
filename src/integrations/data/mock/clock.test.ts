import { describe, expect, it } from 'vitest';
import { SEED_NOW, SYNTRA } from '@/data/fixtures';
import { createSimClock } from './clock';
import { createMockGateway } from './createMockGateway';
import { testSeed } from './gateway.test-util';
import { CLOCK_KEY, MemoryStorage, Persistence } from './persistence';

describe('the simulated clock (contract rule 3, decision D-b)', () => {
  const real = () => {
    let ms = 1_000_000;
    return { now: () => ms, advance: (by: number) => (ms += by) };
  };

  it('starts at the seed\'s moment and flows with real time', () => {
    const t = real();
    const clock = createSimClock({ seedNow: SEED_NOW, persistence: new Persistence(null), realNow: t.now });
    expect(clock.now()).toBe(SEED_NOW);
    t.advance(60_000);
    expect(clock.now()).toBe(new Date(Date.parse(SEED_NOW) + 60_000).toISOString());
  });

  it('is strictly increasing even within one millisecond', () => {
    const t = real();
    const clock = createSimClock({ seedNow: SEED_NOW, persistence: new Persistence(null), realNow: t.now });
    const a = clock.now();
    const b = clock.now();
    expect(b > a).toBe(true);
  });

  it('setNow jumps (also backwards); setNow(null) returns to the seed\'s moment, not real time', () => {
    const t = real();
    const clock = createSimClock({ seedNow: SEED_NOW, persistence: new Persistence(null), realNow: t.now });
    clock.set('2027-05-01T02:00:00.000Z');
    expect(clock.now()).toBe('2027-05-01T02:00:00.000Z');
    clock.set('2027-04-02T02:00:00.000Z');
    expect(clock.now()).toBe('2027-04-02T02:00:00.000Z');
    clock.set(null);
    expect(clock.now()).toBe(SEED_NOW);
  });

  it('setNow refuses a value that is not an instant, and changes nothing', () => {
    const storage = new MemoryStorage();
    const clock = createSimClock({ seedNow: SEED_NOW, persistence: new Persistence(storage), realNow: real().now });
    expect(() => clock.set('soon')).toThrow(RangeError);
    expect(storage.getItem(CLOCK_KEY)).toBeNull();
    expect(clock.now()).toBe(SEED_NOW);
  });

  it('a reload continues from the saved simulated time — time spent closed does not count', () => {
    const storage = new MemoryStorage();
    const t = real();
    const first = createSimClock({ seedNow: SEED_NOW, persistence: new Persistence(storage), realNow: t.now });
    first.set('2027-04-10T02:00:00.000Z');
    t.advance(5_000);
    storage.setItem(CLOCK_KEY, first.serialize()); // what a commit saves with its tables
    t.advance(86_400_000 * 3); // closed for three days
    const second = createSimClock({ seedNow: SEED_NOW, persistence: new Persistence(storage), realNow: t.now });
    expect(second.now()).toBe('2027-04-10T02:00:05.000Z');
    second.reset();
    expect(storage.getItem(CLOCK_KEY)).toBeNull();
  });

  it('the gateway stamps writes from the same clock the screens read', async () => {
    const gateway = createMockGateway({ storage: null, latencyMs: 0, seed: testSeed });
    gateway.dev?.setNow('2027-04-20T03:00:00.000Z');
    const admin = SYNTRA.user(SYNTRA.personas.admin);
    const evidence = await gateway.actuals.addEvidence(SYNTRA.tenantId, admin, {
      goalId: (await gateway.goals.listGoals(SYNTRA.tenantId))[0].id,
      periodId: null,
      actualId: null,
      fileId: null,
      url: 'https://example.test/x',
      note: null,
    });
    expect(evidence.uploadedAt >= '2027-04-20T03:00:00.000Z' && evidence.uploadedAt < '2027-04-20T03:01:00.000Z').toBe(true);
    expect(evidence.uploadedBy).toBe(admin);
    expect(gateway.clock.now() > evidence.uploadedAt).toBe(true);
  });
});
