import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AccessDenied } from '@/components/layout/AccessDenied';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormStatusBadge, GoalPlanStatusBadge, OverdueBadge } from '@/components/shared/StatusBadge';
import { useFormLookups } from '@/components/forms/useFormLookups';
import { WorkMonthSelect, useWorkMonth } from '@/components/work/WorkMonthSelect';
import { WorkPlanWithForm } from '@/components/work/WorkPlanFormBody';
import { monthText } from '@/components/work/workCopy';
import { useSession } from '@/contexts/useSession';
import type { Employee, FormInstance, Id, WorkPlan, WorkTask } from '@/data/types';
import { useForms, useInbox } from '@/hooks/queries/forms';
import { useGatewayClock } from '@/hooks/queries/session';
import { useWorkPlan, useWorkPlans, useWorkTasksOfPlans } from '@/hooks/queries/work';
import { errorSpecOf } from '@/lib/errorCatalog';
import { stepTiming } from '@/lib/formViewRules';
import { managerOf } from '@/lib/orgRules';
import { resourceOfSubject } from '@/lib/permissionRules';
import { combineQueries } from '@/lib/queryState';
import { currentMonthForm, weightedProgress } from '@/lib/workRules';
import { formatNumber } from '@/lib/utils';

const TITLE = 'Công việc tháng của đội';
const LIST_URL = '/team/work';
const FORMS_LIMIT = 200;

interface Row {
  employee: Employee;
  plan: WorkPlan | null;
  tasks: WorkTask[];
  form: FormInstance | null;
  waitingOnMe: boolean;
}

/**
 * "Công việc tháng của đội" (`/team/work`, PEND-14 plan §6): one row per direct report today — the
 * month's plan, its tasks, the weighted progress and the plan form, the ones waiting on the manager
 * first. A name opens the plan (`/team/work/:workPlanId`).
 */
export default function TeamWorkPage() {
  const { user, today } = useSession();
  const navigate = useNavigate();
  const lookups = useFormLookups();
  const clock = useGatewayClock();
  const inbox = useInbox();
  const { months, month, setMonth, query: monthsQuery } = useWorkMonth();
  const [waitingOnly, setWaitingOnly] = useState(false);

  const reports = useMemo(() => {
    const dir = lookups.directory;
    if (!dir || user.employeeId === null) return [];
    return dir.employees
      .filter((e) => e.id !== user.employeeId && managerOf(e.id, dir.assignments, today) === user.employeeId)
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));
  }, [lookups.directory, user.employeeId, today]);
  const ids = reports.map((e) => e.id);
  const enabled = month !== null && ids.length > 0;
  const plans = useWorkPlans(enabled ? { periodId: month.id, employeeIds: ids } : { employeeIds: [] });
  const tasks = useWorkTasksOfPlans((plans.data ?? []).map((p) => p.id));
  const forms = useForms({ formType: 'WORK_PLAN', periodId: month?.id, subjectEmployeeIds: ids }, { limit: FORMS_LIMIT }, { enabled });

  const mine = useMemo(() => new Set(inbox.data?.map((f) => f.id) ?? []), [inbox.data]);
  const rows: Row[] | undefined =
    plans.data && forms.data && (tasks.data || (plans.data ?? []).length === 0)
      ? reports
          .map((employee) => {
            const plan = plans.data!.find((p) => p.employeeId === employee.id) ?? null;
            const form = currentMonthForm(forms.data!.items.filter((f) => f.subjectEmployeeId === employee.id));
            return {
              employee,
              plan,
              tasks: plan ? (tasks.data ?? []).filter((t) => t.workPlanId === plan.id) : [],
              form,
              waitingOnMe: form !== null && mine.has(form.id),
            };
          })
          .sort((a, b) => Number(b.waitingOnMe) - Number(a.waitingOnMe))
          .filter((r) => !waitingOnly || r.waitingOnMe)
      : undefined;

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'name',
      header: 'Nhân viên',
      cell: (r) =>
        r.plan ? (
          <Button variant="link" className="h-auto p-0 font-medium" onClick={() => navigate(`${LIST_URL}/${r.plan!.id}`)}>
            {r.employee.fullName}
          </Button>
        ) : (
          <span className="font-medium">{r.employee.fullName}</span>
        ),
      sortValue: (r) => r.employee.fullName,
    },
    { id: 'plan', header: 'Kế hoạch', cell: (r) => (r.plan ? <GoalPlanStatusBadge status={r.plan.status} /> : <span className="text-muted-foreground">Chưa có kế hoạch</span>) },
    { id: 'count', header: 'Số việc', numeric: true, cell: (r) => (r.plan ? r.tasks.filter((t) => t.cancelledAt === null).length : null) },
    { id: 'progress', header: 'Hoàn thành bình quân (%)', numeric: true, cell: (r) => (r.plan?.status === 'Locked' ? formatNumber(weightedProgress(r.tasks), 1) : null) },
    {
      id: 'form',
      header: 'Phiếu kế hoạch',
      cell: (r) =>
        r.form ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <Button variant="link" className="h-auto p-0" onClick={() => navigate(`/forms/${r.form!.id}`)} aria-label={`Mở phiếu kế hoạch của ${r.employee.fullName}`}>
              <FormStatusBadge status={r.form.status} atMyStep={r.waitingOnMe} />
            </Button>
            {stepTiming(r.form, lookups.steps, clock).overdue && <OverdueBadge />}
          </span>
        ) : null,
    },
  ];

  const header = (
    <PageHeader title={TITLE} description="Kế hoạch và tiến độ công việc tháng của nhân viên trực tiếp." actions={<WorkMonthSelect months={months} month={month} onChange={setMonth} />} />
  );
  if (lookups.directory && reports.length === 0) {
    return (
      <>
        {header}
        <EmptyStateCard>Bạn chưa có nhân viên trực tiếp.</EmptyStateCard>
      </>
    );
  }

  return (
    <>
      {header}
      <DataTable
        label="Công việc tháng của nhân viên"
        columns={columns}
        rows={rows}
        query={combineQueries([monthsQuery, lookups.query, plans, tasks, forms, inbox])}
        getRowId={(r) => r.employee.id}
        empty={`Chưa có nhân viên nào có kế hoạch tháng ${monthText(month)}.`}
        isFiltered={waitingOnly}
        onClearFilters={() => setWaitingOnly(false)}
        pageSize={null}
        toolbar={
          <div className="flex items-center gap-2">
            <Switch id="work-waiting" checked={waitingOnly} onCheckedChange={setWaitingOnly} />
            <Label htmlFor="work-waiting" className="text-sm font-normal">
              Chờ tôi duyệt
            </Label>
          </div>
        }
      />
    </>
  );
}

