import { FlaskConical } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The "Dữ liệu giả lập" banner — permanent and deliberately loud (plan §10, BR-KPI-51): this
 * prototype must never be mistaken for the real system, and nobody should type real personnel data
 * into it. It is on every screen, including the session's loading, error and empty states, which
 * render before the shell exists.
 *
 * Below `lg` the label shortens to "Giả lập" so the top bar keeps the tenant and person switchers;
 * the accessible name stays the full phrase.
 */
export function SimulatedDataBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          tabIndex={0}
          aria-label="Dữ liệu giả lập"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-support-warning/40 bg-support-warning-subtle px-3 py-1.5 text-xs font-semibold text-support-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FlaskConical className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden lg:inline">Dữ liệu giả lập</span>
          <span className="lg:hidden" aria-hidden>
            Giả lập
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        Bản prototype: dữ liệu và đăng nhập đều giả lập, lưu trong trình duyệt này. Không nhập dữ liệu
        nhân sự thật.
      </TooltipContent>
    </Tooltip>
  );
}
