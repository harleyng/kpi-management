import { describe, expect, it } from 'vitest';
import { ENTITY_NAMES } from '@/data/types';
import { KEY_ROOTS, queryKey, rootsAffectedBy } from './keys';
import { employeesKey, orgUnitsKey, positionsKey } from './org';
import {
  calcMethodsKey,
  calcTiersKey,
  dataSourcesKey,
  kpiDefinitionsKey,
  kpiTemplateItemsKey,
  kpiTemplatesKey,
  libraryGoalUsageKey,
  measureUnitsKey,
  perspectivesKey,
} from './library';
import { sessionDirectoryKey } from './session';

describe('query keys', () => {
  it('start with the tenant (CLAUDE.md rule 7)', () => {
    expect(queryKey('t1', 'goals', { goalPlanIds: ['a'] })).toEqual(['t1', 'goals', { goalPlanIds: ['a'] }]);
    for (const key of [orgUnitsKey('t1'), employeesKey('t1'), kpiDefinitionsKey('t1'), perspectivesKey('t1'), measureUnitsKey('t1'), sessionDirectoryKey('t1'),
      positionsKey('t1'), calcMethodsKey('t1'), calcTiersKey('t1'), kpiTemplatesKey('t1'), kpiTemplateItemsKey('t1'), dataSourcesKey('t1'), libraryGoalUsageKey('t1')]) {
      expect(key[0]).toBe('t1');
      expect(Object.keys(KEY_ROOTS)).toContain(key[1]);
    }
  });

  it('every entity (but the tenant itself, keyed apart) makes at least one root stale beyond the audit log', () => {
    for (const entity of ENTITY_NAMES.filter((e) => e !== 'Tenant')) {
      expect(rootsAffectedBy(entity).filter((r) => r !== 'auditLog'), entity).not.toEqual([]);
    }
  });

  it('the session directory follows every identity change (Phase 1.3)', () => {
    for (const entity of ['UserAccount', 'UserRole', 'RolePermission', 'Role', 'OrgUnit', 'EmployeeAssignment', 'Employee'] as const) {
      expect(rootsAffectedBy(entity)).toContain('sessionDirectory');
    }
    expect(rootsAffectedBy('Goal')).not.toContain('sessionDirectory');
  });
});
