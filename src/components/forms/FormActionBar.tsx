import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { toastError } from '@/components/shared/toastError';
import { STEP_ACTION_LABEL, type FormInstance, type PersonFormAction } from '@/data/types';
import { useActOnForm, type UnsavedEdits } from '@/hooks/queries/forms';
import { ERROR_CATALOG, KpiError, type RuleIssue } from '@/lib/errorCatalog';
import type { FormStanding } from '@/lib/formViewRules';
import { FormCommentDialog } from './FormCommentDialog';
import { blockerSentences } from './formCopy';
import { cn } from '@/lib/utils';

const DONE: Record<PersonFormAction, string> = {
  SUBMIT: 'Đã gửi',
  APPROVE: 'Đã duyệt',
  RETURN: 'Đã trả lại',
  CANCEL: 'Đã hủy phiếu',
};
const STALE = ERROR_CATALOG['ERR-KPI-04'];

interface FormActionBarProps {
  form: FormInstance;
  /** Shown in the cancel dialog: "Hủy phiếu 'Đánh giá KPI — Nguyễn Văn An'?". */
  formTitle: string;
  standing: FormStanding;
  /** `canSubmit`'s issues on what is on screen — they block SUBMIT / APPROVE, with the reason beside. */
  blockers: readonly RuleIssue[];
  /** The totals line (computed by the rules in the body). */
  summary?: ReactNode;
  /** Edits not saved yet; saved before SUBMIT / APPROVE in the same mutation. */
  unsaved?: UnsavedEdits;
  /** A value on screen cannot be sent at all (an unreadable %): nothing may be saved or sent. */
  invalid?: boolean;
  /** "Lưu nháp" — present when the step allows EDIT and the body has something to save. */
  saveDraft?: { run: () => void; pending: boolean; dirty: boolean };
  /** A refusal that names rows (`RuleIssue.ref`): the body marks them. */
  onIssues?: (issues: readonly RuleIssue[]) => void;
  /** Move focus to the first row a blocker names. */
  onFocusIssue?: (issue: RuleIssue) => void;
  /** Called after a successful action. */
  onActed?: () => void;
  /** The blocker sentences in the body's own words (a monthly plan counts tasks, not "chỉ tiêu"). Default `blockerSentences`. */
  describeBlockers?: (issues: readonly RuleIssue[]) => string[];
  /**
   * The user has started on the form (an edit, the blocker link, a refusal): blockers read as
   * errors only from then on — an untouched form shows the reason in a neutral tone (ui-ux, T5).
   */
  engaged?: boolean;
}

/**
 * The sticky foot of a form: the totals, the reason a button is disabled, and the step's actions.
 * - Buttons are `standing.actions` — what the step allows AND the user is entitled to now.
 * - SUBMIT / APPROVE save unsaved edits first, then act (one mutation); the bar is disabled meanwhile.
 * - A refusal is never silent: rows it names are marked by the body; a stale step (ERR-KPI-04) leaves
 *   a notice here — the form has already been refetched, the user's unsaved edits are kept.
 */
