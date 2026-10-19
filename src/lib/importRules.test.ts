import { describe, expect, it } from 'vitest';
import type { ImportRowError } from '@/data/types';
import {
  batchCounts,
  canCommitImport,
  canRejectImport,
  errorsByRow,
  headerKey,
  normaliseCell,
  parseDateCell,
  parseNumberCell,
  parseSheet,
  parseTextCell,
  previewOrder,
  type ImportTemplateSpec,
} from './importRules';

describe('normaliseCell — what exceljs hands back, flattened', () => {
  it('keeps plain values and flattens rich text, formulas, hyperlinks and error cells', () => {
    expect(normaliseCell(undefined)).toBeNull();
    expect(normaliseCell(12)).toBe(12);
    expect(normaliseCell({ richText: [{ text: 'Đạ' }, { text: 't' }] })).toBe('Đạt');
    expect(normaliseCell({ formula: 'A1*2', result: 84 })).toBe(84);
    expect(normaliseCell({ sharedFormula: 'A1', result: { richText: [{ text: 'x' }] } })).toBe('x');
    expect(normaliseCell({ formula: 'A1*2' })).toBeNull(); // never calculated
    expect(normaliseCell({ text: 'link', hyperlink: 'https://a.example' })).toBe('link');
    expect(normaliseCell({ error: '#REF!' })).toBe('#REF!');
  });
});

describe('parseTextCell', () => {
  it('trims, turns blank into null, keeps a number\'s digits and writes a date as YYYY-MM-DD', () => {
    expect(parseTextCell('  T03 ')).toBe('T03');
    expect(parseTextCell('   ')).toBeNull();
    expect(parseTextCell(null)).toBeNull();
    expect(parseTextCell(12)).toBe('12');
    expect(parseTextCell(new Date(Date.UTC(2027, 2, 5)))).toBe('2027-03-05');
  });
});

describe('parseNumberCell — never guesses (BR-KPI-53)', () => {
  const ok = (raw: unknown) => {
    const r = parseNumberCell(raw);
    return r.ok ? r.value : 'ERROR';
  };

  it.each([
    [1234.5, 1234.5],
    [0, 0],
    [-5, -5],
    ['0', 0],
    ['-5', -5],
    ['1234.5', 1234.5],
    ['12,5', 12.5],
    ['0.123', 0.123],
    ['0,123', 0.123],
    ['1.234,5', 1234.5],
    ['1,234.5', 1234.5],
    ['1.234.567', 1234567],
    ['1,234,567', 1234567],
    ['13 400 000', 13400000],
    ['85%', 85],
    [' 85 % ', 85],
    ['', null],
    ['   ', null],
    [null, null],
    [{ formula: 'B2/2', result: 21 }, 21],
  ])('%j → %j', (raw, value) => {
    expect(ok(raw)).toBe(value);
  });

  it.each([['1.234'], ['1,234'], ['abc'], ['1e3'], ['Infinity'], ['NaN'], ['1.2.3'], ['1.234,5,6'], [true], [Number.NaN], [new Date(Date.UTC(2027, 0, 1))], [{ error: '#REF!' }]])(
    '%j → refused (CELL_NOT_NUMBER)',
    (raw) => {
      expect(ok(raw)).toBe('ERROR');
    },
  );

  it('never rescales a fraction: 0.85 stays 0.85 (the preview warns instead)', () => {
    expect(ok(0.85)).toBe(0.85);
  });
});

describe('parseDateCell', () => {
  const ok = (raw: unknown) => {
    const r = parseDateCell(raw);
    return r.ok ? r.value : 'ERROR';
  };
  it('reads an Excel date, a serial, dd/mm/yyyy and yyyy-mm-dd; refuses the rest', () => {
    expect(ok(new Date(Date.UTC(2027, 2, 31)))).toBe('2027-03-31');
    expect(ok(46447)).toBe('2027-03-01'); // Excel serial (day 0 = 1899-12-30)
    expect(ok('31/03/2027')).toBe('2027-03-31');
    expect(ok('1/2/2027')).toBe('2027-02-01');
    expect(ok('2027-03-31')).toBe('2027-03-31');
    expect(ok('')).toBeNull();
    expect(ok('31/02/2027')).toBe('ERROR');
    expect(ok('2027-13-01')).toBe('ERROR');
    expect(ok('tháng 3')).toBe('ERROR');
    expect(ok(1.5)).toBe('ERROR');
  });
});

describe('headerKey', () => {
  it('ignores case, tone marks, a required star and extra spaces', () => {
    expect(headerKey('  Giá trị   thực tế * ')).toBe(headerKey('gia tri thuc te'));
    expect(headerKey('Kỳ')).toBe('ky');
  });
});

// A small spec, independent of any real template.
interface Row {
  rowNo: number;
  code: string;
  amount: number | null;
  day: string | null;
}
const SPEC = {
  importType: 'Actual',
  sheetName: 'S',
  fileName: 'f',
  maxRows: 3,
  columns: [
    { id: 'code', header: 'Mã', kind: 'text', required: true, hint: '', width: 10 },
    { id: 'name', header: 'Tên', kind: 'info', required: false, hint: '', width: 10 },
    { id: 'amount', header: 'Số tiền', kind: 'number', required: false, hint: '', width: 10 },
    { id: 'day', header: 'Ngày', kind: 'date', required: false, hint: '', width: 10 },
  ],
  toRow: (cells: Record<string, unknown>, rowNo: number): Row => ({ rowNo, code: String(cells.code), amount: cells.amount as number | null, day: cells.day as string | null }),
} as unknown as ImportTemplateSpec<'Actual'>;
const parse = (matrix: unknown[][]) => parseSheet(SPEC, matrix) as unknown as { rows: Row[]; errors: ImportRowError[] };
const brief = (errors: ImportRowError[]) => errors.map((e) => `${e.rowNo}|${e.column}|${e.detail}`);

