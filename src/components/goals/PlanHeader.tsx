import { useState, type ReactNode } from 'react';
import { AlertTriangle, Info, Lock, Send } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { GoalPlanStatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSession } from '@/contexts/useSession';
import { CYCLE_STATUS_LABEL, OWNER_TYPE_LABEL } from '@/data/types';
import { useSubmitPlanForm, type GoalLookups, type PlanWorkspaceData } from '@/hooks/queries/goals';
import { toastSaved } from '@/hooks/queries/toasts';
import { ERROR_CATALOG, type RuleIssue } from '@/lib/errorCatalog';
import { GOAL_COUNT, KGI_COUNT } from '@/lib/goalPlanRules';
import { formatDate } from '@/lib/utils';
import { EDIT_REASON_COPY, formatWeight, issueText, planOwnerName } from './goalCopy';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

interface PlanHeaderProps {
  data: PlanWorkspaceData;
  lookups: GoalLookups;
  /** HR's lock / unlock / history actions, when the viewer may use them. */
  actions?: ReactNode;
  /** Scrolls to the goal row an issue points at. */
  onFocusGoal: (goalId: string) => void;
}

/**
 * The Goal Plan's header (WBS 4.3.2): owner, cycle, status, the registration step, the weight total
 * and counts — then the readiness strip directly under it, with "Gửi" beside what blocks it.
 * Every figure and every decision comes from the workspace (rules); nothing is computed here.
 */
