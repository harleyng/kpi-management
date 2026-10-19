import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminFormsTab } from '@/components/launches/AdminFormsTab';
import { LaunchesTab } from '@/components/launches/LaunchesTab';
import { LaunchRulesTab } from '@/components/launches/LaunchRulesTab';
import { WorkflowsTab } from '@/components/launches/WorkflowsTab';
import { useSession } from '@/contexts/useSession';

const TABS = ['launches', 'rules', 'forms', 'workflows'] as const;
type Tab = (typeof TABS)[number];

/**
 * "Khởi chạy phiếu" (D5, WBS 4.5.1) — HR and C&B (`form.launch`): one-off launches and the recurring
 * rules that launch the monthly evaluation, every form they produced (to follow a period, act as proxy
 * or cancel), and — for whoever manages cycles — the workflows' step settings (product owner, T5:
 * a tab here, not a menu item). Tab and launch filter live in the URL, so a link opens them.
 */
export default function FormLaunchesPage() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const mayConfigure = can('cycle.manage');
  const wanted = params.get('tab') as Tab | null;
  const tab: Tab = wanted && TABS.includes(wanted) && (wanted !== 'workflows' || mayConfigure) ? wanted : 'launches';
  const launchId = params.get('launch');

  const go = (next: string, launch: string | null = null) => {
    const search: Record<string, string> = {};
    if (next !== 'launches') search.tab = next;
    if (launch) search.launch = launch;
    setParams(search, { replace: next === tab });
  };

  return (
    <>
      <PageHeader title="Khởi chạy phiếu" description="Đợt khởi chạy phiếu đăng ký và đánh giá KPI, lịch tự khởi chạy và theo dõi phiếu." />
      <Tabs value={tab} onValueChange={(v) => go(v)}>
        <TabsList>
          <TabsTrigger value="launches">Đợt khởi chạy</TabsTrigger>
          <TabsTrigger value="rules">Lịch tự khởi chạy</TabsTrigger>
          <TabsTrigger value="forms">Phiếu</TabsTrigger>
          {mayConfigure && <TabsTrigger value="workflows">Quy trình</TabsTrigger>}
        </TabsList>
        <TabsContent value="launches" className="mt-4">
          <LaunchesTab onOpenForms={(id) => go('forms', id)} />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <LaunchRulesTab />
        </TabsContent>
        <TabsContent value="forms" className="mt-4">
          <AdminFormsTab launchId={launchId} onLaunchChange={(id) => go('forms', id)} />
        </TabsContent>
        {mayConfigure && (
          <TabsContent value="workflows" className="mt-4">
            <WorkflowsTab />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
