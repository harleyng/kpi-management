import { useSession } from '@/contexts/useSession';
import { useGatewayEventInvalidation } from '@/hooks/queries/useGatewayEventInvalidation';

/**
 * Renders nothing: subscribes the query cache to the gateway's change events for the session's
 * tenant (`useGatewayEventInvalidation`). Mounted once, inside `SessionProvider`, in `main.tsx`.
 */
export function GatewayEventBridge() {
  const { tenantId } = useSession();
  useGatewayEventInvalidation(tenantId);
  return null;
}
