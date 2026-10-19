import { describe, expect, it } from 'vitest';
import type { CycleStatus, FormType, PerformanceCycle } from '@/data/types';
import { months2027, period } from '@/test/builders';
import {
  canEditCycle,
  canLockPeriod,
  CYCLE_NEXT,
  cycleAllowsLaunch,
  cycleIssues,
  defaultCycleId,
  defaultResultCycle,
  defaultResultPeriod,
  generatePeriods,
  mergeGeneratedPeriods,
  nextCycleStatus,
  periodInput,
  periodIssues,
  statusChangeIssues,
  type PeriodDraft,
} from './cycleRules';

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

describe('generatePeriods — "Tạo kỳ tự động" (WBS 4.3.1)', () => {
  const ok = (c: typeof cycle, options?: Parameters<typeof generatePeriods>[1]): PeriodDraft[] => {
    const result = generatePeriods(c, options);
    if (!result.ok) throw new Error(`expected periods, got ${JSON.stringify(result.issues)}`);
    return result.periods;
  };

  it('a calendar 2027 cycle → T01…T12 and Q1…Q4 with the seed\'s dates and deadlines', () => {
    const periods = ok(cycle);
    const months = periods.filter((p) => p.periodType === 'Month');
    const quarters = periods.filter((p) => p.periodType === 'Quarter');
    expect(months.map((p) => p.label)).toEqual(['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12']);
    expect(months[0]).toEqual({ periodType: 'Month', label: 'T01', startDate: '2027-01-01', endDate: '2027-01-31', inputDeadline: '2027-02-05', evalDeadline: '2027-02-13' });
    expect(months[11]).toMatchObject({ startDate: '2027-12-01', endDate: '2027-12-31', inputDeadline: '2028-01-05', evalDeadline: '2028-01-13' });
    expect(quarters).toEqual([
      { periodType: 'Quarter', label: 'Q1', startDate: '2027-01-01', endDate: '2027-03-31', inputDeadline: null, evalDeadline: null },
      { periodType: 'Quarter', label: 'Q2', startDate: '2027-04-01', endDate: '2027-06-30', inputDeadline: null, evalDeadline: null },
      { periodType: 'Quarter', label: 'Q3', startDate: '2027-07-01', endDate: '2027-09-30', inputDeadline: null, evalDeadline: null },
      { periodType: 'Quarter', label: 'Q4', startDate: '2027-10-01', endDate: '2027-12-31', inputDeadline: null, evalDeadline: null },
    ]);
    expect(periodIssues(cycle, periods)).toEqual([]);
  });

  it('a leap year ends February on the 29th', () => {
    const feb = ok({ ...cycle, startDate: '2028-01-01', endDate: '2028-12-31' }).find((p) => p.label === 'T02');
    expect(feb).toMatchObject({ endDate: '2028-02-29', inputDeadline: '2028-03-05' });
  });

  it('a cycle starting in April counts quarters from its start (ASSUMPTION Q32) and keeps calendar month labels', () => {
    const fiscal = { ...cycle, startDate: '2027-04-01', endDate: '2028-03-31' };
    const periods = ok(fiscal);
    expect(periods.filter((p) => p.periodType === 'Month').map((p) => p.label)).toEqual(['T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12', 'T01', 'T02', 'T03']);
    expect(periods.find((p) => p.label === 'Q1')).toMatchObject({ startDate: '2027-04-01', endDate: '2027-06-30' });
    expect(periods.find((p) => p.label === 'Q4')).toMatchObject({ startDate: '2028-01-01', endDate: '2028-03-31' });
    expect(periodIssues(fiscal, periods)).toEqual([]);
  });

  it('a 7-month cycle gets two whole quarters — never a partial third', () => {
    const short = ok({ ...cycle, endDate: '2027-07-31' });
    expect(short.filter((p) => p.periodType === 'Quarter').map((p) => p.label)).toEqual(['Q1', 'Q2']);
    expect(short.filter((p) => p.periodType === 'Month')).toHaveLength(7);
  });

  it('halves and the year on request', () => {
    const periods = ok(cycle, { types: ['Half', 'Year'] });
    expect(periods.map((p) => `${p.label} ${p.startDate}…${p.endDate}`)).toEqual(['H1 2027-01-01…2027-06-30', 'H2 2027-07-01…2027-12-31', 'Y 2027-01-01…2027-12-31']);
  });

  it('custom deadline offsets (0 = the last day itself, still not before the end)', () => {
    const [t01] = ok(cycle, { types: ['Month'], inputDeadlineDays: 0, evalDeadlineDays: 7 });
    expect(t01).toMatchObject({ inputDeadline: '2027-01-31', evalDeadline: '2027-02-07' });
  });

  it.each([
    [{ ...cycle, startDate: '2027-01-15' }, undefined, 'CYCLE_NOT_WHOLE_MONTHS'],
    [{ ...cycle, endDate: '2027-12-30' }, undefined, 'CYCLE_NOT_WHOLE_MONTHS'],
    [{ ...cycle, endDate: '2028-01-31' }, undefined, 'CYCLE_TOO_LONG'],
    [cycle, { inputDeadlineDays: -1 }, 'DEADLINE_DAYS_INVALID'],
    [cycle, { evalDeadlineDays: 2.5 }, 'DEADLINE_DAYS_INVALID'],
    [{ ...cycle, name: '' }, undefined, 'NAME_REQUIRED'],
    [{ ...cycle, endDate: '2026-01-31' }, undefined, 'DATES_INVALID'],
  ])('%# refuses → %s (ERR-KPI-06)', (c, options, detail) => {
    const result = generatePeriods(c, options);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(details(result.issues)).toContain(detail);
      expect(result.issues.every((i) => i.code === 'ERR-KPI-06')).toBe(true);
    }
  });
});

