/**
 * The payroll hand-off — BR-KPI-45, WBS 4.6.4. Which results a payroll file carries and what each row
 * says, as pure functions over plain rows: the mock's `results.exportPayroll` builds its file from
 * `buildPayrollSheet`, and the export screen counts with `payrollPreview`, so the two always agree.
 *
 * Every number is copied from the STORED `PeriodResult` — the score (already adjusted, rounded once
 * at finalisation), the adjustment and the payout %. Nothing is recomputed: a Final result is a
 * snapshot, and the file must say exactly what HR finalised.
 */

import type {
  CyclePeriod,
  Employee,
  EmployeeAssignment,
  GoalPlan,
  Id,
  IsoDate,
  IsoDateTime,
  JobPosition,
  OrgUnit,
  PerformanceCycle,
  PeriodResult,
  PeriodResultStatus,
  RatingLevel,
  RatingScale,
} from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';
import { toZonedLocalInput } from './isoDate';
import { subjectAssignment } from './resultRules';
import { foldDiacritics } from './utils';

/**
 * BR-KPI-45 (`ASSUMPTION Q19`) — a payroll file carries the period's EMPLOYEE results that are Final
 * or Locked. A Draft is not finalised; a Company / OrgUnit result has no payout (BR-KPI-40).
 */
export const isPayrollResult = (result: Pick<PeriodResult, 'ownerType' | 'status'>): boolean =>
  result.ownerType === 'Employee' && (result.status === 'Final' || result.status === 'Locked');

/** Why a row needs a second look. A row may carry several. */
export const PAYROLL_NOTES = ['NO_RULE', 'NOT_RATED', 'LEVEL_MISSING', 'EMPLOYEE_MISSING'] as const;
export type PayrollNote = (typeof PAYROLL_NOTES)[number];
export const PAYROLL_NOTE_LABEL: Readonly<Record<PayrollNote, string>> = {
  NO_RULE: 'Chưa có quy tắc quy đổi',
  NOT_RATED: 'Chưa xếp loại',
  LEVEL_MISSING: 'Không tìm thấy xếp loại',
  EMPLOYEE_MISSING: 'Thiếu thông tin nhân viên',
};

/**
 * `ASSUMPTION Q20` — why a payroll row has no payout %. The % is then left BLANK in the file (never
 * 0) and the export goes ahead: a Final result is frozen, so refusing would block the period forever.
 */
export function payoutNote(result: Pick<PeriodResult, 'payoutPct' | 'ratingLevelId'>, levels: readonly Pick<RatingLevel, 'id'>[]): PayrollNote | null {
  if (result.payoutPct !== null) return null;
  if (result.ratingLevelId === null) return 'NOT_RATED';
  return levels.some((l) => l.id === result.ratingLevelId) ? 'NO_RULE' : 'LEVEL_MISSING';
}

/** The rows the payroll rules read — a tenant's own collections (the mock passes `tx.all`). */
export interface PayrollData {
  PerformanceCycle: readonly PerformanceCycle[];
  CyclePeriod: readonly CyclePeriod[];
  GoalPlan: readonly GoalPlan[];
  Employee: readonly Employee[];
  EmployeeAssignment: readonly EmployeeAssignment[];
  OrgUnit: readonly OrgUnit[];
  JobPosition: readonly JobPosition[];
  RatingScale: readonly RatingScale[];
  RatingLevel: readonly RatingLevel[];
  PeriodResult: readonly PeriodResult[];
}

/** What the export screen shows BEFORE exporting. `exportable` = the rows the file will have. */
export interface PayrollPreview {
  exportable: number;
  /** Of those, the rows whose payout % will be blank (`payoutPct === null`, Q20). */
  noPayout: number;
  /** Of those, the rows whose person cannot be found. */
  missingEmployee: number;
  /** Employee results still Draft — not in the file. */
  drafts: number;
  /** Company / OrgUnit results — never in the file. */
  unitResults: number;
}

const ownerOf = (result: PeriodResult, plans: readonly GoalPlan[], employees: readonly Employee[]) => {
  const plan = plans.find((p) => p.id === result.goalPlanId) ?? null;
  const employee = plan?.ownerEmployeeId ? (employees.find((e) => e.id === plan.ownerEmployeeId) ?? null) : null;
  return { plan, employee };
};

/** The counts `buildPayrollSheet` would produce for the period, from rows a screen already reads. */
export function payrollPreview(data: Pick<PayrollData, 'PeriodResult' | 'GoalPlan' | 'Employee'>, periodId: Id): PayrollPreview {
  const preview: PayrollPreview = { exportable: 0, noPayout: 0, missingEmployee: 0, drafts: 0, unitResults: 0 };
  for (const result of data.PeriodResult) {
    if (result.periodId !== periodId) continue;
    if (result.ownerType !== 'Employee') preview.unitResults += 1;
    else if (!isPayrollResult(result)) preview.drafts += 1;
    else {
      preview.exportable += 1;
      if (result.payoutPct === null) preview.noPayout += 1;
      if (ownerOf(result, data.GoalPlan, data.Employee).employee === null) preview.missingEmployee += 1;
    }
  }
  return preview;
}

