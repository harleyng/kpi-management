import { useEffect, useId, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useSession } from '@/contexts/useSession';
import { carrySearch, findNavLocation } from '@/lib/navRules';
import { visibleNavGroups } from '@/lib/permissionRules';
import { sidebarActions, useSidebarStore } from '@/lib/sidebarStore';
import { NAV_GROUPS, PRODUCT_ICON, isNavParent, type NavChild, type NavGroup, type NavLeaf, type NavParent } from './navConfig';
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
 * A parent (an area split into sub-pages) is a disclosure button over its sub-items — an accordion,
 * one unfolded by hand at a time, and the parent of the current page always open. Collapsed, the
 * parent's icon opens a menu of its sub-items. The ACTIVE destination is resolved once, by the same
 * longest-prefix rule as the route guard (`findNavLocation`), so a detail page lights up its list and
 * a parent's url prefix never lights up two items.
 *
 * The items shown are the ones the session's permissions allow (`visibleNavGroups`); a group with
 * none left disappears. Never a role check here — and hiding a link is not protection: the AppShell
 * route guard (`canOpenPath`) is.
 */
export function AppSidebar() {
  const collapsed = useSidebarStore((s) => s.collapsed);
  const { access } = useSession();
  const groups = useMemo(() => visibleNavGroups(NAV_GROUPS, access), [access]);
  const { pathname, search } = useLocation();
  const here = findNavLocation(pathname, NAV_GROUPS);
  const nav: NavState = { activeUrl: here?.leaf.url ?? null, activeParent: here?.parent?.url ?? null, search, collapsed };

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
        'hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out md:flex',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <SidebarHeader collapsed={collapsed} />

      <nav aria-label="Điều hướng chính" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.map((group, index) => (
          <SidebarGroup key={group.label} group={group} index={index} nav={nav} />
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
              className="group relative flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
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
      <span className="truncate text-sm font-semibold text-sidebar-accent-foreground">Syntra KPI</span>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={sidebarActions.toggle}
            className="-mr-1.5 ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Where the user is, resolved once per render of the sidebar. */
interface NavState {
  activeUrl: string | null;
  activeParent: string | null;
  /** The current query string — sibling sub-pages carry part of it (`carryParams`). */
  search: string;
  collapsed: boolean;
}

function SidebarGroup({ group, index, nav }: { group: NavGroup; index: number; nav: NavState }) {
  const { collapsed } = nav;
  return (
    // `role="group"` carries the grouping in BOTH states: collapsed there is no heading left to read.
    <div role="group" aria-label={group.label} className={collapsed ? 'mb-2' : 'mb-4'}>
      {collapsed ? (
        index > 0 && <div aria-hidden className="mx-auto mb-2 h-px w-6 bg-sidebar-border" />
      ) : (
        <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-section">
          {group.label}
        </div>
      )}

      {group.items.map((item) =>
        isNavParent(item) ? (
          collapsed ? (
            <CollapsedParent key={item.url} parent={item} nav={nav} />
          ) : (
            <SidebarParent key={item.url} parent={item} nav={nav} />
          )
        ) : (
          <SidebarLink key={item.url} item={item} nav={nav} />
        ),
      )}
    </div>
  );
}

const ROW = 'flex h-9 items-center rounded-md text-sm text-sidebar-foreground transition-colors';
const ROW_ACTIVE = 'bg-sidebar-accent font-medium text-sidebar-accent-foreground';
const ROW_IDLE = 'hover:bg-sidebar-accent/60';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar';

/** A sub-item's link: siblings of the current page keep its cycle / period (`carryParams`). */
function childHref(parent: NavParent, child: NavChild, nav: NavState): string {
  return child.url + (parent.url === nav.activeParent ? carrySearch(parent.carryParams, nav.search) : '');
}

function SidebarLink({ item, nav }: { item: NavLeaf; nav: NavState }) {
  /**
   * A plain `Link`, with the active state resolved by the sidebar: `NavLink` would overwrite our
   * `aria-current` with its own url-only match, and collapsed the link is the child of a Radix
   * `asChild` Slot, which STRING-JOINS a `className` render prop (both in common-pitfalls.md).
   */
  const isActive = nav.activeUrl === item.url;
  const { collapsed } = nav;

  const link = (
    <Link
      to={item.url}
      aria-current={isActive ? 'page' : undefined}
      className={cn(ROW, collapsed ? 'justify-center' : 'gap-2.5 px-2', isActive ? ROW_ACTIVE : ROW_IDLE)}
    >
      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
      {/* Kept in the tree when collapsed, only out of sight: it is what gives the link its
          accessible name, and a tooltip is decoration a screen reader never reaches. */}
      <span className={cn('truncate', collapsed && 'sr-only')}>{item.title}</span>
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.title}</TooltipContent>
    </Tooltip>
  );
}

/**
 * An area with sub-pages, expanded rail: a disclosure button and the sub-items under it. The parent
 * of the current page stays open (its button is inert) and is marked by weight only — the filled
 * highlight belongs to the sub-item you are on.
 */
function SidebarParent({ parent, nav }: { parent: NavParent; nav: NavState }) {
  const openByHand = useSidebarStore((s) => s.openParent === parent.url);
  const listId = useId();
  const holdsPage = nav.activeParent === parent.url;
  const open = holdsPage || openByHand;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => !holdsPage && sidebarActions.toggleParent(parent.url)}
        className={cn(ROW, 'w-full gap-2.5 px-2 text-left', ROW_IDLE, FOCUS, holdsPage && 'font-medium text-sidebar-accent-foreground')}
      >
        <parent.icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">{parent.title}</span>
        <ChevronRight aria-hidden className={cn('h-4 w-4 shrink-0 text-sidebar-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
      </button>
      {open && (
        <ul id={listId} className="mb-1 mt-0.5 space-y-0.5">
          {parent.children.map((child) => {
            const isActive = nav.activeUrl === child.url;
            return (
              <li key={child.url}>
                <Link
                  to={childHref(parent, child, nav)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn('flex h-8 items-center rounded-md pl-[2.375rem] pr-2 text-sm text-sidebar-foreground transition-colors', isActive ? ROW_ACTIVE : ROW_IDLE)}
                >
                  <span className="truncate">{child.title}</span>
                  {child.laterPhase && <LaterPhaseTag />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * An area with sub-pages on the icon rail: the icon opens a menu of the sub-items (its first line
 * names the area). The tooltip shows on hover and focus only; the menu opens on click / Enter.
 */
function CollapsedParent({ parent, nav }: { parent: NavParent; nav: NavState }) {
  const holdsPage = nav.activeParent === parent.url;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            className={cn(ROW, 'w-full justify-center', holdsPage ? ROW_ACTIVE : ROW_IDLE, FOCUS)}
          >
            <parent.icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="sr-only">{parent.title}</span>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{parent.title}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" className="min-w-48">
        <DropdownMenuLabel>{parent.title}</DropdownMenuLabel>
        {parent.children.map((child) => {
          const isActive = nav.activeUrl === child.url;
          return (
            <DropdownMenuItem key={child.url} asChild>
              <Link to={childHref(parent, child, nav)} aria-current={isActive ? 'page' : undefined} className={cn(isActive && 'font-medium text-primary')}>
                {child.title}
                {child.laterPhase && <LaterPhaseTag />}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Phase sau" beside a menu item kept for a later phase (`NavChild.laterPhase`). */
function LaterPhaseTag() {
  return <span className="ml-auto shrink-0 rounded-full border border-current/30 px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-wide opacity-70">Phase sau</span>;
}
