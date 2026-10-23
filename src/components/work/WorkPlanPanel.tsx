import { useMemo, useState } from 'react';
import { CalendarCheck, Copy, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BlockedReason } from '@/components/shared/BlockedReason';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { GoalPlanStatusBadge } from '@/components/shared/StatusBadge';
import { toastError } from '@/components/shared/toastError';
import { FormActionBar } from '@/components/forms/FormActionBar';
import { FormCommentDialog } from '@/components/forms/FormCommentDialog';
import type { FormDetail } from '@/components/forms/useFormDetail';
import { useFormLookups } from '@/components/forms/useFormLookups';
import { useSession } from '@/contexts/useSession';
import type { FormInstance, WorkPlan, WorkTask } from '@/data/types';
import { useDelegations, useForms } from '@/hooks/queries/forms';
import { useAllPeriods, useGoalRows } from '@/hooks/queries/goals';
import { useCancelWorkTask, useSaveWorkTasks, useUpdateTaskProgress, useWorkPlans, useWorkResults, useWorkTasks } from '@/hooks/queries/work';
import type { WorkTaskInput } from '@/integrations/data/types';
import { errorSpecOf, KpiError, ruleIssue, type RuleIssue } from '@/lib/errorCatalog';
import { canSubmit } from '@/lib/formRules';
import { submitCheckInput } from '@/lib/formViewRules';
import { managerOf } from '@/lib/orgRules';
import { resourceOfSubject } from '@/lib/permissionRules';
import { combineQueries } from '@/lib/queryState';
import { isDelegationValid, userOfEmployee } from '@/lib/workflowRules';
import { copyFromPreviousMonth, previousMonth, taskEditBlockers, totalTaskWeight, type TaskEditContext } from '@/lib/workRules';
import { cn, formatPercent } from '@/lib/utils';
import { useGatewayClock } from '@/hooks/queries/session';
import { WorkTaskSheet } from './WorkTaskSheet';
import { WorkTaskTable, type WorkTableMode } from './WorkTaskTable';
import { RENORMALISED_NOTE, monthText, planBlockerSentences, planNotice, taskIssueText, type WorkViewer } from './workCopy';

const inputOf = (t: WorkTask): WorkTaskInput => ({
  id: t.id,
  name: t.name,
  product: t.product,
  description: t.description,
  unitText: t.unitText,
  weight: t.weight,
  startDate: t.startDate,
  dueDate: t.dueDate,
  visibility: t.visibility,
  linkedGoalId: t.linkedGoalId,
});

const problemsOf = (error: unknown): string[] =>
  error instanceof KpiError && error.issues.length > 0 ? [...new Set(error.issues.map(taskIssueText))] : error instanceof KpiError ? [error.message] : ['Không lưu được. Thử lại.'];

interface WorkPlanPanelProps {
  plan: WorkPlan;
  /** The month's WORK_PLAN form with its standing, or `null` when it has none (or it is not loaded here). */
  detail: FormDetail | null;
  /** The form page shows the plan's own heading card; the work pages carry the status in their header. */
  showHeader?: boolean;
  formTitle?: string;
}

/**
 * One employee's month (PEND-14, plan §6): who has the turn, the tasks, and the step's actions. Every
 * choice is a rule's: what may change (`workRules.taskEditBlockers`, the gateway's own check), what
 * blocks sending (`canSubmit` on `submitCheckInput`), what the form allows (`formStanding`). Each change
 * commits at once — the list has no draft (ui-ux, B2).
 */
