import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.5.5 · Track T5. */
export default function MyTasksPage() {
  return (
    <>
      <PageHeader
        title="Việc cần xử lý"
        description="Các phiếu đang chờ bạn: đăng ký, điều chỉnh và đánh giá KPI."
      />
      <PlaceholderPanel
        spec="WP 4.5.5 · Track T5"
        items={[
          "Hộp việc: phiếu đang ở bước của bạn, sắp xếp theo hạn",
          "Đánh dấu phiếu quá hạn và phiếu được ủy quyền",
          "Mở phiếu để gửi, duyệt, trả lại hoặc lưu nháp",
          "Thiết lập ủy quyền khi vắng mặt",
        ]}
      />
    </>
  );
}
