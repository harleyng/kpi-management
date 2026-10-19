import { ChevronsUpDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSession } from '@/contexts/useSession';
import { ROLE_LABEL } from '@/data/types';
import { cn } from '@/lib/utils';

/**
 * The account block — the FOOT of the sidebar. Identity is a property of the whole application,
 * not of the screen currently open, so it belongs to the frame that never changes.
 *
 * The menu opens UPWARDS (`side="top"`) because the trigger sits on the bottom edge; Radix flips it
 * automatically in a short viewport. On the collapsed rail only the initial survives, with the name
 * in a tooltip — nothing about the account becomes unreachable by folding the navigation away.
 *
 * TODO Phase 1.3 — the tenant / user / role switcher (plan §3.3) lives in the top bar; this menu
 * keeps the account's own entries.
 */
export function SidebarAccount({ collapsed = false }: { collapsed?: boolean }) {
  const { user, roles } = useSession();

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label="Tài khoản"
        className={cn(
          'flex w-full items-center rounded-md py-2 text-left transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          collapsed ? 'justify-center' : 'gap-2.5 px-2',
        )}
      >
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-[11px] font-semibold text-primary"
        >
          {user.name.slice(0, 1)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium text-sidebar-foreground">
                {user.name}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </>
        )}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{user.name}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}

      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-60">
        <DropdownMenuLabel>Vai trò</DropdownMenuLabel>
        <div className="px-2 pb-1.5 text-xs text-muted-foreground">
          {roles.map((role) => ROLE_LABEL[role]).join(' · ')}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Đăng xuất (giả lập)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
