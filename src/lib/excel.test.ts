// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTUAL_IMPORT_SPEC } from './actualImportRules';
import { readSheet, writeTemplate, XLSX_MIME } from './excel';
import { parseSheet } from './importRules';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('exceljs stays out of the shell chunk (plan §3.1, cto review)', () => {
  it('no module imports exceljs statically, and only src/lib/excel.ts loads it at all', () => {
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8');
      const rel = file.slice(SRC.length);
      expect(/^\s*import\s+(?!type\b)[^;]*from\s+['"]exceljs['"]/m.test(text), rel).toBe(false);
      if (rel !== 'lib/excel.ts' && !rel.endsWith('.test.ts')) expect(text.includes("import('exceljs')"), rel).toBe(false);
    }
  });
});

describe('writeTemplate → readSheet → parseSheet round trip', () => {
  it('the actuals template reads back into the same rows, ids and labels kept as text', async () => {
    const rows = [
      { goalId: '0f8c2a1e-0000-4000-8000-000000000001', login: 'an.nv', employee: 'Nguyễn Văn An', kpiCode: 'KPI-DOANH-THU', goalName: 'Doanh thu', unit: 'Tỷ đồng', period: 'T03', target: 12.5, actualValue: 13.25, actualText: null, note: 'Đã đối soát', evidenceUrl: 'https://drive.example/a' },
      { goalId: '0f8c2a1e-0000-4000-8000-000000000002', login: 'an.nv', employee: 'Nguyễn Văn An', kpiCode: 'KPI-NGHIEM-THU', goalName: 'Nghiệm thu', unit: null, period: 'T03', target: 'Đạt', actualValue: null, actualText: 'Đạt', note: null, evidenceUrl: null },
    ];
    const blob = await writeTemplate(ACTUAL_IMPORT_SPEC, rows, [{ title: 'Kỳ', values: ['T01', 'T02', 'T03'] }]);
    expect(blob.type).toBe(XLSX_MIME);
    const matrix = await readSheet(await blob.arrayBuffer());
    expect(matrix[0]).toContain('Kỳ *');
    const parsed = parseSheet(ACTUAL_IMPORT_SPEC, matrix);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { rowNo: 2, goalId: rows[0].goalId, login: 'an.nv', kpiCode: 'KPI-DOANH-THU', periodLabel: 'T03', actualValue: 13.25, actualText: null, note: 'Đã đối soát', evidenceUrl: 'https://drive.example/a' },
      { rowNo: 3, goalId: rows[1].goalId, login: 'an.nv', kpiCode: 'KPI-NGHIEM-THU', periodLabel: 'T03', actualValue: null, actualText: 'Đạt', note: null, evidenceUrl: null },
    ]);
  });

  it('an empty template (headers only) reads back as FILE_EMPTY', async () => {
    const matrix = await readSheet(await (await writeTemplate(ACTUAL_IMPORT_SPEC, [])).arrayBuffer());
    expect(parseSheet(ACTUAL_IMPORT_SPEC, matrix).errors.map((e) => e.detail)).toEqual(['FILE_EMPTY']);
  });

  it('a file that is not a workbook throws (the screen shows FILE_UNREADABLE)', async () => {
    await expect(readSheet(new TextEncoder().encode('không phải excel').buffer as ArrayBuffer)).rejects.toThrow();
  });
});
