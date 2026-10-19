import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DiscardChangesDialog } from '@/components/library/DiscardChangesDialog';
import { LibraryExportButton } from '@/components/library/LibraryExportButton';
import { TemplateEditor } from '@/components/library/TemplateEditor';
import { TemplateList, type TemplateListEntry } from '@/components/library/TemplateList';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { SearchInput } from '@/components/shared/SearchInput';
import { useSession } from '@/contexts/useSession';
import { useKpiDefinitions, useKpiTemplateItems, useKpiTemplates } from '@/hooks/queries/library';
import { useOrgUnits, usePositions } from '@/hooks/queries/org';
import { errorSpecOf } from '@/lib/errorCatalog';
import { TEMPLATE_AUDIENCE_LABEL, templateAudience, templateIssues, type TemplateAudience } from '@/lib/libraryRules';
import { combineQueries, loadPhase } from '@/lib/queryState';
import { matchesSearch } from '@/lib/search';

const ALL = 'all';
const NEW = 'moi';

/**
 * Bộ mẫu — WBS 4.2.4, track T2. Master list on the left, the selected template on the right. The
 * selection and filters live in the URL; switching away from unsaved edits asks first.
 */
export default function KpiTemplatesPage() {
  const { can } = useSession();
  const canManage = can('library.manage');
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const audienceFilter = (params.get('ad') ?? ALL) as TemplateAudience | typeof ALL;
  const selectedParam = params.get('bo');

  const templates = useKpiTemplates();
  const items = useKpiTemplateItems();
  const definitions = useKpiDefinitions();
  const orgUnits = useOrgUnits();
  const positions = usePositions();
  const query = combineQueries([templates, items, definitions, orgUnits, positions]);
  const loaded = templates.data && items.data && definitions.data && orgUnits.data && positions.data;

  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);

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

  const select = (id: string) => {
    if (id === selectedParam) return;
    if (dirtyRef.current) setPendingSelect(id);
    else setParam({ bo: id });
  };

  const entries = useMemo<TemplateListEntry[] | undefined>(() => {
    if (!loaded || !templates.data || !items.data || !definitions.data || !orgUnits.data || !positions.data) return undefined;
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
          needsReview: warnings.length > 0,
        };
      });
  }, [loaded, templates.data, items.data, definitions.data, orgUnits.data, positions.data, audienceFilter, search]);

  const selected = selectedParam && selectedParam !== NEW ? templates.data?.find((t) => t.id === selectedParam) ?? null : null;
  const storedItems = useMemo(() => (selected && items.data ? items.data.filter((i) => i.templateId === selected.id) : []), [selected, items.data]);
  const creating = selectedParam === NEW && canManage;

  let detail;
  const phase = loadPhase(query, Boolean(loaded));
  if (phase === 'error') detail = <ErrorStateCard spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} className="border-0" />;
  else if (!loaded) detail = null;
  else if (creating || selected) {
    detail = (
      <TemplateEditor
        template={creating ? null : selected}
        storedItems={storedItems}
        definitions={definitions.data ?? []}
        orgUnits={(orgUnits.data ?? []).filter((u) => u.status === 'Active' || u.id === selected?.orgUnitId)}
        positions={(positions.data ?? []).filter((p) => p.status === 'Active' || p.id === selected?.positionId)}
        readOnly={!canManage}
        onSaved={(id) => setParam({ bo: id })}
        onCancelNew={() => setParam({ bo: null })}
        onDirtyChange={onDirtyChange}
      />
    );
  } else if (selectedParam) {
    detail = <EmptyState>Không tìm thấy bộ mẫu này. Có thể nó đã bị xóa hoặc thuộc công ty khác.</EmptyState>;
  } else {
    detail = <EmptyState>Chọn một bộ mẫu ở danh sách bên trái để xem và sửa chỉ tiêu.</EmptyState>;
  }

  return (
    <>
      <PageHeader title="Bộ mẫu" description="Bộ chỉ tiêu mẫu theo đơn vị hoặc chức danh, kèm trọng số mặc định, để lập Goal Plan nhanh." actions={<LibraryExportButton />} />
      <Card className="flex flex-col overflow-hidden lg:h-[calc(100dvh-13rem)] lg:min-h-[30rem] lg:flex-row">
        <div className="flex min-h-0 flex-col border-b lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="space-y-2 border-b p-3">
            <SearchInput value={search} onChange={(v) => setParam({ q: v })} placeholder="Tìm bộ mẫu" />
            <div className="flex gap-2">
              <Select value={audienceFilter} onValueChange={(v) => setParam({ ad: v })}>
                <SelectTrigger className="h-9 flex-1" aria-label="Lọc theo đối tượng áp dụng">
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
              {canManage && (
                <Button size="sm" className="h-9" onClick={() => select(NEW)}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Thêm bộ mẫu
                </Button>
              )}
            </div>
          </div>
          <div className="max-h-[24rem] overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
            <TemplateList
              entries={entries}
              query={query}
              selectedId={creating ? null : selectedParam}
              onSelect={select}
              isFiltered={search !== '' || audienceFilter !== ALL}
              emptyText={canManage ? 'Chưa có bộ mẫu nào. Chọn Thêm bộ mẫu để tạo bộ đầu tiên.' : 'Chưa có bộ mẫu nào.'}
            />
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{detail}</div>
      </Card>
      <DiscardChangesDialog
        open={pendingSelect !== null}
        onOpenChange={(open) => !open && setPendingSelect(null)}
        onDiscard={() => {
          dirtyRef.current = false;
          setParam({ bo: pendingSelect });
          setPendingSelect(null);
        }}
      />
    </>
  );
}
