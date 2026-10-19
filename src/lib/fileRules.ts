/**
 * Attachments (WBS 4.8.3, BR-KPI-48) — what `system.uploadFile` accepts. Evidence, import files and
 * payroll exports all go through it. Pure; the upload button checks first for quick feedback and the
 * gateway checks again, so a file the screen let through can still never be stored.
 *
 * The limits are not in any source document: `ASSUMPTION Q20` — 10 MB, and the formats people
 * attach to a KPI (PDF, images, Word, Excel, CSV, plain text).
 */

import { ruleIssue, type RuleIssue } from './errorCatalog';

/** 10 MB — `ASSUMPTION Q20`. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Extension → the MIME types a browser may report for it. `ASSUMPTION Q20`. */
export const ALLOWED_FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  csv: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  txt: ['text/plain'],
};

/** The `accept` attribute of a file input. */
export const FILE_ACCEPT = Object.keys(ALLOWED_FILE_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

const extensionOf = (fileName: string) => {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
};

/**
 * What an upload refuses (ERR-KPI-06, `ref` = the field): no name, an empty file, a file over the
 * limit (`data.maxBytes`), or a format outside the list (`data.extension`). The extension decides the
 * format; a MIME type is checked only when the browser reported one (it often reports none for CSV),
 * and parameters such as `;charset=utf-8` are ignored.
 */
export function fileIssues(file: { fileName: string; mimeType: string; sizeBytes: number }): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (file.fileName.trim() === '') issues.push(ruleIssue('ERR-KPI-06', 'fileName', 'FILE_NAME_REQUIRED'));
  if (!(file.sizeBytes > 0)) issues.push(ruleIssue('ERR-KPI-06', 'data', 'FILE_EMPTY'));
  else if (file.sizeBytes > MAX_FILE_BYTES) issues.push(ruleIssue('ERR-KPI-06', 'data', 'FILE_TOO_LARGE', { maxBytes: MAX_FILE_BYTES }));
  const ext = extensionOf(file.fileName);
  const mimes = ALLOWED_FILE_TYPES[ext];
  const mime = file.mimeType.split(';')[0].trim().toLowerCase();
  if (!mimes || (mime !== '' && mime !== 'application/octet-stream' && !mimes.includes(mime))) {
    issues.push(ruleIssue('ERR-KPI-06', 'mimeType', 'FILE_TYPE_NOT_ALLOWED', { extension: ext }));
  }
  return issues;
}
