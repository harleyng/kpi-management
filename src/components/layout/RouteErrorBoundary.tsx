/**
 * Error boundary for the routed area (`<Outlet/>` inside AppShell), and the outermost safety net.
 *
 * WHY IT IS NEEDED: every page is `lazy()` and wrapped only in `<Suspense>`, and **Suspense does
 * not catch errors**. A throw during render — or, more commonly, a stale chunk that fails to load
 * after a redeploy (`Failed to fetch dynamically imported module`) — would blank the entire app
 * with no message at all.
 *
 * Chunk-loading failures reload ONCE (a sessionStorage flag prevents an infinite loop when the
 * server genuinely lacks the file); anything else renders a card with a reload button.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const RELOAD_FLAG = 'kpi-chunk-reloaded';
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[route] render failed', error, info.componentStack);
    if (CHUNK_ERROR.test(error.message) && !sessionStorage.getItem(RELOAD_FLAG)) {
      // A new build renamed the chunk files — reloading fetches the correct ones.
      sessionStorage.setItem(RELOAD_FLAG, '1');
      window.location.reload();
    }
  }

  private handleReload = () => {
    sessionStorage.removeItem(RELOAD_FLAG);
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isChunk = CHUNK_ERROR.test(error.message);
    return (
      <div className="flex items-start justify-center py-16">
        <div className="max-w-md rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-support-negative">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            Không hiển thị được màn hình này
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {isChunk
              ? 'Ứng dụng vừa được cập nhật. Tải lại trang để dùng bản mới.'
              : 'Đã có lỗi khi hiển thị. Tải lại trang để thử lại.'}
          </p>
          <p className="mt-2 break-words rounded bg-muted/50 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
            {error.message}
          </p>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={this.handleReload}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden /> Tải lại
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
