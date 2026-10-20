/**
 * Navigation rules — pure functions over the menu tree (`navConfig.ts`) and URLs. Who may SEE or
 * OPEN a menu item is `permissionRules.ts` (`visibleNavGroups`, `canOpenPath`); this file only maps
 * paths: where a path sits in the menu, which query params follow a sibling link, and where an old
 * link (a `?tab=` from before the sub-page split, 2026-10-19) lands now.
 */
import { claimsPath, normalisePath } from './permissionRules';

/** The structural slice of the menu these rules read — `NAV_GROUPS` satisfies it. */
export interface NavTreeLeaf {
  title: string;
  url: string;
}
export interface NavTreeItem extends NavTreeLeaf {
  children?: readonly NavTreeLeaf[];
  /** Query params a sibling link keeps (`navConfig.ts` `carryParams`). */
  carryParams?: readonly string[];
}
export interface NavTreeGroup {
  label: string;
  items: readonly NavTreeItem[];
}

export interface NavLocation<I extends NavTreeItem = NavTreeItem> {
  group: string;
  /** The parent when the destination is a sub-item, else `null`. */
  parent: I | null;
  /** The menu destination that claims the path (a sub-item or a childless item). */
  leaf: NavTreeLeaf;
}

/**
 * Which menu destination a path belongs to — the longest menu url that is the path or a parent
 * segment of it, the same rule as the route guard. A detail page (`/admin/cycles/list/123`) belongs to its
 * list ("Kỳ đánh giá"). `null` for a path the menu does not claim (`/forms/1`, the not-found page).
 */
export function findNavLocation<I extends NavTreeItem>(pathname: string, groups: readonly { label: string; items: readonly I[] }[]): NavLocation<I> | null {
  let best: NavLocation<I> | null = null;
  let bestLength = -1;
  for (const group of groups) {
    for (const item of group.items) {
      const leaves: [I | null, NavTreeLeaf][] = item.children ? item.children.map((c) => [item, c]) : [[null, item]];
      for (const [parent, leaf] of leaves) {
        const url = normalisePath(leaf.url);
        if (claimsPath(url, pathname) && url.length > bestLength) {
          best = { group: group.label, parent, leaf };
          bestLength = url.length;
        }
      }
    }
  }
  return best;
}

/**
 * The query string a sibling link carries: only the parent's `carryParams` that are present now, in
 * that order (`?cycle=…&period=…`). Empty string when nothing to carry. Links between DIFFERENT parents
 * never carry — the caller only asks for siblings of the current page.
 */
export function carrySearch(carryParams: readonly string[] | undefined, search: string): string {
  if (!carryParams || carryParams.length === 0) return '';
  const current = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const key of carryParams) {
    const value = current.get(key);
    if (value !== null && value !== '') out.set(key, value);
  }
  const text = out.toString();
  return text ? `?${text}` : '';
}

type Remap = (params: URLSearchParams) => string | null;

/** Old `?tab=` values per parent → the sub-page they became. The first entry is the default. */
const TAB_ROUTES: Record<string, [tab: string | null, url: string][]> = {
  '/my/tasks': [[null, '/my/tasks/inbox'], ['inbox', '/my/tasks/inbox'], ['mine', '/my/tasks/forms'], ['delegations', '/my/tasks/delegations']],
  '/team/kpi': [[null, '/team/kpi/members'], ['team', '/team/kpi/members'], ['unit', '/team/kpi/unit']],
  '/dashboard': [[null, '/dashboard/overview'], ['tong-quan', '/dashboard/overview'], ['van-hanh', '/dashboard/operations']],
  '/admin/cycles': [[null, '/admin/cycles/list']],
  '/admin/library': [[null, '/admin/library/definitions'], ['chi-tieu', '/admin/library/definitions'], ['danh-muc', '/admin/library/perspectives'], ['phuong-phap', '/admin/library/calc-methods']],
  '/admin/launches': [[null, '/admin/launches/runs'], ['launches', '/admin/launches/runs'], ['rules', '/admin/launches/rules'], ['forms', '/admin/launches/forms'], ['workflows', '/admin/launches/workflows']],
  '/admin/actuals': [[null, '/admin/actuals/entry'], ['entry', '/admin/actuals/entry'], ['import', '/admin/actuals/import'], ['sync', '/admin/actuals/sync']],
  '/admin/results': [[null, '/admin/results/period'], ['results', '/admin/results/period'], ['rating', '/admin/results/rating'], ['payroll', '/admin/results/payroll']],
  '/system/org': [[null, '/system/org/structure'], ['co-cau', '/system/org/structure'], ['nhan-su', '/system/org/employees'], ['chuc-danh', '/system/org/positions'], ['cong-ty', '/system/org/company']],
  '/system/users': [[null, '/system/users/accounts'], ['tai-khoan', '/system/users/accounts'], ['vai-tro', '/system/users/roles']],
  '/system/data-sources': [[null, '/system/data-sources/catalogue']],
};

