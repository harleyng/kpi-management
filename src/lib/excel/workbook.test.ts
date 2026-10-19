// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { orgUnit, position } from '@/test/builders';
import { ORG_DATA_COLUMNS } from '../orgImportRules';
import { orgDataTemplateSpec } from './orgDataTemplate';
import { buildTemplateWorkbook } from './workbook';

const dir = fileURLToPath(new URL('.', import.meta.url));

describe('Excel templates', () => {
  it('never imports exceljs statically (it loads on the click, not with the page)', () => {
    for (const file of ['workbook.ts', 'orgDataTemplate.ts']) {
      expect(readFileSync(`${dir}/${file}`, 'utf8')).not.toMatch(/^import[^;]*['"]exceljs['"]/m);
    }
  });

  it('the OrgData template has exactly the ORG_DATA_COLUMNS headers, a sample row, and the Active codes', async () => {
    const units = [orgUnit({ code: 'SYN', name: 'Syntra' }), orgUnit({ id: 'kd', code: 'KD', name: 'KD', parentId: 'ou-root', unitType: 'Department' }), orgUnit({ id: 'x', code: 'OLD', status: 'Inactive' })];
    const blob = await buildTemplateWorkbook(orgDataTemplateSpec(units, [position()]));
    const { Workbook } = await import('exceljs');
    const book = new Workbook();
    await book.xlsx.load(await blob.arrayBuffer());
    const input = book.getWorksheet('Nhân sự');
    const header = (input?.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(ORG_DATA_COLUMNS.map((c) => c.header));
    expect((input?.getRow(2).values as unknown[]).slice(1)).toEqual(ORG_DATA_COLUMNS.map((c) => c.example));
    expect(String(input?.getRow(1).getCell(1).note)).toMatch(/^Bắt buộc\./);
    const codes = book.getWorksheet('Mã đơn vị');
    expect([codes?.getRow(2).getCell(1).value, codes?.getRow(3).getCell(1).value, codes?.rowCount]).toEqual(['KD', 'SYN', 3]);
    expect(book.getWorksheet('Mã chức danh')?.getRow(2).getCell(1).value).toBe('NV');
  });
});