export function WorkPlanPanel({ plan, detail, showHeader = false, formTitle }: WorkPlanPanelProps) {
  const { tenantId, user, today, can } = useSession();
  const clock = useGatewayClock();
  const lookups = detail?.lookups ?? null;
  const ownLookups = useFormLookups();
  const look = lookups ?? ownLookups;
  const tasksQuery = useWorkTasks(plan.id);
  const tasks = tasksQuery.data;
  const periods = useAllPeriods();
  const delegations = useDelegations();
  const reviews = useForms({ formType: 'WORK_REVIEW', periodId: plan.periodId, subjectEmployeeIds: [plan.employeeId] }, { limit: 10 });
  const results = useWorkResults({ periodIds: [plan.periodId], employeeIds: [plan.employeeId] });
  const kpis = useGoalRows({ ownerEmployeeId: plan.employeeId });

  const period = look.period(plan.periodId);
  const prev = period && periods.data ? previousMonth(periods.data, period) : null;
  const prevPlans = useWorkPlans(prev ? { periodId: prev.id, employeeIds: [plan.employeeId] } : { employeeIds: [] });
  const prevPlan = prev ? (prevPlans.data?.[0] ?? null) : null;
  const prevTasks = useWorkTasks(prevPlan?.id ?? null);

  const save = useSaveWorkTasks();
  const progress = useUpdateTaskProgress();
  const cancel = useCancelWorkTask();

  const [sheet, setSheet] = useState<{ open: boolean; task: WorkTask | null }>({ open: false, task: null });
  const [problems, setProblems] = useState<string[]>([]);
  const [removing, setRemoving] = useState<WorkTask | null>(null);
  const [cancelling, setCancelling] = useState<WorkTask | null>(null);
  const [noting, setNoting] = useState<WorkTask | null>(null);
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(new Set());
  const [engaged, setEngaged] = useState(false);

  const form: FormInstance | null = detail?.form ?? null;
  const standing = detail?.standing ?? null;
  const assignments = look.directory?.assignments ?? [];
  const managerId = managerOf(plan.employeeId, assignments, today);
  const managerUserId = userOfEmployee(managerId, look.directory?.accounts ?? [])?.id ?? null;
  const isSubject = user.employeeId === plan.employeeId;
  const isManager = user.employeeId !== null && managerId === user.employeeId;
  const viewer: WorkViewer = isSubject ? 'subject' : isManager ? 'manager' : 'other';
  const delegate = managerUserId !== null && (delegations.data ?? []).some((d) => d.fromUserId === managerUserId && d.toUserId === user.id && isDelegationValid(d, 'WORK_PLAN', clock));
  const proxy = !isSubject && can('form.proxy', resourceOfSubject(tenantId, plan.employeeId));

  // The gateway's own question, asked with what the screen knows (`taskEditBlockers`).
  const ctx: TaskEditContext = {
    planStatus: plan.status,
    editAtStep: standing?.canEdit && form && form.status !== 'Completed' && form.status !== 'Cancelled' ? null : ruleIssue('ERR-KPI-04', null, 'NO_OPEN_FORM'),
    isSubject,
    isManager,
    mayActForManager: !isManager && (delegate || proxy),
    reviewLaunched: (reviews.data?.items ?? []).some((f) => f.status !== 'Cancelled'),
    resultRecorded: (results.data ?? []).length > 0,
  };
  // What may change depends on these reads: until they answer (or when one failed) nothing is offered.
  const guardReads = combineQueries([reviews, results, delegations]);
  const guardsReady = reviews.data !== undefined && results.data !== undefined && delegations.data !== undefined;
  const live = { cancelledAt: null };
  const mayEditList = guardsReady && taskEditBlockers(ctx, 'ADD').length === 0;
  const mayProgress = guardsReady && taskEditBlockers(ctx, 'PROGRESS', live).length === 0;
  const mayCancel = guardsReady && taskEditBlockers({ ...ctx, liveTaskCount: tasks ? tasks.filter((t) => t.cancelledAt === null).length : undefined }, 'CANCEL', live, 'x').length === 0;
  const mode: WorkTableMode = plan.status === 'Locked' ? (mayProgress || mayCancel ? 'track' : 'read') : mayEditList ? 'plan' : 'read';

  const writeAll = (list: WorkTaskInput[]) =>
    new Promise<void>((resolve, reject) => {
      setProblems([]);
      save.mutate(
        { workPlanId: plan.id, tasks: list },
        {
          onSuccess: () => resolve(),
          onError: (error) => {
            setProblems(problemsOf(error));
            if (error instanceof KpiError) setFlagged(new Set(error.issues.map((i) => i.ref).filter((r): r is string => r !== null)));
            reject(error);
          },
        },
      );
    });

  const saveOne = (input: WorkTaskInput) => {
    const list = (tasks ?? []).map(inputOf);
    const next = input.id ? list.map((t) => (t.id === input.id ? input : t)) : [...list, input];
    setEngaged(true);
    return writeAll(next);
  };

  const copy = useMemo(() => {
    if (!period || !prev || !prevPlan || !prevTasks.data || !tasks) return null;
    return copyFromPreviousMonth(prevTasks.data, tasks, period, prev.cycleId === period.cycleId);
  }, [period, prev, prevPlan, prevTasks.data, tasks]);
  const copyReason = !prev
    ? 'Không có tháng trước.'
    : prevPlans.data && !prevPlan
      ? `Tháng ${monthText(prev)} không có kế hoạch.`
      : copy && copy.tasks.length === 0
        ? copy.skipped > 0
          ? `Các việc chưa xong của tháng ${monthText(prev)} đã có trong kế hoạch.`
          : `Tháng ${monthText(prev)} không còn việc nào chưa xong để sao chép.`
        : null;
  const runCopy = () => {
    if (!copy || copy.tasks.length === 0 || !prev) return;
    writeAll([...(tasks ?? []).map(inputOf), ...copy.tasks]).then(
      () => toast.success(`Đã sao chép ${copy.tasks.length} việc từ tháng ${monthText(prev)}${copy.skipped ? `, bỏ qua ${copy.skipped} việc đã có` : ''}.`),
      (error) => toastError(error),
    );
  };

  const onProgress = (t: WorkTask, next: { progressPct: number; progressStatus: 'NotStarted' | 'InProgress' | 'Done' }) =>
    progress.mutate({ taskId: t.id, input: { ...next, note: t.note } }, { onError: (e) => toastError(e) });

  // What blocks SUBMIT / APPROVE — the same builder the gateway checks with.
  const forwardable = standing?.actions.some((a) => a === 'SUBMIT' || a === 'APPROVE') ?? false;
  const blockers: RuleIssue[] =
    form && standing?.step && tasks && periods.data && forwardable
      ? (() => {
          const check = canSubmit(
            submitCheckInput(form, standing.step, standing.steps, { goals: [], kgis: [], items: [], changeItems: [], workTasks: tasks, periods: periods.data }),
          );
          return check.ok ? [] : check.issues;
        })()
      : [];
  const verb = standing?.actions.includes('APPROVE') ? 'duyệt' : 'gửi';

  const history = detail?.history ?? [];
  const lastReturn = [...history].reverse().find((a) => a.action === 'RETURN');
  const notice = planNotice({
    viewer,
    plan,
    month: monthText(period),
    employeeName: look.employeeName(plan.employeeId),
    managerName: managerId ? look.employeeName(managerId) : 'quản lý',
    approverName: plan.approvedBy ? look.userName(plan.approvedBy) : null,
    returnComment: plan.status === 'Returned' ? (lastReturn?.comment ?? null) : null,
    autoForwarded: plan.status === 'Submitted' && history.at(-1)?.action === 'AUTO_FORWARD',
    deadline: standing?.deadline ?? null,
    canEdit: mode === 'plan',
  });

  const total = tasks ? totalTaskWeight(tasks) : null;
  const hasCancelled = tasks?.some((t) => t.cancelledAt !== null) ?? false;
  const summary = tasks && (
    <dl className="flex flex-wrap gap-x-6 gap-y-1" aria-live="polite">
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Tổng trọng số</dt>
        <dd className={cn('tabular font-medium', engaged && mode === 'plan' && total !== null && Math.abs(total - 100) > 0.01 && 'text-support-negative')}>{formatPercent(total)}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-muted-foreground">Số việc</dt>
        <dd className="tabular font-medium">{tasks.filter((t) => t.cancelledAt === null).length}</dd>
      </div>
      {hasCancelled && <p className="basis-full text-xs text-muted-foreground">{RENORMALISED_NOTE}</p>}
    </dl>
  );

  const toolbar =
    mode === 'plan' ? (
      <span className="flex flex-col gap-0.5">
        <Button variant="outline" size="sm" disabled={copyReason !== null || save.isPending} aria-describedby={copyReason ? 'copy-reason' : undefined} onClick={runCopy}>
          <Copy aria-hidden />
          Sao chép tháng trước
        </Button>
        {copyReason && <BlockedReason id="copy-reason">{copyReason}</BlockedReason>}
      </span>
    ) : undefined;
  const add =
    mode === 'plan' ? (
      <Button size="sm" onClick={() => setSheet({ open: true, task: null })}>
        <Plus aria-hidden />
        Thêm việc
      </Button>
    ) : undefined;

  const emptyText =
    mode === 'plan'
      ? 'Tháng này chưa có việc nào. Thêm từng việc hoặc sao chép từ tháng trước.'
      : viewer === 'manager' && plan.status === 'Draft'
        ? `${look.employeeName(plan.employeeId)} chưa nhập việc nào.`
        : 'Kế hoạch tháng này không có việc nào.';

  const open = form !== null && (form.status === 'Open' || form.status === 'InProgress');

  return (
    <div className="space-y-3">
      {showHeader && (
        <Card>
          <CardContent className="p-4">
            <SectionTitle icon={CalendarCheck} title={`Kế hoạch công việc tháng ${monthText(period)}`}>
              <GoalPlanStatusBadge status={plan.status} />
            </SectionTitle>
          </CardContent>
        </Card>
      )}
      {guardReads.error != null ? (
        <ErrorState spec={errorSpecOf(guardReads.error)} onAction={() => void Promise.all([reviews.refetch(), results.refetch(), delegations.refetch()])} />
      ) : (
        notice && (
          <p role="status" className="rounded-md border bg-surface-alt px-3 py-2 text-sm">
            {notice}
          </p>
        )
      )}
      <WorkTaskTable
        tasks={tasks}
        query={combineQueries([tasksQuery])}
        mode={mode}
        showProgress={plan.status === 'Locked'}
        empty={emptyText}
        toolbar={toolbar}
        toolbarActions={add}
        flagged={flagged}
        pendingTaskId={progress.isPending ? (progress.variables?.taskId ?? null) : null}
        goalName={(id) => kpis.data?.find((g) => g.id === id)?.name ?? null}
        actions={{
          edit: (t) => setSheet({ open: true, task: t }),
          remove: (t) => setRemoving(t),
          progress: mayProgress ? onProgress : undefined,
          note: mayProgress ? (t) => setNoting(t) : undefined,
          cancel: mayCancel ? (t) => setCancelling(t) : undefined,
        }}
      />
      {open && detail && standing ? (
        <FormActionBar
          form={detail.form!}
          formTitle={formTitle ?? `Kế hoạch công việc tháng ${monthText(period)}`}
          standing={standing}
          blockers={blockers}
          summary={summary}
          engaged={engaged}
          describeBlockers={(issues) => planBlockerSentences(issues, verb)}
          onIssues={(issues) => {
            setEngaged(true);
            setFlagged(new Set(issues.map((i) => i.ref).filter((r): r is string => r !== null)));
          }}
        />
      ) : (
        tasks && tasks.length > 0 && <div className="px-1 text-sm">{summary}</div>
      )}

      {period && (
        <WorkTaskSheet
          open={sheet.open}
          onOpenChange={(o) => {
            setSheet((s) => ({ ...s, open: o }));
            if (!o) setProblems([]);
          }}
          task={sheet.task}
          tasks={tasks ?? []}
          period={period}
          onSave={saveOne}
          saving={save.isPending}
          problems={problems}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Xóa việc"
        body={removing ? `Xóa việc "${removing.name}" khỏi kế hoạch tháng ${monthText(period)}? Trọng số ${formatPercent(removing.weight)} của việc này không còn được tính.` : ''}
        confirmLabel="Xóa việc"
        destructive
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) writeAll((tasks ?? []).filter((t) => t.id !== target.id).map(inputOf)).catch((e) => toastError(e));
        }}
      />
      <FormCommentDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Hủy việc"
        body={cancelling ? `Hủy việc "${cancelling.name}"? Việc vẫn hiện trong kế hoạch (gạch ngang) nhưng không còn trọng số; các việc còn lại được tính lại cho đủ 100%.` : ''}
        label="Lý do hủy việc"
        confirmLabel="Hủy việc"
        destructive
        pending={cancel.isPending}
        onConfirm={(reason) => {
          const target = cancelling;
          if (!target) return;
          cancel.mutate(
            { taskId: target.id, reason },
            { onSuccess: () => { setCancelling(null); toast.success('Đã hủy việc.'); }, onError: (e) => toastError(e) },
          );
        }}
      />
      <FormCommentDialog
        open={noting !== null}
        onOpenChange={(o) => !o && setNoting(null)}
        title="Ghi chú tiến độ"
        body={noting ? `Ghi chú cho việc "${noting.name}" — ví dụ việc đã làm, vướng mắc.` : ''}
        label="Ghi chú"
        confirmLabel="Lưu ghi chú"
        pending={progress.isPending}
        onConfirm={(note) => {
          const target = noting;
          if (!target || target.progressStatus === 'Cancelled') return;
          progress.mutate(
            { taskId: target.id, input: { progressPct: target.progressPct, progressStatus: target.progressStatus, note } },
            { onSuccess: () => setNoting(null), onError: (e) => toastError(e) },
          );
        }}
      />
    </div>
  );
}
