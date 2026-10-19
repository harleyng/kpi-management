import { useSearchParams } from 'react-router-dom';
import type { PerformanceCycle } from '@/data/types';
import { useCycles } from '@/hooks/queries/goals';
import { defaultCycleId } from '@/lib/cycleRules';

/**
 * The cycle a Goal Plan screen shows, kept in `?cycle=` (a reload or a shared link keeps it).
 * Without one: `cycleRules.defaultCycleId` (the Active cycle). Changing it drops any open plan / goal.
 */
export function useSelectedCycle(): { cycles: ReturnType<typeof useCycles>; cycle: PerformanceCycle | null; setCycleId: (id: string) => void } {
  const cycles = useCycles();
  const [params, setParams] = useSearchParams();
  const id = cycles.data ? defaultCycleId(cycles.data, params.get('cycle')) : null;
  const cycle = cycles.data?.find((c) => c.id === id) ?? null;
  const setCycleId = (next: string) =>
    setParams((p) => {
      const out = new URLSearchParams();
      for (const [k, v] of p) if (!['plan', 'goal', 'mode'].includes(k)) out.set(k, v);
      out.set('cycle', next);
      return out;
    });
  return { cycles, cycle, setCycleId };
}
