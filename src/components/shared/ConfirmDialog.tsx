/**
 * Confirmation before an action that cannot be taken back — locking a Goal Plan, finalising a
 * period's results, returning a form to the previous step, deleting a library KPI.
 *
 * The body text names what is lost or what happens next rather than asking "bạn có chắc không?" —
 * a dialog that does not say what it is about to do gets dismissed without being read.
 *
 * `destructive` is not decoration: an action that REMOVES something and one that merely moves a
 * form forward must not look alike, so approving confirms in the default colour while deleting
 * confirms in red.
 */
import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  /** What exactly changes, under the body — a list ("Thêm: …", "Bỏ: …"). */
  details?: ReactNode;
  confirmLabel: string;
  /** Defaults to "Hủy". Name the opposite of the action when "Hủy" would be ambiguous. */
  cancelLabel?: string;
  /** Red action. Defaults to `false`. */
  destructive?: boolean;
  /**
   * Refuse the action while keeping the dialog — for a case the rules will not allow (a Goal Plan
   * whose weights do not sum to 100%). The body says what is in the way.
   */
  confirmDisabled?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  details,
  confirmLabel,
  cancelLabel = 'Hủy',
  destructive = false,
  confirmDisabled = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {details && <div className="text-sm">{details}</div>}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
