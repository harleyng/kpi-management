import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_LABEL,
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABEL,
} from '@/data/types';
import { useNotificationTemplates } from '@/hooks/queries/system';
import { NotificationTemplateDialog, type TemplateSlot } from './NotificationTemplateDialog';
import { EVENT_WHEN } from './templateCopy';

/**
 * Every event × channel the system can notify on, with the tenant's template for it (WBS 4.8.1). The
 * normal case — an in-app template that exists — carries no badge; a MISSING in-app template is
 * flagged, because that event then notifies nobody (BR-KPI-45). E-mail templates can be written but
 * are not sent in P1.
 */
export function NotificationTemplateTable() {
  const templates = useNotificationTemplates();
  const [editing, setEditing] = useState<TemplateSlot | null>(null);

  const slots = useMemo<TemplateSlot[] | undefined>(() => {
    if (!templates.data) return undefined;
    return NOTIFICATION_EVENTS.flatMap((eventCode) =>
      NOTIFICATION_CHANNELS.map((channel) => ({
        eventCode,
        channel,
        template: templates.data.find((t) => t.eventCode === eventCode && t.channel === channel && t.language === 'vi') ?? null,
      })),
    );
  }, [templates.data]);

  const columns: DataTableColumn<TemplateSlot>[] = [
    {
      id: 'event',
      header: 'Sự kiện',
      className: 'w-[30%]',
      cell: (s) => (
        <div className="space-y-0.5">
          <p className="font-medium">{NOTIFICATION_EVENT_LABEL[s.eventCode]}</p>
          <p className="text-xs text-muted-foreground">{EVENT_WHEN[s.eventCode]}</p>
        </div>
      ),
    },
    { id: 'channel', header: 'Kênh', cell: (s) => NOTIFICATION_CHANNEL_LABEL[s.channel] },
    {
      id: 'subject',
      header: 'Tiêu đề',
      className: 'max-w-[18rem]',
      cell: (s) =>
        s.template && (
          <span className="block truncate" title={s.template.subject}>
            {s.template.subject}
          </span>
        ),
    },
    {
      id: 'state',
      header: 'Trạng thái',
      cell: (s) =>
        s.channel === 'Email' ? (
          <StatusBadge tone="muted">Chưa gửi ở P1</StatusBadge>
        ) : s.template ? (
          <span className="text-muted-foreground">Đang dùng</span>
        ) : (
          <div className="space-y-0.5">
            <StatusBadge tone="warning">Thiếu mẫu</StatusBadge>
            <p className="text-xs text-muted-foreground">Sự kiện này sẽ không gửi thông báo.</p>
          </div>
        ),
    },
    {
      id: 'action',
      header: 'Thao tác',
      className: 'w-24 text-right',
      cell: (s) => {
        const name = `${NOTIFICATION_EVENT_LABEL[s.eventCode]}, ${NOTIFICATION_CHANNEL_LABEL[s.channel]}`;
        return (
          <Button
            // Only a missing IN-APP template is urgent (its event notifies nobody); e-mail is not sent in P1.
            variant={!s.template && s.channel === 'InApp' ? 'default' : 'outline'}
            size="sm"
            aria-label={`${s.template ? 'Sửa mẫu' : 'Tạo mẫu'}, ${name}`}
            onClick={() => setEditing(s)}
          >
            {s.template ? 'Sửa' : 'Tạo mẫu'}
          </Button>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        label="Mẫu thông báo theo sự kiện"
        columns={columns}
        rows={slots}
        query={templates}
        getRowId={(s) => `${s.eventCode}:${s.channel}`}
        empty="Chưa có sự kiện nào."
        pageSize={null}
      />
      {editing && <NotificationTemplateDialog key={`${editing.eventCode}:${editing.channel}`} slot={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
