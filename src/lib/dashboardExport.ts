/**
 * The rows of "Xuất báo cáo vận hành (Excel)" (WBS 4.7.3, BR-KPI-88) — the same sections and columns
 * as the "Vận hành" tab, one sheet each. Display mapping only: every figure comes from
 * `dashboardRules.operationsReport`. It is a REPORT, not the payroll file (BR-KPI-81, `result.export`).
 */

import {
  FORM_STATUS_LABEL,
  FORM_STATUSES,
  FORM_TYPE_LABEL,
  GOAL_PLAN_STATUS_LABEL,
  GOAL_PLAN_STATUSES,
  PERIOD_RESULT_STATUS_LABEL,
  PERIOD_RESULT_STATUSES,
  type CyclePeriod,
  type Employee,
  type Id,
} from '@/data/types';
import type { OperationsReport } from './dashboardRules';
import type { ReportSheet } from './excel';
import { statusCounts } from './resultView';
import { roundScore } from './scoreRules';

export interface OperationsExportInput {
  report: OperationsReport;
  cycleName: string;
  period: Pick<CyclePeriod, 'label'>;
  employees: readonly Pick<Employee, 'id' | 'fullName' | 'employeeCode'>[];
  periods: readonly Pick<CyclePeriod, 'id' | 'label'>[];
}

/** No rows at all — the screen disables the button and says why, instead of writing an empty file. */
export function isOperationsReportEmpty(report: OperationsReport): boolean {
  return report.plans.total === 0 && report.registration.total === 0 && report.evaluation.total === 0 && report.results.all.length === 0;
}

export function operationsSheets(input: OperationsExportInput): ReportSheet[] {
  const { report, cycleName, period } = input;
  const people = new Map(input.employees.map((e) => [e.id, e]));
  const periodLabel = new Map<Id, string>(input.periods.map((p) => [p.id, p.label]));
  const resultCounts = statusCounts(report.results.all);

  return [
    {
      name: `Đăng ký KPI ${cycleName}`,
      columns: [{ header: 'Trạng thái Goal Plan', width: 26 }, { header: 'Số kế hoạch cá nhân', width: 20 }],
      rows: [...GOAL_PLAN_STATUSES.map((s) => [GOAL_PLAN_STATUS_LABEL[s], report.plans.byStatus[s]] as const), ['Tổng', report.plans.total] as const],
    },
    {
      name: `Đánh giá kỳ ${period.label}`,
      columns: [{ header: 'Trạng thái phiếu', width: 26 }, { header: 'Số phiếu', width: 12 }],
      rows: [
        ...FORM_STATUSES.map((s) => [FORM_STATUS_LABEL[s], report.evaluation.byStatus[s]] as const),
        ['Quá hạn', report.evaluation.overdue] as const,
        ['Tỉ lệ hoàn thành (%)', report.evaluation.completionPct === null ? null : roundScore(report.evaluation.completionPct)] as const,
        ...report.evaluation.byStep.map((s) => [`Đang ở bước: ${s.name}`, s.count] as const),
      ],
    },
    {
      name: `Kết quả kỳ ${period.label}`,
      columns: [{ header: 'Mục', width: 30 }, { header: 'Số kết quả', width: 14 }],
      rows: [
        ...PERIOD_RESULT_STATUSES.map((s) => [PERIOD_RESULT_STATUS_LABEL[s], resultCounts[s]] as const),
        ...report.results.ratings.levels.map((l) => [`Xếp loại ${l.level.code} (cá nhân, đã chốt)`, l.count] as const),
        ['Chưa xếp loại (cá nhân, đã chốt)', report.results.ratings.unrated] as const,
      ],
    },
    {
      name: 'Phiếu quá hạn',
      columns: [
        { header: 'Mã nhân viên', width: 14 },
        { header: 'Người được đánh giá', width: 28 },
        { header: 'Loại phiếu', width: 18 },
        { header: 'Kỳ', width: 8 },
        { header: 'Bước', width: 26 },
        { header: 'Hạn bước', width: 12 },
        { header: 'Quá hạn (ngày)', width: 14 },
      ],
      rows: report.overdue.map((r) => {
        const person = people.get(r.form.subjectEmployeeId);
        return [
          person?.employeeCode ?? null,
          person?.fullName ?? 'Không xác định',
          FORM_TYPE_LABEL[r.form.formType],
          r.form.periodId ? (periodLabel.get(r.form.periodId) ?? null) : null,
          r.step.name,
          r.deadline,
          r.daysOver,
        ];
      }),
    },
  ];
}
