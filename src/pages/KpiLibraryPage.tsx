import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CalcMethodsPanel } from '@/components/library/CalcMethodsPanel';
import { CataloguesPanel } from '@/components/library/CataloguesPanel';
import { KpiDefinitionsPanel } from '@/components/library/KpiDefinitionsPanel';
import { LibraryActions } from '@/components/library/LibraryExportButton';
import { PageHeader } from '@/components/shared/PageHeader';
import { useSession } from '@/contexts/useSession';

const TABS = ['chi-tieu', 'danh-muc', 'phuong-phap'] as const;
type Tab = (typeof TABS)[number];

/** Thư viện KPI — WBS 4.2.1 (danh mục), 4.2.2 (phương pháp tính), 4.2.3 (chỉ tiêu mẫu), 4.2.5 (xuất Excel). Track T2. */
export default function KpiLibraryPage() {
  const { can } = useSession();
  const canManage = can('library.manage');
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'chi-tieu';

  return (
    <>
      <PageHeader
        title="Thư viện KPI"
        description="Chỉ tiêu mẫu, viễn cảnh BSC, đơn vị đo và phương pháp tính dùng chung khi lập Goal Plan."
        actions={<LibraryActions />}
      />
      <Tabs
        value={tab}
        onValueChange={(value) => setParams(value === 'chi-tieu' ? {} : { tab: value }, { replace: true })}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="chi-tieu">Chỉ tiêu mẫu</TabsTrigger>
          <TabsTrigger value="danh-muc">Danh mục</TabsTrigger>
          <TabsTrigger value="phuong-phap">Phương pháp tính</TabsTrigger>
        </TabsList>
        <TabsContent value="chi-tieu" className="mt-0">
          <KpiDefinitionsPanel canManage={canManage} />
        </TabsContent>
        <TabsContent value="danh-muc" className="mt-0">
          <CataloguesPanel canManage={canManage} />
        </TabsContent>
        <TabsContent value="phuong-phap" className="mt-0">
          <CalcMethodsPanel canManage={canManage} />
        </TabsContent>
      </Tabs>
    </>
  );
}
