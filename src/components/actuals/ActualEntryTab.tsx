import { useCallback, useMemo, useState } from 'react';
import { CircleDashed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { SearchInput } from '@/components/shared/SearchInput';
import { useSession } from '@/contexts/useSession';
import { SOURCE_TYPE_LABEL, SOURCE_TYPES, type CyclePeriod, type Id, type SourceType } from '@/data/types';
import { useActuals } from '@/hooks/queries/actuals';
import { usePeriods } from '@/hooks/queries/goals';
import { usePeriodResults } from '@/hooks/queries/results';
import {
  actualEntrySummary,
  buildActualEntryRows,
  EMPTY_ACTUAL_ENTRY_FILTER,
  filterActualEntryRows,
  isActualEntryFiltered,
  nextEntryRow,
  type ActualEntryFilter,
  type ActualEntryRow,
} from '@/lib/actualEntryRules';
import { issueText } from '@/lib/errorCatalog';
import { resourceOfOwner } from '@/lib/permissionRules';
import { combineQueries } from '@/lib/queryState';
import { cn, formatDateTime, formatNumber } from '@/lib/utils';
import { ActualEntrySheet } from './ActualEntrySheet';
import { ActualValue, SourceTypeTag } from './ActualValue';
import { useCycleGoalData } from './useCycleGoalData';

const ALL = '__all__';

/**
 * "Nhập tay" (WBS 4.4.2): every goal of the cycle for one month, its target and current number, and
 * whether a number can be entered — the rows come whole from `actualEntryRules.buildActualEntryRows`.
 * "Còn X/Y chỉ tiêu chưa có số" sits in the toolbar and filters to those goals.
 */
export function ActualEntryTab({ cycleId, period }: { cycleId: Id | null; period: CyclePeriod | null }) {
  const { tenantId, today, can } = useSession();
  const cycleData = useCycleGoalData(cycleId);
  const actuals = useActuals({ periodId: period?.id }, { enabled: period !== null });
  const results = usePeriodResults({ periodId: period?.id }, { enabled: period !== null });
  // The cycle's quarters: a month under a quarter-only split shows the target derived from it (Q67).
  const periods = usePeriods(cycleId);
  const [filter, setFilter] = useState<ActualEntryFilter>(EMPTY_ACTUAL_ENTRY_FILTER);
  const [openGoalId, setOpenGoalId] = useState<Id | null>(null);

  const mayEnter = useCallback((plan: Parameters<typeof resourceOfOwner>[1]) => can('actual.enter', resourceOfOwner(tenantId, plan)), [can, tenantId]);
  const rows = useMemo(() => {
    if (!cycleData.data || !period || !actuals.data || !results.data || !periods.data) return undefined;
    return buildActualEntryRows({ ...cycleData.data, period, periods: periods.data, actuals: actuals.data, results: results.data, asOf: today, mayEnter });
  }, [cycleData.data, period, periods.data, actuals.data, results.data, today, mayEnter]);
  const visible = useMemo(() => (rows ? filterActualEntryRows(rows, filter) : undefined), [rows, filter]);
  const summary = rows ? actualEntrySummary(rows) : null;
  const units = useMemo(() => [...new Map((rows ?? []).filter((r) => r.orgUnit).map((r) => [r.orgUnit!.id, r.orgUnit!.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi')), [rows]);
  const query = combineQueries([cycleData.query, actuals, results, periods]);

  // The open row comes from ALL rows: saving a number may take it out of the filtered list.
  const openRow = (openGoalId && rows?.find((r) => r.goal.id === openGoalId)) || null;
  const nextRow = openGoalId && rows && visible ? nextEntryRow(rows, visible, openGoalId) : null;

  const columns: DataTableColumn<ActualEntryRow>[] = [
    {
      id: 'owner',
      header: 'Người phụ trách',
      className: 'min-w-40',
      sortValue: (r) => r.ownerName,
      cell: (r) => (
        <div className="min-w-0">
          <p className="font-medium">{r.ownerName}</p>
          {r.orgUnit && r.orgUnit.name !== r.ownerName && <p className="text-xs text-muted-foreground">{r.orgUnit.name}</p>}
        </div>
      ),
    },
    {
      id: 'goal',
      header: 'Chỉ tiêu và nguồn số liệu',
      className: 'min-w-56',
      sortValue: (r) => r.goal.name,
      cell: (r) => (
        <div className="min-w-0">
          <p className="line-clamp-2">{r.goal.name}</p>
          {r.dataSource && <p className="text-xs text-muted-foreground">{r.dataSource.name}</p>}
        </div>
      ),
    },
    {
      id: 'target',
      header: 'Mục tiêu kỳ',
      numeric: true,
      sortValue: (r) => (typeof r.target === 'number' ? r.target : null),
      cell: (r) => (r.target === null ? null : typeof r.target === 'number' ? formatNumber(r.target) : r.target),
    },
    { id: 'actual', header: 'Thực tế', numeric: true, sortValue: (r) => r.current?.actualValue ?? null, cell: (r) => <ActualValue actual={r.current} className="font-medium" /> },
    {
      // One column for "where the number stands": blocked (why), entered (source and when), or missing.
      id: 'state',
      header: 'Trạng thái',
      className: 'min-w-44',
      sortValue: (r) => (r.blockers.length > 0 ? 2 : r.current ? 1 : 0),
      cell: (r) =>
        r.blockers.length > 0 ? (
          <span className="text-xs text-muted-foreground">{issueText(r.blockers[0].detail, r.blockers[0].code)}</span>
        ) : r.current ? (
          <div className="space-y-0.5">
            <SourceTypeTag sourceType={r.current.sourceType} />
            <p className="tabular whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.current.recordedAt)}</p>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
            <CircleDashed className="h-3.5 w-3.5 text-support-warning" aria-hidden />
            Chưa có số
          </span>
        ),
    },
    {
      id: 'action',
      header: 'Thao tác',
      cell: (r) => (
        <Button type="button" size="sm" variant={r.canEnter ? 'outline' : 'ghost'} onClick={() => setOpenGoalId(r.goal.id)} aria-label={`${r.canEnter ? 'Nhập số' : 'Xem số liệu'}: ${r.goal.name}, ${r.ownerName}`}>
          {r.canEnter ? 'Nhập số' : 'Xem'}
        </Button>
      ),
    },
  ];

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput value={filter.search} onChange={(search) => setFilter((f) => ({ ...f, search }))} placeholder="Tìm người, chỉ tiêu, nguồn" className="w-64" />
      <Select value={filter.orgUnitId ?? ALL} onValueChange={(v) => setFilter((f) => ({ ...f, orgUnitId: v === ALL ? null : v }))}>
        <SelectTrigger className="w-48" aria-label="Lọc theo đơn vị">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Mọi đơn vị</SelectItem>
          {units.map(([id, name]) => (
            <SelectItem key={id} value={id}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filter.sourceType ?? ALL} onValueChange={(v) => setFilter((f) => ({ ...f, sourceType: v === ALL ? null : (v as SourceType) }))}>
        <SelectTrigger className="w-40" aria-label="Lọc theo kiểu nguồn">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Mọi kiểu nguồn</SelectItem>
          {SOURCE_TYPES.map((s) => (
            <SelectItem key={s} value={s}>
              {SOURCE_TYPE_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {summary && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={filter.missingOnly}
          onClick={() => setFilter((f) => ({ ...f, missingOnly: !f.missingOnly }))}
          className={cn('ml-auto tabular', filter.missingOnly && 'border-primary bg-primary/10 text-primary hover:bg-primary/15')}
        >
          Còn {summary.missing}/{summary.open} chỉ tiêu chưa có số
        </Button>
      )}
    </div>
  );

  return (
    <>
      <DataTable
        label={period ? `Số thực tế kỳ ${period.label}` : 'Số thực tế'}
        columns={columns}
        rows={visible}
        query={query}
        getRowId={(r) => r.goal.id}
        empty="Chưa có chỉ tiêu nào trong chu kỳ này. Kế hoạch mục tiêu cần được lập và duyệt trước."
        idle="Chọn chu kỳ và kỳ để xem số liệu."
        isFiltered={isActualEntryFiltered(filter)}
        onClearFilters={() => setFilter(EMPTY_ACTUAL_ENTRY_FILTER)}
        pageResetKey={filter}
        toolbar={toolbar}
      />
      {period && <ActualEntrySheet row={openRow} period={period} onClose={() => setOpenGoalId(null)} onNext={nextRow ? () => setOpenGoalId(nextRow.goal.id) : undefined} />}
    </>
  );
}
