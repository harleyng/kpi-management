import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.8.4, Track T7. */
export default function AuditLogPage() {
  return (
    <>
      <PageHeader
        title="Nhật ký"
        description="Nhật ký thao tác trên dữ liệu KPI, phiếu và kết quả."
      />
      <PlaceholderPanel
        spec="WP 4.8.4, Track T7"
        items={[
          "Ghi nhận ai làm gì, lúc nào, thay ai (proxy)",
          "Lọc theo người dùng, đối tượng, khoảng thời gian",
        ]}
      />
    </>
  );
}
