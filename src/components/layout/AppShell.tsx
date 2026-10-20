import { Suspense, useEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/contexts/useSession';
import { legacyRedirect } from '@/lib/navRules';
import { canOpenPath } from '@/lib/permissionRules';
import { AccessDenied } from './AccessDenied';
import { AppSidebar } from './AppSidebar';
import { NAV_GROUPS } from './navConfig';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { TopBar } from './TopBar';

/**
 * The application frame — the sidebar and top bar stay put; only `<Outlet/>` changes.
 *
 * `<Suspense>` wraps the OUTLET (not the whole shell) so the navigation stays on screen while a
 * page chunk loads. `RouteErrorBoundary` sits inside it because Suspense does not catch errors.
 *
 * The ROUTE GUARD lives here, once, for every page: a path the session may not open
 * (`canOpenPath` — the same permission as its menu item) renders `AccessDenied` instead of the page.
 * A detail page still checks its own record with `useSession().can(code, resource)`.
 *
 * After the guard, an OLD link — a split page's parent url or its `?tab=` (`legacyRedirect`) — is
 * replaced by the sub-page it became. In that order: a profile that may not open the old page sees
 * "access denied", never a redirect into it.
 *
 * `<main>` is the scroll container, not the window, so a route change resets ITS scroll and moves
 * focus to the new page's heading (a sub-page or a detail page would otherwise open scrolled down,
 * with focus left on the link that is no longer there).
 */
export function AppShell() {
  const { access } = useSession();
  const { pathname, search } = useLocation();
  const allowed = canOpenPath(pathname, NAV_GROUPS, access);
  const redirect = allowed ? legacyRedirect(pathname, search) : null;
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const main = mainRef.current;
    if (!main) return;
    main.scrollTop = 0;
    // The page's chunk may still be loading — focus the heading once it is there.
    const focusHeading = () => main.querySelector<HTMLElement>('[data-page-title]')?.focus({ preventScroll: true });
    focusHeading();
    const timer = window.setTimeout(focusHeading, 150);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  if (redirect) return <Navigate to={redirect} replace />;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto bg-canvas px-6 py-6">
          <RouteErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>{allowed ? <Outlet /> : <AccessDenied />}</Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}
