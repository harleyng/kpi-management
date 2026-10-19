import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Why an action is disabled, as visible text beside it (operate-craft §3 "Blocked action") — a
 * tooltip never fires on a disabled button or on touch. Give the action
 * `aria-describedby={id}` so a screen reader hears the reason with it.
 */
export function BlockedReason({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    // A span, so it may sit inside a field's hint paragraph.
    <span id={id} className={cn('flex items-start gap-1.5 text-xs text-muted-foreground', className)}>
      <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </span>
  );
}
