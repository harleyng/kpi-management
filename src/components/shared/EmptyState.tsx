import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** The sentence itself — a node, because callers often interpolate a search term. */
  children: ReactNode;
  /**
   * What to do NEXT, when there is something to offer: "clear the search", "create one",
   * "back to the list".
   *
   * Left out deliberately where nothing helps — a task inbox with nothing in it is waiting, not
   * stuck, and a button under it would invent an action the user does not have.
   */
  action?: ReactNode;
  className?: string;
}

/**
 * "There is nothing here", written the same way everywhere.
 *
 * Hand-rolled copies of this drift apart (paddings, the gap above the action) without the
 * variation meaning anything — it is the same message in the same voice, so it has one shape. The
 * gap above the action is fixed at `mt-3`; `className` still tunes the padding, because a tight
 * panel and a whole empty page genuinely want different breathing room.
 *
 * A `<div>` wraps a `<p>` rather than being one: an action is a block element, and a `<div>`
 * inside a `<p>` is invalid HTML that the browser silently reparses.
 *
 * NOT `PlaceholderPanel` — that one marks a screen nobody has built yet and names the work package
 * still owing. This one is a built screen truthfully reporting that it has no rows.
 */
export function EmptyState({ children, action, className }: EmptyStateProps) {
  return (
    <div className={cn('py-6 text-center', className)}>
      <p className="text-sm text-muted-foreground">{children}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * The same message when it stands for a whole PAGE rather than a panel.
 *
 * A page-level empty state needs the card, or the sentence floats loose under the header with no
 * surface behind it. `className` reaches the Card.
 */
export function EmptyStateCard({ children, action, className }: EmptyStateProps) {
  return (
    <Card className={className}>
      <CardContent className="p-0">
        <EmptyState className="p-8" action={action}>
          {children}
        </EmptyState>
      </CardContent>
    </Card>
  );
}
