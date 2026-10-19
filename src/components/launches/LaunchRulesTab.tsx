import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { FormField } from '@/components/shared/FormField';
import { toastError } from '@/components/shared/toastError';
import { PERIOD_TYPES, PERIOD_TYPE_LABEL, type FormLaunchRule, type PeriodType, type RecipientFilter, type RecipientMode } from '@/data/types';
import type { Upsert } from '@/integrations/data/types';
import { useLaunchRules, useSaveLaunchRule, useWorkflows } from '@/hooks/queries/forms';
import { ERROR_CATALOG } from '@/lib/errorCatalog';
import { combineQueries } from '@/lib/queryState';
import { validateLaunchRule } from '@/lib/workflowRules';
import { RecipientFilterFields } from './RecipientFilterFields';
import { EMPTY_RECIPIENT_FILTER, recipientSummary } from './recipients';

const RULE_HINT: Record<string, string> = {
  RULE_KPI_EVAL_ONLY: 'Lịch tự khởi chạy chỉ dành cho phiếu đánh giá KPI.',
  OFFSET_DAYS_INVALID: 'Nhập số ngày nguyên, không âm.',
  DUE_DAYS_INVALID: 'Nhập số ngày nguyên, không âm.',
  FILTER_REQUIRED: 'Chọn điều kiện người nhận.',
};

/**
 * "Lịch tự khởi chạy" (D5, BR-KPI-19): the recurring rules that launch the monthly evaluation by
 * themselves — `PERIOD_END` + N days (`ASSUMPTION Q3`: monthly). Evaluation only (`validateLaunchRule`);
 * a rule fires once per (rule, period) when the scheduler runs.
 */
