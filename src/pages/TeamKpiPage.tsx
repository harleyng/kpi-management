import { AlertTriangle } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CyclePicker } from '@/components/goals/CyclePicker';
import { useSelectedCycle } from '@/components/goals/useSelectedCycle';
import { formatWeight } from '@/components/goals/goalCopy';
import { GoalPlanWorkspace } from '@/components/goals/GoalPlanWorkspace';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { GoalPlanStatusBadge, StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/contexts/useSession';
import type { Employee, GoalPlan } from '@/data/types';
import { useCycles, useGoalPlans, usePlanSummaries, usePlansEditability } from '@/hooks/queries/goals';
import { useEmployees, useOrgUnits } from '@/hooks/queries/org';
import { errorSpecOf } from '@/lib/errorCatalog';
import { combineQueries } from '@/lib/queryState';

/**
 * "KPI đội nhóm" (WBS 4.3.4, Track T3) for a manager: the direct reports' Goal Plans first (the
 * primary view — UI/UX review), then the plan of the unit they head, where they cascade goals down
 * to their people. A plan opens on the same page (`?plan=`), with a way back. The team's actuals
 * progress arrives with Track T4 / Phase 3.
 */
export default function TeamKpiPage() {
  const [params, setParams] = useSearchParams();
  const { cycles, cycle, setCycleId } = useSelectedCycle();
  const planId = params.get('plan');
  const tab = params.get('tab') === 'unit' ? 'unit' : 'team';

  const setParam = (key: string, value: string | null) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value === null) next.delete(key);
      else next.set(key, value);
      next.delete('goal');
      next.delete('mode');
      return next;
    });

  let body;
  if (planId) {
    body = <GoalPlanWorkspace goalPlanId={planId} onBack={() => setParam('plan', null)} />;
  } else if (cycles.error) {
    body = <ErrorStateCard spec={errorSpecOf(cycles.error)} onAction={() => void cycles.refetch()} />;
  } else if (!cycles.data) {
    body = <Skeleton className="h-64 w-full" aria-label="Đang tải" />;
  } else if (!cycle) {
    body = <EmptyStateCard>Chưa có chu kỳ KPI nào.</EmptyStateCard>;
  } else {
    body = (
      <Tabs value={tab} onValueChange={(v) => setParam('tab', v === 'team' ? null : v)}>
        <TabsList>
          <TabsTrigger value="team">Đội nhóm</TabsTrigger>
          <TabsTrigger value="unit">KPI bộ phận</TabsTrigger>
        </TabsList>
        <TabsContent value="team" className="mt-4">
          <TeamPlans cycleId={cycle.id} onOpen={(id) => setParam('plan', id)} />
        </TabsContent>
        <TabsContent value="unit" className="mt-4">
          <UnitPlan cycleId={cycle.id} />
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <>
      <PageHeader
        title="KPI đội nhóm"
        description="Goal Plan của nhân viên trực tiếp và KPI của bộ phận bạn phụ trách — phân giao chỉ tiêu xuống nhân viên."
        actions={!planId && <CyclePicker cycles={cycles.data} cycle={cycle} onChange={setCycleId} />}
      />
      {body}
    </>
  );
}

interface TeamRow {
  employee: Employee;
  plan: GoalPlan | null;
}

function TeamPlans({ cycleId, onOpen }: { cycleId: string; onOpen: (planId: string) => void }) {
  const { user, today } = useSession();
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
        <Button variant="outline" size="sm" disabled={!r.plan} onClick={() => r.plan && onOpen(r.plan.id)} aria-label={`Xem Goal Plan của ${r.employee.fullName}`}>
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

function UnitPlan({ cycleId }: { cycleId: string }) {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const units = useOrgUnits();
  const headed = useMemo(() => (units.data ?? []).filter((u) => u.headEmployeeId !== null && u.headEmployeeId === user.employeeId), [units.data, user.employeeId]);
  const plans = useGoalPlans({ cycleId }, { enabled: headed.length > 0 });
  const unitPlans = useMemo(
    () => (plans.data ?? []).filter((p) => (p.ownerType === 'OrgUnit' || p.ownerType === 'Company') && headed.some((u) => u.id === p.ownerOrgUnitId)),
    [plans.data, headed],
  );
  const chosen = unitPlans.find((p) => p.id === params.get('unitPlan')) ?? unitPlans[0] ?? null;

  if (units.error || plans.error) return <ErrorStateCard spec={errorSpecOf(units.error ?? plans.error)} onAction={() => void (units.error ? units.refetch() : plans.refetch())} />;
  if (!units.data || (headed.length > 0 && !plans.data)) return <Skeleton className="h-64 w-full" aria-label="Đang tải" />;
  if (headed.length === 0) return <EmptyStateCard>Bạn chưa phụ trách đơn vị nào, nên không có KPI bộ phận.</EmptyStateCard>;
  if (!chosen) return <EmptyStateCard>Đơn vị của bạn chưa có Goal Plan trong chu kỳ này. HR tạo Goal Plan bộ phận ở mục Chu kỳ.</EmptyStateCard>;

  return (
    <div className="space-y-4">
      {unitPlans.length > 1 && (
        <div className="flex items-center gap-2">
          <label htmlFor="unit-plan" className="text-sm text-muted-foreground">
            Đơn vị
          </label>
          <Select
            value={chosen.id}
            onValueChange={(v) =>
              setParams((p) => {
                const next = new URLSearchParams(p);
                next.set('unitPlan', v);
                next.delete('goal');
                next.delete('mode');
                return next;
              })
            }
          >
            <SelectTrigger id="unit-plan" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {unitPlans.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {units.data.find((u) => u.id === p.ownerOrgUnitId)?.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <GoalPlanWorkspace goalPlanId={chosen.id} />
    </div>
  );
}
