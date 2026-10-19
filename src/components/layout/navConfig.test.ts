import { describe, expect, it } from 'vitest';
import appSource from '@/App.tsx?raw';
import { buildTenant, type AccountKey } from '@/lib/permissionFixtures.test-util';
import { canOpenPath, visibleNavGroups } from '@/lib/permissionRules';
import { HOME_URL, NAV_GROUPS, PUBLIC_PATHS } from './navConfig';

const A = buildTenant('t1');
const ALL_GROUPS = NAV_GROUPS.map((g) => g.label);

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
    // §7.1 grants whole groups: a visible group shows every one of its items.
    for (const group of visible) {
      expect(group.items).toEqual(NAV_GROUPS.find((g) => g.label === group.label)!.items);
    }
  });

  it('every persona can open the home page', () => {
    for (const [persona] of PLAN_7_1) expect(canOpenPath(HOME_URL, NAV_GROUPS, A.profileOf(persona))).toBe(true);
  });

  it('an EMPLOYEE cannot open an admin route by typing it', () => {
    expect(canOpenPath('/system/users', NAV_GROUPS, A.profileOf('emp'))).toBe(false);
    expect(canOpenPath('/admin/results', NAV_GROUPS, A.profileOf('emp'))).toBe(false);
  });
});

describe('route coverage', () => {
  const routePaths = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  const navUrls = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.url));

  it('finds the routes of App.tsx', () => {
    expect(routePaths.length).toBeGreaterThan(10);
  });

  it('every route is a menu item or explicitly public — a new page is never open to everyone by accident', () => {
    const unclaimed = routePaths.filter((path) => !navUrls.includes(path) && !PUBLIC_PATHS.includes(path));
    expect(unclaimed).toEqual([]);
  });

  it('every menu item has a route', () => {
    expect(navUrls.filter((url) => !routePaths.includes(url))).toEqual([]);
  });
});
