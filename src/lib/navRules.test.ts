import { describe, expect, it } from 'vitest';
import { NAV_GROUPS } from '@/components/layout/navConfig';
import type { RoleCode } from '@/data/types';
import { visibleNavGroups } from './navRules';

const labels = (roles: RoleCode[]) => visibleNavGroups(NAV_GROUPS, roles).map((g) => g.label);

describe('visibleNavGroups (plan §7.1)', () => {
  it('shows only "Của tôi" to an employee', () => {
    expect(labels(['EMPLOYEE'])).toEqual(['Của tôi']);
  });

  it('shows the team and the dashboard to a manager', () => {
    expect(labels(['MANAGER'])).toEqual(['Của tôi', 'Đội nhóm', 'Điều hành']);
  });

  it('shows the dashboard and KPI administration to HR', () => {
    expect(labels(['HR'])).toEqual(['Của tôi', 'Điều hành', 'Quản trị KPI']);
  });

  it('shows KPI administration but not the dashboard to C&B', () => {
    expect(labels(['CNB'])).toEqual(['Của tôi', 'Quản trị KPI']);
  });

  it('shows the dashboard to the board', () => {
    expect(labels(['BOD'])).toEqual(['Của tôi', 'Điều hành']);
  });

  it('shows the system group to an admin', () => {
    expect(labels(['ADMIN'])).toEqual(['Của tôi', 'Hệ thống']);
  });

  it('gives several roles the union, in the declared order', () => {
    expect(labels(['ADMIN', 'MANAGER', 'HR'])).toEqual([
      'Của tôi',
      'Đội nhóm',
      'Điều hành',
      'Quản trị KPI',
      'Hệ thống',
    ]);
  });

  it('still shows the groups open to everyone when the session has no role', () => {
    expect(labels([])).toEqual(['Của tôi']);
  });
});
