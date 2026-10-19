import { AccountsTab } from '@/components/access/AccountsTab';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { PageHeader } from '@/components/shared/PageHeader';

export type UsersSection = 'accounts' | 'roles';

/** "Người dùng & quyền" — WBS 4.1.5–4.1.6 (Track T1; the permission logic is Phase 1.3's); one sub-page per section. */
export default function UsersRolesPage({ section }: { section: UsersSection }) {
  return section === 'accounts' ? (
    <>
      <PageHeader title="Tài khoản" description="Tài khoản người dùng, vai trò và phạm vi dữ liệu của từng người. Đăng nhập trong bản thử nghiệm là giả lập." />
      <AccountsTab />
    </>
  ) : (
    <>
      <PageHeader title="Vai trò & quyền" description="Quyền của từng vai trò. Một người có nhiều vai trò nhận hợp các quyền." />
      <PermissionMatrix />
    </>
  );
}
