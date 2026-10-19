import { describe, expect, it } from 'vitest';
import { ENTITY_NAMES } from '@/data/types';
import { KEY_ROOTS, queryKey, rootsAffectedBy } from './keys';
import { employeesKey, orgUnitsKey, positionsKey } from './org';
import { calcMethodsKey, kpiDefinitionsKey, measureUnitsKey, perspectivesKey } from './library';
import { sessionDirectoryKey } from './session';
import { dataSourcesKey, evidenceKey } from './actuals';
import {
  delegationsKey,
  evaluationItemsKey,
  formActionsKey,
  formKey,
  formsKey,
  goalChangeItemsKey,
  inboxKey,
  launchRulesKey,
  launchesKey,
  workflowStepsKey,
  workflowsKey,
} from './forms';
import { cyclesKey, goalPlanKey, goalPlansKey, goalsKey, kgisKey, periodsKey, targetLevelsKey } from './goals';

describe('query keys', () => {
  it('start with the tenant (CLAUDE.md rule 7)', () => {
    expect(queryKey('t1', 'goals', { goalPlanIds: ['a'] })).toEqual(['t1', 'goals', { goalPlanIds: ['a'] }]);
    for (const key of [orgUnitsKey('t1'), employeesKey('t1'), kpiDefinitionsKey('t1'), perspectivesKey('t1'), measureUnitsKey('t1'), sessionDirectoryKey('t1')]) {
      expect(key[0]).toBe('t1');
      expect(Object.keys(KEY_ROOTS)).toContain(key[1]);
    }
  });

  it('every entity (but the tenant itself, keyed apart) makes at least one root stale beyond the audit log', () => {
    for (const entity of ENTITY_NAMES.filter((e) => e !== 'Tenant')) {
      expect(rootsAffectedBy(entity).filter((r) => r !== 'auditLog'), entity).not.toEqual([]);
    }
  });

  it('the forms keys (T5) start with the tenant and use a declared root', () => {
    const keys = [
      workflowsKey('t1'),
      workflowStepsKey('t1'),
      launchesKey('t1'),
      launchRulesKey('t1'),
      formsKey('t1', { formType: 'KPI_EVAL' }, { limit: 50 }),
      formKey('t1', 'f1'),
      formActionsKey('t1', 'f1'),
      evaluationItemsKey('t1', 'f1'),
      goalChangeItemsKey('t1', 'f1'),
      inboxKey('t1', 'u1'),
      delegationsKey('t1'),
      cyclesKey('t1'),
      periodsKey('t1', 'c1'),
      goalPlansKey('t1'),
      goalPlanKey('t1', 'p1'),
      kgisKey('t1', 'p1'),
      goalsKey('t1', { goalPlanIds: ['p1'] }),
      targetLevelsKey('t1', { goalPlanId: 'p1' }),
      dataSourcesKey('t1'),
      evidenceKey('t1', { periodId: 'T01' }),
      calcMethodsKey('t1'),
      positionsKey('t1'),
    ];
    for (const key of keys) {
      expect(key[0]).toBe('t1');
      expect(Object.keys(KEY_ROOTS)).toContain(key[1]);
    }
  });

  it('a form moving refreshes the forms, the inboxes and the plan screens — no track lists another\'s keys', () => {
    expect(rootsAffectedBy('FormInstance')).toEqual(expect.arrayContaining(['forms', 'inbox']));
    expect(rootsAffectedBy('FormStepAction')).toContain('forms');
    expect(rootsAffectedBy('EvaluationItem')).toContain('forms');
    expect(rootsAffectedBy('GoalChangeItem')).toContain('forms');
    expect(rootsAffectedBy('GoalPlan')).toContain('goalPlans');
    expect(rootsAffectedBy('Delegation')).toEqual(expect.arrayContaining(['delegations', 'inbox']));
    expect(rootsAffectedBy('FormLaunch')).toContain('launches');
    expect(rootsAffectedBy('WorkflowStep')).toContain('workflows');
    expect(rootsAffectedBy('Evidence')).toContain('evidence');
  });

  it('the session directory follows every identity change (Phase 1.3)', () => {
    for (const entity of ['UserAccount', 'UserRole', 'RolePermission', 'Role', 'OrgUnit', 'EmployeeAssignment', 'Employee'] as const) {
      expect(rootsAffectedBy(entity)).toContain('sessionDirectory');
    }
    expect(rootsAffectedBy('Goal')).not.toContain('sessionDirectory');
  });
});
