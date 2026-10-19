import type { ReactNode } from 'react';
import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const TONES = {
  info: { icon: Info, box: 'border-support-info/30 bg-support-info-subtle', iconClass: 'text-support-info' },
  warning: { icon: AlertTriangle, box: 'border-support-warning/40 bg-support-warning-subtle', iconClass: 'text-support-warning' },
  negative: { icon: XCircle, box: 'border-support-negative/30 bg-support-negative-subtle', iconClass: 'text-support-negative' },
} as const;

/**
 * A short notice inside a panel — why an action is blocked, what a preview means. Full 1px border on a
 * tinted surface (never a thick coloured stripe); the icon never carries the meaning alone.
 * `role="alert"` only for something that just went wrong; otherwise a plain note.
 */
export function InlineNotice({
  tone,
  title,
  children,
  alert = false,
  className,
}: {
  tone: keyof typeof TONES;
  title: string;
  children?: ReactNode;
  alert?: boolean;
  className?: string;
}) {
  const { icon: Icon, box, iconClass } = TONES[tone];
  return (
    <div role={alert ? 'alert' : 'note'} className={cn('flex gap-2.5 rounded-md border px-3 py-2.5 text-sm', box, className)}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconClass)} aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {children && <div className="text-foreground/80">{children}</div>}
      </div>
    </div>
  );
}
