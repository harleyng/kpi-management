import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { FORM_TYPES, FORM_TYPE_LABEL, type WorkflowTemplate } from '@/data/types';
import { useWorkflowSteps, useWorkflows } from '@/hooks/queries/forms';
import { combineQueries } from '@/lib/queryState';

/**
 * "Quy trình duyệt" (WBS 4.5.1) — every workflow, by form type with the default first. A row opens
 * its step editor on its own page (`WorkflowDetailPage`); the list never shows the steps itself.
 */
export function WorkflowsTab() {
  const navigate = useNavigate();
  const workflows = useWorkflows();
  const steps = useWorkflowSteps();

  const stepCount = (w: WorkflowTemplate) => steps.data?.filter((s) => s.workflowId === w.id).length ?? 0;
  const rows = workflows.data
    ?.slice()
    .sort((a, b) => FORM_TYPES.indexOf(a.formType) - FORM_TYPES.indexOf(b.formType) || Number(b.isDefault) - Number(a.isDefault));
  const columns: DataTableColumn<WorkflowTemplate>[] = [
    {
      id: 'name',
      header: 'Tên quy trình',
      cell: (w) => (
        <Button
          variant="link"
          className="h-auto p-0 text-left font-medium"
          onClick={() => navigate(`/admin/launches/workflows/${w.id}`)}
          aria-label={`Mở quy trình ${w.name}`}
        >
          {w.name}
        </Button>
      ),
      sortValue: (w) => w.name,
      className: 'min-w-[16rem]',
    },
    { id: 'type', header: 'Loại phiếu', cell: (w) => FORM_TYPE_LABEL[w.formType], sortValue: (w) => FORM_TYPE_LABEL[w.formType] },
    { id: 'default', header: 'Mặc định', cell: (w) => (w.isDefault ? 'Có' : 'Không') },
    { id: 'steps', header: 'Số bước', numeric: true, cell: (w) => stepCount(w), sortValue: (w) => stepCount(w) },
  ];

  return (
    <DataTable
      label="Danh sách quy trình duyệt"
      columns={columns}
      // Step counts first: a row must never claim a workflow has 0 steps while they load.
      rows={steps.data ? rows : undefined}
      query={combineQueries([workflows, steps])}
      getRowId={(w) => w.id}
      empty="Chưa có quy trình nào."
      pageSize={null}
    />
  );
}
