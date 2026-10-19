import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.1.1–4.1.4, 4.1.7 · Track T1. */
export default function OrgUnitsPage() {
  return (
    <>
      <PageHeader
        title="Tổ chức"
        description="Công ty thành viên, cây tổ chức, chức danh và quan hệ báo cáo."
      />
      <PlaceholderPanel
        spec="WP 4.1.1–4.1.4, 4.1.7 · Track T1"
        items={[
          "Quản lý công ty thành viên (tenant)",
          "Cây tổ chức Công ty → Khối → Phòng",
          "Chức danh, hồ sơ nhân viên, phân công và quản lý trực tiếp",
          "Import tổ chức và nhân sự từ Excel",
        ]}
      />
    </>
  );
}
