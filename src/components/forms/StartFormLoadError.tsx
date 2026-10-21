import { Button } from '@/components/ui/button';
import { ERROR_CATALOG } from '@/lib/errorCatalog';
import type { QueryState } from '@/lib/queryState';

/**
 * What a "start a form" control shows when a read it needs failed (ERR-KPI-01): the catalogue's
 * words and its retry, in the button's place — never a button that silently disappears.
 */
export function StartFormLoadError({ query }: { query: QueryState }) {
  const spec = ERROR_CATALOG['ERR-KPI-01'];
  return (
    <span className="inline-flex items-center gap-2 text-sm text-support-negative" role="alert">
      {spec.title}
      <Button variant="outline" size="sm" onClick={() => query.refetch()}>
        {spec.action}
      </Button>
    </span>
  );
}
