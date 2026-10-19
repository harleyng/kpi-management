import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useResultPeriod, type ResultPeriodSelection } from '@/components/results/useResultPeriod';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod, Id } from '@/data/types';
import type { DashboardSelection } from '@/hooks/queries/dashboard';
import { useResultsOfPeriods } from '@/hooks/queries/results';
import { defaultDashboardPeriod, type DashboardModel } from '@/lib/dashboardRules';
import { combineQueries } from '@/lib/queryState';

/**
 * The dashboard's cycle and period, kept in the URL (`?cycle=&period=`) like the results screens
 * (`useResultPeriod`). The period defaults to the latest month with an official result
 * (`defaultDashboardPeriod`) — decided only once every period's results have loaded, and written back
 * with `replace`. Changing the cycle clears the period and the unit.
 */
export function useDashboardSelection(): DashboardSelection & ResultPeriodSelection {
  const { today } = useSession();
  const base = useResultPeriod({ withPeriod: false });
  const [params, setParams] = useSearchParams();
  const periodIds = useMemo(() => base.periods?.map((p) => p.id), [base.periods]);
  const results = useResultsOfPeriods(periodIds);

  const period = useMemo<CyclePeriod | null>(() => {
    if (!base.periods) return null;
    const chosen = base.periods.find((p) => p.id === params.get('period'));
    if (chosen) return chosen;
    return results.data ? defaultDashboardPeriod(base.periods, results.data, today) : null;
  }, [base.periods, params, results.data, today]);

  useEffect(() => {
    if (!period || params.get('period') === period.id) return;
    const next = new URLSearchParams(params);
    next.set('period', period.id);
    setParams(next, { replace: true });
  }, [period, params, setParams]);

  return {
    ...base,
    period,
    cycleResults: base.periods ? results.data : undefined,
    setCycle: (cycleId) => {
      const next = new URLSearchParams(params);
      next.set('cycle', cycleId);
      next.delete('period');
      next.delete('unit');
      setParams(next, { replace: true });
    },
    setPeriod: (periodId) => {
      const next = new URLSearchParams(params);
      next.set('period', periodId);
      setParams(next, { replace: true });
    },
    query: combineQueries([base.query, results.query]),
  };
}

/** The unit in focus (`?unit=`), falling back to the first root; a unit outside the scope never sticks. */
export function useFocusUnit(model: DashboardModel | null | undefined): { focusId: Id | null; setFocus: (unitId: Id) => void } {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('unit');
  const focusId = model ? (wanted && model.nodes.has(wanted) ? wanted : (model.rootIds[0] ?? null)) : null;
  useEffect(() => {
    if (!model || focusId === null || wanted === focusId) return;
    const next = new URLSearchParams(params);
    next.set('unit', focusId);
    setParams(next, { replace: true });
  }, [model, focusId, wanted, params, setParams]);
  return {
    focusId,
    setFocus: (unitId) => {
      const next = new URLSearchParams(params);
      next.set('unit', unitId);
      setParams(next); // pushed, so Back returns to the unit above
    },
  };
}
