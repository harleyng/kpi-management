import { lazy, Suspense, useId } from 'react';
import { Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { hasDevControls } from '@/hooks/queries/session';
import { hasActiveOverride, useDevStore } from '@/lib/devStore';

// The sections load on first open: the shell carries only the trigger.
const DevToolbarPanel = lazy(() => import('./dev/DevToolbarPanel'));

/**
 * "Công cụ demo" — the mock adapter's controls (simulated clock, latency, failure injection, the
 * scheduler, reseed) in a popover beside the "Dữ liệu giả lập" banner. Rendered whenever the
 * gateway has `dev`, in every build: the Vercel prototype is a demo. A real adapter has no `dev`,
 * and the toolbar is then absent.
 *
 * The trigger says "Đang bật" (a dot AND the word, never the colour alone) while any setting is
 * away from its default, so nobody demos a moved clock or a slow network by accident.
 */
export function DevToolbar() {
  if (!hasDevControls()) return null;
  return <DevToolbarPopover />;
}

function DevToolbarPopover() {
  const active = useDevStore(hasActiveOverride);
  const titleId = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0">
          <Wrench aria-hidden />
          <span className="hidden lg:inline">Công cụ demo</span>
          <span className="sr-only lg:hidden">Công cụ demo</span>
          {active && (
            <span className="inline-flex items-center gap-1.5 font-normal text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-support-warning" aria-hidden />
              Đang bật
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-labelledby={titleId}
        className="max-h-[var(--radix-popover-content-available-height)] w-[22rem] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto text-sm"
      >
        <div>
          <p id={titleId} className="font-semibold">
            Công cụ demo
          </p>
          <p className="text-xs text-muted-foreground">Chỉ có trên dữ liệu giả lập. Không ảnh hưởng hệ thống thật.</p>
        </div>
        <Separator />
        <Suspense fallback={<Skeleton className="h-64 w-full" aria-label="Đang tải" />}>
          <DevToolbarPanel />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}
