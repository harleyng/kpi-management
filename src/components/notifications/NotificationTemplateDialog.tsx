import { useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { toastError } from '@/components/shared/toastError';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  NOTIFICATION_CHANNEL_LABEL,
  NOTIFICATION_EVENT_LABEL,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationTemplate,
} from '@/data/types';
import { useSaveNotificationTemplate } from '@/hooks/queries/system';
import { KpiError, type RuleIssue } from '@/lib/errorCatalog';
import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  VARIABLES_BY_EVENT,
  renderTemplate,
  templateIssues,
  type NotificationVariable,
} from '@/lib/notificationRules';
import { EVENT_WHEN, VARIABLE_LABEL, previewVars } from './templateCopy';

export interface TemplateSlot {
  eventCode: NotificationEvent;
  channel: NotificationChannel;
  /** `null` = the tenant has no template for this slot yet ("Tạo mẫu"). */
  template: NotificationTemplate | null;
}

type Field = 'subject' | 'body';

/** One field's problem, in words — the rule's `detail` decides which (ERR-KPI-06 is the code). */
function issueMessage(issue: RuleIssue, field: Field): string {
  switch (issue.detail) {
    case 'TEMPLATE_TEXT_REQUIRED':
      return field === 'subject' ? 'Hãy nhập tiêu đề.' : 'Hãy nhập nội dung.';
    case 'TEMPLATE_TEXT_TOO_LONG':
      return `Tối đa ${issue.data?.max ?? ''} ký tự.`;
    case 'TEMPLATE_UNKNOWN_VARIABLE':
      return `Biến {{${issue.data?.variable ?? ''}}} không dùng được cho sự kiện này. Chọn từ danh sách Biến có thể dùng.`;
    case 'TEMPLATE_UNCLOSED_BRACE':
      return 'Còn dấu {{ hoặc }} chưa đóng.';
    default:
      return 'Nội dung chưa hợp lệ.';
  }
}

const fieldError = (issues: readonly RuleIssue[], field: Field) => {
  const issue = issues.find((i) => i.ref === field);
  return issue ? issueMessage(issue, field) : undefined;
};

/**
 * Create or edit one notification template (WBS 4.8.1): subject and body with `{{variables}}`, the
 * variables this event supplies as insert chips, and a live preview on sample data. The rule that
 * refuses a bad template (`templateIssues`) runs as you type; the gateway runs it again on save.
 * Closing with unsaved changes asks first.
 */
