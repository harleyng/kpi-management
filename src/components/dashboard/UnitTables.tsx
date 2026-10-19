import { useMemo, useState } from 'react';
import { DataTable, MissingValue, type DataTableColumn } from '@/components/shared/DataTable';
import { AttentionBadge, PeriodResultStatusBadge } from '@/components/shared/StatusBadge';
import { PayoutValue, RatingValue, ScoreValue } from '@/components/results/ResultCells';
import { ResultDetailDialog } from '@/components/results/ResultDetailDialog';
import type { Id, RatingLevel } from '@/data/types';
import { isResultFlagged, scoreDelta, type DashboardModel, type StaffEntry, type UnitNode } from '@/lib/dashboardRules';
import type { QueryState } from '@/lib/queryState';
import { payoutState, type ResultRow } from '@/lib/resultView';
import { DeltaValue, StaffAverageValue } from './DashboardFigures';

/** The tables below read rows the page already holds — never a loading state of their own. */
const READY: QueryState = { isPending: false, fetchStatus: 'idle', error: null, refetch: () => undefined };

/** The visible child units of the unit in focus: the main comparison surface. The name drills down. */
export function ChildUnitsTable({ model, nodes, onSelect }: { model: DashboardModel; nodes: UnitNode[]; onSelect: (unitId: Id) => void }) {
  const hasPrevious = model.previous !== null;
  const columns: DataTableColumn<UnitNode>[] = [
    {
      id: 'name',
      header: 'Đơn vị',
      cell: (n) => (
        <button type="button" className="text-left font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none" onClick={() => onSelect(n.unit.id)}>
          {n.unit.name}
        </button>
      ),
      sortValue: (n) => n.unit.name,
    },
    {
      id: 'score',
      header: 'Điểm đơn vị',
      numeric: true,
      cell: (n) =>
        n.ownPlan === null ? (
          <span className="text-xs text-muted-foreground">Chưa có kế hoạch</span>
        ) : n.own ? (
          <span className="flex flex-col items-end gap-1">
            <ScoreValue result={n.own} />
            <PeriodResultStatusBadge status={n.own.status} />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Chưa có kết quả</span>
        ),
      sortValue: (n) => n.own?.totalScore ?? null,
    },
    { id: 'rating', header: 'Xếp loại', cell: (n) => (n.own ? <RatingValue result={n.own} level={n.ownLevel} /> : <MissingValue />) },
    {
      id: 'delta',
      header: 'Chênh lệch (điểm)',
      numeric: true,
      cell: (n) => (n.ownPlan === null ? <MissingValue /> : <DeltaValue delta={n.delta} hasPrevious={hasPrevious} />),
      sortValue: (n) => n.delta.points,
    },
    {
      id: 'staff',
      header: 'Điểm trung bình nhân viên',
      numeric: true,
      cell: (n) => <StaffAverageValue average={n.staffAverage} counted={n.staffCounted} total={n.staffTotal} />,
      sortValue: (n) => n.staffAverage,
    },
    { id: 'attention', header: 'Cần chú ý', cell: (n) => (n.flagged ? <AttentionBadge kind="LOW_RATING" /> : null) },
  ];
  return (
    <DataTable
      label="Các đơn vị trực thuộc"
      columns={columns}
      rows={nodes}
      query={READY}
      getRowId={(n) => n.unit.id}
      empty="Đơn vị này không có đơn vị trực thuộc trong phạm vi bạn xem."
      pageSize={null}
    />
  );
}

interface StaffRow {
  entry: StaffEntry;
  name: string;
  code: string | null;
  level: RatingLevel | null;
}

/**
 * The people placed in one unit for the period (Q43). A name opens T6's result dialog in visibility
 * mode (`plan`), so a PRIVATE goal is never named to a viewer who may not see it.
 */
