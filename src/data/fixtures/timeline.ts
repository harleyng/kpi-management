import type { IsoDate, IsoDateTime } from '@/data/types';

/**
 * Every moment of the seed's story, in ONE place (Phase 1.2 design §5 "time model").
 *
 * Times are written as Vietnam wall-clock (`Asia/Ho_Chi_Minh`, UTC+7, no DST) and stored as UTC
 * instants. The scheduler ran every day at 09:00 up to LAST_SCHEDULER_TICK and has not run since;
 * every overdue state in the seed is what that tick history produces (seed.test.ts checks it).
 */

/** `vn('2027-04-01 09:00')` → `2027-04-01T02:00:00.000Z`. */
export function vn(local: string): IsoDateTime {
  const [date, time = '00:00'] = local.split(' ');
  return new Date(`${date}T${time}:00+07:00`).toISOString();
}

/** The seed's "now" — the simulated clock starts here (decision D-b). */
export const SEED_NOW = vn('2027-04-06 09:00');
/** The last scheduler run of the story — it fired the T03 evaluation launch. */
export const LAST_SCHEDULER_TICK = vn('2027-04-01 09:00');

export const CYCLE_2026 = { start: '2026-01-01', end: '2026-12-31' } as const;
export const CYCLE_2027 = { start: '2027-01-01', end: '2027-12-31' } as const;
export const CYCLE_2028 = { start: '2028-01-01', end: '2028-12-31' } as const;

export const T = {
  cycle2027Created: vn('2026-11-20 10:00'),
  /** HR starts the unit plans' registration by hand (cycle still Planning). */
  unitPlansStarted: vn('2026-12-14 09:00'),
  unitPlansDue: '2026-12-31' as IsoDate,
  unitPlansDone: vn('2026-12-21 15:00'),
  cycleActivated: vn('2027-01-01 08:00'),

  /** GOAL_SETTING launch for staff: due 14 days later. */
  registrationLaunch: vn('2027-01-04 09:00'),
  registrationDue: '2027-01-18' as IsoDate,
  /** A completed registration, step by step (manager → employee → manager → HR, who locks). */
  // Each step is acted on before its deadline (entered + SLA 3/3/3/2 days).
  registrationSteps: [vn('2027-01-05 10:00'), vn('2027-01-07 14:00'), vn('2027-01-09 10:00'), vn('2027-01-11 15:00')] as const,
  registrationLocked: vn('2027-01-11 15:00'),
  /** The unit plans' registration, step by step, in December 2026. */
  unitPlanSteps: [vn('2026-12-15 10:00'), vn('2026-12-17 14:00'), vn('2026-12-19 10:00'), vn('2026-12-21 15:00')] as const,
  /**
   * The ticks that AUTO_LOCKed the five unfinished registrations — the day after each one's step
   * deadline: stuck at step 2 since 01-05 (deadline 01-08), at step 3 since 01-07 (01-10), at step 4
   * since 01-09 (01-11).
   */
  autoLockAtStep2: vn('2027-01-09 09:00'),
  autoLockAtStep3: vn('2027-01-11 09:00'),
  autoLockAtStep4: vn('2027-01-12 09:00'),
  /** HR unlocks four of them with a new due date (the fifth stays frozen). */
  registrationUnlock: vn('2027-04-05 10:00'),
  registrationNewDue: '2027-04-15' as IsoDate,
  /** The manager returns one re-entered plan the same afternoon. */
  registrationReturn: vn('2027-04-05 15:00'),

  /** A late registration launch for the March new hire. */
  newHireLaunch: vn('2027-04-05 09:00'),
  newHireDue: '2027-04-26' as IsoDate,

  /** Monthly evaluations: launched on day 1 (PERIOD_END + 1), due 12 days later. */
  evalT01: vn('2027-02-01 09:00'),
  evalT02: vn('2027-03-01 09:00'),
  evalT03: vn('2027-04-01 09:00'),

  /** The completed adjustment (GOAL_CHANGE) in February. */
  changeDoneStart: vn('2027-02-15 09:30'),
  /** The open adjustment: its step-2 deadline (04-02) falls after the last tick → the ONE unhandled overdue. */
  changeOpenStart: vn('2027-03-30 10:00'),
  changeOpenDue: '2027-04-05' as IsoDate,

  resignedLeftOn: '2027-03-10' as IsoDate,
  newHireHired: '2027-03-15' as IsoDate,
} as const;
