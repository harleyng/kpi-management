/**
 * What a list-reading component should show for a React Query result — settled once, so
 * `DataTable` and the pickers cannot disagree about it.
 *
 * - `error` wins over cached data: ERR-KPI-01 promises stale rows are not shown.
 * - `loading` only while a fetch is ACTUALLY running with no data yet. A disabled query is
 *   `isPending` for ever (common-pitfalls.md, 2026-08-28); reading `isPending` alone would hang a
 *   skeleton on screen indefinitely.
 * - `idle` — no data, and nobody is fetching (a disabled query): nothing has been asked, so it is
 *   neither empty nor failed. Components treat it as "no rows" without claiming the list is empty.
 * - `ready` — data is present (possibly being refreshed in the background).
 */

/** The status half of a `useQuery` result — pass the result itself. */
export interface QueryState {
  isPending: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  error: unknown;
  refetch: () => unknown;
}

export type LoadPhase = 'error' | 'loading' | 'idle' | 'ready';

export function loadPhase(query: QueryState, hasData: boolean): LoadPhase {
  if (query.error != null) return 'error';
  if (hasData) return 'ready';
  return query.isPending && query.fetchStatus !== 'idle' ? 'loading' : 'idle';
}

/** Ready data being refetched in the background — keep it on screen, marked busy. */
export function isRefreshing(query: QueryState, hasData: boolean): boolean {
  return hasData && query.error == null && query.fetchStatus === 'fetching';
}

/**
 * Combine several queries a component reads together (the KPI picker reads definitions,
 * perspectives and units): the first error is the error, any running fetch is running, and a
 * retry refetches every query that failed.
 */
export function combineQueries(queries: readonly QueryState[]): QueryState {
  const failed = queries.filter((q) => q.error != null);
  return {
    isPending: queries.some((q) => q.isPending),
    fetchStatus: queries.some((q) => q.fetchStatus === 'fetching')
      ? 'fetching'
      : queries.some((q) => q.fetchStatus === 'paused')
        ? 'paused'
        : 'idle',
    error: failed[0]?.error ?? null,
    refetch: () => Promise.all((failed.length > 0 ? failed : queries).map((q) => q.refetch())),
  };
}
