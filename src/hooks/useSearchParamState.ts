import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * One URL query parameter as state (`?tab=`, `?unit=`, `?emp=`) — so a selection survives a reload
 * and can be linked. Changes REPLACE the history entry: Back leaves the page, it does not replay
 * every click on the tree.
 */
export function useSearchParamState(name: string): [string | null, (value: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const set = useCallback(
    (value: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value === '') next.delete(name);
          else next.set(name, value);
          return next;
        },
        { replace: true },
      ),
    [name, setParams],
  );
  return [params.get(name), set];
}
