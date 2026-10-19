import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.2.4, Track T2. */
export default function KpiTemplatesPage() {
  return (
    <>
      <PageHeader
        title="Bộ mẫu"
        description="Bộ KPI mẫu theo phòng ban và chức danh để giao nhanh."
      />
      <PlaceholderPanel
        spec="WP 4.2.4, Track T2"
        items={[
          "Bộ KPI mẫu theo phòng ban (seed từ biểu mẫu DATX)",
          "Trọng số mặc định cho từng chỉ tiêu trong bộ",
          "Áp bộ mẫu vào Goal Plan",
        ]}
      />
    </>
  );
}
