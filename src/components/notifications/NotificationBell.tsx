import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { LoadMoreFooter } from '@/components/shared/LoadMoreFooter';
import { toastError } from '@/components/shared/toastError';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NOTIFICATION_EVENT_LABEL, type KpiNotification } from '@/data/types';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationTemplates,
  useNotifications,
  useUnreadNotificationCount,
} from '@/hooks/queries/system';
import { errorSpecOf } from '@/lib/errorCatalog';
import { isInAppNotification } from '@/lib/notificationRules';
import { flattenPages } from '@/lib/pagination';
import { cn, formatDateTime } from '@/lib/utils';
import { notificationTarget } from './notificationLinks';

const BADGE_MAX = 9;

/**
 * The bell in the top bar (WBS 4.8.2): the signed-in user's unread in-app notices, and a popover to
 * read them. A notice opens the screen it is about and is marked read on the way. Unread is not a
 * failure, so the count is primary-coloured, never red; it is hidden at zero.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadNotificationCount();
  const count = unread.data?.count ?? 0;
  const shown = unread.data?.capped ? `${unread.data.count}+` : count > BADGE_MAX ? `${BADGE_MAX}+` : String(count);
  const label = count > 0 ? `Thông báo, ${unread.data?.capped ? `hơn ${count}` : count} chưa đọc` : 'Thông báo';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative shrink-0" aria-label={label}>
          <Bell aria-hidden />
          {count > 0 && (
            <span
              aria-hidden
              className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
            >
              {shown}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-2rem))] p-0">
        {open && <NotificationPanel unreadIds={unread.data?.ids ?? []} onNavigate={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

function NotificationPanel({ unreadIds, onNavigate }: { unreadIds: string[]; onNavigate: () => void }) {
  const titleId = useId();
  const [tab, setTab] = useState<'unread' | 'all'>(unreadIds.length > 0 ? 'unread' : 'all');
  const markAll = useMarkAllNotificationsRead();

  return (
    <section aria-labelledby={titleId}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Thông báo
        </h2>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          disabled={unreadIds.length === 0 || markAll.isPending}
          aria-busy={markAll.isPending}
          onClick={() => markAll.mutate(unreadIds, { onError: toastError })}
        >
          Đánh dấu tất cả đã đọc
        </Button>
      </header>
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'unread' | 'all')}>
        <TabsList className="mx-4 mt-3 grid grid-cols-2">
          <TabsTrigger value="unread">Chưa đọc</TabsTrigger>
          <TabsTrigger value="all">Tất cả</TabsTrigger>
        </TabsList>
        <TabsContent value="unread" className="mt-2">
          <NotificationList unreadOnly onNavigate={onNavigate} />
        </TabsContent>
        <TabsContent value="all" className="mt-2">
          <NotificationList unreadOnly={false} onNavigate={onNavigate} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function NotificationList({ unreadOnly, onNavigate }: { unreadOnly: boolean; onNavigate: () => void }) {
  const query = useNotifications(unreadOnly);
  const templates = useNotificationTemplates();
  const navigate = useNavigate();
  const markRead = useMarkNotificationRead();

  const rows = useMemo(() => {
    const byId = new Map((templates.data ?? []).map((t) => [t.id, t]));
    return flattenPages(query.data?.pages).filter((n) => isInAppNotification(n, byId));
  }, [query.data, templates.data]);

  if (query.isError && !query.data) {
    return <ErrorState spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} className="m-4" />;
  }
  if (query.isPending || templates.isPending) {
    return (
      <div className="space-y-3 px-4 pb-4" aria-busy>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState className="px-4 pb-6">
        {unreadOnly
          ? 'Không có thông báo chưa đọc.'
          : 'Bạn chưa có thông báo nào. Thông báo về phiếu, Goal Plan và nhắc hạn sẽ hiện ở đây.'}
      </EmptyState>
    );
  }

  const open = (n: KpiNotification) => {
    if (n.readAt === null) markRead.mutate(n.id, { onError: toastError });
    navigate(notificationTarget(n));
    onNavigate();
  };

  return (
    <>
      <ScrollArea className="max-h-[420px]">
        <ul className="divide-y">
          {rows.map((n) => (
            <li key={n.id}>
              <NotificationRow notification={n} onOpen={() => open(n)} />
            </li>
          ))}
        </ul>
      </ScrollArea>
      <div className="border-t px-4 py-2">
        <LoadMoreFooter
          shown={rows.length}
          noun="thông báo"
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          isFetchNextPageError={query.isFetchNextPageError}
          fetchNextPage={query.fetchNextPage}
        />
      </div>
    </>
  );
}

function NotificationRow({ notification: n, onOpen }: { notification: KpiNotification; onOpen: () => void }) {
  const unread = n.readAt === null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-alt focus-visible:bg-surface-alt focus-visible:outline-none"
    >
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', unread ? 'bg-primary' : 'bg-transparent')} aria-hidden />
      <span className="min-w-0 flex-1 space-y-1">
        {unread && <span className="sr-only">Chưa đọc. </span>}
        <span className={cn('line-clamp-2 block text-sm', unread ? 'font-medium text-foreground' : 'text-neutral-60')}>{n.subject}</span>
        <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>
        <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{NOTIFICATION_EVENT_LABEL[n.eventCode]}</span>
          <span className="tabular shrink-0">{formatDateTime(n.createdAt)}</span>
        </span>
      </span>
    </button>
  );
}
