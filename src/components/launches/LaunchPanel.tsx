import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { toastError } from '@/components/shared/toastError';
import { useSession } from '@/contexts/useSession';
import { FORM_TYPE_LABEL, LAUNCH_TIMING_LABEL, type FormLaunch, type FormType, type Id, type RecipientFilter, type RecipientMode } from '@/data/types';
import type { NewLaunchInput } from '@/integrations/data/types';
import { useCreateLaunch, useWorkflows } from '@/hooks/queries/forms';
import { useCycles, usePeriods } from '@/hooks/queries/goals';
import { useGatewayClock } from '@/hooks/queries/session';
import { ERROR_CATALOG } from '@/lib/errorCatalog';
import { cycleAllowsLaunch } from '@/lib/cycleRules';
import { addDaysToInstant, fromZonedLocalInput, toZonedLocalInput } from '@/lib/isoDate';
import { formatDate, formatDateTime } from '@/lib/utils';
import { launchDueDate, launchTimingIssues, validateLaunch } from '@/lib/workflowRules';
import { RecipientFilterFields } from './RecipientFilterFields';
import { EMPTY_RECIPIENT_FILTER } from './recipients';

/** A launch is HR's for registration and evaluation; an adjustment is started by hand (BR-KPI-15). */
const LAUNCHABLE: readonly FormType[] = ['KPI_EVAL', 'GOAL_SETTING'];
const DEFAULT_DUE_DAYS = 7; // HR guide p. 92 — "7 ngày sau ngày khởi chạy"

/** The field each `validateLaunch` / `launchTimingIssues` detail belongs to, and what to say there. */
const ISSUE_FIELD: Record<string, { field: string; hint: string }> = {
  PERIOD_REQUIRED: { field: 'period', hint: 'Chọn kỳ đánh giá.' },
  CYCLE_REQUIRED: { field: 'cycle', hint: 'Chọn chu kỳ.' },
  DUE_DAYS_INVALID: { field: 'dueDays', hint: 'Nhập số ngày nguyên, không âm.' },
  FILTER_REQUIRED: { field: 'recipients', hint: 'Chọn điều kiện người nhận.' },
  SCHEDULE_INVALID: { field: 'scheduledAt', hint: 'Chọn ngày giờ khởi chạy.' },
  SCHEDULE_IN_PAST: { field: 'scheduledAt', hint: 'Thời điểm khởi chạy phải sau hiện tại.' },
};

/**
 * "Tạo đợt khởi chạy" (plan §5.4, D5, BR-KPI-19) — an inline panel on the launches tab, not a modal:
 * the recipient filter is too tall for one (ui-ux, T5 phase 2). The checks the gateway runs
 * (`validateLaunch`, `launchTimingIssues`) run here first; a cycle that does not accept the form type
 * is not offered (`cycleAllowsLaunch`).
 */
