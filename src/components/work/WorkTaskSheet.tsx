import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { EditSheet } from '@/components/shared/EditSheet';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import type { CyclePeriod, GoalVisibility, WorkTask } from '@/data/types';
import type { WorkTaskInput } from '@/integrations/data/types';
import { formatDecimalInput, parseDecimalInput } from '@/lib/numberInput';
import { totalTaskWeight } from '@/lib/workRules';
import { formatPercent } from '@/lib/utils';
import { monthText } from './workCopy';

interface Draft {
  name: string;
  product: string;
  description: string;
  unitText: string;
  weight: string;
  startDate: string;
  dueDate: string;
  visibility: GoalVisibility;
}

const blankDraft = (period: Pick<CyclePeriod, 'startDate' | 'endDate'>): Draft => ({
  name: '',
  product: '',
  description: '',
  unitText: '',
  weight: '',
  startDate: period.startDate,
  dueDate: period.endDate,
  visibility: 'PUBLIC',
});

const draftOf = (t: WorkTask): Draft => ({
  name: t.name,
  product: t.product ?? '',
  description: t.description ?? '',
  unitText: t.unitText ?? '',
  weight: formatDecimalInput(t.weight),
  startDate: t.startDate,
  dueDate: t.dueDate,
  visibility: t.visibility,
});

const text = (s: string) => (s.trim() === '' ? null : s.trim());

interface WorkTaskSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task edited, or `null` to add one. */
  task: WorkTask | null;
  /** Every task of the plan, as stored (for the live weight total). */
  tasks: readonly WorkTask[];
  period: Pick<CyclePeriod, 'startDate' | 'endDate'>;
  /** Sends the whole list with this task added / changed; resolves when saved, rejects with the gateway's refusal. */
  onSave: (input: WorkTaskInput) => Promise<void>;
  saving: boolean;
  /** The refusal of the last save, in words. */
  problems: readonly string[];
}

/**
 * Add or edit one monthly task (HR guide pp. 25–26). Each save sends the plan's whole list
 * (`work.saveWorkTasks`) — there is no draft: "Lưu" commits, "Lưu và thêm việc khác" commits and
 * opens a blank form. Dates start on the month and are bounded by it (a carried-over task may start
 * earlier — `ASSUMPTION Q68` — so only the end is kept inside the month's year).
 */
export function WorkTaskSheet({ open, onOpenChange, task, tasks, period, onSave, saving, problems }: WorkTaskSheetProps) {
  const [draft, setDraft] = useState<Draft>(() => (task ? draftOf(task) : blankDraft(period)));
  const [touched, setTouched] = useState(false);
  const [again, setAgain] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(task ? draftOf(task) : blankDraft(period));
      setTouched(false);
    }
  }, [open, task, period]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setTouched(true);
  };

  const weight = parseDecimalInput(draft.weight);
  const nameError = touched && draft.name.trim() === '' ? 'Nhập tên công việc.' : undefined;
  const weightError = draft.weight !== '' && (weight === null || !Number.isFinite(weight) || weight <= 0) ? 'Trọng số là một số lớn hơn 0, ví dụ 25 hoặc 12,5.' : undefined;
  const datesError = draft.dueDate !== '' && draft.startDate !== '' && draft.dueDate < draft.startDate ? 'Ngày kết thúc đứng trước ngày bắt đầu.' : undefined;
  const complete = draft.name.trim() !== '' && weight !== null && Number.isFinite(weight) && weight > 0 && draft.startDate !== '' && draft.dueDate !== '' && !datesError;

  const others = tasks.filter((t) => t.id !== task?.id);
  const totalAfter = totalTaskWeight([...others, { id: 'draft', weight: weight !== null && Number.isFinite(weight) ? weight : 0, cancelledAt: null }]);

  const submit = (more: boolean) => {
    setTouched(true);
    if (!complete || weight === null) return;
    setAgain(more);
    const input: WorkTaskInput = {
      ...(task ? { id: task.id } : {}),
      name: draft.name.trim(),
      product: text(draft.product),
      description: text(draft.description),
      unitText: text(draft.unitText),
      weight,
      startDate: draft.startDate,
      dueDate: draft.dueDate,
      visibility: draft.visibility,
      linkedGoalId: task?.linkedGoalId ?? null,
    };
    void onSave(input).then(
      () => {
        if (more) {
          setDraft(blankDraft(period));
          setTouched(false);
        } else onOpenChange(false);
      },
      () => undefined,
    );
  };

  return (
    <EditSheet
      open={open}
      onOpenChange={onOpenChange}
      title={task ? 'Sửa việc' : 'Thêm việc'}
      description={`Kế hoạch công việc tháng ${monthText(period)}. Thay đổi được lưu ngay khi bấm Lưu.`}
      dirty={touched}
      onSubmit={() => submit(false)}
      submitLabel="Lưu"
      submitting={saving && !again}
      problems={problems}
      footerStart={
        task ? undefined : (
          <Button type="button" variant="outline" disabled={saving} aria-busy={(saving && again) || undefined} onClick={() => submit(true)}>
            Lưu và thêm việc khác
          </Button>
        )
      }
    >
      <RequiredLegend />
      <FormField label="Tên công việc" required error={nameError}>
        {(c) => <Input {...c} value={draft.name} onChange={(e) => set('name', e.target.value)} autoFocus />}
      </FormField>
      <FormField label="Sản phẩm / quy trình">
        {(c) => <Input {...c} value={draft.product} onChange={(e) => set('product', e.target.value)} />}
      </FormField>
      <FormField label="Mô tả">
        {(c) => <Textarea {...c} rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Đơn vị đo" hint="Ví dụ: hợp đồng, báo cáo, khách hàng.">
          {(c) => <Input {...c} value={draft.unitText} onChange={(e) => set('unitText', e.target.value)} />}
        </FormField>
        <FormField
          label="Trọng số (%)"
          required
          error={weightError}
          hint={<span aria-live="polite">Sau khi lưu, tổng trọng số là {formatPercent(totalAfter)}.</span>}
        >
          {(c) => <Input {...c} inputMode="decimal" value={draft.weight} onChange={(e) => set('weight', e.target.value)} className="tabular" />}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Ngày bắt đầu" required hint={`Trong tháng ${monthText(period)}, hoặc trước đó với việc chuyển từ tháng trước.`}>
          {(c) => <Input {...c} type="date" max={period.endDate} value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} />}
        </FormField>
        <FormField label="Ngày kết thúc" required error={datesError}>
          {(c) => <Input {...c} type="date" min={period.startDate} value={draft.dueDate} onChange={(e) => set('dueDate', e.target.value)} />}
        </FormField>
      </div>
      <FormField label="Hiển thị" hint="Việc riêng tư: chỉ bạn và quản lý trực tiếp thấy tên và mô tả.">
        {(c) => (
          <Select value={draft.visibility} onValueChange={(v) => set('visibility', v as GoalVisibility)}>
            <SelectTrigger {...c}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PUBLIC">Công khai</SelectItem>
              <SelectItem value="PRIVATE">Riêng tư</SelectItem>
            </SelectContent>
          </Select>
        )}
      </FormField>
    </EditSheet>
  );
}
