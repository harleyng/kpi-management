import {
  LIBRARY_EXPORT_COLUMNS,
  TEMPLATE_EXPORT_COLUMNS,
  type ExportColumn,
  type LibraryExportRow,
  type TemplateExportRow,
} from '@/lib/libraryRules';

/** One code list of the "Danh mục" sheet — the codes the library sheet refers to. */
export interface CatalogueList {
  title: string;
  rows: readonly { code: string; name: string }[];
}

export interface LibraryWorkbookInput {
  library: readonly LibraryExportRow[];
  templates: readonly TemplateExportRow[];
  catalogues: readonly CatalogueList[];
}

/**
 * Writes the library workbook (WBS 4.2.5) — I/O only: the rows come from `libraryRules`' pure
 * mappings. exceljs is imported HERE, on demand, so it never lands in the shell's or the route's
 * chunk (`add-import-template` skill).
 */
export async function buildLibraryWorkbook(input: LibraryWorkbookInput): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Syntra KPI';

  const addTable = <K extends string>(name: string, columns: readonly ExportColumn<K>[], rows: readonly Record<K, string | number | null>[]) => {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    sheet.getRow(1).font = { bold: true };
    for (const row of rows) sheet.addRow(row);
  };

  addTable('Chỉ tiêu mẫu', LIBRARY_EXPORT_COLUMNS, input.library);
  addTable('Bộ mẫu', TEMPLATE_EXPORT_COLUMNS, input.templates);

  const codes = workbook.addWorksheet('Danh mục');
  codes.columns = [
    { header: 'Danh mục', key: 'list', width: 22 },
    { header: 'Mã', key: 'code', width: 16 },
    { header: 'Tên', key: 'name', width: 40 },
  ];
  codes.getRow(1).font = { bold: true };
  for (const list of input.catalogues) for (const row of list.rows) codes.addRow({ list: list.title, code: row.code, name: row.name });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
