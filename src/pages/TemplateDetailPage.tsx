import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TemplateEditor } from '@/components/library/TemplateEditor';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader, type Crumb } from '@/components/shared/PageHeader';
import { LibraryStatusBadge } from '@/components/shared/StatusBadge';
import { UnsavedChangesGuard } from '@/components/shared/UnsavedChangesGuard';
import { useSession } from '@/contexts/useSession';
import { useKpiDefinitions, useKpiTemplateItems, useKpiTemplates } from '@/hooks/queries/library';
import { useOrgUnits, usePositions } from '@/hooks/queries/org';
import { ERROR_CATALOG, errorSpecOf } from '@/lib/errorCatalog';
import { combineQueries, loadPhase } from '@/lib/queryState';

const LIST_URL = '/admin/templates';
const NEW = 'new';
const trail: Crumb[] = [{ label: 'Bộ mẫu', to: LIST_URL }];

/**
 * One template — WBS 4.2.4, track T2. `/admin/templates/:templateId`, `new` = create. The template
 * is found in the tenant's (cached) template list; a viewer without `library.manage` sees it
 * read-only and cannot open `new`.
 */
export default function TemplateDetailPage() {
  const { templateId = '' } = useParams<{ templateId: string }>();
  const { can } = useSession();
  const canManage = can('library.manage');
  const navigate = useNavigate();
  const creating = templateId === NEW;

  const templates = useKpiTemplates();
  const items = useKpiTemplateItems();
  const definitions = useKpiDefinitions();
  const orgUnits = useOrgUnits();
  const positions = usePositions();
  const query = combineQueries([templates, items, definitions, orgUnits, positions]);
  const loaded = Boolean(templates.data && items.data && definitions.data && orgUnits.data && positions.data);

  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((value: boolean) => setDirty(value), []);
  // Leaving through Save (a new template) or Cancel is not a loss: the guard is lifted first, and
  // the move happens on the next render, once the blocker has seen `when={false}`.
  const [leaveTo, setLeaveTo] = useState<{ url: string; replace: boolean } | null>(null);
  useEffect(() => {
    if (leaveTo) navigate(leaveTo.url, { replace: leaveTo.replace });
  }, [leaveTo, navigate]);
  // A new route param (create → the saved template) starts clean.
  useEffect(() => {
    setLeaveTo(null);
    setDirty(false);
  }, [templateId]);

  const template = creating ? null : (templates.data?.find((t) => t.id === templateId) ?? null);
  const storedItems = useMemo(() => (template && items.data ? items.data.filter((i) => i.templateId === template.id) : []), [template, items.data]);

  const phase = loadPhase(query, loaded);
  if (phase === 'error') {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Bộ mẫu" />
        <ErrorStateCard spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />
      </>
    );
  }
  if (!loaded) {
    return (
      <>
        <PageHeader breadcrumb={trail} title={creating ? 'Thêm bộ mẫu' : 'Bộ mẫu'} />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }
  if (creating ? !canManage : !template) {
    return (
      <>
        <PageHeader breadcrumb={trail} title="Không tìm thấy bộ mẫu" />
        <ErrorStateCard spec={ERROR_CATALOG['ERR-KPI-02']} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={trail}
        title={template ? template.name : 'Thêm bộ mẫu'}
        status={template ? <LibraryStatusBadge status={template.status} /> : undefined}
        description={
          template
            ? 'Chỉ tiêu trong bộ mẫu và trọng số mặc định. Goal Plan lập từ bộ này vẫn sửa được từng chỉ tiêu.'
            : 'Đặt tên, chọn đối tượng áp dụng rồi thêm chỉ tiêu từ thư viện.'
        }
      />
      <UnsavedChangesGuard when={dirty && leaveTo === null} />
      <Card className="flex flex-col">
        <TemplateEditor
          template={template}
          storedItems={storedItems}
          definitions={definitions.data ?? []}
          orgUnits={(orgUnits.data ?? []).filter((u) => u.status === 'Active' || u.id === template?.orgUnitId)}
          positions={(positions.data ?? []).filter((p) => p.status === 'Active' || p.id === template?.positionId)}
          readOnly={!canManage}
          onSaved={(id) => {
            if (creating) setLeaveTo({ url: `${LIST_URL}/${id}`, replace: true });
          }}
          onCancelNew={() => setLeaveTo({ url: LIST_URL, replace: false })}
          onDirtyChange={onDirtyChange}
        />
      </Card>
    </>
  );
}