/** One person's month (`/team/work/:workPlanId`): the plan with its form's actions — the manager approves or returns here. */
export function TeamWorkPlanPage() {
  const { workPlanId = '' } = useParams();
  const { user, tenantId, today, can } = useSession();
  const lookups = useFormLookups();
  const plan = useWorkPlan(workPlanId as Id);
  const forms = useForms(
    { formType: 'WORK_PLAN', periodId: plan.data?.periodId, subjectEmployeeIds: plan.data ? [plan.data.employeeId] : [] },
    { limit: 20 },
    { enabled: plan.data !== undefined },
  );
  const breadcrumb = [{ label: TITLE, to: LIST_URL }];

  const failed = plan.error ?? forms.error ?? lookups.query.error;
  if (failed) {
    return (
      <>
        <PageHeader title="Kế hoạch công việc tháng" breadcrumb={breadcrumb} />
        <ErrorStateCard spec={errorSpecOf(failed)} onAction={() => void Promise.all([plan.refetch(), forms.refetch(), lookups.query.refetch()])} />
      </>
    );
  }
  if (!plan.data || !forms.data || !lookups.directory) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const p = plan.data;
  const isManager = user.employeeId !== null && managerOf(p.employeeId, lookups.directory.assignments, today) === user.employeeId;
  if (!isManager && !can('goalplan.view', resourceOfSubject(tenantId, p.employeeId)) && !can('form.proxy', resourceOfSubject(tenantId, p.employeeId))) return <AccessDenied />;
  const form = currentMonthForm(forms.data.items);
  const month = monthText(lookups.period(p.periodId));

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Kế hoạch công việc tháng ${month} — ${lookups.employeeName(p.employeeId)}`}
        breadcrumb={breadcrumb}
        status={<GoalPlanStatusBadge status={p.status} />}
      />
      <WorkPlanWithForm key={`${p.id}:${form?.id ?? ''}`} plan={p} formId={form?.id ?? null} />
    </div>
  );
}
