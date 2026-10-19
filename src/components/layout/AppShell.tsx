import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { AppSidebar } from './AppSidebar';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { TopBar } from './TopBar';

/**
 * The application frame — the sidebar and top bar stay put; only `<Outlet/>` changes.
 *
 * `<Suspense>` wraps the OUTLET (not the whole shell) so the navigation stays on screen while a
 * page chunk loads. `RouteErrorBoundary` sits inside it because Suspense does not catch errors.
 */
export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <RouteErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
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