export interface PayrollRow {
  resultId: Id;
  /** `null` when the person cannot be found (EMPLOYEE_MISSING). */
  employeeCode: string | null;
  fullName: string | null;
  /** Unit and position of `subjectAssignment` — the ones the payout % was read for — by their current names. */
  unitName: string | null;
  positionName: string | null;
  /** `PeriodResult.totalScore` as stored: adjusted, rounded once at finalisation. */
  score: number | null;
  /** Points, as stored (`adjustmentPct`). */
  adjustment: number;
  ratingCode: string | null;
  ratingLabel: string | null;
  /** As stored; `null` → a blank cell (Q20), never 0. */
  payoutPct: number | null;
  status: PeriodResultStatus;
  finalizedAt: IsoDateTime | null;
  notes: PayrollNote[];
}

export interface PayrollSheet {
  tenantName: string;
  /** The tenant's IANA zone — every date and time in the file is read in it. */
  timeZone: string;
  cycleName: string;
  periodLabel: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  ratingScaleName: string | null;
  exportedAt: IsoDateTime;
  exportedByName: string;
  rows: PayrollRow[];
}

export interface PayrollMeta {
  tenantName: string;
  timeZone: string;
  exportedAt: IsoDateTime;
  exportedByName: string;
}

export type PayrollOutcome = { ok: true; sheet: PayrollSheet } | { ok: false; issues: RuleIssue[] };

const byCodeThenId = (a: PayrollRow, b: PayrollRow): number => {
  const ca = a.employeeCode ?? '';
  const cb = b.employeeCode ?? '';
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.resultId < b.resultId ? -1 : a.resultId > b.resultId ? 1 : 0;
};

/**
 * `results.exportPayroll`'s whole decision (BR-KPI-45): one row per Employee result of the period that
 * is Final or Locked, sorted by employee code. No such result → ERR-KPI-04 `NO_FINAL_RESULT`; an
 * unknown period → ERR-KPI-02. Exporting changes nothing, so a Closed cycle exports too.
 */
export function buildPayrollSheet(data: PayrollData, periodId: Id, meta: PayrollMeta): PayrollOutcome {
  const period = data.CyclePeriod.find((p) => p.id === periodId);
  const cycle = period && data.PerformanceCycle.find((c) => c.id === period.cycleId);
  if (!period || !cycle) return { ok: false, issues: [ruleIssue('ERR-KPI-02', periodId, 'PERIOD_NOT_FOUND')] };
  const results = data.PeriodResult.filter((r) => r.periodId === period.id && r.tenantId === period.tenantId && isPayrollResult(r));
  if (results.length === 0) return { ok: false, issues: [ruleIssue('ERR-KPI-04', periodId, 'NO_FINAL_RESULT')] };

  const rows = results.map((result): PayrollRow => {
    const { plan, employee } = ownerOf(result, data.GoalPlan, data.Employee);
    const assignment = plan ? subjectAssignment(plan, period, data) : null;
    const level = result.ratingLevelId === null ? null : (data.RatingLevel.find((l) => l.id === result.ratingLevelId) ?? null);
    const notes: PayrollNote[] = [];
    if (employee === null) notes.push('EMPLOYEE_MISSING');
    const payout = payoutNote(result, data.RatingLevel);
    if (payout) notes.push(payout);
    return {
      resultId: result.id,
      employeeCode: employee?.employeeCode ?? null,
      fullName: employee?.fullName ?? null,
      unitName: assignment ? (data.OrgUnit.find((u) => u.id === assignment.orgUnitId)?.name ?? null) : null,
      positionName: assignment ? (data.JobPosition.find((p) => p.id === assignment.positionId)?.name ?? null) : null,
      score: result.totalScore,
      adjustment: result.adjustmentPct,
      ratingCode: level?.code ?? null,
      ratingLabel: level?.label ?? null,
      payoutPct: result.payoutPct,
      status: result.status,
      finalizedAt: result.finalizedAt,
      notes,
    };
  });

  return {
    ok: true,
    sheet: {
      tenantName: meta.tenantName,
      timeZone: meta.timeZone,
      cycleName: cycle.name,
      periodLabel: period.label,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      ratingScaleName: cycle.ratingScaleId === null ? null : (data.RatingScale.find((s) => s.id === cycle.ratingScaleId)?.name ?? null),
      exportedAt: meta.exportedAt,
      exportedByName: meta.exportedByName,
      rows: rows.sort(byCodeThenId),
    },
  };
}

/** Lower-case ASCII words joined by `-` — `đ`/`Đ` folded too (NFD does not decompose them). */
const slug = (value: string): string =>
  foldDiacritics(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * `luong-kpi_<cycle>_<period>_<yyyyMMdd-HHmm>.xlsx` — the time is the export's, in the tenant zone, so
 * two exports a minute apart never share a name and the name matches the "Xuất lúc" in the file.
 */
export function payrollFileName(sheet: Pick<PayrollSheet, 'cycleName' | 'periodLabel' | 'exportedAt' | 'timeZone'>): string {
  const local = toZonedLocalInput(sheet.exportedAt, sheet.timeZone); // YYYY-MM-DDTHH:mm
  const stamp = `${local.slice(0, 10).replace(/-/g, '')}-${local.slice(11, 16).replace(':', '')}`;
  return ['luong-kpi', slug(sheet.cycleName), slug(sheet.periodLabel), stamp].filter(Boolean).join('_') + '.xlsx';
}
