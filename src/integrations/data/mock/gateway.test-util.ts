import { buildSeed } from '@/data/fixtures';
import type { Seed } from '@/data/fixtures/types';
import { KpiError } from '@/lib/errorCatalog';
import { createMockGateway, type MockGatewayOptions } from './createMockGateway';
import { MemoryStorage } from './persistence';

/** One seed build for the whole test file — the runtime copies rows on load, so sharing is safe. */
let cached: Seed | null = null;
export const testSeed = (): Seed => (cached ??= buildSeed());

/** A fresh mock with its own in-memory storage, no latency, and the shared seed. */
export function newGateway(options: MockGatewayOptions = {}) {
  const storage = options.storage === undefined ? new MemoryStorage() : options.storage;
  return { gateway: createMockGateway({ latencyMs: 0, seed: testSeed, ...options, storage }), storage };
}

/** The rejection of `promise` as a KpiError (fails the test if it resolves or throws something else). */
export async function rejection(promise: Promise<unknown>): Promise<KpiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof KpiError) return error;
    throw new Error(`expected a KpiError, got ${String(error)}`);
  }
  throw new Error('expected the call to reject');
}

/** Waits for the async system listeners (audit) the bus started. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
