import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.8.1–4.8.2, Track T7. */
export default function NotificationTemplatesPage() {
  return (
    <>
      <PageHeader
        title="Mẫu thông báo"
        description="Mẫu thông báo in-app cho khởi chạy, nhắc hạn và kết quả."
      />
      <PlaceholderPanel
        spec="WP 4.8.1–4.8.2, Track T7"
        items={[
          "Mẫu thông báo khởi chạy quy trình và nhắc hạn (theo email template hiện tại)",
          "Gửi và lịch nhắc in-app",
          "Lưu trữ tệp đính kèm (giả lập bằng blob URL, WP 4.8.3)",
        ]}
      />
    </>
  );
}
