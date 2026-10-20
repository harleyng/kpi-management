import { describe, expect, it } from 'vitest';
import appSource from '@/App.tsx?raw';
import { buildTenant, type AccountKey } from '@/lib/permissionFixtures.test-util';
import { legacyRedirect } from '@/lib/navRules';
import { canOpenPath, claimsPath, visibleNavGroups } from '@/lib/permissionRules';
import { HOME_URL, NAV_DESTINATIONS, NAV_GROUPS, PUBLIC_PATHS, isNavParent, type NavParent } from './navConfig';

const A = buildTenant('t1');
const ALL_GROUPS = NAV_GROUPS.map((g) => g.label);
const PARENTS: NavParent[] = NAV_GROUPS.flatMap((g) => g.items.filter(isNavParent));

/**
 * Plan §7.1, written out by hand — NOT derived from the default matrix, so a slip in the matrix
 * cannot agree with its own test. ADMIN sees every group (product owner, 2026-10-19). Each persona
 * holds EMPLOYEE / Self plus their role with its default scope, as the seed will.
 */
const PLAN_7_1: [persona: AccountKey, role: string, groups: string[]][] = [
  ['emp', 'EMPLOYEE', ['Của tôi']],
  ['head', 'MANAGER', ['Của tôi', 'Đội nhóm', 'Điều hành']],
  ['hr', 'HR', ['Của tôi', 'Điều hành', 'Quản trị KPI']],
  ['cnb', 'CNB', ['Của tôi', 'Quản trị KPI']],
  ['ceo', 'BOD', ['Của tôi', 'Điều hành']],
  ['admin', 'ADMIN', ALL_GROUPS],
];

describe('the menu under the default matrix (plan §7.1)', () => {
  it.each(PLAN_7_1)('%s (%s) sees %j', (persona, _role, groups) => {
    const visible = visibleNavGroups(NAV_GROUPS, A.profileOf(persona));
    expect(visible.map((g) => g.label)).toEqual(groups);
    // §7.1 grants whole groups: a visible group shows every one of its items and every sub-item.
    for (const group of visible) {
      expect(group.items).toEqual(NAV_GROUPS.find((g) => g.label === group.label)!.items);
    }
  });

  it('"Quy trình duyệt" is the one sub-item narrower than its area — it needs cycle.manage', () => {
    const narrower = PARENTS.flatMap((p) => p.children.filter((c) => c.permission !== p.children[0].permission).map((c) => [c.url, c.permission]));
    expect(narrower).toEqual([['/admin/launches/workflows', 'cycle.manage']]);
  });

  it('every persona can open the home page', () => {
    for (const [persona] of PLAN_7_1) expect(canOpenPath(HOME_URL, NAV_GROUPS, A.profileOf(persona))).toBe(true);
  });

  it.each([
    '/system/users/accounts',
    '/system/users/roles',
    '/admin/results/period',
    '/admin/actuals/entry',
    '/admin/cycles/list/c1',
    '/admin/cycles/plans/c1/p1/goals/g1',
    '/admin/cycles',
    '/admin/templates/new',
    '/team/kpi/members/p1',
    '/dashboard/operations',
    // A split area's old url is denied, never redirected into.
    '/admin/actuals',
    '/admin/actuals?tab=sync',
    '/system/org',
  ])('an EMPLOYEE cannot open %s by typing it', (path) => {
    expect(canOpenPath(path, NAV_GROUPS, A.profileOf('emp'))).toBe(false);
  });

  it("a manager's team pages are closed to HR, who has no team.view", () => {
    expect(canOpenPath('/team/kpi/members/p1', NAV_GROUPS, A.profileOf('hr'))).toBe(false);
  });
});

describe('menu shape', () => {
  it('a destination url never nests inside another destination — a detail route has exactly one owner', () => {
    const urls = NAV_DESTINATIONS.map((d) => d.url);
    const nested = urls.flatMap((a) => urls.filter((b) => a !== b && claimsPath(a, b)).map((b) => `${b} under ${a}`));
    expect(nested).toEqual([]);
  });

  it('every sub-item sits under its parent url, and a parent has at least two', () => {
    for (const parent of PARENTS) {
      expect(parent.children.length).toBeGreaterThanOrEqual(2);
      for (const child of parent.children) expect(claimsPath(parent.url, child.url)).toBe(true);
    }
  });

  it('every parent url lands on its first sub-page — so an old link to the area still works', () => {
    for (const parent of PARENTS) expect(legacyRedirect(parent.url, '')).toBe(parent.children[0].url);
  });

  it('titles are unique, so a page title names one menu item', () => {
    const titles = NAV_DESTINATIONS.map((d) => d.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('route coverage', () => {
  const routePaths = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  const destinationUrls = NAV_DESTINATIONS.map((d) => d.url);

  it('finds the routes of App.tsx, every one written with `path` first', () => {
    expect(routePaths.length).toBeGreaterThan(40);
    const routeTagsWithPath = [...appSource.matchAll(/<Route\b[^>]*\bpath=/g)].length;
    expect(routeTagsWithPath).toBe(routePaths.length);
  });

  it('every route is a menu destination, under one, or explicitly public — a new page is never open to everyone by accident', () => {
    const unclaimed = routePaths.filter((path) => !PUBLIC_PATHS.includes(path) && !destinationUrls.some((url) => claimsPath(url, path)));
    expect(unclaimed).toEqual([]);
  });

  it('every menu destination has a route', () => {
    expect(destinationUrls.filter((url) => !routePaths.includes(url))).toEqual([]);
  });

  it('a parent url has no route of its own — the shell redirects it', () => {
    expect(PARENTS.map((p) => p.url).filter((url) => routePaths.includes(url))).toEqual([]);
  });
});
