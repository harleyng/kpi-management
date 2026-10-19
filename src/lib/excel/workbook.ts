/**
 * The one Excel template builder (WBS 4.4.3 shares it; T1's OrgData template is its first user).
 * `exceljs` is loaded ONLY when a template is built (`await import`), so it never weighs on a page
 * until someone clicks "Tải mẫu nhập" — `workbook.test.ts` fails on a static import.
 */

import type { ImportColumn } from '../importColumns';

export interface TemplateSheet {
  name: string;
  /** Input sheet: the import columns (header row, hint row, sample row). */
  columns?: readonly Pick<ImportColumn<never>, 'header' | 'required' | 'hint' | 'width'>[];
  sampleRows?: readonly (readonly string[])[];
  /** Lookup sheet: a plain table (the tenant's codes). */
  table?: { headers: readonly string[]; rows: readonly (readonly string[])[] };
}

export interface TemplateSpec {
  sheets: readonly TemplateSheet[];
}

/** Header row = row 1 (what `ImportRowError.rowNo` counts from); hints are a cell note, not a row. */
export async function buildTemplateWorkbook(spec: TemplateSpec): Promise<Blob> {
  const { Workbook } = await import('exceljs');
  const book = new Workbook();
  for (const sheet of spec.sheets) {
    const ws = book.addWorksheet(sheet.name);
    if (sheet.columns) {
      // The header is exactly `ImportColumn.header`, so the parser matches it verbatim; "required" is in the note.
      ws.columns = sheet.columns.map((c) => ({ header: c.header, width: c.width }));
      sheet.columns.forEach((c, i) => {
        ws.getRow(1).getCell(i + 1).note = c.required ? `Bắt buộc. ${c.hint}` : c.hint;
      });
      for (const row of sheet.sampleRows ?? []) ws.addRow([...row]);
    } else if (sheet.table) {
      ws.columns = sheet.table.headers.map((h) => ({ header: h, width: Math.max(14, h.length + 4) }));
      for (const row of sheet.table.rows) ws.addRow([...row]);
    }
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const buffer = await book.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
