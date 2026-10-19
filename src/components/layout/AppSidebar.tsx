import { useEffect } from 'react';
import { NavLink, useMatch } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { sidebarActions, useSidebarStore } from '@/lib/sidebarStore';
import { NAV_GROUPS, PRODUCT_ICON, type NavGroup, type NavItem } from './navConfig';
import { SidebarAccount } from './SidebarAccount';

/**
 * Left-hand navigation — a column of three parts: the product mark, the scrolling nav, and the
 * account block pinned to the bottom edge (`SidebarAccount`).
 *
 * It collapses to an icon rail. Collapsing is a CHOICE the user makes and we remember
 * (`sidebarStore`), never something a route does to them: a menu that folded itself away on
 * navigation would read as the app losing its navigation.
 *
 * Collapsed, the rail keeps every link in the tree with its label only visually hidden, so it still
 * reads as named destinations to a screen reader; the tooltips are for the eye.
 *
 * TODO Phase 1.3 — render `visibleNavGroups(roles)` instead of every group.
 */
export function AppSidebar() {
  const collapsed = useSidebarStore((s) => s.collapsed);

  /**
   * ⌘B / Ctrl-B, the shortcut every editor with a side panel already uses. Bound on the window
   * rather than the sidebar because the sidebar is never the focused element when you want it back.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        sidebarActions.toggle();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:flex',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <SidebarHeader collapsed={collapsed} />

      <nav aria-label="Điều hướng chính" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {NAV_GROUPS.map((group, index) => (
          <SidebarGroup key={group.label} group={group} index={index} collapsed={collapsed} />
        ))}
      </nav>

      <div className="shrink-0 p-2">
        <SidebarAccount collapsed={collapsed} />
      </div>
    </aside>
  );
}

/**
 * The header row — the product mark, and the control that folds the column away.
 *
 * Collapsed, the rail has no room for a tile and a button side by side, so the MARK becomes the
 * button: same tile, same spot. The control never moves between the two states, which is the whole
 * reason it is trustworthy.
 */
function SidebarHeader({ collapsed }: { collapsed: boolean }) {
  const label = collapsed ? 'Mở rộng menu' : 'Thu gọn menu';

  if (collapsed) {
    return (
      <div className="flex h-14 shrink-0 items-center justify-center px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={label}
              onClick={sidebarActions.toggle}
              className="group relative flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <PRODUCT_ICON className="h-4 w-4 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0" />
              <PanelLeftOpen
                aria-hidden
                className="absolute h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 px-4">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <PRODUCT_ICON className="h-4 w-4" aria-hidden />
      </div>
      <span className="truncate text-sm font-semibold">Syntra KPI</span>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={sidebarActions.toggle}
            className="-mr-1.5 ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function SidebarGroup({
  group,
  index,
  collapsed,
}: {
  group: NavGroup;
  index: number;
  collapsed: boolean;
}) {
  return (
    // `role="group"` carries the grouping in BOTH states: collapsed there is no heading left to read.
    <div role="group" aria-label={group.label} className={collapsed ? 'mb-2' : 'mb-4'}>
      {collapsed ? (
        index > 0 && <div aria-hidden className="mx-auto mb-2 h-px w-6 bg-sidebar-border" />
      ) : (
        <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {group.label}
        </div>
      )}

      {group.items.map((item) => (
        <SidebarLink key={item.url} item={item} collapsed={collapsed} />
      ))}
    </div>
  );
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  /**
   * The active state is resolved HERE rather than through `NavLink`'s `className` render prop,
   * because collapsed the link is the child of a Radix `asChild` Slot — and a Slot merges
   * `className` by STRING-JOINING it. Handed a function it joins the function's source text, and
   * the link renders with no classes at all (common-pitfalls.md).
   */
  const isActive = useMatch({ path: item.url, end: false }) !== null;

  const link = (
    <NavLink
      to={item.url}
      className={cn(
        'flex h-9 items-center rounded-md text-sm text-sidebar-foreground transition-colors',
        collapsed ? 'justify-center' : 'gap-2.5 px-2',
        isActive ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/60',
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
      {/* Kept in the tree when collapsed, only out of sight: it is what gives the link its
          accessible name, and a tooltip is decoration a screen reader never reaches. */}
      <span className={cn('truncate', collapsed && 'sr-only')}>{item.title}</span>
    </NavLink>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.title}</TooltipContent>
    </Tooltip>
  );
}