/** Params that named a record on the old single page and now name a route segment instead. */
const RECORD_ROUTES: Record<string, Remap> = {
  '/my/tasks': (p) => (p.get('form') ? `/forms/${enc(take(p, 'form'))}` : null),
  '/my/kpi': (p) => {
    // The inline goal panel (`?goal=&mode=`) is gone; a goal opens on its plan's goal page.
    const plan = p.get('plan') ? take(p, 'plan') : null;
    const goal = p.get('goal') ? take(p, 'goal') : null;
    p.delete('mode');
    if (plan) return goal && goal !== 'new' ? `/my/kpi/plans/${enc(plan)}/goals/${enc(goal)}` : `/my/kpi/plans/${enc(plan)}`;
    return goal ? '/my/kpi' : null;
  },
  '/team/kpi': (p) => {
    if (p.get('plan')) return `/team/kpi/members/${enc(take(p, 'plan'))}`;
    if (p.get('unitPlan') && p.get('tab') === 'unit') return `/team/kpi/unit/${enc(take(p, 'unitPlan'))}`;
    return null;
  },
  '/admin/actuals': (p) => (p.get('tab') === 'import' && p.get('batch') ? `/admin/actuals/import/${enc(take(p, 'batch'))}` : null),
  '/system/org': (p) => ((p.get('tab') ?? 'co-cau') === 'co-cau' && p.get('unit') ? `/system/org/structure/${enc(take(p, 'unit'))}` : null),
  '/admin/cycles': (p) => {
    if (!p.get('cycle')) return null;
    const cycle = take(p, 'cycle');
    const plan = p.get('plan') ? take(p, 'plan') : null;
    p.delete('goal');
    p.delete('mode');
    return plan ? `/admin/cycles/plans/${enc(cycle)}/${enc(plan)}` : `/admin/cycles/list/${enc(cycle)}`;
  },
  '/admin/templates': (p) => {
    if (!p.get('bo')) return null;
    const bo = take(p, 'bo');
    return bo === 'moi' ? '/admin/templates/new' : `/admin/templates/${enc(bo)}`;
  },
};

function take(params: URLSearchParams, key: string): string {
  const value = params.get(key) ?? '';
  params.delete(key);
  return value;
}

const enc = encodeURIComponent;

/**
 * Where an old link lands — the parent of a split page (`/admin/library`) and the `?tab=` / record
 * params it used to read (`?tab=import&batch=…`, `?cycle=&plan=`, `?bo=`). Returns the new
 * `path?search` keeping every param the target still reads (`cycle`, `period`, `unit`, `launch`…), or
 * `null` when the path needs no redirect. An unknown `?tab=` falls to the first sub-page.
 *
 * The AppShell applies it AFTER the route guard, so a profile that may not open the old page sees
 * "access denied", never a redirect into it.
 */
export function legacyRedirect(pathname: string, search: string): string | null {
  const path = normalisePath(pathname);
  const params = new URLSearchParams(search);
  const record = RECORD_ROUTES[path]?.(params);
  const tabs = TAB_ROUTES[path];
  if (!record && !tabs) return null;
  const tab = params.get('tab');
  params.delete('tab');
  const target = record ?? (tabs.find(([t]) => t === tab) ?? tabs[0])[1];
  const rest = params.toString();
  return rest ? `${target}?${rest}` : target;
}
