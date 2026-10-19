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
  /**
   * The menu parent the user unfolded by hand (its url), or `null`. Accordion: one at a time — the
   * parent of the current page is always open on top of it, so it is not stored. Not persisted: a
   * folded-open menu is about this visit, not a preference.
   */
  openParent: string | null;
}

export const useSidebarStore = create<SidebarState>(() => ({ collapsed: readStoredCollapsed(), openParent: null }));

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
  /** Unfold a parent (folding whichever other one was open), or fold it if it was the open one. */
  toggleParent: (url: string) => useSidebarStore.setState((s) => ({ openParent: s.openParent === url ? null : url })),
};
