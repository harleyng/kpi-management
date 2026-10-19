import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod, Id } from '@/data/types';
import { useCycles, usePeriods } from '@/hooks/queries/goals';
import { defaultCycle, defaultMonth, monthsOf } from '@/lib/actualEntryRules';
import { carrySearch } from '@/lib/navRules';

/** The params "Số liệu & import" carries between its sub-pages (`navConfig.ts` `carryParams`). */
export const ACTUALS_PARAMS = ['cycle', 'period'] as const;

/**
 * The cycle (and, with `withPeriod`, the month) the actuals screens work on, held in the URL as
 * `?cycle=&period=` so the menu carries them between sub-pages and a link reopens the same month.
 * An id the tenant does not have — a typed link, a cycle from another tenant — falls back to the
 * default (`actualEntryRules`: the Active cycle; the latest month that has started) and the URL is
 * corrected in place (replace, so Back does not replay it).
 */
export function useCyclePeriodParams({ withPeriod }: { withPeriod: boolean }) {
  const { today } = useSession();
  const [params, setParams] = useSearchParams();
  const cycles = useCycles();
  const cycleParam = params.get('cycle');
  const periodParam = params.get('period');

  const cycleId: Id | null = cycles.data ? (cycles.data.some((c) => c.id === cycleParam) ? cycleParam : (defaultCycle(cycles.data)?.id ?? null)) : null;
  const periods = usePeriods(cycleId);
  const months = useMemo(() => monthsOf(periods.data ?? []), [periods.data]);
  const period: CyclePeriod | null = withPeriod && periods.data ? (months.find((p) => p.id === periodParam) ?? defaultMonth(months, today)) : null;
  const periodId = period?.id ?? null;
  const periodResolved = withPeriod && periods.data !== undefined;

  useEffect(() => {
    if (!cycles.data) return;
    const fixCycle = cycleParam !== cycleId;
    const fixPeriod = periodResolved && periodParam !== periodId;
    if (!fixCycle && !fixPeriod) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (fixCycle) {
          if (cycleId) next.set('cycle', cycleId);
          else next.delete('cycle');
        }
        if (fixPeriod) {
          if (periodId) next.set('period', periodId);
          else next.delete('period');
        }
        return next;
      },
      { replace: true },
    );
  }, [cycles.data, cycleParam, cycleId, periodResolved, periodParam, periodId, setParams]);

  const setCycle = useCallback(
    (id: Id) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('cycle', id);
          // A month belongs to one cycle; the new cycle's default month is picked once its periods load.
          next.delete('period');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setPeriod = useCallback(
    (p: CyclePeriod) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('period', p.id);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  /** `?cycle=…&period=…` for a link to a sibling or detail page of the same area. */
  const search = carrySearch(ACTUALS_PARAMS, params.toString());
  return { cycleId, period, setCycle, setPeriod, search };
}
