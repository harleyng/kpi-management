import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CyclePicker } from '@/components/goals/CyclePicker';
import { useSelectedCycle } from '@/components/goals/useSelectedCycle';
import { formatWeight, planOwnerName } from '@/components/goals/goalCopy';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { GoalPlanStatusBadge, StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/contexts/useSession';
import { OWNER_TYPE_LABEL, type Employee, type GoalPlan } from '@/data/types';
import { useCycles, useGoalLookups, useGoalPlans, usePlanSummaries, usePlansEditability } from '@/hooks/queries/goals';
import { useEmployees, useOrgUnits } from '@/hooks/queries/org';
import { errorSpecOf } from '@/lib/errorCatalog';
import { combineQueries } from '@/lib/queryState';

const COPY = {
  members: {
    title: 'KPI nhân viên',
    description: 'Goal Plan của nhân viên trực tiếp trong chu kỳ: trạng thái, bước của phiếu đăng ký và tổng trọng số.',
  },
  unit: {
    title: 'KPI bộ phận',
    description: 'Goal Plan của bộ phận bạn phụ trách — nơi phân giao chỉ tiêu xuống nhân viên.',
  },
} as const;

/**
 * "KPI đội nhóm" (WBS 4.3.4, Track T3) for a manager, two sub-pages: "KPI nhân viên" — the direct
 * reports' Goal Plans (the primary view, UI/UX review) — and "KPI bộ phận" — the plan of the unit
 * they head. A plan opens on its own page (`/team/kpi/members/:planId`, `/team/kpi/unit/:planId`).
 * The cycle is kept in `?cycle=`. The team's actuals progress arrives with Track T4 / Phase 3.
 */
export default function TeamKpiPage({ section }: { section: 'members' | 'unit' }) {
  const { cycles, cycle, setCycleId } = useSelectedCycle();

  let body;
  if (cycles.error) {
    body = <ErrorStateCard spec={errorSpecOf(cycles.error)} onAction={() => void cycles.refetch()} />;
  } else if (!cycles.data) {
    body = <Skeleton className="h-64 w-full" aria-label="Đang tải" />;
  } else if (!cycle) {
    body = <EmptyStateCard>Chưa có chu kỳ KPI nào.</EmptyStateCard>;
  } else {
    body = section === 'members' ? <TeamPlans cycleId={cycle.id} /> : <UnitPlans cycleId={cycle.id} />;
  }

  return (
    <>
      <PageHeader title={COPY[section].title} description={COPY[section].description} actions={<CyclePicker cycles={cycles.data} cycle={cycle} onChange={setCycleId} />} />
      {body}
    </>
  );
}

interface TeamRow {
  employee: Employee;
  plan: GoalPlan | null;
}

function TeamPlans({ cycleId }: { cycleId: string }) {
  const { user, today } = useSession();
  const navigate = useNavigate();
  const reports = useEmployees({ managerEmployeeId: user.employeeId ?? '', activeOn: today });
  const reportIds = useMemo(() => (reports.data ?? []).map((e) => e.id), [reports.data]);
  const plans = useGoalPlans({ cycleId, ownerType: 'Employee', ownerEmployeeIds: reportIds }, { enabled: reports.data !== undefined && user.employeeId !== null });
  const cycles = useCycles();
  const { query: summaryQuery, summaries } = usePlanSummaries(plans.data);
  const access = usePlansEditability(plans.data, cycles.data);
  const query = combineQueries([reports, plans, summaryQuery]);

  const rows = useMemo<TeamRow[] | undefined>(
    () => (reports.data && plans.data ? reports.data.map((employee) => ({ employee, plan: plans.data.find((p) => p.ownerEmployeeId === employee.id) ?? null })) : undefined),
    [reports.data, plans.data],
  );

  if (user.employeeId === null) return <EmptyStateCard>Tài khoản hệ thống không có nhân viên trực tiếp.</EmptyStateCard>;

  const stepLabel = (plan: GoalPlan) => {
    const form = access.registrations.get(plan.id);
    if (!form) return null;
    const steps = (access.steps ?? []).filter((s) => s.workflowId === form.workflowId).sort((a, b) => a.stepNo - b.stepNo);
    const step = steps.find((s) => s.id === form.currentStepId);
    return step ? { text: `Bước ${step.stepNo}/${steps.length}: ${step.name}`, mine: access.byPlan.get(plan.id)?.decision.ok === true } : null;
  };

  const columns: DataTableColumn<TeamRow>[] = [
    {
      id: 'name',
      header: 'Nhân viên',
      sortValue: (r) => r.employee.fullName,
      cell: (r) => (
        <div>
          <div className="font-medium">{r.employee.fullName}</div>
          <div className="text-xs text-muted-foreground">{r.employee.employeeCode}</div>
        </div>
      ),
    },
    { id: 'status', header: 'Goal Plan', cell: (r) => (r.plan ? <GoalPlanStatusBadge status={r.plan.status} /> : <span className="text-sm text-muted-foreground">Chưa có Goal Plan</span>) },
    {
      id: 'step',
      header: 'Phiếu đăng ký',
      cell: (r) => {
        const step = r.plan ? stepLabel(r.plan) : null;
        if (!step) return null;
        return (
          <div className="text-sm">
            {step.text}
            {step.mine && (
              <div className="mt-0.5">
                <StatusBadge tone="warning">Đến lượt bạn</StatusBadge>
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'weight',
      header: 'Tổng trọng số',
      numeric: true,
      sortValue: (r) => (r.plan ? (summaries?.get(r.plan.id)?.totalWeight ?? null) : null),
      cell: (r) => {
        const s = r.plan ? summaries?.get(r.plan.id) : undefined;
        return s ? (
          <span className="inline-flex items-center gap-1">
            {!s.weightComplete && <AlertTriangle className="h-3.5 w-3.5 text-support-warning" aria-label="Chưa đủ 100%" />}
            {formatWeight(s.totalWeight)}
          </span>
        ) : null;
      },
    },
    { id: 'count', header: 'Số chỉ tiêu', numeric: true, cell: (r) => (r.plan ? (summaries?.get(r.plan.id)?.goalCount ?? null) : null) },
    {
      id: 'open',
      header: 'Thao tác',
      cell: (r) => (
        <Button variant="outline" size="sm" disabled={!r.plan} onClick={() => r.plan && navigate(`/team/kpi/members/${encodeURIComponent(r.plan.id)}`)} aria-label={`Xem Goal Plan của ${r.employee.fullName}`}>
          Xem Goal Plan
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      label="Goal Plan của nhân viên trực tiếp"
      columns={columns}
      rows={rows}
      query={query}
      getRowId={(r) => r.employee.id}
      empty="Bạn chưa có nhân viên trực tiếp nào."
      pageSize={null}
    />
  );
}

/**
 * The plans of the units this manager heads in the cycle — always a list (even of one), each opening on
 * its own page, so the cycle picker above it and the "KPI bộ phận" breadcrumb stay reachable; never a
 * picker above an inline plan.
 */
function UnitPlans({ cycleId }: { cycleId: string }) {
  const { user } = useSession();
  const navigate = useNavigate();
  const units = useOrgUnits();
  const lookups = useGoalLookups();
  const headed = useMemo(() => (units.data ?? []).filter((u) => u.headEmployeeId !== null && u.headEmployeeId === user.employeeId), [units.data, user.employeeId]);
  const plans = useGoalPlans({ cycleId }, { enabled: headed.length > 0 });
  const unitPlans = useMemo(
    () => (plans.data ?? []).filter((p) => (p.ownerType === 'OrgUnit' || p.ownerType === 'Company') && headed.some((u) => u.id === p.ownerOrgUnitId)),
    [plans.data, headed],
  );
  const open = (planId: string) => `/team/kpi/unit/${encodeURIComponent(planId)}?cycle=${encodeURIComponent(cycleId)}`;

  if (units.error || plans.error) return <ErrorStateCard spec={errorSpecOf(units.error ?? plans.error)} onAction={() => void (units.error ? units.refetch() : plans.refetch())} />;
  if (!units.data || (headed.length > 0 && !plans.data)) return <Skeleton className="h-64 w-full" aria-label="Đang tải" />;
  if (headed.length === 0) return <EmptyStateCard>Bạn chưa phụ trách đơn vị nào, nên không có KPI bộ phận.</EmptyStateCard>;
  if (unitPlans.length === 0) return <EmptyStateCard>Đơn vị của bạn chưa có Goal Plan trong chu kỳ này. HR tạo Goal Plan bộ phận ở mục Chu kỳ.</EmptyStateCard>;

  const name = (p: GoalPlan) => (lookups.data ? planOwnerName(p, lookups.data) : (units.data.find((u) => u.id === p.ownerOrgUnitId)?.name ?? '—'));
  return (
    <DataTable
      label="Goal Plan của các đơn vị bạn phụ trách"
      rows={unitPlans}
      query={plans}
      getRowId={(p) => p.id}
      pageSize={null}
      empty="Đơn vị của bạn chưa có Goal Plan trong chu kỳ này."
      columns={[
        {
          id: 'name',
          header: 'Đơn vị',
          sortValue: (p) => name(p),
          cell: (p) => (
            <div>
              <div className="font-medium">{name(p)}</div>
              <div className="text-xs text-muted-foreground">{OWNER_TYPE_LABEL[p.ownerType]}</div>
            </div>
          ),
        },
        { id: 'status', header: 'Trạng thái', cell: (p) => <GoalPlanStatusBadge status={p.status} /> },
        {
          id: 'open',
          header: 'Thao tác',
          cell: (p) => (
            <Button variant="outline" size="sm" onClick={() => navigate(open(p.id))} aria-label={`Xem Goal Plan của ${name(p)}`}>
              Xem Goal Plan
            </Button>
          ),
        },
      ]}
    />
  );
}
