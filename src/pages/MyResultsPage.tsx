import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.6.4, Track T6. */
export default function MyResultsPage() {
  return (
    <>
      <PageHeader
        title="Kết quả của tôi"
        description="Điểm KPI, xếp loại và tỷ lệ hưởng lương KPI theo từng kỳ."
      />
      <PlaceholderPanel
        spec="WP 4.6.4, Track T6 (dashboard cá nhân: WP 4.7.2, Phase 3)"
        items={[
          "Điểm có trọng số theo kỳ, chi tiết từng chỉ tiêu",
          "Xếp loại và % hưởng lương KPI sau khi HR chốt",
          "Lịch sử kết quả qua các kỳ",
        ]}
      />
    </>
  );
}
