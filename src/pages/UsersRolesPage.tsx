import { PageHeader } from '@/components/shared/PageHeader';
import { PlaceholderPanel } from '@/components/shared/PlaceholderPanel';

/** Placeholder (Phase 0). Replaced by WP 4.1.5–4.1.6, Track T1. */
export default function UsersRolesPage() {
  return (
    <>
      <PageHeader
        title="Người dùng & quyền"
        description="Tài khoản, vai trò và phạm vi dữ liệu của từng người dùng."
      />
      <PlaceholderPanel
        spec="WP 4.1.5–4.1.6, Track T1 (logic quyền ở Phase 1.3)"
        items={[
          "Tài khoản và đăng nhập (giả lập)",
          "6 vai trò: Nhân viên, Quản lý, HR, C&B, Ban điều hành, Quản trị hệ thống",
          "Phạm vi: bản thân, cấp dưới trực tiếp, đơn vị (kèm đơn vị con), toàn công ty",
        ]}
      />
    </>
  );
}