export function LaunchPanel({ onDone }: { onDone: (launch: FormLaunch | null) => void }) {
  const { tenant } = useSession();
  const clock = useGatewayClock();
  const create = useCreateLaunch();
  const cycles = useCycles();
  const [formType, setFormType] = useState<FormType>('KPI_EVAL');
  const workflows = useWorkflows(formType);
  const [workflowId, setWorkflowId] = useState<Id | null>(null);
  const [name, setName] = useState('');
  const [timing, setTiming] = useState<'NOW' | 'SCHEDULED'>('NOW');
  const [scheduledLocal, setScheduledLocal] = useState(() => toZonedLocalInput(addDaysToInstant(clock.now, 1, tenant.timezone), tenant.timezone));
  const [cycleId, setCycleId] = useState<Id | null>(null);
  const [periodId, setPeriodId] = useState<Id | null>(null);
  const [dueDays, setDueDays] = useState(String(DEFAULT_DUE_DAYS));
  const [mode, setMode] = useState<RecipientMode>('ALL');
  const [filter, setFilter] = useState<RecipientFilter>(EMPTY_RECIPIENT_FILTER);
  const [tried, setTried] = useState(false);
  const periods = usePeriods(cycleId);

  const workflow = workflows.data?.find((w) => w.id === workflowId) ?? workflows.data?.find((w) => w.isDefault) ?? workflows.data?.[0];
  const openCycles = (cycles.data ?? []).filter((c) => cycleAllowsLaunch(c, formType).ok);
  const due = /^\d+$/.test(dueDays.trim()) ? Number(dueDays) : Number.NaN;
  const scheduledAt = timing === 'SCHEDULED' ? fromZonedLocalInput(scheduledLocal, tenant.timezone) : clock.now;
  const evaluation = formType === 'KPI_EVAL';
  const recipientFilter = mode === 'FILTER' ? filter : null;

  const issues = [
    ...validateLaunch({ formType, periodId: evaluation ? periodId : null, cycleId, dueDays: due, recipientMode: mode, recipientFilter }),
    ...launchTimingIssues({ timing, scheduledAt: scheduledAt ?? '' }, clock),
  ];
  const hint = (field: string) => {
    if (!tried) return undefined;
    if (field === 'name' && name.trim() === '') return 'Nhập tên đợt khởi chạy.';
    if (field === 'workflow' && !workflow) return 'Chưa có quy trình cho loại phiếu này.';
    return issues.map((i) => ISSUE_FIELD[i.detail ?? '']).find((m) => m?.field === field)?.hint;
  };
  const blocked = issues.length > 0 || name.trim() === '' || !workflow;

  const submit = () => {
    setTried(true);
    if (blocked || !workflow) return;
    const base = { workflowId: workflow.id, name: name.trim(), cycleId, periodId: evaluation ? periodId : null, dueDays: due, recipientMode: mode, recipientFilter };
    const input: NewLaunchInput = timing === 'NOW' ? { ...base, timing: 'NOW' } : { ...base, timing: 'SCHEDULED', scheduledAt: scheduledAt! };
    create.mutate(input, {
      onSuccess: (launch) => {
        toast.success('Đã tạo đợt khởi chạy', {
          description: launch.status === 'Launched' ? 'Phiếu đã được gửi tới người nhận.' : `Đợt sẽ khởi chạy lúc ${formatDateTime(launch.scheduledAt)}.`,
        });
        onDone(launch);
      },
      onError: toastError,
    });
  };

  const changeType = (next: FormType) => {
    setFormType(next);
    setWorkflowId(null);
    setCycleId(null);
    setPeriodId(null);
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Tạo đợt khởi chạy</h2>
          <RequiredLegend />
        </div>
        {tried && blocked && (
          <p role="alert" className="text-sm text-support-negative">
            {ERROR_CATALOG['ERR-KPI-06'].title}. {ERROR_CATALOG['ERR-KPI-06'].message}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-4">
          <FormField label="Loại phiếu" required>
            {(control) => (
              <Select value={formType} onValueChange={(v) => changeType(v as FormType)}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LAUNCHABLE.map((t) => (
                    <SelectItem key={t} value={t}>
                      {FORM_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Quy trình" required error={hint('workflow')}>
            {(control) => (
              <Select value={workflow?.id} onValueChange={setWorkflowId}>
                <SelectTrigger {...control}>
                  <SelectValue placeholder="Chọn quy trình" />
                </SelectTrigger>
                <SelectContent>
                  {(workflows.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Tên đợt" required error={hint('name')} className="md:col-span-2">
            {(control) => <Input {...control} value={name} onChange={(e) => setName(e.target.value)} placeholder="Đánh giá KPI tháng 04/2027" />}
          </FormField>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <FormField label="Chu kỳ" required error={hint('cycle')}>
            {(control) => (
              <Select
                value={cycleId ?? undefined}
                onValueChange={(v) => {
                  setCycleId(v);
                  setPeriodId(null);
                }}
              >
                <SelectTrigger {...control}>
                  <SelectValue placeholder={openCycles.length ? 'Chọn chu kỳ' : 'Không có chu kỳ đang mở'} />
                </SelectTrigger>
                <SelectContent>
                  {openCycles.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          {evaluation && (
            <FormField label="Kỳ đánh giá" required error={hint('period')}>
              {(control) => (
                <Select value={periodId ?? undefined} onValueChange={setPeriodId} disabled={cycleId === null}>
                  <SelectTrigger {...control}>
                    <SelectValue placeholder={cycleId ? 'Chọn kỳ' : 'Chọn chu kỳ trước'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(periods.data ?? [])
                      .slice()
                      .sort((a, b) => (a.startDate === b.startDate ? a.periodType.localeCompare(b.periodType) : a.startDate < b.startDate ? -1 : 1))
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}
          <FormField label="Thời điểm" required>
            {(control) => (
              <Select value={timing} onValueChange={(v) => setTiming(v as 'NOW' | 'SCHEDULED')}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NOW">{LAUNCH_TIMING_LABEL.NOW}</SelectItem>
                  <SelectItem value="SCHEDULED">{LAUNCH_TIMING_LABEL.SCHEDULED}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>
          {timing === 'SCHEDULED' && (
            <FormField label="Khởi chạy lúc" required error={hint('scheduledAt')}>
              {(control) => <Input {...control} type="datetime-local" value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} />}
            </FormField>
          )}
          <FormField
            label="Hạn hoàn thành (số ngày)"
            required
            error={hint('dueDays')}
            hint={Number.isInteger(due) && due >= 0 && scheduledAt ? `Hạn: ${formatDate(launchDueDate(scheduledAt, due, tenant.timezone))}` : undefined}
          >
            {(control) => <Input {...control} inputMode="numeric" className="tabular" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />}
          </FormField>
        </div>

        <RecipientFilterFields mode={mode} filter={filter} onModeChange={setMode} onFilterChange={setFilter} />
        {hint('recipients') && <p className="text-xs text-support-negative">{hint('recipients')}</p>}

        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background px-4 pt-3">
          <Button variant="outline" onClick={() => onDone(null)}>
            Bỏ qua
          </Button>
          <Button onClick={submit} disabled={create.isPending} aria-busy={create.isPending || undefined}>
            {timing === 'NOW' ? 'Khởi chạy' : 'Lên lịch'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