describe('parseSheet', () => {
  it('reads rows by header whatever the column order, skips blank lines, ignores info and unknown columns', () => {
    const { rows, errors } = parse([
      ['Ngày', 'Ghi chú lạ', 'mã', 'Tên', 'Số tiền'],
      ['01/03/2027', 'x', 'A1', 'bỏ qua', '1.234,5'],
      [null, '', '  ', undefined, null],
      ['', '', 'B2', '', ''],
    ]);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { rowNo: 2, code: 'A1', amount: 1234.5, day: '2027-03-01' },
      { rowNo: 4, code: 'B2', amount: null, day: null }, // blank → null, never 0
    ]);
  });

  it('keeps a real 0 as 0', () => {
    expect(parse([['Mã', 'Số tiền'], ['A', 0]]).rows[0].amount).toBe(0);
  });

  it('a required header missing, or written twice, is a file error on row 1 and nothing is read', () => {
    expect(brief(parse([['Số tiền'], [5]]).errors)).toEqual(['1|Mã|HEADER_MISSING']);
    const twice = parse([['Mã', 'MÃ', 'Số tiền'], ['A', 'B', 1]]);
    expect(brief(twice.errors)).toEqual(['1|Mã|HEADER_DUPLICATE']);
    expect(twice.rows).toEqual([]);
  });

  it('the header must be on row 1 (a title row above it reads as a missing header)', () => {
    expect(brief(parse([['Số liệu tháng 3'], ['Mã', 'Số tiền'], ['A', 1]]).errors)).toEqual(['1|Mã|HEADER_MISSING']);
  });

  it('an empty sheet, a header-only file and a file over maxRows are file errors', () => {
    expect(brief(parse([]).errors)).toEqual(['1|Mã|HEADER_MISSING', '1|null|FILE_EMPTY']);
    expect(brief(parse([['Mã']]).errors)).toEqual(['1|null|FILE_EMPTY']);
    expect(brief(parse([['Mã'], ['a'], ['b'], ['c'], ['d']]).errors)).toEqual(['1|null|FILE_TOO_LARGE']);
    expect(parse([['Mã'], ['a'], ['b'], ['c']]).errors).toEqual([]);
  });

  it('cell errors name the row and column; the rows still come back, the bad cell blank', () => {
    const { rows, errors } = parse([
      ['Mã', 'Số tiền', 'Ngày'],
      ['A', 'abc', '31/02/2027'],
      ['', 5, null],
      ['C', new Date(Date.UTC(2027, 0, 1)), null],
    ]);
    expect(brief(errors)).toEqual(['2|Số tiền|CELL_NOT_NUMBER', '2|Ngày|CELL_NOT_DATE', '3|Mã|CELL_REQUIRED', '4|Số tiền|CELL_NOT_NUMBER']);
    expect(errors.every((e) => e.code === 'ERR-KPI-06')).toBe(true);
    expect(rows.map((r) => [r.rowNo, r.amount])).toEqual([[2, null], [3, 5], [4, null]]);
  });
});

describe('the batch (BR-KPI-54)', () => {
  it('counts rows with errors, not errors', () => {
    expect(batchCounts(10, [{ rowNo: 3 }, { rowNo: 3 }, { rowNo: 7 }])).toEqual({ rowsTotal: 10, rowsError: 2 });
    expect(batchCounts(4, [])).toEqual({ rowsTotal: 4, rowsError: 0 });
  });

  it('commits only a Validating batch with rows and no error', () => {
    const batch = (status: 'Validating' | 'Committed' | 'Rejected', rowsTotal: number, rowsError: number) => ({ status, rowsTotal, rowsError });
    expect(canCommitImport(batch('Validating', 5, 0))).toEqual({ ok: true });
    expect(canCommitImport(batch('Validating', 5, 1))).toEqual({ ok: false, code: 'ERR-KPI-04' });
    expect(canCommitImport(batch('Validating', 0, 0))).toEqual({ ok: false, code: 'ERR-KPI-04' });
    expect(canCommitImport(batch('Committed', 5, 0))).toEqual({ ok: false, code: 'ERR-KPI-04' });
    expect(canCommitImport(batch('Rejected', 5, 0))).toEqual({ ok: false, code: 'ERR-KPI-04' });
  });

  it('rejects only a Validating batch', () => {
    expect(canRejectImport({ status: 'Validating' })).toEqual({ ok: true });
    expect(canRejectImport({ status: 'Committed' }).ok).toBe(false);
  });

  it('groups errors by row and puts rows with errors first', () => {
    const errors = [
      { rowNo: 5, column: 'B', code: 'ERR-KPI-06' as const, detail: 'X' },
      { rowNo: 3, column: 'A', code: 'ERR-KPI-06' as const, detail: 'Y' },
      { rowNo: 5, column: 'C', code: 'ERR-KPI-06' as const, detail: 'Z' },
    ];
    expect([...errorsByRow(errors).entries()].map(([row, list]) => [row, list.map((e) => e.detail)])).toEqual([
      [3, ['Y']],
      [5, ['X', 'Z']],
    ]);
    const rows = [2, 3, 4, 5].map((rowNo) => ({ rowNo }));
    expect(previewOrder(rows, errors).map((r) => r.rowNo)).toEqual([3, 5, 2, 4]);
    expect(previewOrder(rows, errors, true).map((r) => r.rowNo)).toEqual([3, 5]);
  });
});
