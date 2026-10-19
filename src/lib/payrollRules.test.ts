import { describe, expect, it } from 'vitest';
import type { PerformanceCycle, PeriodResult, RatingScale } from '@/data/types';
import { TENANT, TZ, assignment, employee, orgUnit, period, plan, position, sampleScale } from '@/test/builders';
import {
  buildPayrollSheet,
  isPayrollResult,
  payoutNote,
  payrollFileName,
  payrollPreview,
  type PayrollData,
  type PayrollMeta,
} from './payrollRules';
import { subjectAssignment } from './resultRules';

const levels = sampleScale(); // rl-D rl-C rl-B rl-A rl-A+
const cycle: PerformanceCycle = { id: 'c2027', tenantId: TENANT, name: 'KPI 2027', startDate: '2027-01-01', endDate: '2027-12-31', ratingScaleId: 'rs1', status: 'Active' };
const scale: RatingScale = { id: 'rs1', tenantId: TENANT, name: 'Thang mẫu A+/A/B/C/D', status: 'Active' };
const T01 = period();
const T02 = period({ id: 'T02', label: 'T02', startDate: '2027-02-01', endDate: '2027-02-28' });

const result = (o: Partial<PeriodResult> = {}): PeriodResult => ({
  id: `r-${o.goalPlanId ?? 'plan1'}-${o.periodId ?? 'T01'}`,
  tenantId: TENANT,
  periodId: 'T01',
  goalPlanId: 'plan1',
  ownerType: 'Employee',
  totalScore: 90.5,
  ratingLevelId: 'rl-B',
  payoutPct: 80,
  adjustmentPct: 1,
  status: 'Final',
  finalizedAt: '2027-02-13T02:00:00.000Z',
  ...o,
});

function data(o: Partial<PayrollData> = {}): PayrollData {
  return {
    PerformanceCycle: [cycle],
    CyclePeriod: [T01, T02],
    GoalPlan: [plan({ status: 'Locked' })],
    Employee: [employee()],
    EmployeeAssignment: [assignment({ orgUnitId: 'ou-kd' })],
    OrgUnit: [orgUnit(), orgUnit({ id: 'ou-kd', parentId: 'ou-root', code: 'KD', name: 'Kinh doanh', unitType: 'Department' })],
    JobPosition: [position()],
    RatingScale: [scale],
    RatingLevel: levels,
    PeriodResult: [result()],
    ...o,
  };
}

const meta: PayrollMeta = { tenantName: 'Syntra', timeZone: TZ, exportedAt: '2027-04-06T02:00:00.000Z', exportedByName: 'Người C&B' };

function sheetOf(d: PayrollData, periodId = 'T01') {
  const outcome = buildPayrollSheet(d, periodId, meta);
  if (!outcome.ok) throw new Error(`refused: ${outcome.issues.map((i) => i.detail).join()}`);
  return outcome.sheet;
}

describe('isPayrollResult (BR-KPI-81, ASSUMPTION Q38)', () => {
  it.each([
    ['Employee', 'Final', true],
    ['Employee', 'Locked', true],
    ['Employee', 'Draft', false],
    ['OrgUnit', 'Final', false],
    ['Company', 'Locked', false],
  ] as const)('%s %s → %s', (ownerType, status, expected) => {
    expect(isPayrollResult({ ownerType, status })).toBe(expected);
  });
});

describe('payoutNote (ASSUMPTION Q39)', () => {
  it('has no note when there is a payout — 0 included', () => {
    expect(payoutNote({ payoutPct: 80, ratingLevelId: 'rl-B' }, levels)).toBeNull();
    expect(payoutNote({ payoutPct: 0, ratingLevelId: 'rl-D' }, levels)).toBeNull();
  });

  it('tells the three reasons for a blank payout apart', () => {
    expect(payoutNote({ payoutPct: null, ratingLevelId: 'rl-B' }, levels)).toBe('NO_RULE');
    expect(payoutNote({ payoutPct: null, ratingLevelId: null }, levels)).toBe('NOT_RATED');
    expect(payoutNote({ payoutPct: null, ratingLevelId: 'rl-gone' }, levels)).toBe('LEVEL_MISSING');
  });
});