describe('mergeGeneratedPeriods — regenerating keeps ids and locks', () => {
  const generated = (generatePeriods(cycle) as { ok: true; periods: PeriodDraft[] }).periods;

  it('a same (type, label) period keeps its id and lock; new ones are unlocked; others are kept', () => {
    const t01 = period({ id: 'stored-T01', isLocked: true, inputDeadline: '2027-02-05', evalDeadline: '2027-02-13' });
    const t02 = period({ id: 'stored-T02', label: 'T02', startDate: '2027-02-01', endDate: '2027-02-28', inputDeadline: '2027-02-28' });
    const extra = period({ id: 'stored-X', periodType: 'Half', label: 'H1', startDate: '2027-01-01', endDate: '2027-06-30' });
    const { inputs, summary } = mergeGeneratedPeriods([t01, t02, extra], generated);

    expect(inputs.find((p) => p.label === 'T01')).toMatchObject({ id: 'stored-T01', isLocked: true });
    expect(inputs.find((p) => p.label === 'T02')).toMatchObject({ id: 'stored-T02', inputDeadline: '2027-03-05' });
    expect(inputs.find((p) => p.label === 'T03')).toMatchObject({ isLocked: false });
    expect(inputs.find((p) => p.label === 'T03')?.id).toBeUndefined();
    expect(inputs.find((p) => p.label === 'H1')).toMatchObject({ id: 'stored-X' });
    expect(inputs).toHaveLength(generated.length + 1);
    expect(summary.unchanged.map((p) => p.label)).toEqual(['T01']);
    expect(summary.updated.map((p) => p.label)).toEqual(['T02']);
    expect(summary.added).toHaveLength(generated.length - 2);
    expect(summary.kept.map((p) => p.id)).toEqual(['stored-X']);
  });

  it('on an empty cycle everything is added', () => {
    const { summary, inputs } = mergeGeneratedPeriods([], generated);
    expect(summary.added).toHaveLength(16);
    expect(inputs.every((p) => p.id === undefined && p.isLocked === false)).toBe(true);
  });

  it('periodInput re-sends a stored period unchanged', () => {
    const stored = period({ id: 'x', isLocked: true });
    const { tenantId: _t, cycleId: _c, ...expected } = stored;
    expect(periodInput(stored)).toEqual(expected);
  });

  it('nextCycleStatus follows CYCLE_NEXT', () => {
    expect(nextCycleStatus({ status: 'Planning' })).toBe('Active');
    expect(nextCycleStatus({ status: 'Closed' })).toBeNull();
  });
});

describe('defaultCycleId — the cycle a screen opens on', () => {
  const c = (id: string, status: CycleStatus, startDate: string) => ({ id, status, startDate });
  const list = [c('2026', 'Closed', '2026-01-01'), c('2027', 'Active', '2027-01-01'), c('2028', 'Planning', '2028-01-01')];

  it('the Active cycle; a valid ?cycle= wins; an unknown one is ignored', () => {
    expect(defaultCycleId(list)).toBe('2027');
    expect(defaultCycleId(list, '2028')).toBe('2028');
    expect(defaultCycleId(list, 'nope')).toBe('2027');
  });

  it('then Evaluating, Planning, the latest Closed; none → null', () => {
    expect(defaultCycleId([c('a', 'Planning', '2028-01-01'), c('b', 'Evaluating', '2027-01-01')])).toBe('b');
    expect(defaultCycleId([c('a', 'Closed', '2025-01-01'), c('b', 'Closed', '2026-01-01')])).toBe('b');
    expect(defaultCycleId([])).toBeNull();
  });
});

describe('defaultResultPeriod / defaultResultCycle (T6 screens)', () => {
  const months = months2027();
  const q1 = period({ id: 'Q1', periodType: 'Quarter', label: 'Q1', startDate: '2027-01-01', endDate: '2027-03-31' });

  it('opens on the latest month already over', () => {
    expect(defaultResultPeriod([q1, ...months], '2027-04-06')?.id).toBe('T03');
    expect(defaultResultPeriod(months, '2027-04-01')?.id).toBe('T03');
    expect(defaultResultPeriod(months, '2027-03-31')?.id).toBe('T02');
  });

  it('falls back to the first month, then the first period, then null', () => {
    expect(defaultResultPeriod([...months].reverse(), '2026-12-01')?.id).toBe('T01');
    expect(defaultResultPeriod([q1], '2027-06-01')?.id).toBe('Q1');
    expect(defaultResultPeriod([], '2027-06-01')).toBeNull();
  });

  const c = (id: string, status: CycleStatus, startDate: string): PerformanceCycle => ({
    id, tenantId: 't1', name: id, startDate, endDate: `${startDate.slice(0, 4)}-12-31`, ratingScaleId: null, status,
  });

  it('prefers the Active cycle, then Evaluating, then the latest started', () => {
    const cycles = [c('2026', 'Closed', '2026-01-01'), c('2027', 'Active', '2027-01-01'), c('2028', 'Planning', '2028-01-01')];
    expect(defaultResultCycle(cycles, '2027-04-06')?.id).toBe('2027');
    expect(defaultResultCycle([c('2026', 'Evaluating', '2026-01-01'), c('2028', 'Planning', '2028-01-01')], '2027-04-06')?.id).toBe('2026');
    expect(defaultResultCycle([c('2026', 'Closed', '2026-01-01'), c('2028', 'Planning', '2028-01-01')], '2027-04-06')?.id).toBe('2026');
    expect(defaultResultCycle([c('2028', 'Planning', '2028-01-01')], '2027-04-06')?.id).toBe('2028');
    expect(defaultResultCycle([], '2027-04-06')).toBeNull();
  });
});
