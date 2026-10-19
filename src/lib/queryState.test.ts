import { describe, expect, it, vi } from 'vitest';
import { combineQueries, isRefreshing, loadPhase, type QueryState } from './queryState';

const q = (over: Partial<QueryState> = {}): QueryState => ({
  isPending: false,
  fetchStatus: 'idle',
  error: null,
  refetch: vi.fn(),
  ...over,
});

describe('loadPhase', () => {
  it('reports an error even when stale data is cached', () => {
    expect(loadPhase(q({ error: new Error('x') }), true)).toBe('error');
  });

  it('is loading only while a first fetch is running', () => {
    expect(loadPhase(q({ isPending: true, fetchStatus: 'fetching' }), false)).toBe('loading');
  });

  it('never hangs on a disabled query (pending + idle)', () => {
    expect(loadPhase(q({ isPending: true, fetchStatus: 'idle' }), false)).toBe('idle');
  });

  it('is ready once data is present, even during a background refetch', () => {
    expect(loadPhase(q({ fetchStatus: 'fetching' }), true)).toBe('ready');
  });
});

describe('isRefreshing', () => {
  it('is true for data being refetched, false without data or with an error', () => {
    expect(isRefreshing(q({ fetchStatus: 'fetching' }), true)).toBe(true);
    expect(isRefreshing(q({ fetchStatus: 'fetching' }), false)).toBe(false);
    expect(isRefreshing(q({ fetchStatus: 'fetching', error: new Error('x') }), true)).toBe(false);
  });
});

describe('combineQueries', () => {
  it('takes the first error and retries only the failed queries', async () => {
    const ok = q();
    const bad = q({ error: new Error('down') });
    const combined = combineQueries([ok, bad]);
    expect(combined.error).toBe(bad.error);
    await combined.refetch();
    expect(bad.refetch).toHaveBeenCalledTimes(1);
    expect(ok.refetch).not.toHaveBeenCalled();
  });

  it('reads an empty set of queries as settled with no error', () => {
    expect(combineQueries([])).toMatchObject({ isPending: false, fetchStatus: 'idle', error: null });
  });

  it('is fetching while any query fetches, and pending while any is pending', () => {
    const combined = combineQueries([q(), q({ isPending: true, fetchStatus: 'fetching' })]);
    expect(combined.fetchStatus).toBe('fetching');
    expect(combined.isPending).toBe(true);
    expect(combined.error).toBeNull();
  });
});
