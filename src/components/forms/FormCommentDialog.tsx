import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface FormCommentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What happens next, in a sentence — the dialog's description. */
  body: string;
  label: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: (comment: string) => void;
}

/**
 * The reason a RETURN or CANCEL requires (BR-KPI-23; `workflowRules` refuses a blank one with
 * ERR-KPI-06 too). Radix returns focus to the button that opened it.
 */
export function FormCommentDialog({ open, onOpenChange, title, body, label, confirmLabel, destructive = false, pending = false, onConfirm }: FormCommentDialogProps) {
  const id = useId();
  const [comment, setComment] = useState('');
  const [tried, setTried] = useState(false);
  const blank = comment.trim() === '';

  const close = (next: boolean) => {
    if (!next) {
      setComment('');
      setTried(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={id}>
            {label}
            <span aria-hidden className="ml-0.5 text-support-negative">
              *
            </span>
            <span className="sr-only"> (bắt buộc)</span>
          </Label>
          <Textarea
            id={id}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            aria-required
            aria-invalid={tried && blank ? true : undefined}
            aria-describedby={tried && blank ? `${id}-error` : undefined}
          />
          {tried && blank && (
            <p id={`${id}-error`} role="alert" className="text-xs text-support-negative">
              Lý do là bắt buộc.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Quay lại
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() => {
              setTried(true);
              if (!blank) onConfirm(comment.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
