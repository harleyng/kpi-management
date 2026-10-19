import { AccountsTab } from '@/components/access/AccountsTab';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { PageHeader } from '@/components/shared/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParamState } from '@/hooks/useSearchParamState';

/** "Người dùng & quyền" — WBS 4.1.5–4.1.6 (Track T1; the permission logic is Phase 1.3's). */
export default function UsersRolesPage() {
  const [tabParam, setTab] = useSearchParamState('tab');
  const tab = tabParam === 'vai-tro' ? 'vai-tro' : 'tai-khoan';

  return (
    <>
      <PageHeader title="Người dùng & quyền" description="Tài khoản, vai trò và phạm vi dữ liệu của từng người dùng. Đăng nhập trong bản thử nghiệm là giả lập." />
      <Tabs value={tab} onValueChange={(next) => setTab(next === 'tai-khoan' ? null : next)}>
        <TabsList className="mb-4">
          <TabsTrigger value="tai-khoan">Tài khoản</TabsTrigger>
          <TabsTrigger value="vai-tro">Vai trò & quyền</TabsTrigger>
        </TabsList>
        <TabsContent value="tai-khoan">
          <AccountsTab />
        </TabsContent>
        <TabsContent value="vai-tro">
          <PermissionMatrix />
        </TabsContent>
      </Tabs>
    </>
  );
}
