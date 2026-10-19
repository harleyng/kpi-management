import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by D5 + WP 4.5.1, Track T5. */
export default function FormLaunchesPage() {
  return (
    <>
      <PageHeader
        title="Khởi chạy phiếu"
        description="Đợt khởi chạy phiếu đăng ký, điều chỉnh và đánh giá KPI."
      />
      <PlaceholderPanel
        spec="D5 + WP 4.5.1, Track T5"
        items={[
          "Chọn loại phiếu và quy trình mẫu",
          "Thời điểm: ngay, hẹn ngày hoặc định kỳ (ví dụ ngày 1 hằng tháng)",
          "Kỳ đánh giá, hạn hoàn thành, danh sách người nhận",
          "Cấu hình bước, người thực hiện, SLA và hành vi quá hạn",
        ]}
      />
    </>
  );
}
