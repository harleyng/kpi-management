import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FormStatusSelect, FormTypeSelect } from '@/components/forms/FormFilters';
import { FormsTable } from '@/components/forms/FormsTable';
import { useFormLookups } from '@/components/forms/useFormLookups';
import { useSession } from '@/contexts/useSession';
import type { FormStatus, FormType, Id } from '@/data/types';
import { useForms, useInbox } from '@/hooks/queries/forms';
import { useAllPeriods } from '@/hooks/queries/goals';
import { useGatewayClock } from '@/hooks/queries/session';
import { stepTiming } from '@/lib/formViewRules';
import { resourceOfSubject } from '@/lib/permissionRules';
import { combineQueries } from '@/lib/queryState';

/** A team's forms over a cycle fit one page; the gateway caps a page at 500. */
const TEAM_FORMS_LIMIT = 500;
const ALL = 'all';

/**
 * "Duyệt & đánh giá" (WBS 4.5.2–4.5.4) — the forms of the people in the manager's scope: registrations
 * to approve or return, adjustments to approve, evaluations to score. Opening one goes to the form;
 * what the manager may do there is the step's question, not this list's.
 * The scope filter here is a convenience, not a boundary: reads are tenant-wide until Phase 5's RLS.
 */
export default function TeamReviewsPage() {
  const { tenantId, user, can } = useSession();
  const lookups = useFormLookups();
  const clock = useGatewayClock();
  const periods = useAllPeriods();
  const inbox = useInbox();
  const [type, setType] = useState<FormType | null>(null);
  const [status, setStatus] = useState<FormStatus | null>(null);
  const [periodId, setPeriodId] = useState<Id | null>(null);
  const [waitingOnMe, setWaitingOnMe] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const subjects = useMemo(
    () =>
      (lookups.directory?.employees ?? [])
        .filter((e) => e.id !== user.employeeId && can('goalplan.view', resourceOfSubject(tenantId, e.id)))
        .map((e) => e.id)
        .sort(),
    [lookups.directory, user.employeeId, can, tenantId],
  );
  const forms = useForms(
    { subjectEmployeeIds: subjects, ...(type ? { formType: type } : {}), ...(status ? { status } : {}), ...(periodId ? { periodId } : {}) },
    { limit: TEAM_FORMS_LIMIT },
    { enabled: lookups.directory !== undefined && subjects.length > 0 },
  );
  const mine = useMemo(() => new Set(inbox.data?.map((f) => f.id) ?? []), [inbox.data]);
  const rows = forms.data?.items.filter((f) => (!waitingOnMe || mine.has(f.id)) && (!overdueOnly || stepTiming(f, lookups.steps, clock).overdue));
  const filtered = type !== null || status !== null || periodId !== null || waitingOnMe || overdueOnly;
  const clear = () => {
    setType(null);
    setStatus(null);
    setPeriodId(null);
    setWaitingOnMe(false);
    setOverdueOnly(false);
  };

  const header = <PageHeader title="Duyệt & đánh giá" description="Duyệt Goal Plan, duyệt điều chỉnh và chấm phiếu đánh giá KPI của nhân viên." />;
  if (lookups.directory && subjects.length === 0) {
    return (
      <>
        {header}
        <EmptyStateCard>Bạn chưa có nhân viên trong phạm vi quản lý.</EmptyStateCard>
      </>
    );
  }

  const monthPeriods = (periods.data ?? []).filter((p) => p.periodType === 'Month').sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const toolbar = (
    <>
      <FormTypeSelect value={type} onChange={setType} />
      <FormStatusSelect value={status} onChange={setStatus} />
      <Select value={periodId ?? ALL} onValueChange={(v) => setPeriodId(v === ALL ? null : v)}>
        <SelectTrigger className="h-8 w-36" aria-label="Kỳ đánh giá">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Mọi kỳ</SelectItem>
          {monthPeriods.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label} ({lookups.cycle(p.cycleId)?.name ?? ''})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Switch id="team-mine" checked={waitingOnMe} onCheckedChange={setWaitingOnMe} />
        <Label htmlFor="team-mine" className="text-sm font-normal">
          Chờ tôi xử lý
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="team-overdue" checked={overdueOnly} onCheckedChange={setOverdueOnly} />
        <Label htmlFor="team-overdue" className="text-sm font-normal">
          Quá hạn
        </Label>
      </div>
    </>
  );

  return (
    <>
      {header}
      <div className="space-y-2">
        <FormsTable
          label="Phiếu của nhân viên"
          rows={rows}
          query={combineQueries([forms, inbox])}
          atMyStep={mine}
          empty="Nhân viên của bạn chưa có phiếu nào. Phiếu sẽ hiện ở đây khi HR khởi chạy đăng ký hoặc đánh giá."
          toolbar={toolbar}
          isFiltered={filtered}
          onClearFilters={clear}
          pageResetKey={`${type}|${status}|${periodId}|${waitingOnMe}|${overdueOnly}`}
        />
        {forms.data?.nextCursor && <p className="text-xs text-muted-foreground">Hiển thị {TEAM_FORMS_LIMIT} phiếu mới nhất. Lọc theo kỳ để xem phiếu cũ hơn.</p>}
      </div>
    </>
  );
}
