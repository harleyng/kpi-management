import { EmployeesTab } from '@/components/org/EmployeesTab';
import { OrgStructureTab } from '@/components/org/OrgStructureTab';
import { PositionsTab } from '@/components/org/PositionsTab';
import { TenantTab } from '@/components/org/TenantTab';
import { PageHeader } from '@/components/shared/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParamState } from '@/hooks/useSearchParamState';

const TABS = [
  { id: 'co-cau', label: 'Cơ cấu' },
  { id: 'nhan-su', label: 'Nhân sự' },
  { id: 'chuc-danh', label: 'Chức danh' },
  { id: 'cong-ty', label: 'Công ty' },
] as const;
type TabId = (typeof TABS)[number]['id'];
const isTab = (value: string | null): value is TabId => TABS.some((t) => t.id === value);

/** "Tổ chức" — WBS 4.1.1–4.1.4 and 4.1.7 (Track T1). The tab is `?tab=`, so a link opens it. */
export default function OrgUnitsPage() {
  const [tabParam, setTab] = useSearchParamState('tab');
  const tab: TabId = isTab(tabParam) ? tabParam : 'co-cau';

  return (
    <>
      <PageHeader title="Tổ chức" description="Cơ cấu tổ chức, nhân sự và phân công, chức danh, thông tin công ty." />
      <Tabs value={tab} onValueChange={(next) => setTab(next === 'co-cau' ? null : next)}>
        <TabsList className="mb-4">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="co-cau">
          <OrgStructureTab />
        </TabsContent>
        <TabsContent value="nhan-su">
          <EmployeesTab />
        </TabsContent>
        <TabsContent value="chuc-danh">
          <PositionsTab />
        </TabsContent>
        <TabsContent value="cong-ty">
          <TenantTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
