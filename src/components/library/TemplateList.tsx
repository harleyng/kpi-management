import { AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { LibraryStatusBadge } from '@/components/shared/StatusBadge';
import type { KpiTemplate } from '@/data/types';
import { errorSpecOf } from '@/lib/errorCatalog';
import { loadPhase, type QueryState } from '@/lib/queryState';
import { cn } from '@/lib/utils';

export interface TemplateListEntry {
  template: KpiTemplate;
  /** "Đơn vị: Phòng Marketing", "Chung"… */
  audience: string;
  itemCount: number;
  needsReview: boolean;
}

/**
 * The master list of `/admin/templates`: one button per template, the selected one marked with
 * `aria-current`. A template off 100% or 5–8 items says "Cần xem lại" in words, not only colour.
 */
export function TemplateList({
  entries,
  query,
  selectedId,
  onSelect,
  isFiltered,
  emptyText,
}: {
  entries: readonly TemplateListEntry[] | undefined;
  query: QueryState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  isFiltered: boolean;
  emptyText: string;
}) {
  const phase = loadPhase(query, entries !== undefined);
  if (phase === 'error') return <ErrorState spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />;
  if (phase !== 'ready' || !entries) {
    return (
      <div className="space-y-2 p-2" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (entries.length === 0) return <EmptyState>{isFiltered ? 'Không có bộ mẫu khớp bộ lọc.' : emptyText}</EmptyState>;

  return (
    <ul className="divide-y" aria-label="Danh sách bộ mẫu">
      {entries.map(({ template, audience, itemCount, needsReview }) => {
        const selected = template.id === selectedId;
        return (
          <li key={template.id}>
            <button
              type="button"
              aria-current={selected || undefined}
              onClick={() => onSelect(template.id)}
              className={cn(
                'flex w-full flex-col gap-1 px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                selected && 'bg-primary-subtle hover:bg-primary-subtle',
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className={cn('font-medium', selected && 'text-primary')}>{template.name}</span>
                {template.status !== 'Active' && <LibraryStatusBadge status={template.status} />}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>{audience}</span>
                <span className="tabular">{itemCount} chỉ tiêu</span>
                {needsReview && (
                  <span className="inline-flex items-center gap-1 text-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-support-warning" aria-hidden />
                    Cần xem lại
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
