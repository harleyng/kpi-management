import { describe, expect, it } from 'vitest';
import type { PayrollRow, PayrollSheet } from '@/lib/payrollRules';
import { PAYROLL_HEADERS, renderPayrollWorkbook } from './payrollWorkbook';

/** The rendered file read back with exceljs (jsdom's Blob has no `arrayBuffer()`, so read the bytes). */

const row = (o: Partial<PayrollRow> = {}): PayrollRow => ({
  resultId: 'r1', employeeCode: 'E016', fullName: 'Trần Thị Thu', unitName: 'Phòng Kinh doanh', positionName: 'Chuyên viên',
  score: 90.5, adjustment: 1, ratingCode: 'B', ratingLabel: 'Tốt', payoutPct: 80, status: 'Locked',
  finalizedAt: '2027-02-13T02:00:00.000Z', notes: [], ...o,
});

const sheet: PayrollSheet = {
  tenantName: 'Syntra', timeZone: 'Asia/Ho_Chi_Minh', cycleName: 'KPI 2027', periodLabel: 'T01',
  periodStart: '2027-01-01', periodEnd: '2027-01-31', ratingScaleName: 'Thang mẫu A+/A/B/C/D',
  exportedAt: '2027-04-06T02:05:00.000Z', exportedByName: 'Người C&B',
  rows: [row(), row({ resultId: 'r2', employeeCode: 'E099', score: 0, adjustment: -5, ratingCode: 'D', payoutPct: 0, status: 'Final' }), row({ resultId: 'r3', employeeCode: 'E100', payoutPct: null, notes: ['NO_RULE'] })],
};

async function readBack(s: PayrollSheet) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await renderPayrollWorkbook(s));
  return workbook;
}

describe('renderPayrollWorkbook', () => {
  it('puts the headers in row 1 and one row per person, numbers as numbers', async () => {
    const data = (await readBack(sheet)).getWorksheet('Lương KPI');
    if (!data) throw new Error('no data sheet');
    expect((data.getRow(1).values as unknown[]).slice(1)).toEqual([...PAYROLL_HEADERS]);
    expect((data.getRow(2).values as unknown[]).slice(1)).toEqual([
      1, 'E016', 'Trần Thị Thu', 'Phòng Kinh doanh', 'Chuyên viên', 90.5, 1, 'B', 80, 'Đã khóa', '13/02/2027 09:00',
    ]);
    expect(data.rowCount).toBe(4);
  });

  it('keeps 0 as a numeric 0 and leaves a missing payout blank, with its note', async () => {
    const data = (await readBack(sheet)).getWorksheet('Lương KPI');
    if (!data) throw new Error('no data sheet');
    expect([data.getCell('F3').value, data.getCell('G3').value, data.getCell('I3').value]).toEqual([0, -5, 0]);
    expect(data.getCell('I4').value).toBeNull();
    expect(data.getCell('L4').value).toBe('Chưa có quy tắc quy đổi');
  });

  it('describes the file on "Thông tin" — period, scale as an assumption, exporter, row count, simulated data', async () => {
    const info = (await readBack(sheet)).getWorksheet('Thông tin');
    if (!info) throw new Error('no info sheet');
    const pairs = Object.fromEntries(info.getSheetValues().slice(1).map((r) => [(r as unknown[])[1], (r as unknown[])[2]]));
    expect(pairs).toMatchObject({
      'Công ty': 'Syntra',
      'Kỳ': 'T01 (01/01/2027 – 31/01/2027)',
      'Thang xếp loại': 'Thang mẫu A+/A/B/C/D',
      'Xuất lúc': '06/04/2027 09:05',
      'Người xuất': 'Người C&B',
      'Số dòng': 3,
    });
    expect(String(pairs['Lưu ý'])).toMatch(/Dữ liệu giả lập.*giả định Q2/);
  });

  it('renders a period with no scale and an empty unit without failing', async () => {
    const data = (await readBack({ ...sheet, ratingScaleName: null, rows: [row({ unitName: null, positionName: null, finalizedAt: null })] })).getWorksheet('Lương KPI');
    expect(data?.getCell('D2').value).toBeNull();
    expect(data?.getCell('K2').value).toBeNull();
  });
});
