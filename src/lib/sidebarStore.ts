/**
 * Whether the left-hand navigation is collapsed to an icon rail.
 *
 * Client state, persisted: a user who folded the menu away to gain width for a dense Goal Plan
 * table should not have to fold it away again on the next visit. Expanded is the default — an
 * unset preference means a first-time visitor, and the icon rail only makes sense once you know
 * what the icons stand for.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'kpi.sidebar';

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'collapsed';
  } catch {
    // Private browsing / storage disabled — fall back rather than crash on first paint.
    return false;
  }
}

interface SidebarState {
  collapsed: boolean;
}

export const useSidebarStore = create<SidebarState>(() => ({ collapsed: readStoredCollapsed() }));

function remember(collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // Not being able to remember the choice is not worth breaking the toggle over.
  }
}

export const sidebarActions = {
  toggle: () => sidebarActions.set(!useSidebarStore.getState().collapsed),
  set: (collapsed: boolean) => {
    useSidebarStore.setState({ collapsed });
    remember(collapsed);
  },
};
