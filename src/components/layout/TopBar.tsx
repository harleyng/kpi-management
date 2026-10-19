import { FlaskConical } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/contexts/useSession';

/**
 * Top bar — the tenant the user is working in, and the "Dữ liệu giả lập" banner.
 *
 * The banner is permanent and deliberately loud (plan §10): this prototype must never be mistaken
 * for the real system, and nobody should type real personnel data into it. It stays visible on
 * every route, including the production deployment.
 *
 * TODO Phase 1.3 — the tenant / user / role switcher sits here, so a demo can walk NV → QL → HR
 * without signing in again.
 */
export function TopBar() {
  const { tenantName, isSimulated } = useSession();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-6">
      <div className="min-w-0 leading-tight">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Công ty</div>
        <div className="truncate text-sm font-semibold">{tenantName}</div>
      </div>

      <div className="flex-1" />

      {isSimulated && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="status"
              tabIndex={0}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-support-warning/40 bg-support-warning-subtle px-3 py-1.5 text-xs font-semibold text-support-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FlaskConical className="h-3.5 w-3.5" aria-hidden />
              Dữ liệu giả lập
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            Bản prototype: dữ liệu và đăng nhập đều giả lập, lưu trong trình duyệt này. Không nhập
            dữ liệu nhân sự thật.
          </TooltipContent>
        </Tooltip>
      )}
    </header>
  );
}
