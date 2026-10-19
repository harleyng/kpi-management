import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import type { Tenant } from '@/data/types';
import { errorSpecOf } from '@/lib/errorCatalog';
import { PRODUCT_ICON } from './navConfig';
import { SimulatedDataBadge } from './SimulatedDataBadge';

/**
 * What the app shows while there is no session yet — before the shell exists, so these screens
 * never call `useSession()`. Each keeps the product mark and the "Dữ liệu giả lập" banner.
 */

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 md:px-6">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <PRODUCT_ICON className="h-4 w-4" aria-hidden />
        </div>
        <span className="text-sm font-semibold">Syntra KPI</span>
        <div className="flex-1" />
        <SimulatedDataBadge />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

/** The first load: the shell's outline, no spinner text (the status is for screen readers). */
export function SessionLoading() {
  return (
    <div className="flex h-screen overflow-hidden bg-background" aria-busy>
      <span role="status" className="sr-only">
        Đang tải phiên làm việc…
      </span>
      <div className="hidden w-60 shrink-0 flex-col gap-3 border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-4 h-4 w-20" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-6">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-40" />
          <div className="flex-1" />
          <SimulatedDataBadge />
        </div>
        <div className="space-y-4 px-6 py-6">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}

/** The session could not be loaded — the catalogue's copy (ERR-KPI-01 today) and a retry. */
export function SessionError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Frame>
      <ErrorStateCard spec={errorSpecOf(error)} onAction={onRetry} />
    </Frame>
  );
}

interface SessionEmptyProps {
  reason: 'noTenant' | 'noAccount';
  /** Other Active tenants the demo can escape to. */
  otherTenants: readonly Tenant[];
  onSwitchTenant: (tenantId: string) => void;
  /** Present only on the mock adapter. */
  onResetSeed?: () => void;
  resetting?: boolean;
}

/** Loaded fine, but there is nobody to be: no Active tenant, or no Active account in this one. */
export function SessionEmpty({ reason, otherTenants, onSwitchTenant, onResetSeed, resetting }: SessionEmptyProps) {
  const firstSentence =
    reason === 'noTenant'
      ? 'Chưa có công ty nào đang hoạt động.'
      : 'Công ty này chưa có người dùng hoạt động nào để đăng nhập giả lập.';
  return (
    <Frame>
      <EmptyStateCard
        action={
          (onResetSeed || otherTenants.length > 0) && (
            <div className="flex flex-col items-center gap-2">
              {onResetSeed && (
                <Button onClick={onResetSeed} disabled={resetting}>
                  Nạp lại dữ liệu mẫu
                </Button>
              )}
              {otherTenants.map((tenant) => (
                <Button key={tenant.id} variant="outline" onClick={() => onSwitchTenant(tenant.id)}>
                  Chuyển sang {tenant.name}
                </Button>
              ))}
            </div>
          )
        }
      >
        <span className="block font-medium text-foreground">Chưa có dữ liệu mẫu</span>
        <span className="mt-1 block">
          {firstSentence} Nạp lại dữ liệu mẫu để bắt đầu.
        </span>
      </EmptyStateCard>
    </Frame>
  );
}
