import { describe, expect, it } from 'vitest';
import * as domain from './types';

/**
 * The fixed state sets are the only source of status labels (CLAUDE.md, rule 2). These tests keep
 * each set and its Vietnamese label map in step, so a value added to a set without a label — or a
 * label left behind after a value is removed — fails here instead of rendering a raw code.
 */
const LABELLED_SETS: [string, readonly string[], Record<string, string>][] = [
  ['RECORD_STATUSES', domain.RECORD_STATUSES, domain.RECORD_STATUS_LABEL],
  ['TENANT_STATUSES', domain.TENANT_STATUSES, domain.TENANT_STATUS_LABEL],
  ['ORG_UNIT_TYPES', domain.ORG_UNIT_TYPES, domain.ORG_UNIT_TYPE_LABEL],
  ['JOB_LEVELS', domain.JOB_LEVELS, domain.JOB_LEVEL_LABEL],
  ['EMPLOYMENT_STATUSES', domain.EMPLOYMENT_STATUSES, domain.EMPLOYMENT_STATUS_LABEL],
  ['AUTH_PROVIDERS', domain.AUTH_PROVIDERS, domain.AUTH_PROVIDER_LABEL],
  ['ROLE_CODES', domain.ROLE_CODES, domain.ROLE_LABEL],
  ['SCOPE_TYPES', domain.SCOPE_TYPES, domain.SCOPE_TYPE_LABEL],
  ['BSC_PERSPECTIVE_CODES', domain.BSC_PERSPECTIVE_CODES, domain.BSC_PERSPECTIVE_LABEL],
  ['CALC_METHOD_TYPES', domain.CALC_METHOD_TYPES, domain.CALC_METHOD_TYPE_LABEL],
  ['KPI_FREQUENCIES', domain.KPI_FREQUENCIES, domain.KPI_FREQUENCY_LABEL],
  ['AGGREGATIONS', domain.AGGREGATIONS, domain.AGGREGATION_LABEL],
  ['LIBRARY_STATUSES', domain.LIBRARY_STATUSES, domain.LIBRARY_STATUS_LABEL],
  ['KPI_CATEGORY_TAGS', domain.KPI_CATEGORY_TAGS, domain.KPI_CATEGORY_TAG_LABEL],
  ['CYCLE_STATUSES', domain.CYCLE_STATUSES, domain.CYCLE_STATUS_LABEL],
  ['PERIOD_TYPES', domain.PERIOD_TYPES, domain.PERIOD_TYPE_LABEL],
  ['PLAN_TYPES', domain.PLAN_TYPES, domain.PLAN_TYPE_LABEL],
  ['OWNER_TYPES', domain.OWNER_TYPES, domain.OWNER_TYPE_LABEL],
  ['GOAL_PLAN_STATUSES', domain.GOAL_PLAN_STATUSES, domain.GOAL_PLAN_STATUS_LABEL],
  ['GOAL_STATUSES', domain.GOAL_STATUSES, domain.GOAL_STATUS_LABEL],
  ['GOAL_VISIBILITIES', domain.GOAL_VISIBILITIES, domain.GOAL_VISIBILITY_LABEL],
  ['KRI_TYPES', domain.KRI_TYPES, domain.KRI_TYPE_LABEL],
  ['TARGET_TYPES', domain.TARGET_TYPES, domain.TARGET_TYPE_LABEL],
  ['TARGET_LEVEL_CODES', domain.TARGET_LEVEL_CODES, domain.TARGET_LEVEL_LABEL],
  ['ALIGNMENT_TYPES', domain.ALIGNMENT_TYPES, domain.ALIGNMENT_TYPE_LABEL],
  ['SOURCE_TYPES', domain.SOURCE_TYPES, domain.SOURCE_TYPE_LABEL],
  ['CONNECTION_AUTH_TYPES', domain.CONNECTION_AUTH_TYPES, domain.CONNECTION_AUTH_TYPE_LABEL],
  ['SYNC_RUN_STATUSES', domain.SYNC_RUN_STATUSES, domain.SYNC_RUN_STATUS_LABEL],
  ['IMPORT_TYPES', domain.IMPORT_TYPES, domain.IMPORT_TYPE_LABEL],
  ['IMPORT_BATCH_STATUSES', domain.IMPORT_BATCH_STATUSES, domain.IMPORT_BATCH_STATUS_LABEL],
  ['FORM_TYPES', domain.FORM_TYPES, domain.FORM_TYPE_LABEL],
  ['ACTOR_RULES', domain.ACTOR_RULES, domain.ACTOR_RULE_LABEL],
  ['STEP_ACTIONS', domain.STEP_ACTIONS, domain.STEP_ACTION_LABEL],
  ['OVERDUE_BEHAVIOURS', domain.OVERDUE_BEHAVIOURS, domain.OVERDUE_BEHAVIOUR_LABEL],
  ['EVALUATION_COLUMNS', domain.EVALUATION_COLUMNS, domain.EVALUATION_COLUMN_LABEL],
  ['FORM_STATUSES', domain.FORM_STATUSES, domain.FORM_STATUS_LABEL],
  ['LAUNCH_TIMINGS', domain.LAUNCH_TIMINGS, domain.LAUNCH_TIMING_LABEL],
  ['LAUNCH_STATUSES', domain.LAUNCH_STATUSES, domain.LAUNCH_STATUS_LABEL],
  ['RECIPIENT_MODES', domain.RECIPIENT_MODES, domain.RECIPIENT_MODE_LABEL],
  ['LAUNCH_TRIGGERS', domain.LAUNCH_TRIGGERS, domain.LAUNCH_TRIGGER_LABEL],
  ['PAYOUT_SCOPES', domain.PAYOUT_SCOPES, domain.PAYOUT_SCOPE_LABEL],
  ['PERIOD_RESULT_STATUSES', domain.PERIOD_RESULT_STATUSES, domain.PERIOD_RESULT_STATUS_LABEL],
  ['NOTIFICATION_EVENTS', domain.NOTIFICATION_EVENTS, domain.NOTIFICATION_EVENT_LABEL],
  ['NOTIFICATION_CHANNELS', domain.NOTIFICATION_CHANNELS, domain.NOTIFICATION_CHANNEL_LABEL],
  ['NOTIFICATION_STATUSES', domain.NOTIFICATION_STATUSES, domain.NOTIFICATION_STATUS_LABEL],
  ['AUDIT_ACTIONS', domain.AUDIT_ACTIONS, domain.AUDIT_ACTION_LABEL],
  ['GOAL_CHANGE_TYPES', domain.GOAL_CHANGE_TYPES, domain.GOAL_CHANGE_TYPE_LABEL],
  // Not a status, but the audit log (T7) shows every entity by name.
  ['ENTITY_NAMES', domain.ENTITY_NAMES, domain.ENTITY_NAME_LABEL],
];

