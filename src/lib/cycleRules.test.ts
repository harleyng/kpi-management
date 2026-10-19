import { describe, expect, it } from 'vitest';
import type { CycleStatus, FormType } from '@/data/types';
import { months2027, period } from '@/test/builders';
import { CYCLE_NEXT, canEditCycle, canLockPeriod, cycleAllowsLaunch, cycleIssues, periodIssues, statusChangeIssues } from './cycleRules';

const cycle = { name: 'KPI 2027', startDate: '2027-01-01', endDate: '2027-12-31' };
const details = (issues: { detail: string | null }[]) => issues.map((i) => i.detail);

describe('cycleIssues — what saveCycle refuses', () => {
  it('accepts a named cycle with ordered real dates', () => {
    expect(cycleIssues(cycle)).toEqual([]);
    expect(cycleIssues({ ...cycle, endDate: cycle.startDate })).toEqual([]);
  });

  it.each([
    [{ ...cycle, name: '  ' }, 'NAME_REQUIRED'],
    [{ ...cycle, startDate: '2027-02-30' }, 'DATES_INVALID'],
    [{ ...cycle, endDate: '2026-12-31' }, 'DATES_INVALID'],
  ])('%# → %s (ERR-KPI-06)', (c, detail) => {
    const issues = cycleIssues(c);
    expect(details(issues)).toContain(detail);
    expect(issues.every((i) => i.code === 'ERR-KPI-06')).toBe(true);
  });
});

describe('periodIssues — what savePeriods refuses', () => {
  it('accepts the twelve months plus their quarters (different types may overlap)', () => {
    const quarter = period({ id: 'Q1', periodType: 'Quarter', label: 'Q1', startDate: '2027-01-01', endDate: '2027-03-31' });
    expect(periodIssues(cycle, [...months2027(), quarter])).toEqual([]);
  });

  it('refuses two periods of the same type that overlap, pointing at the second', () => {
    const issues = periodIssues(cycle, [period({ id: 'a' }), period({ id: 'b', label: 'T01b', startDate: '2027-01-31', endDate: '2027-02-27' })]);
    expect(issues).toEqual([expect.objectContaining({ code: 'ERR-KPI-06', ref: 'b', detail: 'PERIOD_OVERLAP' })]);
  });

  it.each([
    [period({ startDate: '2026-12-31' }), 'PERIOD_OUTSIDE_CYCLE'],
    [period({ endDate: '2028-01-01' }), 'PERIOD_OUTSIDE_CYCLE'],
    [period({ endDate: '2026-12-01' }), 'PERIOD_DATES_INVALID'],
    [period({ inputDeadline: '2027-01-30' }), 'DEADLINE_BEFORE_END'],
    [period({ evalDeadline: 'soon' }), 'DEADLINE_BEFORE_END'],
    [period({ label: '' }), 'LABEL_REQUIRED'],
  ])('%# → %s', (p, detail) => {
    expect(details(periodIssues(cycle, [p]))).toContain(detail);
  });

  it('a deadline on the period\'s last day is fine', () => {
    expect(periodIssues(cycle, [period({ inputDeadline: '2027-01-31', evalDeadline: '2027-02-13' })])).toEqual([]);
  });
});

describe('the cycle\'s status — forward by one, Planning only for edits', () => {
  it('CYCLE_NEXT is Planning → Active → Evaluating → Closed', () => {
    expect(CYCLE_NEXT).toEqual({ Planning: 'Active', Active: 'Evaluating', Evaluating: 'Closed', Closed: null });
  });

  it.each([
    ['Planning', 'Evaluating'],
    ['Active', 'Planning'],
    ['Active', 'Closed'],
    ['Closed', 'Planning'],
    ['Active', 'Active'],
  ] as [CycleStatus, CycleStatus][])('%s → %s is refused (ERR-KPI-04)', (from, to) => {
    expect(statusChangeIssues({ ...cycle, status: from }, to, months2027())).toEqual([expect.objectContaining({ code: 'ERR-KPI-04', detail: 'STATUS_STEP_INVALID' })]);
  });

  it('activating needs at least one valid period (ERR-KPI-06)', () => {
    expect(details(statusChangeIssues({ ...cycle, status: 'Planning' }, 'Active', []))).toEqual(['PERIODS_REQUIRED']);
    const bad = statusChangeIssues({ ...cycle, status: 'Planning' }, 'Active', [period({ endDate: '2028-02-01' })]);
    expect(details(bad)).toEqual(['PERIODS_REQUIRED', 'PERIOD_OUTSIDE_CYCLE']);
    expect(statusChangeIssues({ ...cycle, status: 'Planning' }, 'Active', months2027())).toEqual([]);
  });

  it('later moves need no periods check', () => {
    expect(statusChangeIssues({ ...cycle, status: 'Active' }, 'Evaluating', [])).toEqual([]);
    expect(statusChangeIssues({ ...cycle, status: 'Evaluating' }, 'Closed', [])).toEqual([]);
  });

  it('a cycle and its periods are edited only while Planning', () => {
    expect(canEditCycle({ status: 'Planning' })).toEqual({ ok: true });
    for (const status of ['Active', 'Evaluating', 'Closed'] as const) expect(canEditCycle({ status })).toEqual({ ok: false, code: 'ERR-KPI-04' });
  });

  it('a period lock changes until the cycle is Closed', () => {
    expect(canLockPeriod({ status: 'Evaluating' })).toEqual({ ok: true });
    expect(canLockPeriod({ status: 'Closed' })).toEqual({ ok: false, code: 'ERR-KPI-04' });
  });
});

describe('cycleAllowsLaunch — which forms a cycle accepts', () => {
  it.each([
    ['GOAL_SETTING', 'Planning', true],
    ['GOAL_SETTING', 'Active', true],
    ['GOAL_SETTING', 'Evaluating', false],
    ['KPI_EVAL', 'Planning', false],
    ['KPI_EVAL', 'Active', true],
    ['KPI_EVAL', 'Evaluating', true],
    ['GOAL_CHANGE', 'Evaluating', true],
    ['GOAL_CHANGE', 'Closed', false],
    ['KPI_EVAL', 'Closed', false],
  ] as [FormType, CycleStatus, boolean][])('%s in a %s cycle → %s', (formType, status, ok) => {
    expect(cycleAllowsLaunch({ status }, formType).ok).toBe(ok);
  });
});
