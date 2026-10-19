import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.4.1, 4.4.4–4.4.5, Track T4. */
export default function DataSourcesPage() {
  return (
    <>
      <PageHeader
        title="Nguồn dữ liệu"
        description="Danh mục nguồn số liệu và kết nối tích hợp."
      />
      <PlaceholderPanel
        spec="WP 4.4.1, 4.4.4–4.4.5, Track T4"
        items={[
          "Danh mục nguồn dữ liệu — mọi KPI phải có nguồn",
          "Khung kết nối API (giả lập), lịch đồng bộ và lịch sử chạy",
          "Connector ERP Sale (giả lập)",
        ]}
      />
    </>
  );
}
