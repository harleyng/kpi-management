import { describe, expect, it } from 'vitest';
import { employee, form, sampleScale, step } from '@/test/builders';
import { isOperationsReportEmpty, operationsSheets } from './dashboardExport';
import type { OperationsReport } from './dashboardRules';

const progress = (o: Partial<OperationsReport['evaluation']> = {}): OperationsReport['evaluation'] => ({
  byStatus: { Open: 0, InProgress: 0, Completed: 0, Cancelled: 0 }, total: 0, active: 0, completed: 0, completionPct: null, overdue: 0, byStep: [], ...o,
});
const empty: OperationsReport = {
  plans: { byStatus: { Draft: 0, Submitted: 0, Returned: 0, Approved: 0, Locked: 0 }, total: 0 },
  registration: progress(),
  evaluation: progress(),
  overdue: [],
  results: { all: [], ratings: { levels: sampleScale().map((level) => ({ level, count: 0 })), unrated: 0, total: 0 } },
};

describe('operationsSheets (WBS 4.7.3)', () => {
  it('an empty report is reported as empty — the screen writes no file', () => {
    expect(isOperationsReportEmpty(empty)).toBe(true);
  });

  it('one sheet per section, with the screen\'s labels and the report\'s figures', () => {
    const report: OperationsReport = {
      ...empty,
      plans: { byStatus: { Draft: 2, Submitted: 1, Returned: 1, Approved: 1, Locked: 23 }, total: 28 },
      evaluation: progress({ byStatus: { Open: 0, InProgress: 5, Completed: 22, Cancelled: 0 }, total: 27, active: 27, completed: 22, completionPct: 81.4814, overdue: 5, byStep: [{ stepId: 's2', name: 'Quản lý đánh giá', count: 4 }] }),
      overdue: [{ form: form({ id: 'f1', subjectEmployeeId: 'e9', periodId: 'T02' }), step: step({ name: 'Quản lý đánh giá' }), deadline: '2027-03-08', daysOver: 29 }],
    };
    expect(isOperationsReportEmpty(report)).toBe(false);
    const sheets = operationsSheets({ report, cycleName: 'KPI 2027', period: { label: 'T02' }, employees: [employee({ id: 'e9', fullName: 'Lê Văn Chín', employeeCode: 'E009' })], periods: [{ id: 'T02', label: 'T02' }] });
    expect(sheets.map((s) => s.name)).toEqual(['Đăng ký KPI KPI 2027', 'Đánh giá kỳ T02', 'Kết quả kỳ T02', 'Phiếu quá hạn']);
    expect(sheets[0].rows).toContainEqual(['Đã khóa', 23]);
    expect(sheets[0].rows.at(-1)).toEqual(['Tổng', 28]);
    expect(sheets[1].rows).toContainEqual(['Quá hạn', 5]);
    expect(sheets[1].rows).toContainEqual(['Tỉ lệ hoàn thành (%)', 81.48]);
    expect(sheets[1].rows).toContainEqual(['Đang ở bước: Quản lý đánh giá', 4]);
    expect(sheets[3].rows).toEqual([['E009', 'Lê Văn Chín', 'Đánh giá KPI', 'T02', 'Quản lý đánh giá', '2027-03-08', 29]]);
    for (const sheet of sheets) for (const row of sheet.rows) expect(row).toHaveLength(sheet.columns.length);
  });
});