export function NotificationTemplateDialog({ slot, onClose }: { slot: TemplateSlot; onClose: () => void }) {
  const [subject, setSubject] = useState(slot.template?.subject ?? '');
  const [body, setBody] = useState(slot.template?.body ?? '');
  const [attempted, setAttempted] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const save = useSaveNotificationTemplate();
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<Field>('body');

  const dirty = subject !== (slot.template?.subject ?? '') || body !== (slot.template?.body ?? '');
  const issues = useMemo(() => templateIssues({ eventCode: slot.eventCode, subject, body }), [slot.eventCode, subject, body]);
  // An unknown variable or an open brace shows as you type; "required" only after a save attempt.
  const shown = attempted ? issues : issues.filter((i) => i.detail !== 'TEMPLATE_TEXT_REQUIRED');
  const variables = VARIABLES_BY_EVENT[slot.eventCode];
  const vars = previewVars();

  const requestClose = () => (dirty && !save.isPending ? setConfirmDiscard(true) : onClose());

  const insert = (name: NotificationVariable) => {
    const field = lastField.current;
    const el = field === 'subject' ? subjectRef.current : bodyRef.current;
    const value = field === 'subject' ? subject : body;
    const token = `{{${name}}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    (field === 'subject' ? setSubject : setBody)(next);
    // Back to the field, caret after the inserted variable.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const submit = () => {
    setAttempted(true);
    if (issues.length > 0) {
      (issues[0].ref === 'subject' ? subjectRef : bodyRef).current?.focus();
      return;
    }
    save.mutate(
      { id: slot.template?.id, eventCode: slot.eventCode, channel: slot.channel, language: 'vi', subject, body },
      {
        onSuccess: () => {
          toast.success('Đã lưu mẫu thông báo.');
          onClose();
        },
        onError: (error) => {
          toastError(error);
          if (error instanceof KpiError && error.issues[0]?.ref === 'subject') subjectRef.current?.focus();
        },
      },
    );
  };

  const subjectError = fieldError(shown, 'subject');
  const bodyError = fieldError(shown, 'body');
  const previewSubject = renderTemplate(subject, vars);
  const previewBody = renderTemplate(body, vars);

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent
          className="flex max-h-[85vh] max-w-3xl flex-col gap-0 p-0"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            subjectRef.current?.focus();
          }}
          onInteractOutside={(e) => save.isPending && e.preventDefault()}
        >
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>
              {slot.template ? 'Sửa mẫu' : 'Tạo mẫu'}: {NOTIFICATION_EVENT_LABEL[slot.eventCode]}
            </DialogTitle>
            <DialogDescription>
              {NOTIFICATION_CHANNEL_LABEL[slot.channel]}. {EVENT_WHEN[slot.eventCode]}
              {slot.channel === 'Email' && ' Giai đoạn này chưa gửi email; mẫu được lưu để dùng sau.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid flex-1 gap-6 overflow-y-auto px-6 py-5 md:grid-cols-2">
            <div className="space-y-4">
              <FormField label="Tiêu đề" required error={subjectError} hint={`Tối đa ${MAX_SUBJECT_LENGTH} ký tự.`}>
                {(control) => (
                  <Input
                    {...control}
                    ref={subjectRef}
                    value={subject}
                    maxLength={MAX_SUBJECT_LENGTH + 50}
                    onChange={(e) => setSubject(e.target.value)}
                    onFocus={() => (lastField.current = 'subject')}
                  />
                )}
              </FormField>
              <FormField label="Nội dung" required error={bodyError}>
                {(control) => (
                  <Textarea
                    {...control}
                    ref={bodyRef}
                    value={body}
                    rows={6}
                    maxLength={MAX_BODY_LENGTH + 100}
                    onChange={(e) => setBody(e.target.value)}
                    onFocus={() => (lastField.current = 'body')}
                  />
                )}
              </FormField>
              <div className="space-y-2">
                <p className="text-sm font-medium">Biến có thể dùng</p>
                <p className="text-xs text-muted-foreground">Bấm để chèn vào vị trí con trỏ của ô đang soạn.</p>
                <ul className="flex flex-wrap gap-1.5">
                  {variables.map((name) => (
                    <li key={name}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 font-mono text-xs"
                            aria-label={`Chèn biến {{${name}}}: ${VARIABLE_LABEL[name]}`}
                            onMouseDown={(e) => e.preventDefault()} // keep the caret in the field
                            onClick={() => insert(name)}
                          >
                            {`{{${name}}}`}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{VARIABLE_LABEL[name]}</TooltipContent>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <section aria-labelledby="template-preview-title" className="space-y-2">
              <h3 id="template-preview-title" className="text-sm font-medium">
                Xem trước (dữ liệu mẫu)
              </h3>
              <div className="space-y-2 rounded-lg border bg-surface-alt p-4">
                {previewSubject ? (
                  <p className="text-sm font-medium">{previewSubject}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Nhập tiêu đề để xem trước.</p>
                )}
                {previewBody && <p className="whitespace-pre-line text-sm text-neutral-60">{previewBody}</p>}
              </div>
              <p className="text-xs text-muted-foreground">
                Biến không có giá trị sẽ để trống, không bao giờ hiện nguyên dạng {'{{…}}'}.
              </p>
            </section>
          </div>

          <DialogFooter className="border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={requestClose} disabled={save.isPending}>
              Hủy
            </Button>
            <Button type="button" onClick={submit} disabled={save.isPending} aria-busy={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Lưu mẫu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Bỏ thay đổi?"
        body="Nội dung bạn vừa sửa chưa được lưu và sẽ mất."
        confirmLabel="Bỏ thay đổi"
        cancelLabel="Tiếp tục sửa"
        destructive
        onConfirm={onClose}
      />
    </>
  );
}
