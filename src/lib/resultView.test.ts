import { describe, expect, it } from 'vitest';
import type { PeriodResult } from '@/data/types';
import { TENANT, assignment, employee, orgUnit, plan, sampleScale } from '@/test/builders';
import { buildResultRows, draftSelection, formatPoints, isShownToEmployee, payoutState, statusCounts, UNKNOWN_OWNER } from './resultView';

const levels = sampleScale();
const result = (o: Partial<PeriodResult> = {}): PeriodResult => ({
  id: 'r1', tenantId: TENANT, periodId: 'T01', goalPlanId: 'plan1', ownerType: 'Employee', totalScore: 90, ratingLevelId: 'rl-B',
  payoutPct: 80, adjustmentPct: 0, status: 'Final', finalizedAt: null, ...o,
});

describe('payoutState', () => {
  it('distinguishes a value (0 included), a unit result, unrated, no rule and a missing level', () => {
    expect(payoutState(result(), levels)).toEqual({ kind: 'value', pct: 80 });
    expect(payoutState(result({ payoutPct: 0, ratingLevelId: 'rl-D' }), levels)).toEqual({ kind: 'value', pct: 0 });
    expect(payoutState(result({ ownerType: 'OrgUnit', payoutPct: null }), levels)).toEqual({ kind: 'notApplicable' });
    expect(payoutState(result({ payoutPct: null, ratingLevelId: null }), levels)).toEqual({ kind: 'notRated' });
    expect(payoutState(result({ payoutPct: null }), levels)).toEqual({ kind: 'noRule' });
    expect(payoutState(result({ payoutPct: null, ratingLevelId: 'gone' }), levels)).toEqual({ kind: 'levelMissing' });
  });
});

describe('buildResultRows', () => {
  const units = [orgUnit({ name: 'Công ty Syntra' }), orgUnit({ id: 'ou-kd', parentId: 'ou-root', code: 'KD', name: 'Kinh doanh', unitType: 'Department' })];
  const base = {
    employees: [employee({ fullName: 'Trần Thu' })],
    assignments: [assignment({ orgUnitId: 'ou-kd', effectiveTo: '2027-01-14' }), assignment({ id: 'as-2', orgUnitId: 'ou-root', effectiveFrom: '2027-01-15' })],
    units,
    levels,
    period: { endDate: '2027-01-31' },
  };

  it('names the person and the unit they were in at the period end; the level by id', () => {
    const [row] = buildResultRows({ ...base, results: [result()], plans: [plan()] });
    expect(row).toMatchObject({ ownerName: 'Trần Thu', ownerCode: 'E1', unitName: 'Công ty Syntra', level: { code: 'B' } });
  });

  it('names a unit plan by its unit and the company plan by the root; neither repeats it as its unit', () => {
    const rows = buildResultRows({
      ...base,
      results: [result({ id: 'u', goalPlanId: 'pu', ownerType: 'OrgUnit' }), result({ id: 'c', goalPlanId: 'pc', ownerType: 'Company' })],
      plans: [plan({ id: 'pu', ownerType: 'OrgUnit', ownerEmployeeId: null, ownerOrgUnitId: 'ou-kd' }), plan({ id: 'pc', ownerType: 'Company', ownerEmployeeId: null, ownerOrgUnitId: 'ou-root' })],
    });
    expect(rows.map((r) => [r.ownerName, r.unitName])).toEqual([
      ['Kinh doanh', null],
      ['Công ty Syntra', null],
    ]);
  });

  it('never leaves the owner blank when it cannot be found', () => {
    const rows = buildResultRows({ ...base, results: [result({ goalPlanId: 'gone' }), result({ id: 'r2' })], plans: [plan({ ownerEmployeeId: 'ghost' })] });
    expect(rows.map((r) => r.ownerName)).toEqual([UNKNOWN_OWNER, UNKNOWN_OWNER]);
    expect(rows[0].level?.code).toBe('B');
  });
});

describe('statusCounts / isShownToEmployee / draftSelection', () => {
  it('counts every status, zero included', () => {
    expect(statusCounts([result(), result({ status: 'Draft' }), result({ status: 'Draft' })])).toEqual({ Draft: 2, Final: 1, Locked: 0 });
  });

  it('hides a Draft from its employee; shows Final and Locked', () => {
    expect(['Draft', 'Final', 'Locked'].map((status) => isShownToEmployee({ status: status as PeriodResult['status'] }))).toEqual([false, true, true]);
  });

  it('keeps only selected ids that are still Drafts', () => {
    const results = [result({ id: 'a', status: 'Draft' }), result({ id: 'b', status: 'Final' }), result({ id: 'c', status: 'Draft' })];
    expect(draftSelection(new Set(['a', 'b', 'gone']), results)).toEqual(['a']);
  });
});

describe('formatPoints', () => {
  it('signs the points, Vietnamese decimals, a plain 0', () => {
    expect([formatPoints(1), formatPoints(-2.5), formatPoints(0)]).toEqual(['+1', '−2,5', '0']);
  });
});
