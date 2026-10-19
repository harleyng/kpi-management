import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { RouteErrorBoundary } from '@/components/layout/RouteErrorBoundary';
import { isRetryable } from '@/lib/errorCatalog';
import { appRoutes } from './App.tsx';
import './index.css';

/**
 * The data router — needed for `useBlocker` (an editor page asking before its unsaved edits are left,
 * `UnsavedChangesGuard`). The routes stay declared as elements in `App.tsx`.
 */
const router = createBrowserRouter(appRoutes);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      // One retry, and only for failures that could pass on a second try (not ERR-KPI-02/04/05/06).
      retry: (failureCount, error) => failureCount < 1 && isRetryable(error),
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  // Outermost safety net: catches failures in the layout frame itself, which the boundary inside
  // AppShell cannot reach.
  <RouteErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <Toaster />
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </RouteErrorBoundary>,
);
