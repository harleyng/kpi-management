import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ERROR_CATALOG } from '@/lib/errorCatalog';
import { HOME_URL } from './navConfig';

const DENIED = ERROR_CATALOG['ERR-KPI-05'];

/**
 * What the AppShell route guard shows on a route the session may not open (a typed-in URL, a stale
 * bookmark). It renders INSIDE the shell, so the top bar's person switcher stays at hand — the demo's
 * way out. Copy from the catalogue (ERR-KPI-05).
 */
export function AccessDenied() {
  const navigate = useNavigate();
  return (
    <EmptyStateCard action={<Button onClick={() => navigate(HOME_URL)}>Về trang chủ</Button>}>
      <span role="alert" className="block font-medium text-foreground">
        {DENIED.title}
      </span>
      <span className="mt-1 block">Chọn người dùng khác ở thanh trên hoặc quay về trang chủ.</span>
    </EmptyStateCard>
  );
}
