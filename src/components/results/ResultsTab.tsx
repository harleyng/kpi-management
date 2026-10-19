import { useMemo, useState } from 'react';
import { Calculator, ChevronDown, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { SearchInput } from '@/components/shared/SearchInput';
import { PeriodResultStatusBadge } from '@/components/shared/StatusBadge';
import { useSession } from '@/contexts/useSession';
import {
  OWNER_TYPES,
  OWNER_TYPE_LABEL,
  PERIOD_RESULT_STATUSES,
  PERIOD_RESULT_STATUS_LABEL,
  type CyclePeriod,
  type Id,
  type OwnerType,
  type PerformanceCycle,
  type PeriodResultStatus,
  type RatingLevel,
} from '@/data/types';
import { isBlockedFinalize, useCalculateResults, useFinalizeResults, useLockResults, useResultRows } from '@/hooks/queries/results';
import { matchesSearch } from '@/lib/search';
import { draftSelection, payoutState, type ResultRow } from '@/lib/resultView';
import { AdjustmentValue, PayoutValue, RatingValue, ScoreValue } from './ResultCells';
import { FinalizeIssuesPanel } from './FinalizeIssuesPanel';
import { ResultDetailDialog } from './ResultDetailDialog';

type Filter<T extends string> = T | 'all';
const TIER_ORDER: Record<OwnerType, number> = { Company: 0, OrgUnit: 1, Employee: 2 };

interface ResultsTabProps {
  cycle: PerformanceCycle;
  period: CyclePeriod;
  levels: readonly RatingLevel[];
  scaleName: string | null;
}

/**
 * "Kết quả kỳ" (WBS 4.6.1, 4.6.2, 4.6.4): the period's results, and HR's three acts on them —
 * calculate, finalise (all or none), lock. Mounted per period (`key`), so a period change clears the
 * selection, the filters and the blocking-issues panel.
 */
export function ResultsTab({ cycle, period, levels, scaleName }: ResultsTabProps) {
  const { can } = useSession();
  const mayFinalize = can('result.finalize');
  const { rows, counts, query } = useResultRows(period, levels);
  const calculate = useCalculateResults();
  const finalize = useFinalizeResults();
  const lock = useLockResults();

  const [search, setSearch] = useState('');
  const [tier, setTier] = useState<Filter<OwnerType>>('all');
  const [status, setStatus] = useState<Filter<PeriodResultStatus>>('all');
  const [selected, setSelected] = useState<ReadonlySet<Id>>(new Set());
  const [openId, setOpenId] = useState<Id | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'finalize'; ids?: Id[] } | { kind: 'lock' }>(null);

  const closed = cycle.status === 'Closed';
  const isFiltered = search.trim() !== '' || tier !== 'all' || status !== 'all';
  const visible = useMemo(
    () =>
      rows
        ?.filter((r) => (tier === 'all' || r.result.ownerType === tier) && (status === 'all' || r.result.status === status))
        .filter((r) => matchesSearch(search, [r.ownerName, r.ownerCode, r.unitName]))
        .sort((a, b) => TIER_ORDER[a.result.ownerType] - TIER_ORDER[b.result.ownerType] || a.ownerName.localeCompare(b.ownerName, 'vi')),
    [rows, tier, status, search],
  );
  const results = useMemo(() => rows?.map((r) => r.result) ?? [], [rows]);
  const chosen = draftSelection(selected, results);
  const visibleDrafts = (visible ?? []).filter((r) => r.result.status === 'Draft');
  const allVisibleChosen = visibleDrafts.length > 0 && visibleDrafts.every((r) => selected.has(r.result.id));
  const drafts = counts?.Draft ?? 0;
  const finals = counts?.Final ?? 0;
  const openRow = openId ? (rows?.find((r) => r.result.id === openId) ?? null) : null;
  const blocked = isBlockedFinalize(finalize.error) ? finalize.error.issues : null;

  const toggle = (id: Id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of visibleDrafts) {
        if (allVisibleChosen) next.delete(r.result.id);
        else next.add(r.result.id);
      }
      return next;
    });

  const runFinalize = (ids?: Id[]) =>
    finalize.mutate(
      { periodId: period.id, resultIds: ids },
      { onSuccess: () => setSelected(new Set()) },
    );

  const columns: DataTableColumn<ResultRow>[] = [
    {
      id: 'select',
      header: 'Chọn',
      className: 'w-12',
      cell: (r) => (
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary disabled:opacity-40"
          checked={selected.has(r.result.id)}
          disabled={r.result.status !== 'Draft' || !mayFinalize}
          onChange={() => toggle(r.result.id)}
          aria-label={r.result.status === 'Draft' ? `Chọn ${r.ownerName}` : `${r.ownerName}: đã chốt, không chọn được`}
        />
      ),
    },
    {
      id: 'owner',
      header: 'Đối tượng',
      sortValue: (r) => r.ownerName,
      cell: (r) => (
        <div className="flex min-w-0 flex-col items-start">
          <button
            type="button"
            className="max-w-[16rem] truncate text-left font-medium text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
            title={r.ownerName}
            onClick={() => setOpenId(r.result.id)}
          >
            {r.ownerName}
          </button>
          {r.ownerCode && <span className="text-xs text-muted-foreground">{r.ownerCode}</span>}
        </div>
      ),
    },
    { id: 'tier', header: 'Cấp', className: 'whitespace-nowrap', sortValue: (r) => TIER_ORDER[r.result.ownerType], cell: (r) => OWNER_TYPE_LABEL[r.result.ownerType] },
    { id: 'unit', header: 'Đơn vị', sortValue: (r) => r.unitName, cell: (r) => (r.unitName ? <span className="block max-w-[12rem] truncate" title={r.unitName}>{r.unitName}</span> : null) },
    { id: 'score', header: 'Điểm KPI', numeric: true, sortValue: (r) => r.result.totalScore, cell: (r) => <ScoreValue result={r.result} /> },
    { id: 'adjustment', header: 'Điều chỉnh (điểm)', numeric: true, sortValue: (r) => r.result.adjustmentPct, cell: (r) => <AdjustmentValue points={r.result.adjustmentPct} /> },
    { id: 'rating', header: 'Xếp loại', sortValue: (r) => r.level?.minScore ?? null, cell: (r) => <RatingValue result={r.result} level={r.level} /> },
    { id: 'payout', header: '% hưởng lương KPI', numeric: true, sortValue: (r) => r.result.payoutPct, cell: (r) => <PayoutValue state={payoutState(r.result, levels)} /> },
    { id: 'status', header: 'Trạng thái', sortValue: (r) => r.result.status, cell: (r) => <PeriodResultStatusBadge status={r.result.status} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {counts ? (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-label="Số kết quả theo trạng thái">
            {PERIOD_RESULT_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(status === s ? 'all' : s)}
                aria-pressed={status === s}
                className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-surface-alt aria-pressed:bg-primary-subtle"
              >
                <PeriodResultStatusBadge status={s} />
                <span className="tabular font-medium">{counts[s]}</span>
              </button>
            ))}
          </p>
        ) : (
          <span />
        )}
        {mayFinalize && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={closed || calculate.isPending} onClick={() => calculate.mutate(period.id)} aria-busy={calculate.isPending || undefined}>
              <Calculator className="mr-1.5 h-4 w-4" aria-hidden />
              {calculate.isPending ? 'Đang tính…' : rows && rows.length > 0 ? 'Tính lại kết quả' : 'Tính kết quả'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant={drafts > 0 ? 'default' : 'outline'} disabled={closed || drafts === 0 || finalize.isPending}>
                  {finalize.isPending ? 'Đang chốt…' : 'Chốt kết quả'}
                  <ChevronDown className="ml-1.5 h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={chosen.length === 0} onSelect={() => setConfirm({ kind: 'finalize', ids: chosen })}>
                  {chosen.length === 0 ? 'Chốt các kết quả đã chọn (chưa chọn kết quả nào)' : `Chốt các kết quả đã chọn (${chosen.length})`}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setConfirm({ kind: 'finalize' })}>Chốt tất cả bản nháp ({drafts})</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant={drafts === 0 && finals > 0 ? 'default' : 'outline'} disabled={finals === 0 || lock.isPending} onClick={() => setConfirm({ kind: 'lock' })}>
              <Lock className="mr-1.5 h-4 w-4" aria-hidden />
              {lock.isPending ? 'Đang khóa…' : 'Khóa kết quả'}
            </Button>
          </div>
        )}
      </div>
      {mayFinalize && (
        <p className="text-xs text-muted-foreground">
          {closed
            ? 'Chu kỳ đã đóng: không tính lại, điều chỉnh hay chốt được nữa. Vẫn khóa và xuất file lương được.'
            : 'Chốt: điểm được làm tròn và không tính lại nữa. Khóa kết quả không khóa kỳ nhập số liệu.'}
        </p>
      )}

      {blocked && rows && (
        <FinalizeIssuesPanel issues={blocked} rows={rows} onShow={setOpenId} onDismiss={() => finalize.reset()} />
      )}

      <DataTable
        label={`Kết quả ${period.label}`}
        columns={columns}
        rows={visible}
        query={query}
        getRowId={(r) => r.result.id}
        empty={
          mayFinalize && !closed
            ? 'Chưa có kết quả cho kỳ này. Bấm "Tính kết quả" khi phiếu đánh giá của kỳ đã hoàn thành.'
            : 'Chưa có kết quả cho kỳ này. Kết quả có sau khi phiếu đánh giá hoàn thành và HR tính kết quả.'
        }
        isFiltered={isFiltered}
        onClearFilters={() => {
          setSearch('');
          setTier('all');
          setStatus('all');
        }}
        pageResetKey={`${search}|${tier}|${status}`}
        toolbar={
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Tìm theo tên, mã, đơn vị" label="Tìm kết quả" className="w-64" />
            <Select value={tier} onValueChange={(v) => setTier(v as Filter<OwnerType>)}>
              <SelectTrigger className="h-9 w-36" aria-label="Lọc theo cấp">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Mọi cấp</SelectItem>
                {OWNER_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {OWNER_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as Filter<PeriodResultStatus>)}>
              <SelectTrigger className="h-9 w-40" aria-label="Lọc theo trạng thái">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Mọi trạng thái</SelectItem>
                {PERIOD_RESULT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PERIOD_RESULT_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mayFinalize && visibleDrafts.length > 0 && (
              <label className="ml-auto flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={allVisibleChosen} onChange={toggleAllVisible} />
                Chọn tất cả bản nháp đang hiện ({visibleDrafts.length})
              </label>
            )}
            <span className="sr-only" aria-live="polite">
              {chosen.length > 0 ? `Đã chọn ${chosen.length} trên ${drafts} bản nháp` : ''}
            </span>
          </div>
        }
      />
      {rows && rows.length > 0 && <p className="text-xs text-muted-foreground">Bấm vào tên để xem chi tiết từng chỉ tiêu.</p>}

      <ResultDetailDialog row={openRow} period={period} levels={levels} onOpenChange={(open) => !open && setOpenId(null)} canAdjust={mayFinalize && !closed} scaleName={scaleName} />

      <ConfirmDialog
        open={confirm?.kind === 'finalize'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.kind === 'finalize' && confirm.ids ? `Chốt ${confirm.ids.length} kết quả đã chọn?` : `Chốt tất cả ${drafts} bản nháp của kỳ ${period.label}?`}
        body="Điểm được làm tròn 2 chữ số và không tính lại được nữa. Nếu còn một kết quả vướng, không kết quả nào được chốt và màn hình liệt kê mọi chỗ vướng."
        confirmLabel="Chốt kết quả"
        onConfirm={() => {
          if (confirm?.kind === 'finalize') runFinalize(confirm.ids);
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'lock'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Khóa ${finals} kết quả đã chốt của kỳ ${period.label}?`}
        body="Kết quả đã khóa không sửa được. Bản tạm tính giữ nguyên. Việc này không khóa kỳ nhập số liệu."
        confirmLabel="Khóa kết quả"
        onConfirm={() => {
          lock.mutate(period.id);
          setConfirm(null);
        }}
      />
    </div>
  );
}
