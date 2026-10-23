import { useEffect, useState, type ReactNode } from 'react';
import { EyeOff, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { StatusBadge, WorkTaskStatusBadge } from '@/components/shared/StatusBadge';
import { WORK_TASK_STATUS_LABEL, type WorkTask, type WorkTaskStatus } from '@/data/types';
import { followProgress } from '@/lib/workRules';
import type { QueryState } from '@/lib/queryState';
import { cn, formatDate, formatNumber } from '@/lib/utils';

type LiveStatus = Exclude<WorkTaskStatus, 'Cancelled'>;
const LIVE_STATUSES: LiveStatus[] = ['NotStarted', 'InProgress', 'Done'];

/** `plan` — the list is being written; `track` — approved, progress moves; `read` — look only. */
export type WorkTableMode = 'plan' | 'track' | 'read';

export interface WorkTaskActions {
  /** Plan mode: edit / remove a task (the step allows EDIT and the user is entitled). */
  edit?: (task: WorkTask) => void;
  remove?: (task: WorkTask) => void;
  /** Track mode: change % / status (committed at once), the note, or cancel (manager). */
  progress?: (task: WorkTask, next: { progressPct: number; progressStatus: LiveStatus }) => void;
  note?: (task: WorkTask) => void;
  cancel?: (task: WorkTask) => void;
}

interface WorkTaskTableProps {
  tasks: readonly WorkTask[] | undefined;
  query: QueryState;
  mode: WorkTableMode;
  /** Show "Hoàn thành (%)" and "Trạng thái" — from approval on (planning would read 0 / "Chưa bắt đầu" everywhere). */
  showProgress: boolean;
  actions: WorkTaskActions;
  /** The first-use sentence. */
  empty: ReactNode;
  /** "Thêm việc", "Sao chép tháng trước" — the toolbar row above the table. */
  toolbar?: ReactNode;
  toolbarActions?: ReactNode;
  /** A KPI the task serves, by goal id (the employee's own plan). */
  goalName?: (goalId: string) => string | null;
  /** Mark these rows (a refusal named them). */
  flagged?: ReadonlySet<string>;
  pendingTaskId?: string | null;
}

/** One cell of "Hoàn thành (%)": typed, committed on blur or Enter (ui-ux, B2 — no modal for the most frequent action). */
function ProgressCell({ task, onCommit, disabled }: { task: WorkTask; onCommit: (pct: number) => void; disabled: boolean }) {
  const [value, setValue] = useState(String(task.progressPct));
  useEffect(() => setValue(String(task.progressPct)), [task.progressPct]);
  const commit = () => {
    const n = Number(value.replace(',', '.'));
    if (value.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) {
      setValue(String(task.progressPct));
      return;
    }
    if (n !== task.progressPct) onCommit(n);
  };
  return (
    <Input
      type="number"
      min={0}
      max={100}
      step={5}
      value={value}
      disabled={disabled}
      aria-label={`Hoàn thành (%) — ${task.name}`}
      className="h-8 w-20 text-right tabular"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/**
 * A month's tasks (HR guide pp. 25–26): name with product and the "Riêng tư" tag, unit, weight,
 * dates, and — once the plan is approved — % complete and status, edited in place. A cancelled task
 * stays, struck through, with its reason on a second line (never on hover). Planning hides % and
 * status: every row would read 0 / "Chưa bắt đầu".
 */
export function WorkTaskTable({ tasks, query, mode, showProgress, actions, empty, toolbar, toolbarActions, goalName, flagged, pendingTaskId }: WorkTaskTableProps) {
  const tracking = showProgress;
  const rowMenu = (t: WorkTask) => {
    const items: { label: string; run: () => void; destructive?: boolean }[] = [];
    if (mode === 'plan' && actions.edit) items.push({ label: 'Sửa', run: () => actions.edit!(t) });
    if (mode === 'plan' && actions.remove) items.push({ label: 'Xóa', run: () => actions.remove!(t), destructive: true });
    if (mode === 'track' && t.cancelledAt === null && actions.note) items.push({ label: 'Ghi chú tiến độ', run: () => actions.note!(t) });
    if (mode === 'track' && t.cancelledAt === null && actions.cancel) items.push({ label: 'Hủy việc', run: () => actions.cancel!(t), destructive: true });
    if (items.length === 0) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Thao tác — ${t.name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map((i) => (
            <DropdownMenuItem key={i.label} onSelect={i.run} className={cn(i.destructive && 'text-support-negative')}>
              {i.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const columns: DataTableColumn<WorkTask>[] = [
    {
      id: 'name',
      header: 'Công việc',
      className: 'min-w-[16rem]',
      cell: (t) => {
        const cancelled = t.cancelledAt !== null;
        const kpi = t.linkedGoalId && goalName ? goalName(t.linkedGoalId) : null;
        return (
          <div className={cn('space-y-0.5', flagged?.has(t.id) && 'rounded ring-2 ring-support-negative/60 ring-offset-2')}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn('font-medium', cancelled && 'text-muted-foreground line-through')}>{t.name}</span>
              {t.visibility === 'PRIVATE' && (
                <StatusBadge tone="muted">
                  <EyeOff className="h-3 w-3" aria-hidden />
                  Riêng tư
                </StatusBadge>
              )}
              {cancelled && <WorkTaskStatusBadge status="Cancelled" />}
            </div>
            {(t.product || kpi) && (
              <p className="text-xs text-muted-foreground">{[t.product, kpi ? `KPI: ${kpi}` : null].filter(Boolean).join(' · ')}</p>
            )}
            {cancelled && t.cancelReason && <p className="text-xs text-muted-foreground">Lý do hủy: {t.cancelReason}</p>}
            {tracking && t.note && !cancelled && <p className="text-xs text-muted-foreground">Ghi chú: {t.note}</p>}
          </div>
        );
      },
    },
    { id: 'unit', header: 'Đơn vị đo', cell: (t) => t.unitText },
    {
      id: 'weight',
      header: 'Trọng số (%)',
      numeric: true,
      cell: (t) => <span className={cn(t.cancelledAt !== null && 'text-muted-foreground line-through')}>{formatNumber(t.weight)}</span>,
    },
    {
      id: 'dates',
      header: 'Bắt đầu – Kết thúc',
      cell: (t) => (
        <span className="tabular whitespace-nowrap">
          {formatDate(t.startDate)} – {formatDate(t.dueDate)}
        </span>
      ),
    },
  ];

  if (tracking) {
    const live = (t: WorkTask) => t.cancelledAt === null && mode === 'track' && actions.progress !== undefined;
    columns.push(
      {
        id: 'progress',
        header: 'Hoàn thành (%)',
        numeric: true,
        cell: (t) =>
          live(t) ? (
            <ProgressCell
              task={t}
              disabled={pendingTaskId === t.id}
              onCommit={(pct) => actions.progress!(t, followProgress({ progressPct: t.progressPct, progressStatus: t.progressStatus as LiveStatus }, { progressPct: pct }))}
            />
          ) : (
            formatNumber(t.progressPct)
          ),
      },
      {
        id: 'status',
        header: 'Trạng thái',
        cell: (t) =>
          live(t) ? (
            <Select
              value={t.progressStatus}
              disabled={pendingTaskId === t.id}
              onValueChange={(v) =>
                actions.progress!(t, followProgress({ progressPct: t.progressPct, progressStatus: t.progressStatus as LiveStatus }, { progressStatus: v as LiveStatus }))
              }
            >
              <SelectTrigger className="h-8 w-40" aria-label={`Trạng thái — ${t.name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIVE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {WORK_TASK_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : t.cancelledAt !== null ? null : (
            <WorkTaskStatusBadge status={t.progressStatus} />
          ),
      },
    );
  }
  if (mode !== 'read') columns.push({ id: 'menu', header: '', className: 'w-10', cell: (t) => rowMenu(t) ?? <span className="sr-only">Không có thao tác</span> });

  return (
    <DataTable
      label="Các việc trong tháng"
      columns={columns}
      rows={tasks}
      query={query}
      getRowId={(t) => t.id}
      empty={empty}
      toolbar={toolbar}
      actions={toolbarActions}
      pageSize={null}
    />
  );
}
