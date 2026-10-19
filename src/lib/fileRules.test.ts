import { describe, expect, it } from 'vitest';
import { FILE_ACCEPT, MAX_FILE_BYTES, fileIssues } from './fileRules';

const file = (o: Partial<{ fileName: string; mimeType: string; sizeBytes: number }> = {}) => ({
  fileName: 'bang-chung.pdf', mimeType: 'application/pdf', sizeBytes: 1024, ...o,
});
const details = (o: Parameters<typeof file>[0]) => fileIssues(file(o)).map((i) => i.detail);

describe('fileIssues — what uploadFile refuses (BR-KPI-48, ASSUMPTION Q20)', () => {
  it('accepts the office, image and text formats, case-insensitively', () => {
    for (const [fileName, mimeType] of [
      ['a.pdf', 'application/pdf'],
      ['Ảnh.PNG', 'image/png'],
      ['so-lieu.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['bao-cao.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['ghi-chu.txt', 'text/plain;charset=utf-8'],
    ]) {
      expect(fileIssues(file({ fileName, mimeType })), fileName).toEqual([]);
    }
  });

  it('accepts a CSV whatever the browser calls it, or nothing', () => {
    expect(details({ fileName: 'x.csv', mimeType: '' })).toEqual([]);
    expect(details({ fileName: 'x.csv', mimeType: 'application/vnd.ms-excel' })).toEqual([]);
    expect(details({ fileName: 'x.csv', mimeType: 'application/octet-stream' })).toEqual([]);
  });

  it('accepts exactly the limit and refuses one byte more', () => {
    expect(details({ sizeBytes: MAX_FILE_BYTES })).toEqual([]);
    expect(fileIssues(file({ sizeBytes: MAX_FILE_BYTES + 1 }))).toEqual([
      expect.objectContaining({ code: 'ERR-KPI-06', ref: 'data', detail: 'FILE_TOO_LARGE', data: { maxBytes: MAX_FILE_BYTES } }),
    ]);
  });

  it('refuses an empty file and a missing name', () => {
    expect(details({ sizeBytes: 0 })).toEqual(['FILE_EMPTY']);
    expect(details({ fileName: ' ' })).toContain('FILE_NAME_REQUIRED');
  });

  it('refuses a format outside the list, a file with no extension, and a disguised one', () => {
    expect(details({ fileName: 'setup.exe', mimeType: 'application/x-msdownload' })).toEqual(['FILE_TYPE_NOT_ALLOWED']);
    expect(details({ fileName: 'README', mimeType: 'text/plain' })).toEqual(['FILE_TYPE_NOT_ALLOWED']);
    expect(details({ fileName: 'anh.png', mimeType: 'application/x-msdownload' })).toEqual(['FILE_TYPE_NOT_ALLOWED']);
  });

  it('offers the same list to the file picker', () => {
    expect(FILE_ACCEPT.split(',')).toEqual(expect.arrayContaining(['.pdf', '.xlsx', '.csv']));
    expect(FILE_ACCEPT).not.toContain('.exe');
  });
});