describe('buildPayrollSheet — which results', () => {
  it('takes Final and Locked Employee results of the period and nothing else', () => {
    const d = data({
      GoalPlan: ['plan1', 'plan2', 'plan3', 'unit'].map((id, i) => plan({ id, ownerEmployeeId: i < 3 ? `e${i + 1}` : null, ownerType: i < 3 ? 'Employee' : 'OrgUnit' })),
      Employee: [employee(), employee({ id: 'e2', employeeCode: 'E2' }), employee({ id: 'e3', employeeCode: 'E3' })],
      PeriodResult: [
        result({ goalPlanId: 'plan1', status: 'Final' }),
        result({ goalPlanId: 'plan2', status: 'Locked' }),
        result({ goalPlanId: 'plan3', status: 'Draft' }),
        result({ goalPlanId: 'unit', ownerType: 'OrgUnit', payoutPct: null }),
        result({ goalPlanId: 'plan1', periodId: 'T02' }),
        result({ goalPlanId: 'plan2', tenantId: 'other' , id: 'foreign' }),
      ],
    });
    const rows = sheetOf(d).rows;
    expect(rows.map((r) => [r.employeeCode, r.status])).toEqual([
      ['E1', 'Final'],
      ['E2', 'Locked'],
    ]);
  });

  it('refuses a period with no Final / Locked Employee result (ERR-KPI-04 NO_FINAL_RESULT)', () => {
    const outcome = buildPayrollSheet(data({ PeriodResult: [result({ status: 'Draft' }), result({ ownerType: 'Company', goalPlanId: 'x' })] }), 'T01', meta);
    expect(outcome).toEqual({ ok: false, issues: [expect.objectContaining({ code: 'ERR-KPI-04', detail: 'NO_FINAL_RESULT', ref: 'T01' })] });
  });

  it('refuses an unknown period (ERR-KPI-02)', () => {
    const outcome = buildPayrollSheet(data(), 'T99', meta);
    expect(outcome.ok === false && outcome.issues[0].code).toBe('ERR-KPI-02');
  });

  it('a Closed cycle still exports (exporting computes nothing)', () => {
    expect(sheetOf(data({ PerformanceCycle: [{ ...cycle, status: 'Closed' }] })).rows).toHaveLength(1);
  });
});

describe('buildPayrollSheet — every number as stored', () => {
  it('copies score, adjustment, rating and payout verbatim', () => {
    const [row] = sheetOf(data()).rows;
    expect(row).toMatchObject({ score: 90.5, adjustment: 1, ratingCode: 'B', ratingLabel: 'B', payoutPct: 80, finalizedAt: '2027-02-13T02:00:00.000Z', notes: [] });
  });

  it('never rounds or re-derives (a stored 90.123 stays 90.123; a negative adjustment stays)', () => {
    const [row] = sheetOf(data({ PeriodResult: [result({ totalScore: 90.123, adjustmentPct: -2 })] })).rows;
    expect(row.score).toBe(90.123);
    expect(row.adjustment).toBe(-2);
  });

  it('keeps 0 as 0 — a clamped score and a 0% payout are numbers, not blanks', () => {
    const [row] = sheetOf(data({ PeriodResult: [result({ totalScore: 0, adjustmentPct: -5, ratingLevelId: 'rl-D', payoutPct: 0 })] })).rows;
    expect(row).toMatchObject({ score: 0, payoutPct: 0, ratingCode: 'D', notes: [] });
  });

  it('a blank payout carries its reason; an unknown level has no code and does not crash', () => {
    const rows = (o: Partial<PeriodResult>) => sheetOf(data({ PeriodResult: [result({ payoutPct: null, ...o })] })).rows[0];
    expect(rows({ ratingLevelId: 'rl-B' })).toMatchObject({ payoutPct: null, notes: ['NO_RULE'] });
    expect(rows({ ratingLevelId: null })).toMatchObject({ ratingCode: null, notes: ['NOT_RATED'] });
    expect(rows({ ratingLevelId: 'rl-gone' })).toMatchObject({ ratingCode: null, ratingLabel: null, notes: ['LEVEL_MISSING'] });
  });
});

