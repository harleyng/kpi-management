import type { ReactNode } from 'react';
import { Clock, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  CYCLE_STATUS_LABEL,
  DELEGATION_STATE_LABEL,
  EMPLOYMENT_STATUS_LABEL,
  GOAL_PLAN_STATUS_LABEL,
  GOAL_STATUS_LABEL,
  IMPORT_BATCH_STATUS_LABEL,
  LAUNCH_STATUS_LABEL,
  LIBRARY_STATUS_LABEL,
  NOTIFICATION_STATUS_LABEL,
  PERIOD_RESULT_STATUS_LABEL,
  RECORD_STATUS_LABEL,
  SYNC_RUN_STATUS_LABEL,
  FORM_STATUS_LABEL,
  type CycleStatus,
  type DelegationState,
  type EmploymentStatus,
  type FormStatus,
  type GoalPlanStatus,
  type GoalStatus,
  type ImportBatchStatus,
  type LaunchStatus,
  type LibraryStatus,
  type NotificationStatus,
  type PeriodResultStatus,
  type RecordStatus,
  type SyncRunStatus,
} from '@/data/types';
import {
  CYCLE_STATUS_TONE,
  DELEGATION_STATE_TONE,
  EMPLOYMENT_STATUS_TONE,
  GOAL_PLAN_STATUS_TONE,
  GOAL_STATUS_TONE,
  IMPORT_BATCH_STATUS_TONE,
  LAUNCH_STATUS_TONE,
  LIBRARY_STATUS_TONE,
  NOTIFICATION_STATUS_TONE,
  OVERDUE_LABEL,
  PLAN_ADJUSTING_LABEL,
  PLAN_ADJUSTING_TONE,
  PERIOD_RESULT_STATUS_TONE,
  RECORD_STATUS_TONE,
  SYNC_RUN_STATUS_TONE,
  formTone,
  type Tone,
} from './statusTones';

/**
 * Status badges — one per state set. The label comes from the set's `*_LABEL` map in
 * `src/data/types.ts`, the tone from `statusTones.ts`; a screen passes only the status. That is
 * what keeps "Đã duyệt" the same colour on every screen (design-system.md).
 *
 * Colour is never the only signal: a badge always carries its label.
 */

export type { Tone } from './statusTones';

/**
 * The primitive the per-set badges are built from. Prefer a per-set badge on a screen — choosing a
 * tone at the call site is how the mapping drifts.
 */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <Badge variant={tone} className="shrink-0 gap-1 whitespace-nowrap">
      {children}
    </Badge>
  );
}

export function GoalPlanStatusBadge({ status }: { status: GoalPlanStatus }) {
  return (
    <StatusBadge tone={GOAL_PLAN_STATUS_TONE[status]}>
      {status === 'Locked' && <Lock className="h-3 w-3" aria-hidden />}
      {GOAL_PLAN_STATUS_LABEL[status]}
    </StatusBadge>
  );
}

/**
 * `atMyStep` — the form waits on the person looking at it (decided by `workflowRules`), which
 * turns "Đang xử lý" amber. Overdue is not a status: render `<OverdueBadge>` beside this one.
 */
export function FormStatusBadge({ status, atMyStep = false }: { status: FormStatus; atMyStep?: boolean }) {
  return <StatusBadge tone={formTone(status, atMyStep)}>{FORM_STATUS_LABEL[status]}</StatusBadge>;
}

/**
 * The overdue flag next to a form's status. Whether a form IS overdue comes from `workflowRules`
 * and the gateway clock — this badge takes no dates. `subject` names the form for a screen reader
 * when the badge sits in a list ("Quá hạn — Phiếu đánh giá T01 của Nguyễn Văn An").
 */
export function OverdueBadge({ subject }: { subject?: string }) {
  return (
    <Badge
      variant="negative"
      className="shrink-0 gap-1 whitespace-nowrap"
      aria-label={subject ? `${OVERDUE_LABEL} — ${subject}` : undefined}
    >
      <Clock className="h-3 w-3" aria-hidden />
      {OVERDUE_LABEL}
    </Badge>
  );
}

export function CycleStatusBadge({ status }: { status: CycleStatus }) {
  return <StatusBadge tone={CYCLE_STATUS_TONE[status]}>{CYCLE_STATUS_LABEL[status]}</StatusBadge>;
}

export function PeriodResultStatusBadge({ status }: { status: PeriodResultStatus }) {
  return (
    <StatusBadge tone={PERIOD_RESULT_STATUS_TONE[status]}>{PERIOD_RESULT_STATUS_LABEL[status]}</StatusBadge>
  );
}

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  return <StatusBadge tone={GOAL_STATUS_TONE[status]}>{GOAL_STATUS_LABEL[status]}</StatusBadge>;
}

export function LibraryStatusBadge({ status }: { status: LibraryStatus }) {
  return <StatusBadge tone={LIBRARY_STATUS_TONE[status]}>{LIBRARY_STATUS_LABEL[status]}</StatusBadge>;
}

export function LaunchStatusBadge({ status }: { status: LaunchStatus }) {
  return <StatusBadge tone={LAUNCH_STATUS_TONE[status]}>{LAUNCH_STATUS_LABEL[status]}</StatusBadge>;
}

export function ImportBatchStatusBadge({ status }: { status: ImportBatchStatus }) {
  return (
    <StatusBadge tone={IMPORT_BATCH_STATUS_TONE[status]}>{IMPORT_BATCH_STATUS_LABEL[status]}</StatusBadge>
  );
}

/** `detail` — say what to do about a partial failure where the caller knows ("3/120 dòng lỗi"). */
export function SyncRunStatusBadge({ status, detail }: { status: SyncRunStatus; detail?: string }) {
  return (
    <StatusBadge tone={SYNC_RUN_STATUS_TONE[status]}>
      {SYNC_RUN_STATUS_LABEL[status]}
      {detail && <span className="tabular font-normal">· {detail}</span>}
    </StatusBadge>
  );
}

export function NotificationStatusBadge({ status }: { status: NotificationStatus }) {
  return (
    <StatusBadge tone={NOTIFICATION_STATUS_TONE[status]}>{NOTIFICATION_STATUS_LABEL[status]}</StatusBadge>
  );
}

export function EmploymentStatusBadge({ status }: { status: EmploymentStatus }) {
  return <StatusBadge tone={EMPLOYMENT_STATUS_TONE[status]}>{EMPLOYMENT_STATUS_LABEL[status]}</StatusBadge>;
}

/** Renders nothing for `Active` — the norm on every row is not worth a badge. */
export function RecordStatusBadge({ status }: { status: RecordStatus }) {
  const tone = RECORD_STATUS_TONE[status];
  if (tone === null) return null;
  return <StatusBadge tone={tone}>{RECORD_STATUS_LABEL[status]}</StatusBadge>;
}

/** Where a delegation stands today — derived from its dates and `revokedAt` (`formViewRules`). */
export function DelegationStateBadge({ state }: { state: DelegationState }) {
  return <StatusBadge tone={DELEGATION_STATE_TONE[state]}>{DELEGATION_STATE_LABEL[state]}</StatusBadge>;
}

/** Beside a Locked plan's status while an adjustment form is open on it (BR-KPI-15). */
export function PlanAdjustingBadge() {
  return <StatusBadge tone={PLAN_ADJUSTING_TONE}>{PLAN_ADJUSTING_LABEL}</StatusBadge>;
}
