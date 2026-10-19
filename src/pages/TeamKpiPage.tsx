import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.3.4, Track T3. */
export default function TeamKpiPage() {
  return (
    <>
      <PageHeader
        title="KPI đội nhóm"
        description="Goal Plan của nhân viên trực tiếp và mức độ phân giao từ KPI của bạn."
      />
      <PlaceholderPanel
        spec="WP 4.3.4, Track T3"
        items={[
          "Cây cascade từ KPI của quản lý xuống từng nhân viên",
          "Theo dõi đã giao / tự nhận / chưa giao / tự thực hiện (D3)",
          "Trạng thái Goal Plan của từng nhân viên",
          "Tiến độ số thực tế của đội nhóm",
        ]}
      />
    </>
  );
}
