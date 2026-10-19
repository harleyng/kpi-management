import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { IsoDateTime } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { DevControls } from '@/integrations/data/types';
import { devActions, type FailureMode } from '@/lib/devStore';
import { addDaysToInstant } from '@/lib/isoDate';
import { DEV_NOW_KEY } from './keys';

/**
 * The demo toolbar's hooks — the ONLY place that touches `gateway.dev` (besides `useResetSeed` in
 * `session.ts`, which the session's empty state shares). Each setter mirrors what it set into
 * `devStore` after the gateway accepted it, then refreshes what the change can affect:
 *
 * - the clock, latency and failure mode affect every screen (deadlines, "quá hạn", loading and
 *   error states), so they invalidate EVERY query — without waiting for it: the control is done once
 *   the gateway took the setting, and the screens show their own loading (under an injected failure
 *   the refetches retry, which would hold the toolbar's spinner for seconds);
 * - the scheduler writes one tenant's forms, so it invalidates that tenant's queries (its events
 *   reach the cache through `useGatewayEventInvalidation` too).
 */

function devControls(): DevControls {
  const dev = getDataGateway().dev;
  // The toolbar renders only when `dev` exists; reaching here without it is a programming error.
  if (!dev) throw new Error('dev controls are only available on the mock adapter');
  return dev;
}

export const simulatedNowKey = () => DEV_NOW_KEY;

/**
 * The simulated "now" (`gateway.clock.now()`). Re-read every time the toolbar opens (the mock's
 * clock also runs on with real time) and after every clock change (`invalidateQueries`).
 */
export function useSimulatedNow() {
  return useQuery({
    queryKey: simulatedNowKey(),
    queryFn: async (): Promise<IsoDateTime> => getDataGateway().clock.now(),
    staleTime: Infinity,
    refetchOnMount: 'always',
  });
}

/** Jump to an instant, back to the seed's moment (`to: null`), or move by whole days in the zone. */
export type SimulatedNowChange = { to: IsoDateTime | null } | { shiftDays: number };

export function useSetSimulatedNow() {
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  return useMutation({
    mutationFn: async (change: SimulatedNowChange) => {
      const dev = devControls();
      // "+1 ngày" counts from the clock as it reads NOW, not from the reading on screen.
      const to = 'shiftDays' in change ? addDaysToInstant(getDataGateway().clock.now(), change.shiftDays, tenant.timezone) : change.to;
      dev.setNow(to);
      return to;
    },
    onSuccess: (to) => {
      devActions.setClockOverridden(to !== null);
      void queryClient.invalidateQueries();
    },
  });
}

export function useSetLatency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ms: number) => {
      devControls().setLatency(ms);
      return ms;
    },
    onSuccess: (ms) => {
      devActions.setLatency(ms);
      void queryClient.invalidateQueries();
    },
  });
}

export function useSetFailureMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mode: FailureMode) => {
      devControls().setFailureMode(
        mode.enabled && mode.methodPattern ? { enabled: true, methodPattern: mode.methodPattern } : { enabled: mode.enabled },
      );
      return mode;
    },
    onSuccess: (mode) => {
      devActions.setFailure(mode);
      // Every screen re-reads, so error states appear (or clear) at once.
      void queryClient.invalidateQueries();
    },
  });
}

/** Runs the clock-driven jobs (launches, reminders, overdue) for the session's tenant. */
export function useRunScheduler() {
  const queryClient = useQueryClient();
  const { tenantId } = useSession();
  return useMutation({
    mutationFn: () => getDataGateway().scheduler.runDue(tenantId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [tenantId] }),
  });
}
