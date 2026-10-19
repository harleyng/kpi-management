import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.2.1–4.2.3, 4.2.5 · Track T2. */
export default function KpiLibraryPage() {
  return (
    <>
      <PageHeader
        title="Thư viện KPI"
        description="Danh mục chỉ tiêu mẫu, viễn cảnh BSC, đơn vị đo và phương pháp tính."
      />
      <PlaceholderPanel
        spec="WP 4.2.1–4.2.3, 4.2.5 · Track T2"
        items={[
          "Danh mục nền: viễn cảnh BSC, đơn vị đo",
          "Phương pháp tính: RATIO_UP, RATIO_DOWN, TIERED, BINARY, FORMULA, LEVELS; trần và sàn %",
          "Chỉ tiêu mẫu với định nghĩa, công thức, nguồn số liệu",
          "Import/Export thư viện bằng Excel",
        ]}
      />
    </>
  );
}
