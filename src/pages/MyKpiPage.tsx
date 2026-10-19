import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.3.2–4.3.5 · Track T3. */
export default function MyKpiPage() {
  return (
    <>
      <PageHeader
        title="KPI của tôi"
        description="Goal Plan của bạn trong chu kỳ hiện tại: chỉ tiêu, trọng số, mục tiêu và tiến độ."
      />
      <PlaceholderPanel
        spec="WP 4.3.2–4.3.5 · Track T3 (nhập số: WP 4.4.2, Track T4)"
        items={[
          "Xem Goal Plan cá nhân theo chu kỳ và kỳ đánh giá",
          "Thêm chỉ tiêu từ thư viện hoặc tự nhập, liên kết với chỉ tiêu của quản lý (cascade/link)",
          "Kiểm tra tổng trọng số 100% và 5–8 chỉ tiêu trước khi gửi",
          "Nhập số thực tế kèm bằng chứng cho từng kỳ",
        ]}
      />
    </>
  );
}
