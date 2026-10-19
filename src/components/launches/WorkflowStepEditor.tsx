import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MissingValue } from '@/components/shared/DataTable';
import { toastError } from '@/components/shared/toastError';
import { UnsavedChangesGuard } from '@/components/shared/UnsavedChangesGuard';
import {
  ACTOR_RULE_LABEL,
  EVALUATION_COLUMN_LABEL,
  OVERDUE_BEHAVIOURS,
  OVERDUE_BEHAVIOUR_LABEL,
  STEP_ACTION_LABEL,
  type OverdueBehaviour,
  type WorkflowStep,
  type WorkflowTemplate,
} from '@/data/types';
import { useSaveWorkflow } from '@/hooks/queries/forms';
import { ERROR_CATALOG } from '@/lib/errorCatalog';
import { workflowEditWarnings, type WorkflowEditWarning } from '@/lib/formViewRules';
import { validateWorkflow } from '@/lib/workflowRules';

const NONE = 'none';

const ISSUE_HINT: Record<string, string> = {
  STEPS_REQUIRED: 'Quy trình cần ít nhất một bước.',
  STEP_NUMBERS: 'Các bước phải đánh số liên tục.',
  NO_FORWARD_ACTION: 'Bước cần có thao tác Gửi hoặc Duyệt.',
  RETURN_ON_FIRST_STEP: 'Bước đầu tiên không thể trả lại.',
  RETURN_TARGET_INVALID: 'Bước trả về phải nằm trước bước này.',
  AUTO_FORWARD_ON_LAST_STEP: 'Bước cuối không thể tự chuyển khi quá hạn.',
  LOCK_NOT_ALLOWED: 'Chỉ quy trình đăng ký KPI mới khóa Goal Plan khi quá hạn.',
  SLA_INVALID: 'SLA phải là số ngày nguyên, không âm.',
  REMIND_INVALID: 'Số ngày nhắc phải là số nguyên, không âm.',
  ROLE_REQUIRED: 'Bước theo vai trò cần chọn vai trò.',
  TOO_FEW_STEPS: 'Quy trình đăng ký cần ít nhất 2 bước.',
  OWNER_STEP_REQUIRED: 'Quy trình đăng ký cần một bước của nhân viên.',
};

const WARNING_TEXT: Record<WorkflowEditWarning, string> = {
  APPLIES_NOW: 'Áp dụng ngay cho các phiếu đang ở bước này: hạn bước và xử lý quá hạn tính theo cấu hình mới.',
  LOCK_RELEASED: 'Phiếu đang bị khóa do quá hạn ở bước này sẽ được mở lại.',
  LOCK_ADDED: 'Phiếu đăng ký đã quá hạn ở bước này sẽ khóa Goal Plan ở lần chạy lịch tiếp theo.',
  COMMENT_REQUIRED: 'Lần gửi tiếp theo cần nhận xét cho mọi chỉ tiêu ở bước này.',
};


const intOrNull = (text: string) => (text.trim() === '' ? null : /^\d+$/.test(text.trim()) ? Number(text) : Number.NaN);
const showInt = (v: number | null) => (v === null || Number.isNaN(v) ? '' : String(v));

/**
 * The step editor of one workflow (WBS 4.5.1) — the settings HR may change: name, SLA, what happens
 * when a step runs over, the reminder, a mandatory comment. Who acts and which actions a step allows
 * are fixed in P1 (product owner, T5 phase 1). Steps are not versioned: an edit reaches the forms
 * already in the step, and the screen says how (`workflowEditWarnings`). Key it by the steps' fetch
 * time so a save (or a refetch) starts a fresh draft.
 */
