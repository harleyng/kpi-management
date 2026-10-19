import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader, type Crumb } from '@/components/shared/PageHeader';
import { UnsavedChangesGuard } from '@/components/shared/UnsavedChangesGuard';
import { LaunchPanel } from '@/components/launches/LaunchPanel';
import { WorkflowStepEditor } from '@/components/launches/WorkflowStepEditor';
import { useSession } from '@/contexts/useSession';
import { FORM_TYPE_LABEL } from '@/data/types';
import { useWorkflowSteps, useWorkflows } from '@/hooks/queries/forms';
import { ERROR_CATALOG, errorSpecOf } from '@/lib/errorCatalog';
import { combineQueries } from '@/lib/queryState';

const RUNS_URL = '/admin/launches/runs';
const WORKFLOWS_URL = '/admin/launches/workflows';

/**
 * "Tạo đợt khởi chạy" (D5, BR-KPI-19) — its own page under "Đợt khởi chạy": the recipient filter
 * makes the form too big for a dialog, and a list never holds an editor. Done or cancelled → back to
 * the list; leaving with a half-filled form asks first.
 */
export function NewLaunchPage() {
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Navigate only after the guard has re-rendered with `when={false}` — its blocker reads the last render.
  useEffect(() => {
    if (leaving) navigate(RUNS_URL);
  }, [leaving, navigate]);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Đợt khởi chạy', to: RUNS_URL }]}
        title="Tạo đợt khởi chạy"
        description="Gửi phiếu đăng ký hoặc đánh giá KPI tới người nhận, ngay hoặc theo lịch."
      />
      <UnsavedChangesGuard when={dirty && !leaving} />
      <LaunchPanel onDone={() => setLeaving(true)} onDirtyChange={setDirty} />
    </>
  );
}

/**
 * One workflow's step editor (WBS 4.5.1) — opened from "Quy trình duyệt". The workflow comes from the
 * tenant's (cached) workflow list: still loading → skeleton; not in it → ERR-KPI-02 under the trail.
 * The route is gated by `cycle.manage`, so whoever reaches it may edit.
 */
export function WorkflowDetailPage() {
  const { workflowId } = useParams();
  const { can } = useSession();
  const workflows = useWorkflows();
  const steps = useWorkflowSteps();
  const query = combineQueries([workflows, steps]);
  const trail: Crumb[] = [{ label: 'Quy trình duyệt', to: WORKFLOWS_URL }];

  if (query.error != null) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Quy trình duyệt" />
        <ErrorStateCard spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />
      </>
    );
  }
  if (!workflows.data || !steps.data) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Quy trình duyệt" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }
  const workflow = workflows.data.find((w) => w.id === workflowId);
  if (!workflow) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Không tìm thấy quy trình" />
        <ErrorStateCard spec={ERROR_CATALOG['ERR-KPI-02']} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={trail}
        title={workflow.name}
        description={`${FORM_TYPE_LABEL[workflow.formType]}${workflow.isDefault ? ', quy trình mặc định' : ''}`}
      />
      <WorkflowStepEditor
        key={`${workflow.id}:${steps.dataUpdatedAt}`}
        workflow={workflow}
        steps={steps.data.filter((s) => s.workflowId === workflow.id).sort((a, b) => a.stepNo - b.stepNo)}
        editable={can('cycle.manage')}
      />
    </>
  );
}
