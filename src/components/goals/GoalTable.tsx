import { useMemo } from 'react';
import { AlertTriangle, EyeOff, MoreHorizontal } from 'lucide-react';
import { DataTable, MissingValue, type DataTableColumn } from '@/components/shared/DataTable';
import { GoalStatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CALC_METHOD_TYPE_LABEL, type Goal } from '@/data/types';
import type { GoalLookups, PlanWorkspaceData } from '@/hooks/queries/goals';
import { splitPeriodType } from '@/lib/goalPlanRules';
import type { QueryState } from '@/lib/queryState';
import { cn, formatNumber } from '@/lib/utils';
import { formatTarget, formatWeight, issueText, splitLabel } from './goalCopy';

/** What a row menu may do, and why not (shown as the disabled item's tooltip — never hidden). */
export interface GoalRowActions {
  open: (goal: Goal) => void;
  edit: { run: (goal: Goal) => void; refusal: (goal: Goal) => string | null };
  split: { run: (goal: Goal) => void; refusal: (goal: Goal) => string | null };
  link: { run: (goal: Goal) => void; refusal: (goal: Goal) => string | null };
  cascade: { run: (goal: Goal) => void; refusal: (goal: Goal) => string | null } | null;
  remove: { run: (goal: Goal) => void; refusal: (goal: Goal) => string | null };
}

interface GoalTableProps {
  data: PlanWorkspaceData;
  lookups: GoalLookups;
  query: QueryState;
  actions: GoalRowActions;
  /** Show the D3 bucket columns (a manager's plan that cascades). */
  showBuckets: boolean;
}

const ORDER = { Active: 0, Changed: 1, Cancelled: 2 } as const;

