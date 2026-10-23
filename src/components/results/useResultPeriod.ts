import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod, Id, PerformanceCycle } from '@/data/types';
import { useCycles, usePeriods } from '@/hooks/queries/goals';
import { defaultResultCycle, defaultResultPeriod } from '@/lib/cycleRules';
import { combineQueries, type QueryState } from '@/lib/queryState';
import { isPaidPeriod } from '@/lib/resultRules';

export interface ResultPeriodSelection {
  cycles: PerformanceCycle[] | undefined;
  periods: CyclePeriod[] | undefined;
  cycle: PerformanceCycle | null;
  period: CyclePeriod | null;
  setCycle: (cycleId: Id) => void;
  setPeriod: (periodId: Id) => void;
  query: QueryState;
}

/**
 * The cycle and period a result screen shows, kept in the URL (`?cycle=&period=`) so a link or a
 * reload opens the same period. An id that is not in the loaded lists (stale, or another tenant's)
 * falls back to the default (`cycleRules.defaultResult*`) and the URL is REPLACED, never pushed — and
 * nothing is decided before both lists have loaded.
 */
export function useResultPeriod(options: { withPeriod?: boolean; paidOnly?: boolean } = {}): ResultPeriodSelection {
  const withPeriod = options.withPeriod ?? true;
  // The payroll screen offers only the paid periods: quarters and the year (PEND-09).
  const paidOnly = options.paidOnly ?? false;
  const { today } = useSession();
  const [params, setParams] = useSearchParams();
  const cyclesQuery = useCycles();
  const cycles = cyclesQuery.data;

  const cycle = useMemo(() => {
    if (!cycles) return null;
    return cycles.find((c) => c.id === params.get('cycle')) ?? defaultResultCycle(cycles, today);
  }, [cycles, params, today]);

  const periodsQuery = usePeriods(cycle?.id ?? null);
  const periods = useMemo(() => (paidOnly ? periodsQuery.data?.filter(isPaidPeriod) : periodsQuery.data), [paidOnly, periodsQuery.data]);
  const period = useMemo(() => {
    if (!withPeriod || !periods) return null;
    return periods.find((p) => p.id === params.get('period')) ?? defaultResultPeriod(periods, today);
  }, [withPeriod, periods, params, today]);

  // Write the resolved selection back once it differs from the URL (a fallback, or the first visit).
  useEffect(() => {
    if (!cycle) return;
    const wantPeriod = withPeriod && period ? period.id : null;
    if (params.get('cycle') === cycle.id && (!withPeriod || !periods || params.get('period') === wantPeriod)) return;
    const next = new URLSearchParams(params);
    next.set('cycle', cycle.id);
    if (wantPeriod) next.set('period', wantPeriod);
    setParams(next, { replace: true });
  }, [cycle, period, periods, params, setParams, withPeriod]);

  return {
    cycles,
    periods,
    cycle,
    period,
    setCycle: (cycleId) => {
      const next = new URLSearchParams(params);
      next.set('cycle', cycleId);
      next.delete('period');
      setParams(next, { replace: true });
    },
    setPeriod: (periodId) => {
      const next = new URLSearchParams(params);
      next.set('period', periodId);
      setParams(next, { replace: true });
    },
    query: combineQueries(withPeriod && cycle ? [cyclesQuery, periodsQuery] : [cyclesQuery]),
  };
}