/** Sets that are never shown as a status on their own — a subset, or developer-facing names. */
const UNLABELLED_SETS = ['ALLOWED_STEP_ACTIONS', 'PERSON_FORM_ACTIONS', 'NOTIFICATION_LANGUAGES', 'NOTIFICATION_REF_TYPES'];

describe('state sets', () => {
  it('pairs every exported set with a label map, or lists it as deliberately unlabelled', () => {
    const exportedSets = Object.entries(domain)
      .filter(([, value]) => Array.isArray(value))
      .map(([name]) => name)
      .sort();
    const covered = [...LABELLED_SETS.map(([name]) => name), ...UNLABELLED_SETS].sort();
    expect(exportedSets).toEqual(covered);
  });

  it.each(LABELLED_SETS)('%s has exactly one non-empty label per value', (_name, values, labels) => {
    expect(Object.keys(labels).sort()).toEqual([...values].sort());
    for (const value of values) expect(labels[value]?.trim()).toBeTruthy();
  });

  it('never repeats a value inside a set', () => {
    const all = [...LABELLED_SETS.map(([name, values]) => [name, values] as const)];
    for (const name of UNLABELLED_SETS) all.push([name, (domain as Record<string, unknown>)[name] as readonly string[]]);
    for (const [name, values] of all) expect(new Set(values).size, name).toBe(values.length);
  });

  it('offers a person only the step actions a person can take', () => {
    for (const system of ['AUTO_FORWARD', 'AUTO_LOCK'] as const) {
      expect(domain.ALLOWED_STEP_ACTIONS).not.toContain(system);
      expect(domain.PERSON_FORM_ACTIONS).not.toContain(system);
    }
    expect(domain.ALLOWED_STEP_ACTIONS).not.toContain('CANCEL');
    for (const action of [...domain.ALLOWED_STEP_ACTIONS, ...domain.PERSON_FORM_ACTIONS]) {
      expect(domain.STEP_ACTIONS).toContain(action);
    }
  });

  it('never records EDIT as a form action — it is a permission (workflow review)', () => {
    expect(domain.PERSON_FORM_ACTIONS).not.toContain('EDIT');
  });

  it('keeps the ERD Goal Plan states and adds only Returned (plan §6.4)', () => {
    expect(domain.GOAL_PLAN_STATUSES).toEqual(['Draft', 'Submitted', 'Returned', 'Approved', 'Locked']);
  });

  it('declares the LEVELS method (D1) beside the five ERD methods', () => {
    expect(domain.CALC_METHOD_TYPES).toEqual(['RATIO_UP', 'RATIO_DOWN', 'TIERED', 'BINARY', 'FORMULA', 'LEVELS']);
  });

  it('keeps P2 form types out of P1', () => {
    expect(domain.FORM_TYPES).toEqual(['GOAL_SETTING', 'GOAL_CHANGE', 'KPI_EVAL']);
  });
});
