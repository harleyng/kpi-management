import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { FormField } from '@/components/shared/FormField';
import { InlineNotice } from '@/components/shared/InlineNotice';
import { toastError } from '@/components/shared/toastError';
import { StartFormLoadError } from '@/components/forms/StartFormLoadError';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSession } from '@/contexts/useSession';
import { GOAL_PLAN_STATUS_LABEL, OVERDUE_BEHAVIOUR_LABEL, type FormInstance, type GoalPlan, type Id, type PerformanceCycle } from '@/data/types';
import { useStartForm } from '@/hooks/queries/forms';
import { useStartFormContext, type StartFormContext } from '@/hooks/queries/startForm';
import { cycleAllowsLaunch } from '@/lib/cycleRules';
import { issueText, KpiError, type RuleIssue } from '@/lib/errorCatalog';
import { resourceOfOwner } from '@/lib/permissionRules';
import { startStepChoices } from '@/lib/workflowRules';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';

interface StartRegistrationButtonProps {
  plan: GoalPlan;
  cycle: PerformanceCycle;
  /** The plan's open registration form, if known — one is already running, nothing to start. */
  registration: FormInstance | null;
  /** The plan's name in the dialog ("Phòng Kinh doanh", "Công ty · Công ty Syntra"). */
  planName: string;
  compact?: boolean;
}

/**
 * "Bắt đầu đăng ký" (BR-KPI-19): HR — or a manager with `form.start` over the unit — starts the
 * registration form of a Company / OrgUnit plan by hand; its subject is the unit head. Shown only
 * when starting can be the next step: a unit plan, not Locked (a change then goes through GOAL_CHANGE),
 * no registration open, the cycle still accepting registration (`cycleAllowsLaunch`), and the unit
 * has a head — the plan list says why otherwise. The dialog shows who acts at each step now and the
 * due date, and re-checks `canStartForm` (the gateway's own check) before the button enables.
 */
export function StartRegistrationButton({ plan, cycle, registration, planName, compact = false }: StartRegistrationButtonProps) {
  const { tenantId, can } = useSession();
  if (plan.ownerType === 'Employee' || plan.status === 'Locked' || registration !== null) return null;
  if (!cycleAllowsLaunch(cycle, 'GOAL_SETTING').ok || !can('form.start', resourceOfOwner(tenantId, plan))) return null;
  return <StartRegistrationControl plan={plan} planName={planName} compact={compact} />;
}