export function LaunchRulesTab() {
  const rules = useLaunchRules();
  const workflows = useWorkflows('KPI_EVAL');
  const save = useSaveLaunchRule();
  const [editing, setEditing] = useState<FormLaunchRule | 'new' | null>(null);

  const toggle = (rule: FormLaunchRule, isActive: boolean) => {
    const { id, tenantId: _t, ...fields } = rule;
    save.mutate({ ...fields, id, isActive }, { onSuccess: () => toast.success(isActive ? 'Đã bật lịch tự khởi chạy' : 'Đã tắt lịch tự khởi chạy'), onError: toastError });
  };

  const columns: DataTableColumn<FormLaunchRule>[] = [
    { id: 'name', header: 'Tên lịch', cell: (r) => <span className="font-medium">{r.name}</span>, className: 'min-w-[12rem]' },
    { id: 'workflow', header: 'Quy trình', cell: (r) => workflows.data?.find((w) => w.id === r.workflowId)?.name ?? null },
    { id: 'period', header: 'Loại kỳ', cell: (r) => PERIOD_TYPE_LABEL[r.periodType] },
    { id: 'fires', header: 'Khởi chạy', cell: (r) => `${r.offsetDays} ngày sau khi kết thúc kỳ` },
    { id: 'due', header: 'Hạn (ngày)', numeric: true, cell: (r) => r.dueDays },
    { id: 'recipients', header: 'Người nhận', cell: (r) => recipientSummary(r.recipientMode, r.recipientFilter) },
    {
      id: 'active',
      header: 'Đang bật',
      cell: (r) => <Switch checked={r.isActive} disabled={save.isPending} onCheckedChange={(v) => toggle(r, v)} aria-label={`Bật lịch ${r.name}`} />,
    },
    {
      id: 'edit',
      header: 'Thao tác',
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
          Sửa
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        label="Lịch tự khởi chạy"
        columns={columns}
        rows={rules.data}
        query={combineQueries([rules, workflows])}
        getRowId={(r) => r.id}
        empty="Chưa có lịch tự khởi chạy. Thêm lịch để phiếu đánh giá tháng tự gửi sau mỗi kỳ."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden />
            Thêm lịch tự khởi chạy
          </Button>
        }
      />
      {editing !== null && <LaunchRuleDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function LaunchRuleDialog({ rule, onClose }: { rule: FormLaunchRule | null; onClose: () => void }) {
  const workflows = useWorkflows('KPI_EVAL');
  const save = useSaveLaunchRule();
  const [name, setName] = useState(rule?.name ?? 'Đánh giá KPI hằng tháng');
  const [workflowId, setWorkflowId] = useState(rule?.workflowId ?? null);
  const [periodType, setPeriodType] = useState<PeriodType>(rule?.periodType ?? 'Month');
  const [offsetDays, setOffsetDays] = useState(String(rule?.offsetDays ?? 1));
  const [dueDays, setDueDays] = useState(String(rule?.dueDays ?? 7));
  const [mode, setMode] = useState<RecipientMode>(rule?.recipientMode ?? 'ALL');
  const [filter, setFilter] = useState<RecipientFilter>(rule?.recipientFilter ?? EMPTY_RECIPIENT_FILTER);
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const [tried, setTried] = useState(false);

  const workflow = workflows.data?.find((w) => w.id === workflowId) ?? workflows.data?.find((w) => w.isDefault) ?? workflows.data?.[0];
  const asInt = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : Number.NaN);
  const draft: Upsert<FormLaunchRule> = {
    ...(rule ? { id: rule.id } : {}),
    workflowId: workflow?.id ?? '',
    name: name.trim(),
    triggerEvent: 'PERIOD_END',
    periodType,
    offsetDays: asInt(offsetDays),
    dueDays: asInt(dueDays),
    recipientMode: mode,
    recipientFilter: mode === 'FILTER' ? filter : null,
    isActive,
  };
  const issues = validateLaunchRule(draft, workflow?.formType ?? 'KPI_EVAL');
  const hint = (ref: string) => {
    if (!tried) return undefined;
    if (ref === 'name' && draft.name === '') return 'Nhập tên lịch.';
    if (ref === 'workflowId' && !workflow) return 'Chưa có quy trình đánh giá KPI.';
    const issue = issues.find((i) => i.ref === ref);
    return issue ? RULE_HINT[issue.detail ?? ''] : undefined;
  };
  const blocked = issues.length > 0 || draft.name === '' || !workflow;

  const submit = () => {
    setTried(true);
    if (blocked) return;
    save.mutate(draft, {
      onSuccess: () => {
        toast.success(rule ? 'Đã lưu lịch tự khởi chạy' : 'Đã thêm lịch tự khởi chạy');
        onClose();
      },
      onError: toastError,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{rule ? 'Sửa lịch tự khởi chạy' : 'Thêm lịch tự khởi chạy'}</DialogTitle>
          <DialogDescription>Khi một kỳ của chu kỳ đang chạy kết thúc, lịch tự tạo một đợt đánh giá sau số ngày đã chọn.</DialogDescription>
        </DialogHeader>
        {tried && blocked && (
          <p role="alert" className="text-sm text-support-negative">
            {ERROR_CATALOG['ERR-KPI-06'].title}. {ERROR_CATALOG['ERR-KPI-06'].message}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Tên lịch" required error={hint('name')}>
            {(control) => <Input {...control} value={name} onChange={(e) => setName(e.target.value)} />}
          </FormField>
          <FormField label="Quy trình" required error={hint('workflowId')}>
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
          <FormField label="Loại kỳ" required>
            {(control) => (
              <Select value={periodType} onValueChange={(v) => setPeriodType(v as PeriodType)}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {PERIOD_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Khởi chạy sau khi kết thúc kỳ (ngày)" required error={hint('offsetDays')} hint="1 = ngày đầu tiên của kỳ sau.">
            {(control) => <Input {...control} inputMode="numeric" className="tabular" value={offsetDays} onChange={(e) => setOffsetDays(e.target.value)} />}
          </FormField>
          <FormField label="Hạn hoàn thành (số ngày)" required error={hint('dueDays')}>
            {(control) => <Input {...control} inputMode="numeric" className="tabular" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />}
          </FormField>
          <div className="flex items-center gap-2 self-end pb-2">
            <Switch id="rule-active" checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor="rule-active" className="text-sm font-normal">
              Đang bật
            </Label>
          </div>
        </div>
        <RecipientFilterFields mode={mode} filter={filter} onModeChange={setMode} onFilterChange={setFilter} />
        {hint('recipientFilter') && <p className="text-xs text-support-negative">{hint('recipientFilter')}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Quay lại
          </Button>
          <Button onClick={submit} disabled={save.isPending} aria-busy={save.isPending || undefined}>
            {rule ? 'Lưu lịch' : 'Thêm lịch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
