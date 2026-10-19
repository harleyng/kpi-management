import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface SectionTitleProps {
  icon: LucideIcon;
  title: string;
  /** The line under the title — a hint, or the section's current value. */
  children?: ReactNode;
  /** One control at the far edge, aligned to the title. */
  action?: ReactNode;
}

/**
 * A titled section inside a page's body: a primary icon, an `h2`, an optional line under it and an optional
 * action at the far edge. The icon is what marks a TITLE — a sub-heading inside the section goes without one,
 * so the two levels never read as equals.
 */
export function SectionTitle({ icon: Icon, title, children, action }: SectionTitleProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