describe('buildPayrollSheet — who, where (subjectAssignment, BR-KPI-24/40/42)', () => {
  const kd = assignment({ id: 'as-kd', orgUnitId: 'ou-kd', effectiveFrom: '2020-01-01', effectiveTo: '2027-01-14' });
  const root = assignment({ id: 'as-root', orgUnitId: 'ou-root', positionId: 'pos-lead', effectiveFrom: '2027-01-15' });
  const positions = [position(), position({ id: 'pos-lead', code: 'TN', name: 'Trưởng nhóm', jobLevel: 'TeamLead' })];
  const unitOf = (o: Partial<PayrollData>) => sheetOf(data({ JobPosition: positions, ...o })).rows[0];

  it('names the unit and position in force on the last day of the period', () => {
    expect(unitOf({ EmployeeAssignment: [kd, root] })).toMatchObject({ unitName: 'Syntra', positionName: 'Trưởng nhóm', employeeCode: 'E1', fullName: 'Nhân viên' });
  });

  it('a transfer effective on the last day counts; one effective after does not', () => {
    const onLast = assignment({ id: 'as-last', orgUnitId: 'ou-root', effectiveFrom: '2027-01-31' });
    const after = assignment({ id: 'as-after', orgUnitId: 'ou-root', effectiveFrom: '2027-02-01' });
    const kdOpen = assignment({ id: 'as-kd', orgUnitId: 'ou-kd' });
    expect(unitOf({ EmployeeAssignment: [{ ...kdOpen, effectiveTo: '2027-01-30' }, onLast] }).unitName).toBe('Syntra');
    expect(unitOf({ EmployeeAssignment: [{ ...kdOpen, effectiveTo: '2027-01-31' }, after] }).unitName).toBe('Kinh doanh');
  });

  it('someone who left mid-period is placed where they were on their last day', () => {
    expect(unitOf({ Employee: [employee({ leftOn: '2027-01-10', employmentStatus: 'Resigned' })], EmployeeAssignment: [kd, root] }).unitName).toBe('Kinh doanh');
  });

  it('two primaries starting the same day: decided by id, not by row order', () => {
    const a = assignment({ id: 'as-a', orgUnitId: 'ou-kd' });
    const b = assignment({ id: 'as-b', orgUnitId: 'ou-root' });
    expect(unitOf({ EmployeeAssignment: [a, b] }).unitName).toBe(unitOf({ EmployeeAssignment: [b, a] }).unitName);
  });

  it('a concurrent (non-primary) assignment is ignored', () => {
    const concurrent = assignment({ id: 'as-x', orgUnitId: 'ou-root', isPrimary: false, effectiveFrom: '2027-01-20' });
    expect(unitOf({ EmployeeAssignment: [assignment({ orgUnitId: 'ou-kd' }), concurrent] }).unitName).toBe('Kinh doanh');
  });

  it('no assignment, or a deleted unit / position → blank names, row still there', () => {
    expect(unitOf({ EmployeeAssignment: [] })).toMatchObject({ unitName: null, positionName: null, employeeCode: 'E1' });
    expect(unitOf({ EmployeeAssignment: [assignment({ orgUnitId: 'ou-gone', positionId: 'pos-gone' })] })).toMatchObject({ unitName: null, positionName: null });
  });

  it('a person who cannot be found is kept, flagged, never dropped', () => {
    const [row] = sheetOf(data({ Employee: [] })).rows;
    expect(row).toMatchObject({ employeeCode: null, fullName: null, notes: ['EMPLOYEE_MISSING'] });
    const [unowned] = sheetOf(data({ GoalPlan: [plan({ ownerEmployeeId: null })] })).rows;
    expect(unowned.notes).toEqual(['EMPLOYEE_MISSING']);
  });

  it('agrees with the payout subject for the same inputs', () => {
    const d = data({ EmployeeAssignment: [kd, root] });
    expect(subjectAssignment(d.GoalPlan[0], T01, d)?.id).toBe('as-root');
  });
});

