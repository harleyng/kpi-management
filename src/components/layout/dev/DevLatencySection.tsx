import { Timer } from 'lucide-react';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { useSetLatency } from '@/hooks/queries/dev';
import { LATENCY_CHOICES, useDevStore } from '@/lib/devStore';
import { PendingButton } from './PendingButton';
import { toastError } from '@/components/shared/toastError';

const LABELS: Record<(typeof LATENCY_CHOICES)[number], string> = {
  0: 'Không (0 ms)',
  150: '150 ms',
  1000: '1000 ms',
};

/** How long every gateway call waits — to see the loading states. */
export function DevLatencySection() {
  const latencyMs = useDevStore((s) => s.latencyMs);
  const setLatency = useSetLatency();

  return (
    <section className="space-y-2">
      <SectionTitle icon={Timer} title="Độ trễ phản hồi">
        Để kiểm tra trạng thái đang tải.
      </SectionTitle>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Độ trễ phản hồi">
        {LATENCY_CHOICES.map((ms) => {
          const pressed = latencyMs === ms;
          return (
            <PendingButton
              key={ms}
              aria-pressed={pressed}
              className="tabular aria-pressed:border-primary aria-pressed:bg-primary-subtle aria-pressed:text-primary"
              pending={setLatency.isPending && setLatency.variables === ms}
              disabled={setLatency.isPending}
              onClick={() => {
                if (!pressed) setLatency.mutateAsync(ms).catch(toastError);
              }}
            >
              {LABELS[ms]}
            </PendingButton>
          );
        })}
      </div>
    </section>
  );
}
