import { Outlet } from 'react-router-dom';
import { SessionProvider } from '@/contexts/SessionContext';
import { GatewayEventBridge } from './GatewayEventBridge';
import { RouteErrorBoundary } from './RouteErrorBoundary';

/**
 * The root route: the session wraps every page — the shell and every page read it, and it navigates
 * on a user switch, so it must sit inside the router. The boundary catches a failure in the frame
 * itself before the router's bare default error screen.
 */
export function AppRoot() {
  return (
    <RouteErrorBoundary>
      <SessionProvider>
        <GatewayEventBridge />
        <Outlet />
      </SessionProvider>
    </RouteErrorBoundary>
  );
}