describe('buildPayrollSheet — order and header', () => {
  it('sorts by employee code, ties by result id; a missing code first', () => {
    const d = data({
      GoalPlan: [plan({ id: 'p1', ownerEmployeeId: 'e2' }), plan({ id: 'p2', ownerEmployeeId: 'e1' }), plan({ id: 'p3', ownerEmployeeId: 'ghost' })],
      Employee: [employee(), employee({ id: 'e2', employeeCode: 'E2' })],
      PeriodResult: [result({ id: 'r1', goalPlanId: 'p1' }), result({ id: 'r2', goalPlanId: 'p2' }), result({ id: 'r3', goalPlanId: 'p3' })],
    });
    expect(sheetOf(d).rows.map((r) => r.resultId)).toEqual(['r3', 'r2', 'r1']);
  });

  it('carries the cycle, period, scale and export metadata', () => {
    expect(sheetOf(data())).toMatchObject({
      tenantName: 'Syntra', timeZone: TZ, cycleName: 'KPI 2027', periodLabel: 'T01', periodStart: '2027-01-01', periodEnd: '2027-01-31',
      ratingScaleName: 'Thang mẫu A+/A/B/C/D', exportedAt: meta.exportedAt, exportedByName: 'Người C&B',
    });
    expect(sheetOf(data({ PerformanceCycle: [{ ...cycle, ratingScaleId: null }] })).ratingScaleName).toBeNull();
  });
});

describe('payrollPreview', () => {
  it('counts what the sheet will hold, and what it leaves out', () => {
    const d = data({
      GoalPlan: [plan({ id: 'p1' }), plan({ id: 'p2', ownerEmployeeId: 'ghost' }), plan({ id: 'p3' }), plan({ id: 'u', ownerType: 'OrgUnit', ownerEmployeeId: null })],
      PeriodResult: [
        result({ goalPlanId: 'p1' }),
        result({ goalPlanId: 'p2', payoutPct: null }),
        result({ goalPlanId: 'p3', status: 'Draft' }),
        result({ goalPlanId: 'u', ownerType: 'OrgUnit' }),
        result({ goalPlanId: 'p1', periodId: 'T02' }),
      ],
    });
    const preview = payrollPreview(d, 'T01');
    expect(preview).toEqual({ exportable: 2, noPayout: 1, missingEmployee: 1, drafts: 1, unitResults: 1 });
    expect(preview.exportable).toBe(sheetOf(d).rows.length);
  });
});

describe('payrollFileName', () => {
  it('folds diacritics (đ included), keeps safe characters only, stamps the tenant-zone time', () => {
    expect(payrollFileName({ cycleName: 'KPI 2027 — Đợt 1', periodLabel: 'Tháng 02/2027', exportedAt: '2027-04-06T02:05:00.000Z', timeZone: TZ })).toBe(
      'luong-kpi_kpi-2027-dot-1_thang-02-2027_20270406-0905.xlsx',
    );
  });

  it('reads the date in the tenant zone (23:30 UTC is already the next day in GMT+7)', () => {
    expect(payrollFileName({ cycleName: 'KPI', periodLabel: 'T01', exportedAt: '2027-01-31T23:30:00.000Z', timeZone: TZ })).toBe('luong-kpi_kpi_t01_20270201-0630.xlsx');
  });
});
