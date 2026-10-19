import type { IsoDateTime } from '@/data/types';
import { PERIOD_RESULT_STATUS_LABEL } from '@/data/types';
import { toZonedLocalInput } from '@/lib/isoDate';
import { PAYROLL_NOTE_LABEL, type PayrollSheet } from '@/lib/payrollRules';

/**
 * The payroll file (BR-KPI-45, WBS 4.6.4) rendered from `payrollRules.buildPayrollSheet` — what a
 * backend would render server-side, so it lives with the adapter. The ONLY module that imports
 * exceljs, and only dynamically: the library is a chunk of its own, never in the app's main bundle.
 *
 * Sheet "Lương KPI": the header in row 1 (payroll imports read row 1), one row per person, numbers as
 * numbers, a blank cell for a value we do not have (never 0). Sheet "Thông tin": what the file is.
 */

export const PAYROLL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Column headers, in order. Unit names live in the header, never in the cells (BR-KPI-45). */
export const PAYROLL_HEADERS = [
  'STT',
  'Mã NV',
  'Họ và tên',
  'Đơn vị',
  'Chức danh',
  'Điểm KPI (đã gồm điều chỉnh)',
  'Điều chỉnh điểm (điểm)',
  'Xếp loại',
  '% hưởng lương KPI (%)',
  'Trạng thái kết quả',
  'Thời điểm chốt',
  'Ghi chú',
] as const;

/** `dd/MM/yyyy HH:mm` in the tenant zone. */
function localDateTime(instant: IsoDateTime | null, timeZone: string): string | null {
  if (instant === null) return null;
  const local = toZonedLocalInput(instant, timeZone); // YYYY-MM-DDTHH:mm
  return `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} ${local.slice(11, 16)}`;
}

const localDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** The workbook's bytes. Split from `buildPayrollWorkbook` so a test can read them back. */
export async function renderPayrollWorkbook(sheet: PayrollSheet): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Syntra KPI (dữ liệu giả lập)';
  workbook.created = new Date(sheet.exportedAt);

  const data = workbook.addWorksheet('Lương KPI', { views: [{ state: 'frozen', ySplit: 1 }] });
  data.addRow([...PAYROLL_HEADERS]).font = { bold: true };
  sheet.rows.forEach((row, i) => {
    data.addRow([
      i + 1,
      row.employeeCode,
      row.fullName,
      row.unitName,
      row.positionName,
      row.score,
      row.adjustment,
      row.ratingCode,
      row.payoutPct,
      PERIOD_RESULT_STATUS_LABEL[row.status],
      localDateTime(row.finalizedAt, sheet.timeZone),
      row.notes.length > 0 ? row.notes.map((n) => PAYROLL_NOTE_LABEL[n]).join('; ') : null,
    ]);
  });
  for (const col of [6, 7]) data.getColumn(col).numFmt = '0.00';
  data.getColumn(9).numFmt = '0.##';
  [6, 12, 28, 22, 18, 14, 12, 10, 12, 14, 18, 30].forEach((width, i) => (data.getColumn(i + 1).width = width));
  data.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: PAYROLL_HEADERS.length } };

  const info = workbook.addWorksheet('Thông tin');
  info.addRows([
    ['Công ty', sheet.tenantName],
    ['Chu kỳ', sheet.cycleName],
    ['Kỳ', `${sheet.periodLabel} (${localDate(sheet.periodStart)} – ${localDate(sheet.periodEnd)})`],
    ['Thang xếp loại', sheet.ratingScaleName ?? 'Chưa gắn thang xếp loại'],
    ['Xuất lúc', localDateTime(sheet.exportedAt, sheet.timeZone)],
    ['Người xuất', sheet.exportedByName],
    ['Số dòng', sheet.rows.length],
    ['Điểm KPI', 'Điểm tổng hợp các chỉ tiêu cộng điều chỉnh, không thấp hơn 0, làm tròn 2 chữ số khi chốt. Không cộng thêm cột điều chỉnh.'],
    ['% hưởng lương KPI', 'Số phần trăm (120 = 120%). Để trống khi chưa có quy tắc quy đổi hoặc chưa xếp loại, xem cột Ghi chú.'],
    ['Phạm vi', 'Kết quả cá nhân đã chốt hoặc đã khóa của kỳ. Bản tạm tính và kết quả bộ phận/công ty không có trong file.'],
    ['Lưu ý', 'Dữ liệu giả lập: thang xếp loại và bảng quy đổi là mẫu (giả định Q2), không dùng để trả lương thật.'],
  ]);
  info.getColumn(1).font = { bold: true };
  info.getColumn(1).width = 20;
  info.getColumn(2).width = 90;

  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/** The payroll file as a Blob, ready for the mock's file store. */
export async function buildPayrollWorkbook(sheet: PayrollSheet): Promise<Blob> {
  return new Blob([await renderPayrollWorkbook(sheet)], { type: PAYROLL_MIME_TYPE });
}
