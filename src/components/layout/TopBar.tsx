import { NotificationBell } from '@/components/notifications/NotificationBell';
import { useSession } from '@/contexts/useSession';
import { DevToolbar } from './DevToolbar';
import { SessionSwitcher } from './SessionSwitcher';
import { SimulatedDataBadge } from './SimulatedDataBadge';

/**
 * Top bar — the session switcher (which company, who you are), the demo toolbar (mock adapter only),
 * the notification bell (T7) and the "Dữ liệu giả lập" banner.
 *
 * The banner never leaves the bar: below `lg` it shortens rather than wrapping or dropping, and the
 * switchers truncate first (plan §10, BR-KPI-51).
 */
export function TopBar() {
  const { isSimulated } = useSession();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4 md:px-6">
      <SessionSwitcher />
      <div className="flex-1" />
      <DevToolbar />
      <NotificationBell />
      {isSimulated && <SimulatedDataBadge />}
    </header>
  );
}
