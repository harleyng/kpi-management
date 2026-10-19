import { BellRing, CalendarClock } from 'lucide-react';
import { NotificationTemplateTable } from '@/components/notifications/NotificationTemplateTable';
import { ReminderScheduleTable } from '@/components/notifications/ReminderScheduleTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { SectionTitle } from '@/components/shared/SectionTitle';

/**
 * Mẫu thông báo (WBS 4.8.1–4.8.2, Track T7) — the texts the system sends when a form is launched,
 * reaches someone's step, is returned, or nears a step deadline; and, read-only, when each step
 * reminds. The route guard (`notification.manage`) keeps everyone else out. File storage (4.8.3)
 * has no screen of its own: `FileUploadButton` / `FileLink` serve the screens that attach files.
 */
export default function NotificationTemplatesPage() {
  return (
    <>
      <PageHeader
        title="Mẫu thông báo"
        description="Nội dung thông báo trong ứng dụng gửi khi khởi chạy phiếu, chuyển bước, trả lại và nhắc hạn."
      />
      <div className="space-y-8">
        <section className="space-y-3">
          <SectionTitle icon={BellRing} title="Thông báo trong ứng dụng và email">
            Mỗi sự kiện dùng một mẫu cho mỗi kênh. Giai đoạn này chỉ gửi thông báo trong ứng dụng.
          </SectionTitle>
          <NotificationTemplateTable />
        </section>
        <section className="space-y-3">
          <SectionTitle icon={CalendarClock} title="Lịch nhắc hạn">
            Nhắc hạn và xử lý quá hạn được cấu hình theo từng bước của quy trình mẫu, tại Khởi chạy phiếu; ở đây chỉ để xem.
          </SectionTitle>
          <ReminderScheduleTable />
        </section>
      </div>
    </>
  );
}
