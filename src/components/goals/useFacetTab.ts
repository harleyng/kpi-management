import { useSearchParams } from 'react-router-dom';

/**
 * A detail page's facet tab, kept in `?tab=` (a reload or a shared link reopens it). The first value
 * is the default and is left out of the URL. An unknown value falls back to the default. Switching
 * replaces the history entry — tabs are not pages, Back leaves the record.
 */
export function useFacetTab<T extends string>(values: readonly [T, ...T[]]): [T, (next: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab = values.find((v) => v === raw) ?? values[0];
  const setTab = (next: string) =>
    setParams(
      (p) => {
        const out = new URLSearchParams(p);
        if (next === values[0] || !values.includes(next as T)) out.delete('tab');
        else out.set('tab', next);
        return out;
      },
      { replace: true },
    );
  return [tab, setTab];
}
