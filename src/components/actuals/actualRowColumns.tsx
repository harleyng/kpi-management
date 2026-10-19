import type { DataTableColumn } from '@/components/shared/DataTable';
import type { ActualImportRow } from '@/data/types';
import { formatNumber } from '@/lib/utils';
import type { useCycleGoalData } from './useCycleGoalData';

/** The actuals row as the preview shows it: the goal by name when it resolves, else what the file said. */
export function actualRowColumns(data: ReturnType<typeof useCycleGoalData>['data'] | null): DataTableColumn<ActualImportRow>[] {
  const goals = new Map((data?.goals ?? []).map((g) => [g.id, g]));
  const employees = new Map((data?.employees ?? []).map((e) => [e.id, e.fullName]));
  return [
    {
      id: 'goal',
      header: 'Chỉ tiêu',
      className: 'min-w-56',
      cell: (r) => {
        const goal = r.goalId ? goals.get(r.goalId) : undefined;
        if (goal) {
          return (
            <div>
              <p className="line-clamp-2">{goal.name}</p>
              {goal.ownerEmployeeId && <p className="text-xs text-muted-foreground">{employees.get(goal.ownerEmployeeId)}</p>}
            </div>
          );
        }
        const key = [r.login, r.kpiCode].filter(Boolean).join(', ');
        return <span className="break-all text-muted-foreground">{r.goalId ?? (key || null)}</span>;
      },
    },
    { id: 'period', header: 'Kỳ', cell: (r) => r.periodLabel || null },
    {
      id: 'value',
      header: 'Giá trị',
      numeric: true,
      cell: (r) => (r.actualValue !== null ? formatNumber(r.actualValue) : r.actualText),
    },
    { id: 'note', header: 'Ghi chú', className: 'min-w-32', cell: (r) => r.note },
  ];
}
