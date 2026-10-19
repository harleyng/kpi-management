import type {
  CycleStatus,
  EmploymentStatus,
  FormStatus,
  GoalPlanStatus,
  GoalStatus,
  ImportBatchStatus,
  LaunchStatus,
  LibraryStatus,
  NotificationStatus,
  PeriodResultStatus,
  RecordStatus,
  SyncRunStatus,
} from '@/data/types';

/**
 * Status → tone, for every state set in `src/data/types.ts` — the ONE place a status picks its
 * colour (design-system.md, "Status → tone mapping"). The badges in `StatusBadge.tsx` read these;
 * no screen chooses a tone itself.
 *
 * The principle: **muted** = nothing happening, or the normal running state · **info** = waiting on
 * someone else or on the system · **warning** = waiting on the person looking, or needs attention ·
 * **positive** = settled and good · **negative** = refused or failed. A badge marks the exception,
 * so a set's ordinary state (a goal that is Active, a KPI in use) stays muted rather than green on
 * every row.
 *
 * Kept free of JSX so the component file exports only components (clean hot reload).
 */

export type Tone = 'muted' | 'info' | 'positive' | 'warning' | 'negative';

export const GOAL_PLAN_STATUS_TONE: Readonly<Record<GoalPlanStatus, Tone>> = {
  Draft: 'muted',
  Submitted: 'info',
  Returned: 'warning',
  Approved: 'positive',
  // Final and read-only, not an alarm — the badge adds a lock icon.
  Locked: 'muted',
};

export const FORM_STATUS_TONE: Readonly<Record<FormStatus, Tone>> = {
  Open: 'muted',
  InProgress: 'info',
  Completed: 'positive',
  Cancelled: 'muted',
};

export const CYCLE_STATUS_TONE: Readonly<Record<CycleStatus, Tone>> = {
  Planning: 'muted',
  Active: 'info',
  Evaluating: 'warning',
  Closed: 'positive',
};

export const PERIOD_RESULT_STATUS_TONE: Readonly<Record<PeriodResultStatus, Tone>> = {
  Draft: 'muted',
  Final: 'info',
  Locked: 'positive',
};

export const GOAL_STATUS_TONE: Readonly<Record<GoalStatus, Tone>> = {
  Active: 'muted',
  // Superseded by an approved adjustment — the replacement goal is the one to read.
  Changed: 'info',
  Cancelled: 'muted',
};

export const LIBRARY_STATUS_TONE: Readonly<Record<LibraryStatus, Tone>> = {
  Draft: 'muted',
  Active: 'muted',
  Archived: 'muted',
};

export const LAUNCH_STATUS_TONE: Readonly<Record<LaunchStatus, Tone>> = {
  // Waiting on the system to reach its date.
  Scheduled: 'info',
  Launched: 'positive',
  Cancelled: 'muted',
};

export const IMPORT_BATCH_STATUS_TONE: Readonly<Record<ImportBatchStatus, Tone>> = {
  Validating: 'info',
  Committed: 'positive',
  Rejected: 'negative',
};

export const SYNC_RUN_STATUS_TONE: Readonly<Record<SyncRunStatus, Tone>> = {
  Running: 'info',
  Succeeded: 'positive',
  PartiallyFailed: 'warning',
  Failed: 'negative',
};

export const NOTIFICATION_STATUS_TONE: Readonly<Record<NotificationStatus, Tone>> = {
  Queued: 'muted',
  // Delivered, waiting on the recipient to read it.
  Sent: 'info',
  Read: 'muted',
  Failed: 'negative',
};

/** An attribute, not a workflow — every value is muted; the label carries the meaning. */
export const EMPLOYMENT_STATUS_TONE: Readonly<Record<EmploymentStatus, Tone>> = {
  Probation: 'muted',
  Official: 'muted',
  Resigned: 'muted',
};

/** `null` = render no badge: "Active" is every row's norm, only "Inactive" is worth marking. */
export const RECORD_STATUS_TONE: Readonly<Record<RecordStatus, Tone | null>> = {
  Active: null,
  Inactive: 'muted',
};

/**
 * A form's tone for the person looking at it: an in-progress form at THEIR step is waiting on
 * them (`warning`), so the inbox highlights their turn; otherwise the set's own tone. Whether it is
 * their step is the caller's answer (`workflowRules`, Phase 1.5) — this only colours it.
 */
export function formTone(status: FormStatus, atMyStep: boolean): Tone {
  return status === 'InProgress' && atMyStep ? 'warning' : FORM_STATUS_TONE[status];
}

/**
 * "Overdue" is a flag next to a form's status, never a status itself (`FORM_STATUSES`): it is
 * derived from the deadline and the clock, so it is labelled here rather than in a state set.
 */
export const OVERDUE_LABEL = 'Quá hạn';