export function PlanHeader({ data, lookups, actions, onFocusGoal }: PlanHeaderProps) {
  const { plan, cycle, summary, kgis, editability, registration, registrationStep } = data;
  const reason = EDIT_REASON_COPY[editability.reason];

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{planOwnerName(plan, lookups)}</h2>
              <GoalPlanStatusBadge status={plan.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Goal Plan {OWNER_TYPE_LABEL[plan.ownerType].toLowerCase()} · {cycle.name} ({CYCLE_STATUS_LABEL[cycle.status].toLowerCase()})
            </p>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4">
          <Field label="Tổng trọng số">
            {!summary.weightComplete && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-support-warning" aria-label="Chưa đủ 100%" />}
            <span>{formatWeight(summary.totalWeight)}</span>
            <span className="font-normal text-muted-foreground"> / 100%</span>
          </Field>
          <Field label={`Số chỉ tiêu (${GOAL_COUNT.min}–${GOAL_COUNT.max})`}>{summary.goalCount}</Field>
          <Field label={`Số KGI (${KGI_COUNT.min}–${KGI_COUNT.max})`}>{kgis.length}</Field>
          <Field label="Phiếu đăng ký">
            {registration && registrationStep ? (
              <>
                Bước {registrationStep.stepNo}/{registrationStep.stepCount}: {registrationStep.name}
                <span className="block text-xs font-normal text-muted-foreground">Hạn phiếu {formatDate(registration.dueDate)}</span>
              </>
            ) : (
              <span className="font-normal text-muted-foreground">Không có phiếu đang mở</span>
            )}
          </Field>
        </dl>

        {reason && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            {editability.reason === 'LOCKED' ? <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <span>
              {reason}
              {editability.formFrozen && ' Phiếu đăng ký đang dừng tại bước hiện tại cho tới khi HR mở khóa.'}
            </span>
          </p>
        )}

        <PlanReadiness data={data} onFocusGoal={onFocusGoal} />
      </CardContent>
    </Card>
  );
}

function IssueList({ issues, icon, tone, onFocusGoal, goalNames }: { issues: RuleIssue[]; icon: ReactNode; tone: string; onFocusGoal: (id: string) => void; goalNames: Map<string, string> }) {
  return (
    <ul className="space-y-1">
      {issues.map((issue, i) => {
        const goalName = issue.ref ? goalNames.get(issue.ref) : undefined;
        return (
          <li key={`${issue.code}-${issue.ref}-${issue.detail}-${i}`} className={`flex items-start gap-2 text-sm ${tone}`}>
            <span className="mt-0.5 shrink-0" aria-hidden>
              {icon}
            </span>
            <span className="min-w-0">
              {goalName && (
                <>
                  <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => onFocusGoal(issue.ref as string)}>
                    {goalName}
                  </button>
                  {': '}
                </>
              )}
              {issueText(issue)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "Cần xử lý trước khi gửi" (blocking) and "Lưu ý" (never blocks) — each item names its goal and
 * jumps to it. "Gửi" sits beside the blocking list with the first reason next to it when disabled.
 */
function PlanReadiness({ data, onFocusGoal }: { data: PlanWorkspaceData; onFocusGoal: (goalId: string) => void }) {
  const { readiness, submit, registration } = data;
  const goalNames = new Map(data.goals.map((g) => [g.id, g.name]));
  const showSubmit = submit !== null && submit.visible && registration !== null;
  if (readiness.blocking.length === 0 && readiness.warnings.length === 0 && readiness.info.length === 0 && !showSubmit) return null;

  return (
    <div className="grid gap-4 border-t pt-4 lg:grid-cols-[1fr_auto]">
      <div className="space-y-3">
        {readiness.blocking.length > 0 && (
          <section aria-label="Cần xử lý trước khi gửi">
            <h3 className="mb-1 text-sm font-semibold">Cần xử lý trước khi gửi</h3>
            <IssueList issues={readiness.blocking} icon={<AlertTriangle className="h-4 w-4" />} tone="text-support-negative" onFocusGoal={onFocusGoal} goalNames={goalNames} />
          </section>
        )}
        {readiness.info.length > 0 && (
          <section aria-label="Nhân viên sẽ cần hoàn thiện">
            <h3 className="mb-1 text-sm font-semibold">Nhân viên sẽ cần hoàn thiện ở bước của mình</h3>
            <IssueList issues={readiness.info} icon={<Info className="h-4 w-4" />} tone="text-muted-foreground" onFocusGoal={onFocusGoal} goalNames={goalNames} />
          </section>
        )}
        {readiness.warnings.length > 0 && (
          <section aria-label="Lưu ý">
            <h3 className="mb-1 text-sm font-semibold">Lưu ý</h3>
            <IssueList issues={readiness.warnings} icon={<Info className="h-4 w-4 text-support-warning" />} tone="text-foreground" onFocusGoal={onFocusGoal} goalNames={goalNames} />
          </section>
        )}
      </div>
      {showSubmit && registration && <SubmitButton data={data} />}
    </div>
  );
}

function SubmitButton({ data }: { data: PlanWorkspaceData }) {
  const { user, people } = useSession();
  const submit = data.submit!;
  const registration = data.registration!;
  const mutation = useSubmitPlanForm();
  const [confirming, setConfirming] = useState(false);
  const onBehalfOf = submit.actor?.onBehalfOfUserId ?? null;
  const onBehalfName = onBehalfOf ? (people.find((p) => p.userId === onBehalfOf)?.name ?? 'người xử lý bước') : null;
  const base = submit.kind === 'HAND_TO_OWNER' ? 'Chuyển cho nhân viên' : 'Gửi';
  const label = onBehalfOf && onBehalfOf !== user.id ? `${base} (thay mặt ${onBehalfName})` : base;
  // Content issues are already listed beside the button; name only a refusal of another kind.
  const blockedBy = !submit.allowed && submit.issues.length === 0 && submit.refusal ? ERROR_CATALOG[submit.refusal.code].title : null;

  return (
    <div className="flex flex-col items-start gap-1.5 lg:items-end">
      <Button onClick={() => setConfirming(true)} disabled={!submit.allowed || mutation.isPending} aria-describedby={blockedBy ? 'submit-blocked' : undefined}>
        <Send aria-hidden />
        {label}
      </Button>
      {blockedBy && (
        <p id="submit-blocked" className="max-w-xs text-xs text-muted-foreground lg:text-right">
          Chưa gửi được: {blockedBy}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={submit.kind === 'HAND_TO_OWNER' ? 'Chuyển Goal Plan cho nhân viên?' : 'Gửi Goal Plan?'}
        body={
          submit.kind === 'HAND_TO_OWNER'
            ? 'Nhân viên sẽ bổ sung chỉ tiêu, liên kết và gửi lại. Bạn không sửa được Goal Plan cho tới bước duyệt.'
            : 'Goal Plan chuyển sang bước tiếp theo của phiếu đăng ký. Bạn không sửa được nữa trừ khi bị trả lại.'
        }
        confirmLabel={base}
        onConfirm={() =>
          mutation.mutate(
            { form: registration, actor: submit.actor! },
            { onSuccess: () => toastSaved(submit.kind === 'HAND_TO_OWNER' ? 'Đã chuyển Goal Plan cho nhân viên' : 'Đã gửi Goal Plan') },
          )
        }
      />
    </div>
  );
}
