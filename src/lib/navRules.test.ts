import { describe, expect, it } from 'vitest';
import { carrySearch, findNavLocation, legacyRedirect, type NavTreeGroup } from './navRules';

const groups: NavTreeGroup[] = [
  { label: 'mine', items: [{ title: 'KPI', url: '/my/kpi' }] },
  {
    label: 'admin',
    items: [
      { title: 'Chu kỳ', url: '/admin/cycles' },
      {
        title: 'Thư viện',
        url: '/admin/library',
        children: [
          { title: 'Chỉ tiêu', url: '/admin/library/definitions' },
          { title: 'Đơn vị', url: '/admin/library/units' },
        ],
      },
    ],
  },
];

describe('findNavLocation', () => {
  it.each([
    ['/my/kpi', 'mine', null, 'KPI'],
    ['/my/kpi/plans/p1/goals/g1', 'mine', null, 'KPI'],
    ['/admin/cycles/c1', 'admin', null, 'Chu kỳ'],
    ['/admin/library/units', 'admin', 'Thư viện', 'Đơn vị'],
    ['/admin/library/units/', 'admin', 'Thư viện', 'Đơn vị'],
    ['/admin/library/definitions/42?x=1', 'admin', 'Thư viện', 'Chỉ tiêu'],
  ])('%s → %s / %s / %s', (path, group, parent, leaf) => {
    const here = findNavLocation(path, groups);
    expect(here?.group).toBe(group);
    expect(here?.parent?.title ?? null).toBe(parent);
    expect(here?.leaf.title).toBe(leaf);
  });

  it('claims nothing for a parent url, a sibling-looking prefix or a public path', () => {
    expect(findNavLocation('/admin/library', groups)).toBeNull();
    expect(findNavLocation('/admin/cyclesX', groups)).toBeNull();
    expect(findNavLocation('/forms/1', groups)).toBeNull();
  });
});

describe('carrySearch', () => {
  it('keeps only the listed params that are present, in the listed order', () => {
    expect(carrySearch(['cycle', 'period'], '?period=p&q=x&cycle=c')).toBe('?cycle=c&period=p');
    expect(carrySearch(['cycle', 'period'], '?cycle=c')).toBe('?cycle=c');
    expect(carrySearch(['cycle'], '?cycle=')).toBe('');
  });

  it('carries nothing without a list', () => {
    expect(carrySearch(undefined, '?cycle=c')).toBe('');
    expect(carrySearch([], '?cycle=c')).toBe('');
  });
});

describe('legacyRedirect', () => {
  it.each([
    // A split area's own url → its first sub-page.
    ['/my/tasks', '', '/my/tasks/inbox'],
    ['/team/kpi', '', '/team/kpi/members'],
    ['/dashboard', '', '/dashboard/overview'],
    ['/admin/library', '', '/admin/library/definitions'],
    ['/admin/launches', '', '/admin/launches/runs'],
    ['/admin/actuals', '', '/admin/actuals/entry'],
    ['/admin/results', '', '/admin/results/period'],
    ['/system/org', '', '/system/org/structure'],
    ['/system/users', '', '/system/users/accounts'],
    ['/system/data-sources', '', '/system/data-sources/catalogue'],
    ['/admin/library/', '', '/admin/library/definitions'],
    // Every old ?tab= value.
    ['/my/tasks', '?tab=inbox', '/my/tasks/inbox'],
    ['/my/tasks', '?tab=mine', '/my/tasks/forms'],
    ['/my/tasks', '?tab=delegations', '/my/tasks/delegations'],
    ['/team/kpi', '?tab=unit', '/team/kpi/unit'],
    ['/dashboard', '?tab=van-hanh', '/dashboard/operations'],
    ['/dashboard', '?tab=tong-quan', '/dashboard/overview'],
    ['/admin/library', '?tab=danh-muc', '/admin/library/perspectives'],
    ['/admin/library', '?tab=phuong-phap', '/admin/library/calc-methods'],
    ['/admin/launches', '?tab=rules', '/admin/launches/rules'],
    ['/admin/launches', '?tab=workflows', '/admin/launches/workflows'],
    ['/admin/actuals', '?tab=import', '/admin/actuals/import'],
    ['/admin/actuals', '?tab=sync', '/admin/actuals/sync'],
    ['/admin/results', '?tab=rating', '/admin/results/rating'],
    ['/admin/results', '?tab=payroll', '/admin/results/payroll'],
    ['/system/org', '?tab=nhan-su', '/system/org/employees'],
    ['/system/org', '?tab=chuc-danh', '/system/org/positions'],
    ['/system/org', '?tab=cong-ty', '/system/org/company'],
    ['/system/users', '?tab=vai-tro', '/system/users/roles'],
    // An unknown tab falls to the first sub-page.
    ['/admin/results', '?tab=khong-co', '/admin/results/period'],
    // Other params survive.
    ['/dashboard', '?tab=van-hanh&cycle=c&period=p&unit=u', '/dashboard/operations?cycle=c&period=p&unit=u'],
    ['/admin/launches', '?tab=forms&launch=l1', '/admin/launches/forms?launch=l1'],
    ['/system/org', '?tab=nhan-su&emp=e1', '/system/org/employees?emp=e1'],
    // Record params that are a route segment now.
    ['/my/tasks', '?form=f1', '/forms/f1'],
    ['/my/kpi', '?plan=p1', '/my/kpi/plans/p1'],
    ['/my/kpi', '?plan=p1&goal=g1&mode=edit', '/my/kpi/plans/p1/goals/g1'],
    ['/my/kpi', '?goal=g1&mode=view&cycle=c', '/my/kpi?cycle=c'],
    ['/team/kpi', '?plan=p1&cycle=c', '/team/kpi/members/p1?cycle=c'],
    ['/team/kpi', '?tab=unit&unitPlan=p2', '/team/kpi/unit/p2'],
    ['/admin/actuals', '?tab=import&batch=b1', '/admin/actuals/import/b1'],
    ['/system/org', '?unit=u1', '/system/org/structure/u1'],
    ['/system/org', '?tab=co-cau&unit=u1', '/system/org/structure/u1'],
    ['/admin/cycles', '', '/admin/cycles/list'],
    ['/admin/cycles', '?cycle=c1', '/admin/cycles/list/c1'],
    ['/admin/cycles', '?cycle=c1&plan=p1&goal=g1&mode=edit', '/admin/cycles/plans/c1/p1'],
    ['/admin/templates', '?bo=t1&q=x', '/admin/templates/t1?q=x'],
    ['/admin/templates', '?bo=moi', '/admin/templates/new'],
    // Ids are encoded.
    ['/my/tasks', '?form=a%2Fb', '/forms/a%2Fb'],
  ])('%s%s → %s', (path, search, target) => {
    expect(legacyRedirect(path, search)).toBe(target);
  });

  it.each([
    ['/my/kpi', ''],
    ['/my/kpi', '?cycle=c'],
    ['/admin/templates', '?q=x'],
    ['/admin/library/units', '?tab=x'],
    ['/admin/cycles/list/c1', '?cycle=c2'],
    ['/forms/f1', ''],
    ['/', ''],
  ])('leaves %s%s alone', (path, search) => {
    expect(legacyRedirect(path, search)).toBeNull();
  });
});
