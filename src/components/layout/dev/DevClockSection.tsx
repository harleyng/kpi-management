import { useId, useState } from 'react';
import { Clock } from 'lucide-react';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/contexts/useSession';
import type { IsoDateTime } from '@/data/types';
import { useSetSimulatedNow, useSimulatedNow, type SimulatedNowChange } from '@/hooks/queries/dev';
import { errorSpecOf } from '@/lib/errorCatalog';
import { fromZonedLocalInput, toZonedLocalInput, zoneOffsetLabel } from '@/lib/isoDate';
import { PendingButton } from './PendingButton';
import { toastError } from '@/components/shared/toastError';

/** "06/04/2027 09:00 (GMT+7)" — the instant's wall clock in the tenant's zone. */
function formatNow(instant: IsoDateTime, timeZone: string): string {
  const [date, time] = toZonedLocalInput(instant, timeZone).split('T');
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y} ${time} (${zoneOffsetLabel(instant, timeZone)})`;
}

type ClockAction = 'plus1' | 'plus7' | 'seed' | 'apply';

/** The simulated clock: read it, move it by days, set it, or send it back to the seed's moment. */
export function DevClockSection() {
  const { tenant } = useSession();
  const now = useSimulatedNow();
  const setNow = useSetSimulatedNow();
  const [pendingAction, setPendingAction] = useState<ClockAction | null>(null);
  const [draft, setDraft] = useState('');
  const fieldId = useId();
  const hintId = useId();

  const target = fromZonedLocalInput(draft, tenant.timezone);
  const busy = setNow.isPending;

  const run = (action: ClockAction, change: SimulatedNowChange) => {
    setPendingAction(action);
    setNow
      .mutateAsync(change)
      .then(() => {
        if (action === 'apply') setDraft('');
      }, toastError)
      .finally(() => setPendingAction(null));
  };

  return (
    <section className="space-y-2">
      <SectionTitle icon={Clock} title="Đồng hồ giả lập">
        Mọi hạn chót và trạng thái quá hạn tính theo giờ này.
      </SectionTitle>

      <div className="flex min-h-5 items-center gap-1">
        <span className="text-muted-foreground">Bây giờ:</span>
        {now.data !== undefined ? (
          <span className="tabular font-medium">{formatNow(now.data, tenant.timezone)}</span>
        ) : now.error ? (
          <span role="alert" className="text-support-negative">
            {errorSpecOf(now.error).title}
          </span>
        ) : (
          <Skeleton className="h-4 w-40" aria-label="Đang tải" />
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <PendingButton pending={pendingAction === 'plus1'} disabled={busy} onClick={() => run('plus1', { shiftDays: 1 })}>
          +1 ngày
        </PendingButton>
        <PendingButton pending={pendingAction === 'plus7'} disabled={busy} onClick={() => run('plus7', { shiftDays: 7 })}>
          +7 ngày
        </PendingButton>
        <PendingButton pending={pendingAction === 'seed'} disabled={busy} onClick={() => run('seed', { to: null })}>
          Về thời điểm seed
        </PendingButton>
      </div>

      <form
        className="space-y-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (target) run('apply', { to: target });
        }}
      >
        <Label htmlFor={fieldId}>Đặt ngày giờ</Label>
        <div className="flex gap-2">
          <Input
            id={fieldId}
            type="datetime-local"
            className="h-8 flex-1"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-describedby={target ? undefined : hintId}
          />
          <PendingButton type="submit" pending={pendingAction === 'apply'} disabled={busy || target === null}>
            Áp dụng
          </PendingButton>
        </div>
        {target === null && (
          <p id={hintId} className="text-xs text-muted-foreground">
            Nhập ngày giờ hợp lệ.
          </p>
        )}
      </form>
    </section>
  );
}
