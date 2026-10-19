import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/contexts/useSession';
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
 */
export function AppShell() {
  const { access } = useSession();
  const { pathname } = useLocation();
  const allowed = canOpenPath(pathname, NAV_GROUPS, access);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
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
