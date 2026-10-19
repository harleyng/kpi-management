import { useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from './ConfirmDialog';

interface EditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Unsaved edits: closing asks "Bỏ thay đổi chưa lưu?" first. */
  dirty: boolean;
  /** The form's submit. Omit for a sheet with no form of its own (its sections save themselves). */
  onSubmit?: () => void;
  submitLabel?: string;
  submitting?: boolean;
  /** Sentences that block the submit or name no field — shown above the actions, announced. */
  problems?: readonly string[];
  /** `wide` for a record with sections (an employee: profile + assignments). */
  wide?: boolean;
  /** Extra actions on the left of the footer ("Cho nghỉ việc"). */
  footerStart?: ReactNode;
  children: ReactNode;
}

/**
 * The side sheet every T1 editor uses — a record edited beside the list it came from (operate-craft
 * §3: a sheet, not a modal). The footer stays at the bottom while the body scrolls; closing with
 * unsaved edits confirms first; Radix returns focus to the control that opened it.
 */
export function EditSheet({
  open,
  onOpenChange,
  title,
  description,
  dirty,
  onSubmit,
  submitLabel = 'Lưu thay đổi',
  submitting = false,
  problems = [],
  wide = false,
  footerStart,
  children,
}: EditSheetProps) {
  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = (next: boolean) => {
    if (!next && dirty && !submitting) setConfirmClose(true);
    else onOpenChange(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit?.();
  };

  return (
    <>
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent className={cn('gap-0 p-0', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
          <form onSubmit={submit} className="flex h-full min-h-0 flex-col" noValidate>
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              {description && <SheetDescription>{description}</SheetDescription>}
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">{children}</div>
            {problems.length > 0 && (
              <ul role="alert" className="space-y-1 border-t bg-support-negative-subtle px-5 py-2 text-sm text-support-negative">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <SheetFooter className="items-center">
              {footerStart && <div className="mr-auto flex gap-2">{footerStart}</div>}
              <Button type="button" variant="outline" onClick={() => requestClose(false)}>
                {onSubmit ? 'Hủy' : 'Đóng'}
              </Button>
              {onSubmit && (
                <Button type="submit" disabled={submitting} aria-busy={submitting || undefined}>
                  {submitting && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
                  {submitLabel}
                </Button>
              )}
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Bỏ thay đổi chưa lưu?"
        body="Các thay đổi trong biểu mẫu này sẽ mất."
        confirmLabel="Bỏ thay đổi"
        cancelLabel="Tiếp tục sửa"
        destructive
        onConfirm={() => {
          setConfirmClose(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
