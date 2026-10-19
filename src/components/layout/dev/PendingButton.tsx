import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';

interface PendingButtonProps extends ButtonProps {
  /** This button's own call is running: spinner, `aria-busy`, disabled. */
  pending?: boolean;
}

/**
 * A demo-toolbar button that shows its own call running. A sibling's call disables it through
 * `disabled` without the spinner, so the spinner always marks the button that was pressed.
 */
export const PendingButton = forwardRef<HTMLButtonElement, PendingButtonProps>(
  ({ pending = false, disabled, children, ...props }, ref) => (
    <Button ref={ref} size="sm" variant="outline" disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
      {children}
    </Button>
  ),
);
PendingButton.displayName = 'PendingButton';
