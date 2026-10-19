import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LibraryExportButton } from '@/components/library/LibraryExportButton';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { LibraryStatusBadge } from '@/components/shared/StatusBadge';
import { useSession } from '@/contexts/useSession';
import { LIBRARY_STATUSES, type KpiTemplate } from '@/data/types';
import { useKpiDefinitions, useKpiTemplateItems, useKpiTemplates } from '@/hooks/queries/library';
import { useOrgUnits, usePositions } from '@/hooks/queries/org';
import { TEMPLATE_AUDIENCE_LABEL, templateAudience, templateIssues, templateWeightTotal, type TemplateAudience } from '@/lib/libraryRules';
import { combineQueries } from '@/lib/queryState';
import { matchesSearch } from '@/lib/search';
import { formatPercent } from '@/lib/utils';

const ALL = 'all';

interface TemplateRow {
  template: KpiTemplate;
  /** "Đơn vị: Phòng Marketing", "Chung"… */
  audience: string;
  itemCount: number;
  weightTotal: number;
  /** Off 100% or outside 5–8 items, or an archived KPI inside (`templateIssues` warnings). */
  needsReview: boolean;
}

/**
 * Bộ mẫu — WBS 4.2.4, track T2. The list only; a template opens on its own page
 * (`/admin/templates/:templateId`, `TemplateDetailPage`). Search and the audience filter live in the URL.
 */
export default function KpiTemplatesPage() {
  const { can } = useSession();
  const canManage = can('library.manage');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const audienceFilter = (params.get('ad') ?? ALL) as TemplateAudience | typeof ALL;

  const templates = useKpiTemplates();
  const items = useKpiTemplateItems();
  const definitions = useKpiDefinitions();
  const orgUnits = useOrgUnits();
  const positions = usePositions();
  const query = combineQueries([templates, items, definitions, orgUnits, positions]);

  const setParam = (changes: Record<string, string | null>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '' || value === ALL) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const rows = useMemo<TemplateRow[] | undefined>(() => {
    if (!templates.data || !items.data || !definitions.data || !orgUnits.data || !positions.data) return undefined;
    const defs = new Map(definitions.data.map((d) => [d.id, d]));
    const unitName = new Map(orgUnits.data.map((u) => [u.id, u.name]));
    const positionName = new Map(positions.data.map((p) => [p.id, p.name]));
    return [...templates.data]
      .filter((t) => (audienceFilter === ALL || templateAudience(t) === audienceFilter) && (search === '' || matchesSearch(search, [t.name])))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
      .map((t) => {
        const own = items.data.filter((i) => i.templateId === t.id);
        const audience = templateAudience(t);
        const target = audience === 'OrgUnit' ? unitName.get(t.orgUnitId as string) : audience === 'Position' ? positionName.get(t.positionId as string) : null;
        const { warnings } = templateIssues(t, own, defs, new Set(own.map((i) => i.kpiDefId)));
        return {
          template: t,
          audience: target ? `${TEMPLATE_AUDIENCE_LABEL[audience]}: ${target}` : TEMPLATE_AUDIENCE_LABEL[audience],
          itemCount: own.length,
          weightTotal: templateWeightTotal(own),
          needsReview: warnings.length > 0,
        };
      });
  }, [templates.data, items.data, definitions.data, orgUnits.data, positions.data, audienceFilter, search]);

  const open = (id: string) => navigate(`/admin/templates/${id}`);

  const columns: DataTableColumn<TemplateRow>[] = [
    {
      id: 'name',
      header: 'Tên bộ mẫu',
      cell: ({ template }) => (
        <button
          type="button"
          className="rounded-sm text-left font-medium underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => open(template.id)}
        >
          {template.name}
        </button>
      ),
      sortValue: ({ template }) => template.name,
      className: 'min-w-[16rem]',
    },
    { id: 'audience', header: 'Áp dụng cho', cell: (r) => r.audience, sortValue: (r) => r.audience, className: 'min-w-[12rem]' },
    { id: 'items', header: 'Số chỉ tiêu', numeric: true, cell: (r) => r.itemCount, sortValue: (r) => r.itemCount },
    {
      id: 'weight',
      header: 'Tổng trọng số',
      numeric: true,
      cell: (r) => (r.itemCount === 0 ? null : formatPercent(r.weightTotal)),
      sortValue: (r) => (r.itemCount === 0 ? null : r.weightTotal),
    },
    {
      id: 'review',
      header: 'Kiểm tra',
      // Said in words, not only colour.
      cell: (r) =>
        r.needsReview ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm">
            <AlertTriangle className="h-3.5 w-3.5 text-support-warning" aria-hidden />
            Cần xem lại
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Hợp lệ</span>
        ),
      sortValue: (r) => (r.needsReview ? 0 : 1),
      className: 'whitespace-nowrap',
    },
    {
      id: 'status',
      header: 'Trạng thái',
      cell: ({ template }) => <LibraryStatusBadge status={template.status} />,
      sortValue: ({ template }) => LIBRARY_STATUSES.indexOf(template.status),
    },
  ];

  const isFiltered = search !== '' || audienceFilter !== ALL;

  return (
    <>
      <PageHeader title="Bộ mẫu" description="Bộ chỉ tiêu mẫu theo đơn vị hoặc chức danh, kèm trọng số mặc định, để lập Goal Plan nhanh." actions={<LibraryExportButton />} />
      <DataTable
        label="Danh sách bộ mẫu"
        columns={columns}
        rows={rows}
        query={query}
        getRowId={(r) => r.template.id}
        empty={canManage ? 'Chưa có bộ mẫu nào. Chọn Thêm bộ mẫu để tạo bộ đầu tiên.' : 'Chưa có bộ mẫu nào.'}
        isFiltered={isFiltered}
        onClearFilters={() => setParam({ q: null, ad: null })}
        pageResetKey={`${search}|${audienceFilter}`}
        toolbar={
          <>
            <SearchInput value={search} onChange={(v) => setParam({ q: v })} placeholder="Tìm bộ mẫu" className="w-full sm:w-72" />
            <Select value={audienceFilter} onValueChange={(v) => setParam({ ad: v })}>
              <SelectTrigger className="h-9 w-[12rem]" aria-label="Lọc theo đối tượng áp dụng">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Mọi đối tượng</SelectItem>
                {(Object.keys(TEMPLATE_AUDIENCE_LABEL) as TemplateAudience[]).map((a) => (
                  <SelectItem key={a} value={a}>
                    {TEMPLATE_AUDIENCE_LABEL[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        actions={
          canManage && (
            <Button size="sm" onClick={() => navigate('/admin/templates/new')}>
              <Plus className="h-4 w-4" aria-hidden />
              Thêm bộ mẫu
            </Button>
          )
        }
      />
    </>
  );
}