export function WorkflowStepEditor({ workflow, steps, editable }: { workflow: WorkflowTemplate; steps: WorkflowStep[]; editable: boolean }) {
  const save = useSaveWorkflow();
  const [draft, setDraft] = useState<WorkflowStep[]>(steps);
  const textOf = (rows: readonly WorkflowStep[]) => Object.fromEntries(rows.map((s) => [s.id, { sla: showInt(s.slaDays), remind: showInt(s.remindDaysBefore) }]));
  const [text, setText] = useState<Record<string, { sla: string; remind: string }>>(() => textOf(steps));
  const [tried, setTried] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(steps);
  const issues = validateWorkflow(workflow.formType, draft);
  const last = draft.length;

  const update = (id: string, patch: Partial<WorkflowStep>) => setDraft(draft.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const submit = () => {
    setTried(true);
    if (issues.length > 0) return;
    save.mutate(
      {
        workflow: { id: workflow.id, formType: workflow.formType, name: workflow.name, isDefault: workflow.isDefault },
        steps: draft.map(({ tenantId: _t, workflowId: _w, stepNo: _n, ...step }) => step),
      },
      { onSuccess: () => toast.success('Đã lưu quy trình'), onError: toastError },
    );
  };

  return (
    <Card>
      <UnsavedChangesGuard when={editable && dirty} />
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Các bước</h2>
          {editable && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!dirty || save.isPending} onClick={() => {
                  setDraft(steps);
                  setText(textOf(steps));
                  setTried(false);
                }}>
                Hoàn tác
              </Button>
              <Button size="sm" disabled={!dirty || save.isPending} aria-busy={save.isPending || undefined} onClick={submit}>
                Lưu quy trình
              </Button>
            </div>
          )}
        </div>
        {tried && issues.length > 0 && (
          <div role="alert" className="text-sm text-support-negative">
            <p>
              {ERROR_CATALOG['ERR-KPI-06'].title}. {ERROR_CATALOG['ERR-KPI-06'].message}
            </p>
            {issues
              .filter((x) => x.ref === null)
              .map((x) => (
                <p key={x.detail}>{ISSUE_HINT[x.detail ?? ''] ?? ERROR_CATALOG[x.code].title}</p>
              ))}
          </div>
        )}
        <div className="overflow-x-auto">
          <Table aria-label={`Các bước của ${workflow.name}`} className="min-w-[60rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 text-xs">Bước</TableHead>
                <TableHead className="min-w-[14rem] text-xs">Tên bước</TableHead>
                <TableHead className="w-32 text-xs">Người xử lý</TableHead>
                <TableHead className="w-32 text-xs">Thao tác</TableHead>
                <TableHead className="w-20 text-right text-xs">SLA (ngày)</TableHead>
                <TableHead className="w-44 text-xs">Khi quá hạn</TableHead>
                <TableHead className="w-20 text-right text-xs">Nhắc trước (ngày)</TableHead>
                <TableHead className="text-xs">Bắt buộc nhận xét</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.map((s, i) => {
                const original = steps.find((o) => o.id === s.id) ?? s;
                const warnings = workflowEditWarnings(original, s, workflow.formType);
                const stepIssues = tried ? issues.filter((x) => x.ref === s.id) : [];
                // LOCK only on registration, AUTO_FORWARD never on the last step (`validateWorkflow`); a stored value always shows.
                const overdueOptions = OVERDUE_BEHAVIOURS.filter(
                  (b) => b === s.onOverdue || ((b !== 'LOCK' || workflow.formType === 'GOAL_SETTING') && (b !== 'AUTO_FORWARD' || i + 1 < last)),
                );
                return (
                  <TableRow key={s.id} className="align-top hover:bg-surface-alt">
                    <TableCell className="tabular px-3 py-2">{s.stepNo}</TableCell>
                    <TableCell className="px-3 py-2">
                      {editable ? (
                        <Input className="h-8" value={s.name} onChange={(e) => update(s.id, { name: e.target.value })} aria-label={`Tên bước ${s.stepNo}`} />
                      ) : (
                        s.name
                      )}
                      {(warnings.length > 0 || stepIssues.length > 0) && (
                        <ul className="mt-1 space-y-0.5 text-xs">
                          {stepIssues.map((x) => (
                            <li key={x.detail} className="text-support-negative">
                              {ISSUE_HINT[x.detail ?? ''] ?? ERROR_CATALOG[x.code].title}
                            </li>
                          ))}
                          {warnings.map((w) => (
                            <li key={w} className="text-support-warning">
                              {WARNING_TEXT[w]}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2">{ACTOR_RULE_LABEL[s.actorRule]}</TableCell>
                    <TableCell className="px-3 py-2">{s.allowedActions.map((a) => STEP_ACTION_LABEL[a]).join(', ')}</TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      {editable ? (
                        <Input
                          inputMode="numeric"
                          className="tabular h-8 text-right"
                          value={text[s.id]?.sla ?? ''}
                          onChange={(e) => {
                            setText({ ...text, [s.id]: { ...text[s.id], sla: e.target.value } });
                            update(s.id, { slaDays: intOrNull(e.target.value) });
                          }}
                          aria-label={`SLA bước ${s.stepNo} (ngày)`}
                        />
                      ) : (
                        <span className="tabular">{s.slaDays ?? <MissingValue />}</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      {editable ? (
                        <Select value={s.onOverdue ?? NONE} onValueChange={(v) => update(s.id, { onOverdue: v === NONE ? null : (v as OverdueBehaviour) })}>
                          <SelectTrigger className="h-8" aria-label={`Khi quá hạn — bước ${s.stepNo}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Không xử lý</SelectItem>
                            {overdueOptions.map((b) => (
                              <SelectItem key={b} value={b}>
                                {OVERDUE_BEHAVIOUR_LABEL[b]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : s.onOverdue ? (
                        OVERDUE_BEHAVIOUR_LABEL[s.onOverdue]
                      ) : (
                        <MissingValue />
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      {editable ? (
                        <Input
                          inputMode="numeric"
                          className="tabular h-8 text-right"
                          value={text[s.id]?.remind ?? ''}
                          onChange={(e) => {
                            setText({ ...text, [s.id]: { ...text[s.id], remind: e.target.value } });
                            update(s.id, { remindDaysBefore: intOrNull(e.target.value) });
                          }}
                          aria-label={`Nhắc trước hạn bước ${s.stepNo} (ngày)`}
                        />
                      ) : (
                        <span className="tabular">{s.remindDaysBefore ?? <MissingValue />}</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      {s.evaluationColumn === null ? (
                        <span className="text-muted-foreground">Không áp dụng</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Switch
                            checked={s.requiresComment}
                            disabled={!editable}
                            onCheckedChange={(v) => update(s.id, { requiresComment: v })}
                            aria-label={`Bắt buộc nhận xét — ${EVALUATION_COLUMN_LABEL[s.evaluationColumn]}`}
                          />
                          <span className="text-xs text-muted-foreground">{EVALUATION_COLUMN_LABEL[s.evaluationColumn]}</span>
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