function MenuItem({ label, refusal, onSelect }: { label: string; refusal: string | null; onSelect: () => void }) {
  if (!refusal) return <DropdownMenuItem onSelect={onSelect}>{label}</DropdownMenuItem>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <DropdownMenuItem disabled aria-description={refusal}>
            {label}
          </DropdownMenuItem>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs">
        {refusal}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The plan's goals (WBS 4.3.3): one dense table, ordered by BSC perspective then the plan's order;
 * Changed / Cancelled goals muted and struck through (they carry no weight). The weight total is the
 * footer — the plan summary from `goalPlanRules`, never summed here. Bucket columns (D3) are the
 * workspace's `allocationBuckets`.
 */
export function GoalTable({ data, lookups, query, actions, showBuckets }: GoalTableProps) {
  const warningsByGoal = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of [...data.readiness.blocking, ...data.readiness.warnings]) {
      if (!issue.ref) continue;
      map.set(issue.ref, [...(map.get(issue.ref) ?? []), issueText(issue)]);
    }
    return map;
  }, [data.readiness]);

  const rows = useMemo(
    () =>
      [...data.goals].sort(
        (a, b) =>
          ORDER[a.status] - ORDER[b.status] ||
          (lookups.perspective.get(a.perspectiveId)?.sortOrder ?? 99) - (lookups.perspective.get(b.perspectiveId)?.sortOrder ?? 99) ||
          a.sortOrder - b.sortOrder,
      ),
    [data.goals, lookups.perspective],
  );

  const parentsOf = (goal: Goal) => data.alignments.filter((a) => a.childGoalId === goal.id);
  /** "Phân giao từ: Doanh thu (Công ty Syntra)" — the compact form, used beside the bucket columns. */
  const parentLine = (goal: Goal) =>
    parentsOf(goal)
      .map((a) => `${a.alignmentType === 'CASCADE' ? 'Phân giao từ' : 'Liên kết'}: ${data.relatedGoals.get(a.parentGoalId)?.name ?? 'chỉ tiêu riêng tư'}`)
      .join('; ');
  const muted = (goal: Goal) => goal.status !== 'Active';

  const columns: DataTableColumn<Goal>[] = [
    {
      id: 'name',
      header: 'Chỉ tiêu',
      // Sticky, so the row keeps its name while the D3 columns scroll (UI/UX critique).
      className: 'sticky left-0 z-10 min-w-[14rem] bg-inherit',
      cell: (goal) => {
        const kpi = goal.kpiDefId ? lookups.kpi.get(goal.kpiDefId) : undefined;
        const warnings = warningsByGoal.get(goal.id);
        return (
          <div id={`goal-row-${goal.id}`} className={cn('min-w-0 scroll-mt-24', muted(goal) && 'text-muted-foreground line-through')}>
            <div className="flex items-start gap-1.5">
              {warnings && !muted(goal) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} role="img" aria-label={warnings.join(' ')} className="mt-0.5 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <AlertTriangle className="h-4 w-4 text-support-warning" aria-hidden />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{warnings.join(' ')}</TooltipContent>
                </Tooltip>
              )}
              <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => actions.open(goal)}>
                {goal.name}
              </button>
              {goal.visibility === 'PRIVATE' && (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                  Riêng tư
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground no-underline">
              <span>{lookups.perspective.get(goal.perspectiveId)?.name}</span>
              {kpi && <span>{kpi.code}</span>}
              {goal.status !== 'Active' && <GoalStatusBadge status={goal.status} />}
            </div>
            {showBuckets && parentsOf(goal).length > 0 && <div className="mt-0.5 text-xs text-muted-foreground">{parentLine(goal)}</div>}
          </div>
        );
      },
    },
    {
      id: 'weight',
      header: 'Trọng số',
      numeric: true,
      className: 'whitespace-nowrap',
      cell: (goal) => <span className={cn(muted(goal) && 'text-muted-foreground line-through')}>{formatWeight(goal.weight)}</span>,
    },
    {
      id: 'target',
      header: 'Mục tiêu',
      numeric: true,
      cell: (goal) => {
        const levels = data.levels.filter((l) => l.goalId === goal.id);
        const split = splitPeriodType(goal.id, data.periodTargets, data.periods);
        return (
          <div>
            <div className="whitespace-nowrap">{formatTarget(goal, lookups.unit.get(goal.unitId))}</div>
            {split && <div className="whitespace-nowrap text-xs text-muted-foreground">{splitLabel(split)}</div>}
            {levels.length > 0 && (
              <div className="text-xs text-muted-foreground" aria-label={`Có ${levels.length} định mức`}>
                Định mức {levels.map((l) => l.levelCode).sort().join(', ')}
              </div>
            )}
          </div>
        );
      },
    },
    ...(showBuckets
      ? []
      : [
          {
            id: 'measure',
            header: 'Cách đo',
            className: 'min-w-[11rem]',
            cell: (goal: Goal) => {
              const method = lookups.method.get(goal.calcMethodId);
              return (
                <div className="text-sm">
                  <div title={method ? CALC_METHOD_TYPE_LABEL[method.methodType] : undefined}>{method?.name ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">{lookups.dataSource.get(goal.dataSourceId)?.name ?? '—'}</div>
                </div>
              );
            },
          } satisfies DataTableColumn<Goal>,
        ]),
    ...(showBuckets ? [] : [{
      id: 'align',
      header: 'Liên kết lên',
      className: 'min-w-[10rem]',
      cell: (goal) => {
        const parents = parentsOf(goal);
        if (parents.length === 0) return null;
        return (
          <ul className="space-y-0.5 text-xs">
            {parents.map((a) => {
              const parent = data.relatedGoals.get(a.parentGoalId);
              const owner = parent ? data.relatedPlans.get(parent.goalPlanId) : undefined;
              const ownerName = owner
                ? owner.ownerType === 'Employee'
                  ? lookups.employee.get(owner.ownerEmployeeId ?? '')?.fullName
                  : lookups.orgUnit.get(owner.ownerOrgUnitId ?? '')?.name
                : undefined;
              return (
                <li key={a.id}>
                  <span className="text-muted-foreground">{a.alignmentType === 'CASCADE' ? 'Phân giao từ' : 'Liên kết'}: </span>
                  {parent ? `${parent.name}${ownerName ? ` (${ownerName})` : ''}` : 'Chỉ tiêu riêng tư'}
                  {a.alignmentType === 'CASCADE' && a.allocatedValue !== null && <span className="tabular-nums text-muted-foreground"> · {formatNumber(a.allocatedValue)}</span>}
                  {a.alignmentType === 'LINK' && a.contributionPct !== null && <span className="tabular-nums text-muted-foreground"> · {formatNumber(a.contributionPct)}%</span>}
                </li>
              );
            })}
          </ul>
        );
      },
    } satisfies DataTableColumn<Goal>]),
  ];

  if (showBuckets) {
    const bucket = (goal: Goal) => data.buckets.get(goal.id);
    columns.push(
      { id: 'assigned', header: 'Đã giao', numeric: true, className: 'whitespace-nowrap', cell: (goal) => (bucket(goal) ? formatNumber(bucket(goal)!.assigned) : null) },
      { id: 'self', header: 'Tự giao', numeric: true, className: 'whitespace-nowrap', cell: (goal) => (bucket(goal) ? formatNumber(bucket(goal)!.selfAssigned) : null) },
      {
        id: 'unassigned',
        header: 'Chưa giao',
        numeric: true,
        className: 'whitespace-nowrap',
        cell: (goal) => {
          const b = bucket(goal);
          if (!b || b.unassigned === null) return null;
          return (
            <span className={cn('inline-flex items-center gap-1', b.overAllocated && 'text-support-negative')}>
              {(b.overAllocated || b.unassigned > 0) && (
                <AlertTriangle className={cn('h-3.5 w-3.5', b.overAllocated ? 'text-support-negative' : 'text-support-warning')} aria-hidden />
              )}
              {formatNumber(b.unassigned)}
              {b.overAllocated && <span className="text-xs"> vượt mục tiêu</span>}
              {b.heldByLeavers > 0 && <span className="text-xs text-muted-foreground"> (gồm {formatNumber(b.heldByLeavers)} của người đã nghỉ)</span>}
            </span>
          );
        },
      },
      // Not tracked in P1 (ASSUMPTION Q11) — the column says so instead of disappearing.
      { id: 'own', header: 'Tự thực hiện', numeric: true, className: 'whitespace-nowrap', cell: (goal) => (bucket(goal) ? <MissingValue /> : null) },
    );
  }

  columns.push({
    id: 'actions',
    header: 'Thao tác',
    className: 'w-12',
    cell: (goal) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Thao tác với chỉ tiêu ${goal.name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => actions.open(goal)}>Xem chi tiết</DropdownMenuItem>
          <MenuItem label="Sửa chỉ tiêu và định mức" refusal={actions.edit.refusal(goal)} onSelect={() => actions.edit.run(goal)} />
          <MenuItem label="Phân bổ mục tiêu theo kỳ" refusal={actions.split.refusal(goal)} onSelect={() => actions.split.run(goal)} />
          <MenuItem label="Liên kết lên chỉ tiêu cấp trên" refusal={actions.link.refusal(goal)} onSelect={() => actions.link.run(goal)} />
          {actions.cascade && <MenuItem label="Phân giao" refusal={actions.cascade.refusal(goal)} onSelect={() => actions.cascade!.run(goal)} />}
          <DropdownMenuSeparator />
          <MenuItem label="Xóa chỉ tiêu" refusal={actions.remove.refusal(goal)} onSelect={() => actions.remove.run(goal)} />
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  });

  const footer = (
    <TableRow className="sticky bottom-0 bg-background font-medium">
      <TableCell className="sticky left-0 z-10 bg-inherit">
        Tổng trọng số
        {data.hiddenCount > 0 && <span className="block text-xs font-normal text-muted-foreground">Gồm {data.hiddenCount} chỉ tiêu riêng tư bạn không xem được</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {!data.summary.weightComplete && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-support-warning" aria-label="Chưa đủ 100%" />}
        {formatWeight(data.summary.totalWeight)} / 100%
      </TableCell>
      <TableCell colSpan={columns.length - 2} />
    </TableRow>
  );

  return (
    <DataTable
      label="Danh sách chỉ tiêu của Goal Plan"
      columns={columns}
      rows={rows}
      query={query}
      getRowId={(goal) => goal.id}
      empty={data.hiddenCount > 0 ? `Goal Plan có ${data.hiddenCount} chỉ tiêu riêng tư bạn không xem được.` : 'Goal Plan chưa có chỉ tiêu nào.'}
      pageSize={null}
      footer={rows.length > 0 ? footer : undefined}
    />
  );
}
