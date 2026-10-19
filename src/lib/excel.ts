/**
 * Reading and writing `.xlsx` for the batch-import framework (WBS 4.4.3) — exceljs (plan §3.1; never
 * the npm `xlsx` package). exceljs is ~1 MB, so it is loaded ONLY inside these functions
 * (`await import('exceljs')`): this module may be imported by the import screens' lazy chunks, never
 * by the shell, a hook or a rule (`excel.test.ts` guards it). No validation happens here — the cell
 * matrix goes to `importRules.parseSheet`.
 */

import type { Workbook } from 'exceljs';
import type { ImportType } from '@/data/types';
import type { ImportTemplateSpec } from './importRules';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function newWorkbook(): Promise<Workbook> {
  const mod = await import('exceljs');
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  return new ExcelJS.Workbook();
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE4FC' } } as const;
const INFO_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } } as const;

/**
 * The template: the data sheet (header row frozen, required headers marked "*", reference `info`
 * columns shaded, text columns formatted as text so an id or a period label is never turned into a
 * number or a date), the pre-filled `rows`, a "Hướng dẫn" sheet listing every column, and optional
 * reference lists (e.g. the cycle's period labels) on a "Danh mục" sheet.
 */
export async function writeTemplate<K extends ImportType>(
  spec: ImportTemplateSpec<K>,
  rows: readonly Readonly<Record<string, string | number | null>>[],
  lists: readonly { title: string; values: readonly string[] }[] = [],
): Promise<Blob> {
  const wb = await newWorkbook();
  wb.creator = 'Syntra KPI';
  const sheet = wb.addWorksheet(spec.sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = spec.columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.id, width: c.width, style: c.kind === 'number' ? {} : { numFmt: '@' } }));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
  for (const values of rows) {
    const row = sheet.addRow(Object.fromEntries(spec.columns.map((c) => [c.id, values[c.id] ?? null])));
    spec.columns.forEach((c, index) => {
      if (c.kind === 'info') row.getCell(index + 1).fill = INFO_FILL;
    });
  }

  const guide = wb.addWorksheet('Hướng dẫn');
  guide.columns = [
    { header: 'Cột', key: 'header', width: 26 },
    { header: 'Bắt buộc', key: 'required', width: 10 },
    { header: 'Hướng dẫn', key: 'hint', width: 90 },
  ];
  guide.getRow(1).font = { bold: true };
  for (const c of spec.columns) guide.addRow({ header: c.header, required: c.required ? 'Có' : c.kind === 'info' ? 'Tham khảo' : 'Không', hint: c.hint });

  if (lists.length > 0) {
    const ref = wb.addWorksheet('Danh mục');
    lists.forEach((list, index) => {
      ref.getColumn(index + 1).width = 24;
      ref.getCell(1, index + 1).value = list.title;
      ref.getCell(1, index + 1).font = { bold: true };
      list.values.forEach((value, i) => {
        ref.getCell(i + 2, index + 1).value = value;
      });
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer as ArrayBuffer], { type: XLSX_MIME });
}

/**
 * The FIRST sheet's cells as a matrix (row 1 = the header), each cell as exceljs gives it — rich
 * text, formulas and dates are flattened later by `importRules.normaliseCell`. Throws when the file
 * is not a readable workbook (the screen shows FILE_UNREADABLE).
 */
export async function readSheet(data: ArrayBuffer): Promise<unknown[][]> {
  const wb = await newWorkbook();
  await wb.xlsx.load(data);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const matrix: unknown[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const values = sheet.getRow(r).values;
    matrix.push(Array.isArray(values) ? values.slice(1) : []);
  }
  return matrix;
}

/** One sheet of a report: a header row, then the rows — numbers stay numbers, `null` is an empty cell. */
export interface ReportSheet {
  name: string;
  columns: readonly { header: string; width?: number }[];
  rows: readonly (readonly (string | number | null)[])[];
}

/**
 * A plain report workbook (the dashboard's "Xuất báo cáo vận hành", WBS 4.7.3): one sheet per section,
 * bold frozen header row. Sheet names are cut to Excel's 31 characters.
 */
export async function writeSheets(sheets: readonly ReportSheet[]): Promise<Blob> {
  const wb = await newWorkbook();
  wb.creator = 'Syntra KPI';
  for (const spec of sheets) {
    const sheet = wb.addWorksheet(spec.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = spec.columns.map((c) => ({ header: c.header, width: c.width ?? 18 }));
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = HEADER_FILL;
    });
    for (const row of spec.rows) sheet.addRow([...row]);
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer as ArrayBuffer], { type: XLSX_MIME });
}
