import type {
  CycleStatus,
  DelegationState,
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
 * The principle — five colours, one meaning each:
 * **info** (blue) = waiting on someone else or on the system · **positive** (green) = in effect
 * ("applying") or succeeded · **warning** (yellow) = needs action, waiting on the person looking ·
 * **negative** (red) = error, refused or failed · **muted** (grey) = cancelled, ended, or not started.
 *
 * Kept free of JSX so the component file exports only components (clean hot reload).
 */

export type Tone = 'muted' | 'info' | 'positive' | 'warning' | 'negative';

export const GOAL_PLAN_STATUS_TONE: Readonly<Record<GoalPlanStatus, Tone>> = {
  Draft: 'muted',
  Submitted: 'info',
  Returned: 'warning',
  Approved: 'positive',
  // In effect for the cycle — the badge adds a lock icon.
  Locked: 'positive',
};

export const FORM_STATUS_TONE: Readonly<Record<FormStatus, Tone>> = {
  // Launched, waiting on its first actor.
  Open: 'info',
  InProgress: 'info',
  Completed: 'positive',
  Cancelled: 'muted',
};

export const CYCLE_STATUS_TONE: Readonly<Record<CycleStatus, Tone>> = {
  // Being prepared, waiting to open.
  Planning: 'info',
  Active: 'positive',
  Evaluating: 'warning',
  // Over — like an expired delegation.
  Closed: 'muted',
};

export const PERIOD_RESULT_STATUS_TONE: Readonly<Record<PeriodResultStatus, Tone>> = {
  Draft: 'muted',
  Final: 'info',
  Locked: 'positive',
};

export const GOAL_STATUS_TONE: Readonly<Record<GoalStatus, Tone>> = {
  Active: 'positive',
  // Superseded by an approved adjustment — no longer in effect; the replacement goal is the one to read.
  Changed: 'muted',
  Cancelled: 'muted',
};

export const LIBRARY_STATUS_TONE: Readonly<Record<LibraryStatus, Tone>> = {
  Draft: 'muted',
  Active: 'positive',
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
  Queued: 'info',
  Sent: 'positive',
  Read: 'positive',
  Failed: 'negative',
};

export const EMPLOYMENT_STATUS_TONE: Readonly<Record<EmploymentStatus, Tone>> = {
  // Waiting on confirmation.
  Probation: 'info',
  Official: 'positive',
  Resigned: 'muted',
};

/** `null` would render no badge; every value is badged today. */
export const RECORD_STATUS_TONE: Readonly<Record<RecordStatus, Tone | null>> = {
  Active: 'positive',
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

/**
 * A delegation's derived state (`formViewRules.delegationState`): granting now is in effect, an
 * upcoming one is waiting on its start date, the rest is history.
 */
export const DELEGATION_STATE_TONE: Readonly<Record<DelegationState, Tone>> = {
  Upcoming: 'info',
  Active: 'positive',
  Expired: 'muted',
  Revoked: 'muted',
};

/**
 * "Đang điều chỉnh" — a Locked plan with an open adjustment (GOAL_CHANGE). Derived from the open form
 * (BR-KPI-15), never a plan status, so it is labelled here beside "Quá hạn" — a flag next to the
 * plan's own status badge.
 */
export const PLAN_ADJUSTING_LABEL = 'Đang điều chỉnh';
export const PLAN_ADJUSTING_TONE: Tone = 'info';

/**
 * The dashboard's attention flags (BR-KPI-86, Phase 3) — derived from a stored achievement % or rating,
 * never a status: a goal "Dưới ngưỡng" (below `AT_RISK_ACHIEVEMENT_PCT`) or "Thiếu số liệu" (no
 * achievement — never a warning, never 0), and a result in one of the scale's lowest bands
 * ("Xếp loại thấp"). The column that holds them is "Cần chú ý".
 */
export const ATTENTION_LABEL = {
  BELOW_THRESHOLD: 'Dưới ngưỡng',
  MISSING: 'Thiếu số liệu',
  LOW_RATING: 'Xếp loại thấp',
} as const;
export const ATTENTION_TONE: Readonly<Record<keyof typeof ATTENTION_LABEL, Tone>> = {
  BELOW_THRESHOLD: 'warning',
  MISSING: 'muted',
  LOW_RATING: 'warning',
};
