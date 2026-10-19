import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ORG_UNIT_TYPE_LABEL, type OrgUnit } from '@/data/types';
import { useOrgUnits } from '@/hooks/queries/org';
import { errorSpecOf } from '@/lib/errorCatalog';
import {
  allTreeIds,
  ancestorIds,
  buildTree,
  pruneTree,
  treeKeyAction,
  visibleTreeRows,
} from '@/lib/orgTree';
import { loadPhase, type QueryState } from '@/lib/queryState';
import { matchesSearch } from '@/lib/search';
import { cn } from '@/lib/utils';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorStateCard';
import { SearchInput } from './SearchInput';

interface OrgUnitTreeProps {
  /** The tree's accessible name ("Cây tổ chức", "Đơn vị nhận phiếu"). */
  label: string;
  selected: readonly string[];
  onSelectedChange: (ids: string[]) => void;
  /**
   * Several units (launch recipients, `RecipientFilter.orgUnitIds`). Selecting a unit never selects
   * its children — "include sub-units" is the caller's own control (`includeChildUnits`).
   */
  multiple?: boolean;
  /** A search box above the tree. Default: on when the tenant has more than 10 units. */
  searchable?: boolean;
  className?: string;
}

/** The org tree read from the gateway (WBS 4.1.2) — T1's org screen and T5's launch recipients. */
export function OrgUnitTree(props: OrgUnitTreeProps) {
  const units = useOrgUnits();
  return <OrgUnitTreeView {...props} units={units.data} query={units} />;
}

interface OrgUnitTreeViewProps extends OrgUnitTreeProps {
  units: readonly OrgUnit[] | undefined;
  query: QueryState;
}

/**
 * The tree itself, fed by props — exported for tests. A WAI-ARIA tree with ONE tab stop (roving
 * tabindex); the keyboard model is `treeKeyAction` in `src/lib/orgTree.ts`. The root and the path
 * to every selected unit start open.
 */
export function OrgUnitTreeView({
  label,
  selected,
  onSelectedChange,
  multiple = false,
  searchable,
  className,
  units,
  query,
}: OrgUnitTreeViewProps) {
  const [search, setSearch] = useState('');
  const [expandedState, setExpanded] = useState<ReadonlySet<string> | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const moveFocus = useRef(false);

  const phase = loadPhase(query, units !== undefined);
  const roots = useMemo(() => buildTree(units ?? []), [units]);

  // Until the user opens or closes something: the roots and the path to each selected unit.
  const defaultExpanded = useMemo(() => {
    const ids = new Set(roots.map((r) => r.item.id));
    for (const id of selected) for (const a of ancestorIds(units ?? [], id)) ids.add(a);
    return ids;
  }, [roots, selected, units]);
  const expanded = expandedState ?? defaultExpanded;

  const searching = search.trim().length > 0;
  const shownRoots = useMemo(
    () =>
      searching
        ? pruneTree(roots, (u) => matchesSearch(search, [u.name, u.code, ORG_UNIT_TYPE_LABEL[u.unitType]]))
        : roots,
    [roots, search, searching],
  );
  // While searching every match is shown in place, its path open.
  const rows = useMemo(
    () => visibleTreeRows(shownRoots, searching ? new Set(allTreeIds(shownRoots)) : expanded),
    [shownRoots, searching, expanded],
  );

  const focusable =
    rows.find((r) => r.node.item.id === focusedId)?.node.item.id ??
    rows.find((r) => selected.includes(r.node.item.id))?.node.item.id ??
    rows[0]?.node.item.id;

  useEffect(() => {
    if (moveFocus.current && focusable) {
      rowRefs.current.get(focusable)?.focus();
      moveFocus.current = false;
    }
  }, [focusable]);

  const toggleExpanded = (id: string, open: boolean) => {
    const next = new Set(expanded);
    if (open) next.add(id);
    else next.delete(id);
    setExpanded(next);
  };

  const select = (id: string) => {
    if (!multiple) onSelectedChange([id]);
    else onSelectedChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, id: string) => {
    const action = treeKeyAction(rows, id, event.key);
    if (!action) return;
    event.preventDefault();
    if (action.type === 'focus') {
      moveFocus.current = true;
      setFocusedId(action.id);
    } else if (action.type === 'expand' || action.type === 'collapse') {
      if (!searching) toggleExpanded(action.id, action.type === 'expand');
    } else {
      select(action.id);
    }
  };

  const showSearch = searchable ?? (units?.length ?? 0) > 10;

  let body;
  if (phase === 'error') {
    body = <ErrorState spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />;
  } else if (phase === 'loading') {
    body = (
      <div className="space-y-2 p-2" aria-busy>
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="ml-5 h-5 w-2/5" />
        <Skeleton className="ml-5 h-5 w-1/3" />
      </div>
    );
  } else if (roots.length === 0) {
    body = <EmptyState>Chưa có đơn vị nào.</EmptyState>;
  } else if (rows.length === 0) {
    body = <EmptyState>Không có đơn vị nào khớp “{search.trim()}”.</EmptyState>;
  } else {
    body = (
      <div role="tree" aria-label={label} aria-multiselectable={multiple || undefined} className="space-y-px">
        {rows.map((row) => {
          const unit = row.node.item;
          const isSelected = selected.includes(unit.id);
          const inactive = unit.status === 'Inactive';
          return (
            <div
              key={unit.id}
              ref={(el) => {
                if (el) rowRefs.current.set(unit.id, el);
                else rowRefs.current.delete(unit.id);
              }}
              role="treeitem"
              aria-level={row.level}
              aria-setsize={row.setSize}
              aria-posinset={row.posInSet}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              aria-selected={isSelected}
              tabIndex={unit.id === focusable ? 0 : -1}
              onKeyDown={(e) => onKeyDown(e, unit.id)}
              onClick={() => {
                setFocusedId(unit.id);
                select(unit.id);
              }}
              onFocus={() => setFocusedId(unit.id)}
              style={{ paddingLeft: `${(row.level - 1) * 1.25 + 0.25}rem` }}
              className={cn(
                'flex h-8 cursor-pointer select-none items-center gap-1 rounded-md pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSelected ? 'bg-primary-subtle font-medium text-primary' : 'hover:bg-surface-alt',
              )}
            >
              {row.hasChildren ? (
                // Mouse-only by design: the keyboard opens and closes with → / ← on the row itself.
                <span
                  aria-hidden
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!searching) toggleExpanded(unit.id, !row.expanded);
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-neutral-20"
                >
                  <ChevronRight className={cn('h-4 w-4 transition-transform', row.expanded && 'rotate-90')} />
                </span>
              ) : (
                <span aria-hidden className="w-6 shrink-0" />
              )}
              <span className={cn('truncate', inactive && 'text-muted-foreground')} title={unit.name}>
                {unit.name}
                {inactive && ' (ngừng hoạt động)'}
              </span>
              <span className="ml-auto shrink-0 pl-2 text-xs font-normal text-muted-foreground">
                {ORG_UNIT_TYPE_LABEL[unit.unitType]}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {showSearch && phase === 'ready' && (
        <SearchInput value={search} onChange={setSearch} placeholder="Tìm đơn vị" />
      )}
      {body}
    </div>
  );
}
