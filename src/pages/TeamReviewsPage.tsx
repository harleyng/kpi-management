import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.5.2–4.5.4, Track T5. */
export default function TeamReviewsPage() {
  return (
    <>
      <PageHeader
        title="Duyệt & đánh giá"
        description="Duyệt Goal Plan và chấm phiếu đánh giá KPI của nhân viên."
      />
      <PlaceholderPanel
        spec="WP 4.5.2–4.5.4, Track T5"
        items={[
          "Duyệt, chỉnh sửa hoặc trả lại Goal Plan (quy trình đăng ký 4 bước)",
          "Duyệt yêu cầu điều chỉnh KPI",
          "Chấm % hoàn thành và nhận xét trên phiếu đánh giá",
          "Thao tác thay (proxy) ghi nhận đủ hai người",
        ]}
      />
    </>
  );
}
