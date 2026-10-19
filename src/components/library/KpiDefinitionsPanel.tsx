import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { SearchInput } from '@/components/shared/SearchInput';
import { LibraryStatusBadge } from '@/components/shared/StatusBadge';
import { LIBRARY_STATUS_LABEL, LIBRARY_STATUSES, type KpiDefinition, type LibraryStatus } from '@/data/types';
import {
  useCalcMethods,
  useKpiDefinitions,
  useKpiTemplateItems,
  useKpiTemplates,
  useLibraryGoalUsage,
  useMeasureUnits,
  usePerspectives,
} from '@/hooks/queries/library';
import { useDataSources } from '@/hooks/queries/actuals';
import { activeTemplatesContaining, libraryUsage } from '@/lib/libraryRules';
import { combineQueries } from '@/lib/queryState';
import { matchesSearch } from '@/lib/search';
import { KpiDefinitionSheet } from './KpiDefinitionSheet';
import { UsageUnavailable } from './UsageUnavailable';

const ALL = 'all';

/**
 * "Chỉ tiêu mẫu" (WBS 4.2.3): the library as a filterable table; a row's name opens the side sheet.
 * Search and filters live in the URL, so back and reload keep them.
 */
export function KpiDefinitionsPanel({ canManage }: { canManage: boolean }) {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const perspectiveFilter = params.get('vc') ?? ALL;
  const statusFilter = (params.get('tt') ?? ALL) as LibraryStatus | typeof ALL;
  const setParam = (key: string, value: string, fallback = '') =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const definitions = useKpiDefinitions();
  const perspectives = usePerspectives();
  const units = useMeasureUnits();
  const methods = useCalcMethods();
  const dataSources = useDataSources();
  const templates = useKpiTemplates();
  const items = useKpiTemplateItems();
  const goals = useLibraryGoalUsage();
  // The goal count is advisory: if it fails the column shows "—", the table still works.
  const query = combineQueries([definitions, perspectives, units, methods, dataSources, templates, items]);

  const [editing, setEditing] = useState<KpiDefinition | 'new' | null>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);

  const lookup = useMemo(
    () => ({
      perspective: new Map((perspectives.data ?? []).map((p) => [p.id, p])),
      unit: new Map((units.data ?? []).map((u) => [u.id, u])),
      method: new Map((methods.data ?? []).map((m) => [m.id, m])),
      source: new Map((dataSources.data ?? []).map((s) => [s.id, s])),
    }),
    [perspectives.data, units.data, methods.data, dataSources.data],
  );
  const usage = useMemo(() => (goals.data ? libraryUsage(goals.data, []) : null), [goals.data]);

  const allLoaded = definitions.data && perspectives.data && units.data && methods.data && dataSources.data && templates.data && items.data;
  const rows = useMemo(() => {
    if (!allLoaded || !definitions.data) return undefined;
    return [...definitions.data]
      .filter(
        (d) =>
          (perspectiveFilter === ALL || d.perspectiveId === perspectiveFilter) &&
          (statusFilter === ALL || d.status === statusFilter) &&
          (search === '' || matchesSearch(search, [d.code, d.name])),
      )
      .sort((a, b) => {
        const pa = lookup.perspective.get(a.perspectiveId)?.sortOrder ?? 99;
        const pb = lookup.perspective.get(b.perspectiveId)?.sortOrder ?? 99;
        return pa - pb || a.code.localeCompare(b.code, 'vi');
      });
  }, [allLoaded, definitions.data, perspectiveFilter, statusFilter, search, lookup]);

  const isFiltered = search !== '' || perspectiveFilter !== ALL || statusFilter !== ALL;

  const columns: DataTableColumn<KpiDefinition>[] = [
    {
      id: 'code',
      header: 'Mã',
      cell: (d) => <span className="font-mono text-xs">{d.code}</span>,
      sortValue: (d) => d.code,
      className: 'whitespace-nowrap',
    },
    {
      id: 'name',
      header: 'Tên chỉ tiêu',
      cell: (d) => (
        <button
            type="button"
            className="text-left font-medium text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            onClick={(e) => {
              lastTrigger.current = e.currentTarget;
              setEditing(d);
            }}
          >
            {d.name}
          </button>
      ),
      sortValue: (d) => d.name,
      className: 'min-w-[16rem]',
    },
    { id: 'perspective', header: 'Viễn cảnh', cell: (d) => lookup.perspective.get(d.perspectiveId)?.name, className: 'whitespace-nowrap' },
    { id: 'unit', header: 'Đơn vị đo', cell: (d) => lookup.unit.get(d.unitId)?.name, className: 'whitespace-nowrap' },
    { id: 'method', header: 'Phương pháp tính', cell: (d) => lookup.method.get(d.calcMethodId)?.name, className: 'min-w-[11rem]' },
    { id: 'source', header: 'Nguồn dữ liệu', cell: (d) => (d.defaultDataSourceId ? lookup.source.get(d.defaultDataSourceId)?.name : null), className: 'min-w-[9rem]' },
    {
      id: 'goals',
      header: 'Đang dùng',
      numeric: true,
      cell: (d) => (usage ? (usage.goalsByKpi.get(d.id) ?? 0) : null),
      sortValue: (d) => (usage ? (usage.goalsByKpi.get(d.id) ?? 0) : null),
    },
    { id: 'status', header: 'Trạng thái', cell: (d) => <LibraryStatusBadge status={d.status} />, sortValue: (d) => LIBRARY_STATUSES.indexOf(d.status) },
  ];

  const openNew = (e: React.MouseEvent<HTMLElement>) => {
    lastTrigger.current = e.currentTarget;
    setEditing('new');
  };

  return (
    <>
      {goals.error != null && (
        <div className="mb-2">
          <UsageUnavailable onRetry={() => void goals.refetch()} />
        </div>
      )}
      <DataTable
        label="Danh sách chỉ tiêu mẫu"
        columns={columns}
        rows={rows}
        query={query}
        getRowId={(d) => d.id}
        empty={
          canManage
            ? 'Chưa có chỉ tiêu mẫu. Thêm chỉ tiêu đầu tiên để dùng khi lập Goal Plan.'
            : 'Thư viện chưa có chỉ tiêu mẫu nào.'
        }
        emptyAction={
          canManage && (
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4" aria-hidden />
              Thêm chỉ tiêu
            </Button>
          )
        }
        isFiltered={isFiltered}
        onClearFilters={() => setParams(new URLSearchParams(params.get('tab') ? { tab: params.get('tab') as string } : {}), { replace: true })}
        pageResetKey={`${search}|${perspectiveFilter}|${statusFilter}`}
        toolbar={
          <>
            <SearchInput
              value={search}
              onChange={(v) => setParam('q', v)}
              placeholder="Tìm theo mã hoặc tên chỉ tiêu"
              className="w-full sm:w-72"
            />
            <Select value={perspectiveFilter} onValueChange={(v) => setParam('vc', v, ALL)}>
              <SelectTrigger className="h-9 w-[12rem]" aria-label="Lọc theo viễn cảnh">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Mọi viễn cảnh</SelectItem>
                {(perspectives.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setParam('tt', v, ALL)}>
              <SelectTrigger className="h-9 w-[11rem]" aria-label="Lọc theo trạng thái">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Mọi trạng thái</SelectItem>
                {LIBRARY_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {LIBRARY_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canManage && (
              <Button size="sm" className="ml-auto" onClick={openNew}>
                <Plus className="h-4 w-4" aria-hidden />
                Thêm chỉ tiêu
              </Button>
            )}
          </>
        }
      />
      <KpiDefinitionSheet
        editing={editing}
        onClose={() => setEditing(null)}
        readOnly={!canManage}
        definitions={definitions.data ?? []}
        perspectives={perspectives.data ?? []}
        units={units.data ?? []}
        methods={methods.data ?? []}
        dataSources={dataSources.data ?? []}
        activeTemplatesOf={(id) => activeTemplatesContaining(id, templates.data ?? [], items.data ?? [])}
        returnFocus={() => lastTrigger.current?.focus()}
      />
    </>
  );
}
