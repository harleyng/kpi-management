import { useContext, useEffect } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom';
import { DiscardChangesDialog } from '@/components/library/DiscardChangesDialog';

/**
 * Asks "Bỏ thay đổi chưa lưu?" before an editor PAGE with unsaved edits is left — through the
 * sidebar, a breadcrumb, the browser's Back button (`useBlocker`) or a reload / closed tab
 * (`beforeunload`, the browser's own prompt). Render it once on the page: `<UnsavedChangesGuard when={dirty} />`.
 *
 * Leaving through the page's own Save or Cancel is not a loss: call the navigation after the state
 * that made the page dirty is cleared, or pass `when={false}` first.
 *
 * `useBlocker` exists only under the data router (`createBrowserRouter`, `main.tsx`); a component
 * test under a `MemoryRouter` gets the reload prompt only.
 */
export function UnsavedChangesGuard({ when }: { when: boolean }) {
  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  const inDataRouter = useContext(UNSAFE_DataRouterContext) !== null;
  return inDataRouter ? <NavigationBlocker when={when} /> : null;
}

function NavigationBlocker({ when }: { when: boolean }) {
  // Only a move to ANOTHER page is a loss — a query-param change (a tab, a filter) stays on it.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname);
  return (
    <DiscardChangesDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => !open && blocker.state === 'blocked' && blocker.reset()}
      onDiscard={() => blocker.state === 'blocked' && blocker.proceed()}
    />
  );
}
