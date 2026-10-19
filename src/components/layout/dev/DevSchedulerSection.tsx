import { useId } from 'react';
import { CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { SectionTitle } from '@/components/shared/SectionTitle';
import type { SchedulerReport } from '@/integrations/data/types';
import { useRunScheduler } from '@/hooks/queries/dev';
import { useDevStore } from '@/lib/devStore';
import { PendingButton } from './PendingButton';
import { toastError } from '@/components/shared/toastError';

/** What one tick did, in Vietnamese — only the kinds of work that happened. */
function summarise(report: SchedulerReport): string {
  const parts = [
    report.launchesFired.length && `${report.launchesFired.length} đợt phát hành`,
    report.formsCreated.length && `${report.formsCreated.length} phiếu mới`,
    report.overdueHandled.length && `${report.overdueHandled.length} bước quá hạn đã xử lý`,
    report.remindersDue.length && `${report.remindersDue.length} lời nhắc hạn`,
  ].filter(Boolean);
  return parts.length === 0 ? 'Không có việc nào đến hạn.' : `Đã chạy bộ lập lịch: ${parts.join(', ')}.`;
}

/** Runs the clock-driven jobs for this company now, instead of waiting for a cron. */
export function DevSchedulerSection() {
  const runScheduler = useRunScheduler();
  // With the failure on, the call would only fail — say why instead of letting it.
  const failing = useDevStore((s) => s.failure.enabled);
  const hintId = useId();

  return (
    <section className="space-y-2">
      <SectionTitle icon={CalendarClock} title="Bộ lập lịch">
        Xử lý lịch phát hành, nhắc hạn và quá hạn tính đến giờ giả lập.
      </SectionTitle>
      <PendingButton
        pending={runScheduler.isPending}
        disabled={failing}
        aria-describedby={failing ? hintId : undefined}
        onClick={() => {
          runScheduler.mutateAsync().then((report) => toast.success(summarise(report)), toastError);
        }}
      >
        Chạy bộ lập lịch
      </PendingButton>
      {failing && (
        <p id={hintId} className="text-xs text-muted-foreground">
          Tắt giả lập lỗi để chạy bộ lập lịch.
        </p>
      )}
    </section>
  );
}
