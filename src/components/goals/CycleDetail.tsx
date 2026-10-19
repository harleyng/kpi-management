import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Plus } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { FormField } from '@/components/shared/FormField';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { CycleStatusBadge, GoalPlanStatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/contexts/useSession';
import {
  CYCLE_STATUS_LABEL,
  GOAL_PLAN_STATUSES,
  GOAL_PLAN_STATUS_LABEL,
  OWNER_TYPES,
  OWNER_TYPE_LABEL,
  PERIOD_TYPES,
  PERIOD_TYPE_LABEL,
  type CycleStatus,
  type GoalPlan,
  type GoalPlanStatus,
  type OwnerType,
  type PerformanceCycle,
  type PeriodType,
} from '@/data/types';
import {
  useCreateGoalPlan,
  useGoalPlans,
  usePeriods,
  usePlanSummaries,
  usePlansEditability,
  useSaveCycle,
  useSavePeriods,
  useSetCycleStatus,
  useSetPeriodLocked,
} from '@/hooks/queries/goals';
import { useEmployees, useOrgUnits } from '@/hooks/queries/org';
import { toastSaved } from '@/hooks/queries/toasts';
import { canEditCycle, canLockPeriod, cycleIssues, generatePeriods, mergeGeneratedPeriods, nextCycleStatus, PERIOD_GENERATION_DEFAULTS, type PeriodMergeSummary } from '@/lib/cycleRules';
import { KpiError } from '@/lib/errorCatalog';
import { combineQueries } from '@/lib/queryState';
import { formatDate, formatDateTime } from '@/lib/utils';
import { firstIssueText, formatWeight, issueText } from './goalCopy';
import { PlanLockActions } from './PlanLockActions';

/** What the next-status button says — the action, not the state (UI/UX review). */
const NEXT_STATUS_ACTION: Readonly<Record<CycleStatus, string>> = {
  Planning: 'Bắt đầu chu kỳ',
  Active: 'Chuyển sang đánh giá',
  Evaluating: 'Đóng chu kỳ',
  Closed: '',
};
const NEXT_STATUS_BODY: Readonly<Record<CycleStatus, string>> = {
  Planning: 'Chu kỳ chuyển sang "Đang thực hiện". Tên, ngày và các kỳ không sửa được nữa.',
  Active: 'Chu kỳ chuyển sang "Đang đánh giá". Không khởi chạy phiếu đăng ký mới được nữa.',
  Evaluating: 'Chu kỳ chuyển sang "Đã đóng": mọi kỳ sẽ bị khóa số liệu và Goal Plan của chu kỳ không sửa được nữa. Không hoàn tác được.',
  Closed: '',
};

/** The selected cycle (WBS 4.3.1, 4.3.6): its header and status step, its periods, its Goal Plans. */
export function CycleDetail({ cycle, onOpenPlan, onEdit }: { cycle: PerformanceCycle; onOpenPlan: (planId: string) => void; onEdit: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const setStatus = useSetCycleStatus();
  const next = nextCycleStatus(cycle);
  const [statusError, setStatusError] = useState<string | null>(null);

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{cycle.name}</h2>
              <CycleStatusBadge status={cycle.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEditCycle(cycle).ok && (
              <Button variant="outline" onClick={onEdit}>
                Sửa thông tin
              </Button>
            )}
            {next && (
              <Button onClick={() => setConfirming(true)} disabled={setStatus.isPending}>
                {NEXT_STATUS_ACTION[cycle.status]}
              </Button>
            )}
          </div>
        </div>
        {statusError && (
          <p role="alert" className="text-sm text-support-negative">
            {statusError}
          </p>
        )}
        <Tabs defaultValue="periods">
          <TabsList>
            <TabsTrigger value="periods">Kỳ đánh giá</TabsTrigger>
            <TabsTrigger value="plans">Goal Plan</TabsTrigger>
          </TabsList>
          <TabsContent value="periods" className="mt-4">
            <PeriodsPanel cycle={cycle} />
          </TabsContent>
          <TabsContent value="plans" className="mt-4">
            <CyclePlansPanel cycle={cycle} onOpenPlan={onOpenPlan} />
          </TabsContent>
        </Tabs>
        {next && (
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`${NEXT_STATUS_ACTION[cycle.status]} "${cycle.name}"?`}
            body={NEXT_STATUS_BODY[cycle.status]}
            confirmLabel={NEXT_STATUS_ACTION[cycle.status]}
            destructive={next === 'Closed'}
            onConfirm={() => {
              setStatusError(null);
              setStatus.mutate(
                { cycleId: cycle.id, status: next },
                {
                  onSuccess: () => toastSaved(`Chu kỳ đã chuyển sang "${CYCLE_STATUS_LABEL[next]}"`),
                  onError: (e) => setStatusError(e instanceof KpiError && e.issues.length ? e.issues.map(issueText).join(' ') : null),
                },
              );
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Periods ───────────────────────────────────────────────────────────────────────────────────

function PeriodsPanel({ cycle }: { cycle: PerformanceCycle }) {
  const periods = usePeriods(cycle.id);
  const lock = useSetPeriodLocked();
  const [generating, setGenerating] = useState(false);
  const editable = canEditCycle(cycle).ok;
  const lockable = canLockPeriod(cycle).ok;

  return (
    <div className="space-y-4">
      <SectionTitle
        icon={CalendarDays}
        title="Kỳ đánh giá"
        action={
          editable && !generating ? (
            <Button variant="outline" size="sm" onClick={() => setGenerating(true)}>
              Tạo kỳ tự động
            </Button>
          ) : undefined
        }
      >
        {editable ? 'Các kỳ chỉ sửa được khi chu kỳ còn "Đang lập kế hoạch".' : 'Chu kỳ đã bắt đầu — các kỳ không sửa được, chỉ khóa / mở khóa số liệu.'}
      </SectionTitle>
      {generating && periods.data && <GeneratePeriods cycle={cycle} existing={periods.data} onDone={() => setGenerating(false)} />}
      <DataTable
        label="Các kỳ của chu kỳ"
        rows={periods.data}
        query={periods}
        getRowId={(p) => p.id}
        pageSize={null}
        empty={editable ? 'Chu kỳ chưa có kỳ nào. Bấm "Tạo kỳ tự động" để tạo 12 tháng và 4 quý.' : 'Chu kỳ chưa có kỳ nào.'}
        columns={[
          { id: 'type', header: 'Loại', cell: (p) => PERIOD_TYPE_LABEL[p.periodType] },
          { id: 'label', header: 'Kỳ', cell: (p) => <span className="font-medium">{p.label}</span> },
          { id: 'dates', header: 'Thời gian', cell: (p) => `${formatDate(p.startDate)} – ${formatDate(p.endDate)}` },
          { id: 'input', header: 'Hạn nhập số', cell: (p) => (p.inputDeadline ? formatDate(p.inputDeadline) : null) },
          { id: 'eval', header: 'Hạn đánh giá', cell: (p) => (p.evalDeadline ? formatDate(p.evalDeadline) : null) },
          {
            id: 'lock',
            header: 'Khóa số liệu',
            cell: (p) => (
              <Switch
                checked={p.isLocked}
                disabled={!lockable || lock.isPending}
                aria-busy={lock.isPending && lock.variables?.periodId === p.id}
                aria-label={`Khóa số liệu kỳ ${p.label}`}
                title={!lockable ? 'Chu kỳ đã đóng — khóa số liệu không đổi được nữa.' : undefined}
                onCheckedChange={(locked) => lock.mutate({ periodId: p.id, locked }, { onSuccess: () => toastSaved(locked ? `Đã khóa số liệu kỳ ${p.label}` : `Đã mở khóa số liệu kỳ ${p.label}`) })}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function GeneratePeriods({ cycle, existing, onDone }: { cycle: PerformanceCycle; existing: Parameters<typeof mergeGeneratedPeriods>[0]; onDone: () => void }) {
  const [types, setTypes] = useState<PeriodType[]>([...PERIOD_GENERATION_DEFAULTS.types]);
  const [inputDays, setInputDays] = useState(String(PERIOD_GENERATION_DEFAULTS.inputDeadlineDays));
  const [evalDays, setEvalDays] = useState(String(PERIOD_GENERATION_DEFAULTS.evalDeadlineDays));
  const save = useSavePeriods();
  const generated = generatePeriods(cycle, { types, inputDeadlineDays: Number(inputDays), evalDeadlineDays: Number(evalDays) });
  const merged = generated.ok ? mergeGeneratedPeriods(existing, generated.periods) : null;
  const status = (p: { periodType: string; label: string }, summary: PeriodMergeSummary) =>
    summary.added.some((a) => a.periodType === p.periodType && a.label === p.label) ? 'Thêm mới' : summary.updated.some((a) => a.periodType === p.periodType && a.label === p.label) ? 'Cập nhật ngày' : 'Giữ nguyên';

  return (
    <div className="space-y-4 rounded-md border p-4">
      <h3 className="text-sm font-semibold">Tạo kỳ tự động · xem trước {merged ? merged.inputs.length : 0} kỳ</h3>
      <div className="flex flex-wrap items-end gap-4">
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Loại kỳ</legend>
          <div className="flex flex-wrap gap-3">
            {PERIOD_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={types.includes(t)} onChange={(e) => setTypes((ts) => (e.target.checked ? [...ts, t] : ts.filter((x) => x !== t)))} />
                {PERIOD_TYPE_LABEL[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <FormField label="Hạn nhập số (ngày sau cuối tháng)" className="w-56">
          {(control) => <Input {...control} inputMode="numeric" value={inputDays} onChange={(e) => setInputDays(e.target.value)} />}
        </FormField>
        <FormField label="Hạn đánh giá (ngày sau cuối tháng)" className="w-56">
          {(control) => <Input {...control} inputMode="numeric" value={evalDays} onChange={(e) => setEvalDays(e.target.value)} />}
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">Giả định Q20: quý, nửa năm tính từ tháng đầu của chu kỳ. Kỳ đã có (cùng loại, cùng tên) giữ nguyên mã và trạng thái khóa.</p>
      {!generated.ok ? (
        <p role="alert" className="text-sm text-support-negative">
          {generated.issues.map(issueText).join(' ')}
        </p>
      ) : (
        merged && (
          <div className="max-h-80 overflow-auto rounded-md border">
            <Table aria-label="Xem trước các kỳ">
              <TableHeader>
                <TableRow>
                  <TableHead>Loại</TableHead>
                  <TableHead>Kỳ</TableHead>
                  <TableHead>Thời gian</TableHead>
                  <TableHead>Hạn nhập số</TableHead>
                  <TableHead>Hạn đánh giá</TableHead>
                  <TableHead>Thay đổi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {merged.inputs.map((p) => (
                  <TableRow key={`${p.periodType}:${p.label}`}>
                    <TableCell>{PERIOD_TYPE_LABEL[p.periodType]}</TableCell>
                    <TableCell className="font-medium">{p.label}</TableCell>
                    <TableCell>
                      {formatDate(p.startDate)} – {formatDate(p.endDate)}
                    </TableCell>
                    <TableCell>{p.inputDeadline ? formatDate(p.inputDeadline) : '—'}</TableCell>
                    <TableCell>{p.evalDeadline ? formatDate(p.evalDeadline) : '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{status(p, merged.summary)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone} disabled={save.isPending}>
          Hủy
        </Button>
        <Button
          disabled={!merged || save.isPending}
          aria-busy={save.isPending}
          onClick={() => merged && save.mutate({ cycleId: cycle.id, periods: merged.inputs }, { onSuccess: () => { toastSaved(`Đã lưu ${merged.inputs.length} kỳ`); onDone(); } })}
        >
          Áp dụng
        </Button>
      </div>
    </div>
  );
}

// ─── Plans of the cycle (WBS 4.3.6) ────────────────────────────────────────────────────────────

const ALL = '__all';

function CyclePlansPanel({ cycle, onOpenPlan }: { cycle: PerformanceCycle; onOpenPlan: (planId: string) => void }) {
  const { can } = useSession();
  const plans = useGoalPlans({ cycleId: cycle.id });
  const units = useOrgUnits();
  const employees = useEmployees({ includeResigned: true });
  const { query: summaryQuery, summaries } = usePlanSummaries(plans.data);
  const access = usePlansEditability(plans.data, [cycle]);
  const [tier, setTier] = useState<OwnerType | typeof ALL>(ALL);
  const [status, setStatus] = useState<GoalPlanStatus | typeof ALL>(ALL);
  const [creating, setCreating] = useState(false);
  const query = combineQueries([plans, units, employees, summaryQuery]);

  const ownerName = (p: GoalPlan) =>
    p.ownerType === 'Employee' ? (employees.data?.find((e) => e.id === p.ownerEmployeeId)?.fullName ?? '—') : (units.data?.find((u) => u.id === p.ownerOrgUnitId)?.name ?? '—');
  const rows = useMemo(
    () => (plans.data ?? []).filter((p) => (tier === ALL || p.ownerType === tier) && (status === ALL || p.status === status)).sort((a, b) => OWNER_TYPES.indexOf(a.ownerType) - OWNER_TYPES.indexOf(b.ownerType)),
    [plans.data, tier, status],
  );
  const filtered = tier !== ALL || status !== ALL;

  const columns: DataTableColumn<GoalPlan>[] = [
    {
      id: 'owner',
      header: 'Chủ Goal Plan',
      sortValue: (p) => ownerName(p),
      cell: (p) => (
        <div>
          <div className="font-medium">{ownerName(p)}</div>
          <div className="text-xs text-muted-foreground">{OWNER_TYPE_LABEL[p.ownerType]}</div>
        </div>
      ),
    },
    { id: 'status', header: 'Trạng thái', cell: (p) => <GoalPlanStatusBadge status={p.status} /> },
    {
      id: 'form',
      header: 'Phiếu đăng ký',
      cell: (p) => {
        const form = access.registrations.get(p.id);
        if (!form) return null;
        const steps = (access.steps ?? []).filter((s) => s.workflowId === form.workflowId).sort((a, b) => a.stepNo - b.stepNo);
        const step = steps.find((s) => s.id === form.currentStepId);
        return step ? <span className="text-sm">Bước {step.stepNo}/{steps.length}: {step.name}</span> : null;
      },
    },
    {
      id: 'weight',
      header: 'Tổng trọng số',
      numeric: true,
      sortValue: (p) => summaries?.get(p.id)?.totalWeight ?? null,
      cell: (p) => {
        const s = summaries?.get(p.id);
        return s ? (
          <span className="inline-flex items-center gap-1">
            {!s.weightComplete && <AlertTriangle className="h-3.5 w-3.5 text-support-warning" aria-label="Chưa đủ 100%" />}
            {formatWeight(s.totalWeight)}
          </span>
        ) : null;
      },
    },
    { id: 'count', header: 'Số chỉ tiêu', numeric: true, sortValue: (p) => summaries?.get(p.id)?.goalCount ?? null, cell: (p) => summaries?.get(p.id)?.goalCount ?? null },
    { id: 'locked', header: 'Khóa lúc', cell: (p) => (p.lockedAt ? formatDateTime(p.lockedAt) : null) },
    {
      id: 'actions',
      header: 'Thao tác',
      cell: (p) => (
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" size="sm" onClick={() => onOpenPlan(p.id)} aria-label={`Xem Goal Plan của ${ownerName(p)}`}>
            Xem
          </Button>
          <PlanLockActions plan={p} cycle={cycle} registration={access.registrations.get(p.id) ?? null} planName={`Goal Plan của ${ownerName(p)}`} compact />
        </div>
      ),
    },
  ];

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={tier} onValueChange={(v) => setTier(v as OwnerType | typeof ALL)}>
        <SelectTrigger className="w-40" aria-label="Lọc theo tầng">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Mọi tầng</SelectItem>
          {OWNER_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {OWNER_TYPE_LABEL[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={(v) => setStatus(v as GoalPlanStatus | typeof ALL)}>
        <SelectTrigger className="w-44" aria-label="Lọc theo trạng thái">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Mọi trạng thái</SelectItem>
          {GOAL_PLAN_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {GOAL_PLAN_STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {can('goalplan.edit') && cycle.status !== 'Closed' && (
        <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          Tạo Goal Plan công ty / bộ phận
        </Button>
      )}
    </div>
  );

  return (
    <>
      <DataTable
        label={`Goal Plan của ${cycle.name}`}
        columns={columns}
        rows={plans.data ? rows : undefined}
        query={query}
        getRowId={(p) => p.id}
        empty="Chu kỳ chưa có Goal Plan nào. Goal Plan cá nhân được tạo khi HR khởi chạy phiếu đăng ký."
        isFiltered={filtered}
        onClearFilters={() => {
          setTier(ALL);
          setStatus(ALL);
        }}
        toolbar={toolbar}
      />
      {creating && plans.data && units.data && <CreatePlanDialog cycle={cycle} plans={plans.data} units={units.data} onClose={() => setCreating(false)} onCreated={onOpenPlan} />}
    </>
  );
}

function CreatePlanDialog({
  cycle,
  plans,
  units,
  onClose,
  onCreated,
}: {
  cycle: PerformanceCycle;
  plans: GoalPlan[];
  units: NonNullable<ReturnType<typeof useOrgUnits>['data']>;
  onClose: () => void;
  onCreated: (planId: string) => void;
}) {
  const root = units.find((u) => u.parentId === null);
  const hasCompany = plans.some((p) => p.ownerType === 'Company');
  const free = units.filter((u) => u.parentId !== null && u.status === 'Active' && !plans.some((p) => p.ownerType === 'OrgUnit' && p.ownerOrgUnitId === u.id));
  const [tier, setTier] = useState<'Company' | 'OrgUnit'>(hasCompany ? 'OrgUnit' : 'Company');
  const [unitId, setUnitId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateGoalPlan();
  const ownerUnit = tier === 'Company' ? (root?.id ?? null) : unitId || null;

  const onSave = () => {
    setError(null);
    if (!ownerUnit) return;
    create.mutate(
      { cycleId: cycle.id, planType: 'KPI', ownerType: tier, ownerOrgUnitId: ownerUnit, ownerEmployeeId: null },
      {
        onSuccess: (plan) => {
          toastSaved('Đã tạo Goal Plan');
          onClose();
          onCreated(plan.id);
        },
        onError: (e) => setError(e instanceof KpiError ? (firstIssueText(e.issues) ?? null) : null),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tạo Goal Plan · {cycle.name}</DialogTitle>
          <DialogDescription>Goal Plan công ty hoặc bộ phận, ở trạng thái Nháp. Goal Plan cá nhân được tạo khi khởi chạy phiếu đăng ký.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Tầng" required>
            {(control) => (
              <Select value={tier} onValueChange={(v) => setTier(v as 'Company' | 'OrgUnit')}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Company" disabled={hasCompany}>
                    {OWNER_TYPE_LABEL.Company}
                    {hasCompany ? ' (đã có)' : ''}
                  </SelectItem>
                  <SelectItem value="OrgUnit">{OWNER_TYPE_LABEL.OrgUnit}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>
          {tier === 'OrgUnit' && (
            <FormField label="Bộ phận" required hint={free.length === 0 ? 'Mọi bộ phận đã có Goal Plan trong chu kỳ này.' : undefined}>
              {(control) => (
                <Select value={unitId} onValueChange={setUnitId}>
                  <SelectTrigger {...control}>
                    <SelectValue placeholder="Chọn bộ phận" />
                  </SelectTrigger>
                  <SelectContent>
                    {free.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}
          {error && (
            <p role="alert" className="text-sm text-support-negative">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Hủy
          </Button>
          <Button onClick={onSave} disabled={!ownerUnit || create.isPending} aria-busy={create.isPending}>
            Tạo Goal Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create / edit a cycle ─────────────────────────────────────────────────────────────────────

export function CycleFormDialog({ cycle, cycles, onClose, onSaved }: { cycle: PerformanceCycle | null; cycles: PerformanceCycle[]; onClose: () => void; onSaved: (id: string) => void }) {
  const latest = [...cycles].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  const nextYear = latest ? Number(latest.endDate.slice(0, 4)) + 1 : null;
  const [name, setName] = useState(cycle?.name ?? (nextYear ? `KPI ${nextYear}` : ''));
  const [startDate, setStart] = useState(cycle?.startDate ?? (nextYear ? `${nextYear}-01-01` : ''));
  const [endDate, setEnd] = useState(cycle?.endDate ?? (nextYear ? `${nextYear}-12-31` : ''));
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveCycle();
  const issues = cycleIssues({ name, startDate, endDate });
  const fieldIssue = (ref: string) => (submitted ? firstIssueText(issues.filter((i) => i.ref === ref)) : undefined);

  const onSave = () => {
    setSubmitted(true);
    setError(null);
    if (issues.length) return;
    save.mutate(
      { ...(cycle ? { id: cycle.id } : {}), name: name.trim(), startDate, endDate, ratingScaleId: cycle?.ratingScaleId ?? latest?.ratingScaleId ?? null },
      {
        onSuccess: (saved) => {
          toastSaved(cycle ? 'Đã lưu chu kỳ' : 'Đã tạo chu kỳ', cycle ? undefined : 'Tiếp theo: tạo các kỳ đánh giá.');
          onClose();
          onSaved(saved.id);
        },
        onError: (e) => setError(e instanceof KpiError ? (firstIssueText(e.issues) ?? null) : null),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{cycle ? `Sửa ${cycle.name}` : 'Tạo chu kỳ'}</DialogTitle>
          <DialogDescription>
            Chu kỳ mới ở trạng thái "Đang lập kế hoạch". Thang xếp loại giữ như chu kỳ gần nhất (cấu hình ở Kết quả & lương).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Tên chu kỳ" required error={fieldIssue('name')}>
            {(control) => <Input {...control} value={name} onChange={(e) => setName(e.target.value)} />}
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Ngày bắt đầu" required error={fieldIssue('startDate')}>
              {(control) => <Input {...control} type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />}
            </FormField>
            <FormField label="Ngày kết thúc" required error={fieldIssue('endDate')}>
              {(control) => <Input {...control} type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />}
            </FormField>
          </div>
          {error && (
            <p role="alert" className="text-sm text-support-negative">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Hủy
          </Button>
          <Button onClick={onSave} disabled={save.isPending} aria-busy={save.isPending}>
            {cycle ? 'Lưu' : 'Tạo chu kỳ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
