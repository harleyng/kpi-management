import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.3.1, 4.3.6, Track T3. */
export default function CyclesPage() {
  return (
    <>
      <PageHeader
        title="Chu kỳ"
        description="Chu kỳ đánh giá, các kỳ tháng/quý, hạn nhập số và hạn đánh giá."
      />
      <PlaceholderPanel
        spec="WP 4.3.1, 4.3.6, Track T3"
        items={[
          "Tạo chu kỳ (ví dụ KPI 2027) với 12 kỳ tháng và 4 kỳ quý",
          "Hạn nhập số liệu và hạn đánh giá cho từng kỳ",
          "Khóa, mở khóa Goal Plan và xem lịch sử khóa/mở",
        ]}
      />
    </>
  );
}