function StartRegistrationControl({ plan, planName, compact }: { plan: GoalPlan; planName: string; compact: boolean }) {
  const ctx = useStartFormContext(plan, 'GOAL_SETTING');
  const [open, setOpen] = useState(false);
  if (ctx.status === 'error') return <StartFormLoadError query={ctx.query} />;
  if (ctx.status === 'loading' || !ctx.workflow || ctx.openForm || ctx.ownerId === null) return null;
  return (
    <>
      <Button variant="outline" size={compact ? 'sm' : 'default'} onClick={() => setOpen(true)} aria-label={compact ? `Bắt đầu đăng ký Goal Plan của ${planName}` : undefined}>
        <Send aria-hidden />
        Bắt đầu đăng ký
      </Button>
      {open && <StartRegistrationDialog plan={plan} planName={planName} ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The name of a user, by their employee record; the login when they have none. */
function userName(ctx: StartFormContext, userId: Id): string {
  const account = ctx.dir?.users.find((u) => u.id === userId);
  const person = account?.employeeId ? ctx.dir?.employees.find((e) => e.id === account.employeeId) : undefined;
  return person?.fullName ?? account?.login ?? '—';
}

const issueSentence = (issue: RuleIssue) => issueText(issue.detail, issue.code);

function StartRegistrationDialog({ plan, planName, ctx, onClose }: { plan: GoalPlan; planName: string; ctx: StartFormContext; onClose: () => void }) {
  const navigate = useNavigate();
  const start = useStartForm();
  const [dueDate, setDueDate] = useState(ctx.defaultDueDate);
  const [error, setError] = useState<string | null>(null);
  /** PEND-01 — `null` = step 1 (the director cascades first); the head's own step = the head drafts it. */
  const [startStepNo, setStartStepNo] = useState<number | null>(null);
  const issues = ctx.issuesFor(dueDate);
  const dueIssue = issues.find((i) => i.ref === 'dueDate');
  const otherIssue = issues.find((i) => i.ref !== 'dueDate');
  const subject = ctx.dir?.employees.find((e) => e.id === ctx.ownerId);
  const fullRoute = ctx.route ?? [];
  const startChoices = startStepChoices(fullRoute.map((r) => r.step));
  // The steps before the start are skipped: they record nothing and are not shown.
  const route = fullRoute.filter((r) => r.step.stepNo >= (startStepNo ?? 1));
  const firstActors = route[0]?.actorUserIds ?? [];
  const firstName = firstActors.length > 0 ? firstActors.map((id) => userName(ctx, id)).join(', ') : null;
  // A step nobody holds and that locks the plan when overdue: HR must act on it in time.
  const unattendedLock = route.find((r) => r.actorUserIds.length === 0 && r.step.actorRule !== 'SELF' && r.step.onOverdue === 'LOCK');
  const totalDays = route.reduce((sum, r) => sum + (r.step.slaDays ?? 0), 0);

  const onStart = () => {
    setError(null);
    if (!ctx.workflow || ctx.ownerId === null || issues.length > 0) return;
    start.mutate(
      { workflowId: ctx.workflow.id, subjectEmployeeId: ctx.ownerId, goalPlanId: plan.id, periodId: null, dueDate, startStepNo },
      {
        onSuccess: (form) => {
          toast.success('Đã bắt đầu đăng ký', {
            description: firstName ? `Phiếu đang chờ ${firstName} ở bước ${route[0]?.step.stepNo ?? 1}.` : `Bước ${route[0]?.step.stepNo ?? 1} chưa có người nhận — HR thao tác thay.`,
            action: { label: 'Xem phiếu', onClick: () => navigate(`/forms/${form.id}`) },
          });
          onClose();
        },
        onError: (e) => {
          const issue = e instanceof KpiError ? e.issues[0] : undefined;
          if (issue) setError(issueSentence(issue));
          else toastError(e);
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !start.isPending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Bắt đầu đăng ký: {planName}</DialogTitle>
          <DialogDescription>
            Phiếu đăng ký KPI cho Goal Plan của {planName}, theo quy trình "{ctx.workflow?.name}". Người đăng ký là trưởng đơn vị; phiếu đi qua các bước dưới đây.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Trưởng đơn vị</dt>
            <dd className="font-medium">{subject?.fullName ?? '—'}</dd>
            <dt className="text-muted-foreground">Goal Plan</dt>
            <dd>{GOAL_PLAN_STATUS_LABEL[plan.status]}</dd>
          </dl>

          {startChoices.length > 1 && (
            <FormField label="Bắt đầu từ" className="max-w-sm">
              {(control) => (
                <Select value={String(startStepNo ?? 1)} onValueChange={(v) => setStartStepNo(v === '1' ? null : Number(v))}>
                  <SelectTrigger {...control}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {startChoices.map((s) => (
                      <SelectItem key={s.id} value={String(s.stepNo)}>
                        {s.stepNo === 1 ? 'Cấp trên giao trước' : s.actorRule === 'SELF' ? 'Trưởng đơn vị tự lập' : s.name} (bước {s.stepNo})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}

          <section aria-labelledby="route-title" className="space-y-1.5">
            <h3 id="route-title" className="text-sm font-medium">
              Các bước và người xử lý hiện tại
            </h3>
            <ol className="divide-y rounded-md border text-sm">
              {route.map(({ step, actorUserIds }) => (
                <li key={step.id} className="grid grid-cols-[1.5rem_1fr] gap-x-2 px-3 py-2 sm:grid-cols-[1.5rem_1fr_1fr]">
                  <span className="tabular-nums text-muted-foreground">{step.stepNo}</span>
                  <span>
                    {step.name}
                    <span className="block text-xs text-muted-foreground">
                      {step.slaDays !== null ? `${step.slaDays} ngày` : 'Theo hạn phiếu'}
                      {step.onOverdue ? ` · Quá hạn: ${OVERDUE_BEHAVIOUR_LABEL[step.onOverdue]}` : ''}
                    </span>
                  </span>
                  <span className="col-start-2 sm:col-start-3">
                    {actorUserIds.length > 0 ? (
                      actorUserIds.map((id) => userName(ctx, id)).join(', ')
                    ) : (
                      <span className="text-support-warning">{step.actorRule === 'SELF' ? 'Chưa có người nhận (trưởng đơn vị chưa có tài khoản)' : 'Chưa có người nhận — HR thao tác thay'}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">Người xử lý được xác định lại khi phiếu tới từng bước (đổi quản lý thì bước chuyển theo).</p>
          </section>

          {unattendedLock && (
            <InlineNotice tone="warning" title={`Bước ${unattendedLock.step.stepNo} không có người nhận`}>
              Không ai được thông báo ở bước này. Quá hạn {unattendedLock.step.slaDays} ngày, Goal Plan sẽ tự khóa — HR cần thao tác thay kịp thời.
            </InlineNotice>
          )}
          {plan.status !== 'Draft' && (
            <p className="text-sm text-muted-foreground">Goal Plan đang "{GOAL_PLAN_STATUS_LABEL[plan.status]}" sẽ về "Nháp" khi bắt đầu đăng ký.</p>
          )}

          <FormField
            label="Hạn xử lý phiếu"
            required
            className="max-w-xs"
            error={dueIssue ? issueSentence(dueIssue) : undefined}
            hint={totalDays > 0 ? `Mặc định ${totalDays} ngày — tổng thời hạn các bước (${formatDate(ctx.defaultDueDate)}).` : undefined}
          >
            {(control) => <Input {...control} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
          </FormField>

          {(otherIssue || error) && (
            <p role="alert" className="text-sm text-support-negative">
              {error ?? (otherIssue ? issueSentence(otherIssue) : null)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={start.isPending}>
            Hủy
          </Button>
          <Button onClick={onStart} disabled={issues.length > 0 || start.isPending} aria-busy={start.isPending || undefined}>
            Bắt đầu đăng ký
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
