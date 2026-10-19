import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/shared/PageHeader';
import { AdminFormsTab } from '@/components/launches/AdminFormsTab';
import { LaunchesTab } from '@/components/launches/LaunchesTab';
import { LaunchRulesTab } from '@/components/launches/LaunchRulesTab';
import { WorkflowsTab } from '@/components/launches/WorkflowsTab';

export type LaunchesSection = 'runs' | 'rules' | 'forms' | 'workflows';

const SECTIONS: Record<LaunchesSection, { title: string; description: string }> = {
  runs: { title: 'Đợt khởi chạy', description: 'Mọi đợt gửi phiếu đăng ký và đánh giá KPI, kể cả đợt do lịch tự động tạo.' },
  rules: { title: 'Lịch tự động', description: 'Lịch tự khởi chạy phiếu đánh giá tháng sau mỗi kỳ.' },
  forms: { title: 'Phiếu đã tạo', description: 'Theo dõi mọi phiếu các đợt đã tạo: xử lý thay, hủy phiếu khi cần.' },
  workflows: { title: 'Quy trình duyệt', description: 'Các bước duyệt của từng loại phiếu: SLA, xử lý quá hạn, nhắc hạn, bắt buộc nhận xét.' },
};

/**
 * "Khởi chạy phiếu" (D5, WBS 4.5.1) — HR and C&B (`form.launch`), one sub-page per section: one-off
 * launches, the recurring rules that launch the monthly evaluation, every form they produced (to
 * follow a period, act as proxy or cancel), and — for whoever manages cycles (`cycle.manage`, gated by
 * the menu and the route) — the workflows' step settings. "Phiếu đã tạo" keeps its launch filter in
 * the URL (`?launch=`), so "Mở phiếu" on a launch links straight to its forms.
 */
export default function FormLaunchesPage({ section }: { section: LaunchesSection }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { title, description } = SECTIONS[section];

  return (
    <>
      <PageHeader title={title} description={description} />
      {section === 'runs' && <LaunchesTab onOpenForms={(id) => navigate(`/admin/launches/forms?launch=${encodeURIComponent(id)}`)} />}
      {section === 'rules' && <LaunchRulesTab />}
      {section === 'forms' && (
        <AdminFormsTab launchId={params.get('launch')} onLaunchChange={(id) => setParams(id ? { launch: id } : {}, { replace: true })} />
      )}
      {section === 'workflows' && <WorkflowsTab />}
    </>
  );
}
