import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.7.1–4.7.4, Phase 3. */
export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Bức tranh KPI sống của công ty, bộ phận và cá nhân."
      />
      <PlaceholderPanel
        spec="WP 4.7.1–4.7.4, Phase 3"
        items={[
          "Dashboard điều hành theo 4 viễn cảnh BSC",
          "Dashboard quản lý và cá nhân",
          "Báo cáo vận hành: tiến độ nhập số, phiếu quá hạn",
          "Trợ lý AI (giả lập) tóm tắt và giải thích điểm",
        ]}
      />
    </>
  );
}