export function StaffTable({
  model,
  staff,
  levels,
  unitName,
}: {
  model: DashboardModel;
  staff: StaffEntry[];
  levels: readonly RatingLevel[];
  unitName: string;
}) {
  const [openId, setOpenId] = useState<Id | null>(null);
  const levelById = useMemo(() => new Map(levels.map((l) => [l.id, l])), [levels]);
  const rows = useMemo<StaffRow[]>(
    () =>
      staff.map((entry) => ({
        entry,
        name: entry.employee?.fullName ?? 'Không xác định',
        code: entry.employee?.employeeCode ?? null,
        level: entry.result?.ratingLevelId ? (levelById.get(entry.result.ratingLevelId) ?? null) : null,
      })),
    [staff, levelById],
  );
  const openRow = rows.find((r) => r.entry.result !== null && r.entry.result.id === openId) ?? null;
  const dialogRow: ResultRow | null =
    openRow && openRow.entry.result ? { result: openRow.entry.result, ownerName: openRow.name, ownerCode: openRow.code, unitName, level: openRow.level } : null;

  const columns: DataTableColumn<StaffRow>[] = [
    {
      id: 'name',
      header: 'Nhân viên',
      cell: (r) =>
        r.entry.result ? (
          <span className="flex min-w-[9rem] flex-col">
            <button type="button" className="text-left font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none" onClick={() => setOpenId(r.entry.result?.id ?? null)}>
              {r.name}
            </button>
            <span className="tabular text-xs text-muted-foreground">{r.code}</span>
          </span>
        ) : (
          <span className="flex min-w-[9rem] flex-col">
            <span className="font-medium">{r.name}</span>
            <span className="tabular text-xs text-muted-foreground">{r.code}</span>
          </span>
        ),
      sortValue: (r) => r.name,
    },
    {
      id: 'score',
      header: 'Điểm KPI',
      numeric: true,
      cell: (r) => (r.entry.result ? <ScoreValue result={r.entry.result} /> : <span className="text-xs text-muted-foreground">Chưa có kết quả</span>),
      sortValue: (r) => r.entry.result?.totalScore ?? null,
    },
    { id: 'rating', header: 'Xếp loại', cell: (r) => (r.entry.result ? <RatingValue result={r.entry.result} level={r.level} /> : <MissingValue />) },
    {
      id: 'payout',
      header: '% hưởng lương',
      numeric: true,
      cell: (r) => (r.entry.result ? <PayoutValue state={payoutState(r.entry.result, levels)} /> : <MissingValue />),
    },
    {
      id: 'delta',
      header: 'Chênh lệch (điểm)',
      numeric: true,
      cell: (r) => <DeltaValue delta={scoreDelta(r.entry.result, r.entry.previous)} hasPrevious={model.previous !== null} />,
    },
    { id: 'status', header: 'Trạng thái', cell: (r) => (r.entry.result ? <PeriodResultStatusBadge status={r.entry.result.status} /> : <span className="text-xs text-muted-foreground">Chưa có phiếu</span>) },
    {
      id: 'attention',
      header: 'Cần chú ý',
      cell: (r) => (r.entry.result && isResultFlagged(r.entry.result, model.flaggedLevels) ? <AttentionBadge kind="LOW_RATING" /> : null),
    },
  ];

  return (
    <>
      <DataTable
        label={`Nhân viên của ${unitName}`}
        columns={columns}
        rows={rows}
        query={READY}
        getRowId={(r) => r.entry.plan.id}
        empty="Đơn vị này không có nhân viên có kế hoạch trong kỳ."
        pageSize={null}
      />
      <ResultDetailDialog
        row={dialogRow}
        period={model.period}
        levels={levels}
        onOpenChange={(o) => !o && setOpenId(null)}
        canAdjust={false}
        plan={openRow?.entry.plan}
      />
      <p className="text-xs text-muted-foreground">
        Mỗi người được tính ở đơn vị họ thuộc vào ngày cuối kỳ (giả định Q43). Bấm tên để xem từng chỉ tiêu. Điểm trung bình không
        tính kết quả tạm tính.
      </p>
    </>
  );
}