export function FormActionBar({
  form,
  formTitle,
  standing,
  blockers,
  summary,
  unsaved,
  invalid = false,
  saveDraft,
  onIssues,
  onFocusIssue,
  onActed,
  engaged = false,
  describeBlockers = blockerSentences,
}: FormActionBarProps) {
  const act = useActOnForm();
  const [dialog, setDialog] = useState<'RETURN' | 'CANCEL' | null>(null);
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const busy = act.isPending || (saveDraft?.pending ?? false);
  const forwards = standing.actions.filter((a): a is 'SUBMIT' | 'APPROVE' => a === 'SUBMIT' || a === 'APPROVE');
  const blocked = forwards.length > 0 && blockers.length > 0;

  const run = (action: PersonFormAction, comment: string | null) => {
    if (!form.currentStepId) return;
    const as = action === 'CANCEL' || standing.standing === null ? { onBehalfOfUserId: null, delegationId: null } : standing.standing;
    act.mutate(
      {
        input: { formId: form.id, expectedStepId: form.currentStepId, action, comment, onBehalfOfUserId: as.onBehalfOfUserId, delegationId: as.delegationId },
        unsaved,
      },
      {
        onSuccess: () => {
          setDialog(null);
          setStaleAt(null);
          toast.success(action === 'APPROVE' && standing.step?.evaluationColumn === 'FINAL' ? 'Đã ghi nhận' : DONE[action]);
          setAnnouncement(DONE[action]);
          onActed?.();
        },
        onError: (error) => {
          if (error instanceof KpiError) {
            if (error.code === 'ERR-KPI-04') setStaleAt(form.currentStepId);
            if (error.issues.some((i) => i.ref !== null)) onIssues?.(error.issues);
          }
          toastError(error);
        },
      },
    );
  };

  const returnTo = standing.returnTarget;
  const showStale = staleAt !== null;
  const sentences = describeBlockers(blockers);
  const firstWithRow = blockers.find((b) => b.ref !== null);

  if (standing.actions.length === 0 && !saveDraft && !summary) return null;

  return (
    <div className="sticky bottom-0 z-10 -mx-6 border-t bg-background px-6 py-3">
      {summary && <div className="mb-2 text-sm">{summary}</div>}
      {showStale && (
        <div role="alert" className="mb-2 rounded-md border border-support-warning/40 bg-support-warning-subtle px-3 py-2 text-sm">
          <span className="font-medium">{STALE.title}.</span> {STALE.message}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={cn('min-w-0 flex-1 text-sm', engaged || invalid ? 'text-support-negative' : 'text-muted-foreground')} id={`blockers-${form.id}`}>
          {blocked &&
            sentences.map((s) =>
              firstWithRow && onFocusIssue ? (
                <button key={s} type="button" className="block text-left underline-offset-2 hover:underline" onClick={() => onFocusIssue(firstWithRow)}>
                  {s}
                </button>
              ) : (
                <p key={s}>{s}</p>
              ),
            )}
          {invalid && <p>{ERROR_CATALOG['ERR-KPI-06'].title}. {ERROR_CATALOG['ERR-KPI-06'].message}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {standing.actions.includes('CANCEL') && (
            <Button variant="ghost" className="mr-3 text-support-negative" disabled={busy} onClick={() => setDialog('CANCEL')}>
              {STEP_ACTION_LABEL.CANCEL}
            </Button>
          )}
          {saveDraft && (
            <Button variant="outline" disabled={busy || invalid || !saveDraft.dirty} aria-busy={saveDraft.pending || undefined} onClick={saveDraft.run}>
              Lưu nháp
            </Button>
          )}
          {standing.actions.includes('RETURN') && (
            <Button variant="outline" disabled={busy} onClick={() => setDialog('RETURN')}>
              {STEP_ACTION_LABEL.RETURN}
            </Button>
          )}
          {forwards.map((action) => (
            <Button
              key={action}
              disabled={busy || blocked || invalid}
              aria-busy={act.isPending || undefined}
              aria-describedby={blocked ? `blockers-${form.id}` : undefined}
              onClick={() => run(action, null)}
            >
              {/* HR records the manager's result, it does not approve it (PEND-08). */}
              {action === 'APPROVE' && standing.step?.evaluationColumn === 'FINAL' ? 'Ghi nhận' : STEP_ACTION_LABEL[action]}
            </Button>
          ))}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <FormCommentDialog
        open={dialog === 'RETURN'}
        onOpenChange={(open) => setDialog(open ? 'RETURN' : null)}
        title="Trả lại phiếu"
        body={
          returnTo
            ? `Phiếu sẽ về bước ${returnTo.stepNo} — ${returnTo.name}. Nhập lý do để người xử lý biết cần sửa gì.`
            : 'Nhập lý do để người xử lý biết cần sửa gì.'
        }
        label="Lý do trả lại"
        confirmLabel={STEP_ACTION_LABEL.RETURN}
        pending={act.isPending}
        onConfirm={(comment) => run('RETURN', comment)}
      />
      <FormCommentDialog
        open={dialog === 'CANCEL'}
        onOpenChange={(open) => setDialog(open ? 'CANCEL' : null)}
        title="Hủy phiếu"
        body={`Hủy phiếu "${formTitle}"? Phiếu đóng lại và không thể mở lại.${form.formType === 'GOAL_SETTING' ? ' Goal Plan trở về trạng thái Nháp.' : form.formType === 'WORK_PLAN' ? ' Kế hoạch công việc tháng trở về trạng thái Nháp, các việc đã nhập được giữ lại.' : ''}`}
        label="Lý do hủy phiếu"
        confirmLabel={STEP_ACTION_LABEL.CANCEL}
        destructive
        pending={act.isPending}
        onConfirm={(comment) => run('CANCEL', comment)}
      />
    </div>
  );
}
