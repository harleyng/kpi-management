import { useMemo } from 'react';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import {
  ACTOR_RULE_LABEL,
  FORM_TYPE_LABEL,
  OVERDUE_BEHAVIOUR_LABEL,
  type WorkflowStep,
  type WorkflowTemplate,
} from '@/data/types';
import { useWorkflowSteps, useWorkflows } from '@/hooks/queries/workflows';
import { combineQueries } from '@/lib/queryState';
import { effectiveOverdueBehaviour } from '@/lib/workflowRules';

interface ScheduleRow {
  workflow: WorkflowTemplate;
  step: WorkflowStep;
  steps: WorkflowStep[];
}

/**
 * "Lịch nhắc hạn" (WBS 4.8.2), read-only: for each step of each workflow, its SLA, when the reminder
 * goes out and what happens when it runs over. Edited with the workflow (T5), never here, so there is
 * one place it is configured. "Khi quá hạn" shows what the scheduler WILL do — when a step's setting
 * cannot apply (auto-forward on the last step, lock outside registration) it falls back to a
 * reminder, and the configured value is named beside it.
 */
export function ReminderScheduleTable() {
  const workflows = useWorkflows();
  const steps = useWorkflowSteps();
  const query = combineQueries([workflows, steps]);

  const rows = useMemo<ScheduleRow[] | undefined>(() => {
    if (!workflows.data || !steps.data) return undefined;
    return workflows.data.flatMap((workflow) => {
      const own = steps.data.filter((s) => s.workflowId === workflow.id).sort((a, b) => a.stepNo - b.stepNo);
      return own.map((step) => ({ workflow, step, steps: own }));
    });
  }, [workflows.data, steps.data]);

  const columns: DataTableColumn<ScheduleRow>[] = [
    {
      id: 'workflow',
      header: 'Quy trình',
      cell: (r) => (
        <div className="space-y-0.5">
          <p>{r.workflow.name}</p>
          <p className="text-xs text-muted-foreground">{FORM_TYPE_LABEL[r.workflow.formType]}</p>
        </div>
      ),
    },
    { id: 'step', header: 'Bước', cell: (r) => `${r.step.stepNo}. ${r.step.name}` },
    { id: 'actor', header: 'Người thực hiện', cell: (r) => ACTOR_RULE_LABEL[r.step.actorRule] },
    { id: 'sla', header: 'SLA (ngày)', numeric: true, cell: (r) => r.step.slaDays ?? <span className="text-muted-foreground">Theo hạn phiếu</span> },
    {
      id: 'remind',
      header: 'Nhắc trước (ngày)',
      numeric: true,
      cell: (r) => r.step.remindDaysBefore ?? <span className="text-muted-foreground">Không nhắc</span>,
    },
    {
      id: 'overdue',
      header: 'Khi quá hạn',
      cell: (r) => {
        const effective = effectiveOverdueBehaviour(r.workflow, r.step, r.steps);
        if (effective === null) return <span className="text-muted-foreground">Không xử lý</span>;
        const configured = r.step.onOverdue;
        return (
          <div className="space-y-0.5">
            <p>{OVERDUE_BEHAVIOUR_LABEL[effective]}</p>
            {configured !== null && configured !== effective && (
              <p className="text-xs text-muted-foreground">Cấu hình “{OVERDUE_BEHAVIOUR_LABEL[configured]}” không áp dụng được cho bước này.</p>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      label="Lịch nhắc hạn theo bước quy trình"
      columns={columns}
      rows={rows}
      query={query}
      getRowId={(r) => r.step.id}
      empty="Chưa có quy trình nào."
      pageSize={null}
    />
  );
}
