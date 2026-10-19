/**
 * The shared Excel batch-import framework — WBS 4.4.3, BR-KPI-53 / 54. Every P1 import (actuals 4.4.3,
 * organisation & staff 4.1.7, library 4.2.5, Goal Plans 4.3.7) runs on it: a template spec, the sheet
 * read into typed rows (`parseSheet`), a per-type row validator (`actualImportRules`, and the other
 * tracks' own), a preview, then the batch is committed whole or rejected.
 *
 * Reading the workbook itself (exceljs) is `src/lib/excel.ts`; everything here is pure and works on
 * the plain cell matrix, so it is tested without a file. Shared by T1, T2, T3 — after T4 merges,
 * changing these shapes is a Large change.
 */

import type { ImportBatch, ImportRowError, ImportRowsByType, ImportType, IsoDate } from '@/data/types';
import type { Decision } from './goalPlanRules';
import type { ErrorCode, IssueDetail } from './errorCatalog';
import { foldDiacritics } from './utils';

// ─── The template spec ───────────────────────────────────────────────────────────────────────────

/**
 * - `text` / `number` / `date` are read into the row;
 * - `info` columns are reference data the template pre-fills (a person's name, a goal's target) to
 *   help whoever fills the file — written to the template, ignored when read back.
 */
export type ImportCellKind = 'text' | 'number' | 'date' | 'info';

export interface ImportColumn {
  /** Stable key the spec's `toRow` reads. */
  id: string;
  /** The header as written in the template, Vietnamese. Matched ignoring case, tone marks and spaces. */
  header: string;
  kind: ImportCellKind;
  /** A blank cell is a file error (CELL_REQUIRED). Conditional requirements belong to the row validator. */
  required: boolean;
  /** One line for the template's "Hướng dẫn" sheet. */
  hint: string;
  /** Template column width (characters). */
  width: number;
}

/** A parsed cell: `null` = blank (never 0, BR-KPI-32). */
export type ParsedCell = string | number | null;

export interface ImportTemplateSpec<K extends ImportType> {
  importType: K;
  /** The data sheet's name in the template. */
  sheetName: string;
  /** The downloaded template's file name (no extension). */
  fileName: string;
  columns: readonly ImportColumn[];
  /** Data rows accepted per file. */
  maxRows: number;
  /** Builds the typed row from the parsed cells of one sheet row (`rowNo` = the sheet's row number). */
  toRow(cells: Readonly<Record<string, ParsedCell>>, rowNo: number): ImportRowsByType[K];
}

export const DEFAULT_MAX_ROWS = 5000;

// ─── Cells ───────────────────────────────────────────────────────────────────────────────────────

/**
 * What exceljs hands back for a cell, flattened to a value: rich text joined, a formula's cached
 * result, a hyperlink's text, an error cell as its text ("#REF!"). `undefined` / empty → null.
 */
export function normaliseCell(raw: unknown): string | number | boolean | Date | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' || raw instanceof Date) return raw;
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: unknown }[]).map((p) => String(p.text ?? '')).join('');
    if ('result' in o) return normaliseCell(o.result);
    if ('formula' in o || 'sharedFormula' in o) return null; // a formula Excel never calculated
    if (typeof o.text === 'string') return o.text;
    if (typeof o.error === 'string') return o.error;
  }
  return String(raw);
}

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** A text cell: trimmed; a number keeps its digits ("12" not "12.0"); a date becomes `YYYY-MM-DD`. */
export function parseTextCell(raw: unknown): string | null {
  const v = normaliseCell(raw);
  if (isBlank(v)) return null;
  if (v instanceof Date) return isoOfDate(v);
  return String(v).trim();
}

export type CellResult<T> = { ok: true; value: T | null } | { ok: false };

/**
 * A number cell. An Excel number is taken as it is; a string is read without guessing (`ASSUMPTION`,
 * hr-performance-expert review):
 * - spaces are ignored and a trailing "%" dropped ("85%" → 85 — percent KPIs are stored in percent
 *   units, BR-KPI-30); a number is never rescaled (0.85 stays 0.85, the preview warns instead);
 * - with both "." and ",": "1.234,5" (vi-VN) or "1,234.5" (en) — the last one is the decimal mark;
 * - with one kind of mark: two or more groups of three ("1.234.567") are thousands; a single mark
 *   followed by exactly three digits after a non-zero part ("1.234", "1,234") is AMBIGUOUS and refused;
 *   anything else is a decimal mark ("12.5", "12,5", "0.123");
 * - exponents, Infinity, NaN, a boolean or a date are refused. Blank → null.
 */
export function parseNumberCell(raw: unknown): CellResult<number> {
  const v = normaliseCell(raw);
  if (isBlank(v)) return { ok: true, value: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: true, value: v } : { ok: false };
  if (typeof v !== 'string') return { ok: false };
  let s = v.replace(/\s/g, '');
  if (s.endsWith('%')) s = s.slice(0, -1);
  const num = (text: string): CellResult<number> => {
    const n = Number(text);
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
  };
  if (/^[-+]?\d+$/.test(s)) return num(s);
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    if (/^[-+]?\d{1,3}(\.\d{3})+,\d+$/.test(s)) return num(s.replace(/\./g, '').replace(',', '.'));
    if (/^[-+]?\d{1,3}(,\d{3})+\.\d+$/.test(s)) return num(s.replace(/,/g, ''));
    return { ok: false };
  }
  const mark = hasDot ? '.' : hasComma ? ',' : null;
  if (mark === null) return { ok: false };
  const m = mark === '.' ? '\\.' : ',';
  if (new RegExp(`^[-+]?\\d{1,3}(${m}\\d{3}){2,}$`).test(s)) return num(s.split(mark).join(''));
  const single = new RegExp(`^([-+]?)(\\d+)${m}(\\d+)$`).exec(s);
  if (!single) return { ok: false };
  const [, sign, whole, fraction] = single;
  if (fraction.length === 3 && /^[1-9]\d{0,2}$/.test(whole)) return { ok: false }; // "1.234": thousands or decimal?
  return num(`${sign}${whole}.${fraction}`);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** A cell Date's calendar day — exceljs builds dates in UTC. */
const isoOfDate = (d: Date): IsoDate => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function validIso(y: number, m: number, d: number): IsoDate | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** A date cell: an Excel date, an Excel serial number, "dd/mm/yyyy" or "yyyy-mm-dd". Blank → null. */
export function parseDateCell(raw: unknown): CellResult<IsoDate> {
  const v = normaliseCell(raw);
  if (isBlank(v)) return { ok: true, value: null };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? { ok: false } : { ok: true, value: isoOfDate(v) };
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 1 || v > 2958465) return { ok: false };
    return { ok: true, value: isoOfDate(new Date(Date.UTC(1899, 11, 30) + v * 86_400_000)) };
  }
  if (typeof v !== 'string') return { ok: false };
  const s = v.trim();
  const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const value = vn ? validIso(+vn[3], +vn[2], +vn[1]) : iso ? validIso(+iso[1], +iso[2], +iso[3]) : null;
  return value ? { ok: true, value } : { ok: false };
}

// ─── Reading a sheet ─────────────────────────────────────────────────────────────────────────────

/** Header text compared ignoring case, tone marks, a trailing "*" and repeated spaces. */
export const headerKey = (header: string) => foldDiacritics(header).toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();

export const importError = (rowNo: number, column: string | null, detail: IssueDetail, code: ErrorCode = 'ERR-KPI-06'): ImportRowError => ({
  rowNo,
  column,
  code,
  detail,
});

export interface ParsedSheet<K extends ImportType> {
  rows: ImportRowsByType[K][];
  /** Problems of the FILE (headers, size; then `rows` is empty) and of single cells (type, required). Any → nothing is staged. */
  errors: ImportRowError[];
}

/**
 * Reads a sheet's cell matrix (row 1 = the header, as the template writes it) into typed rows. Does
 * no business validation. A required header missing or one written twice, an empty file and a file
 * over `maxRows` are file errors (row 1); a cell of the wrong type or a blank required cell is a cell
 * error (the row is still returned, that cell blank). Blank lines are skipped; unknown headers and
 * `info` columns are ignored.
 */
export function parseSheet<K extends ImportType>(spec: ImportTemplateSpec<K>, matrix: readonly (readonly unknown[])[]): ParsedSheet<K> {
  const errors: ImportRowError[] = [];
  const header = matrix[0] ?? [];
  const byKey = new Map(spec.columns.map((c) => [headerKey(c.header), c]));
  const position = new Map<string, number>();
  header.forEach((raw, index) => {
    const text = parseTextCell(raw);
    if (text === null) return;
    const column = byKey.get(headerKey(text));
    if (!column) return;
    if (position.has(column.id)) errors.push(importError(1, column.header, 'HEADER_DUPLICATE'));
    else position.set(column.id, index);
  });
  for (const column of spec.columns) {
    if (column.required && !position.has(column.id)) errors.push(importError(1, column.header, 'HEADER_MISSING'));
  }

  const dataRows: { rowNo: number; cells: readonly unknown[] }[] = [];
  matrix.slice(1).forEach((cells, index) => {
    if (cells.some((c) => !isBlank(normaliseCell(c)))) dataRows.push({ rowNo: index + 2, cells });
  });
  if (dataRows.length === 0) errors.push(importError(1, null, 'FILE_EMPTY'));
  if (dataRows.length > spec.maxRows) errors.push(importError(1, null, 'FILE_TOO_LARGE'));
  if (errors.length > 0) return { rows: [], errors };

  const rows: ImportRowsByType[K][] = [];
  for (const { rowNo, cells } of dataRows) {
    const parsed: Record<string, ParsedCell> = {};
    for (const column of spec.columns) {
      if (column.kind === 'info') continue;
      const index = position.get(column.id);
      const raw = index === undefined ? null : cells[index];
      let value: ParsedCell = null;
      if (column.kind === 'text') value = parseTextCell(raw);
      else {
        const result = column.kind === 'number' ? parseNumberCell(raw) : parseDateCell(raw);
        if (!result.ok) {
          errors.push(importError(rowNo, column.header, column.kind === 'number' ? 'CELL_NOT_NUMBER' : 'CELL_NOT_DATE'));
          parsed[column.id] = null;
          continue;
        }
        value = result.value;
      }
      if (value === null && column.required) errors.push(importError(rowNo, column.header, 'CELL_REQUIRED'));
      parsed[column.id] = value;
    }
    rows.push(spec.toRow(parsed, rowNo));
  }
  // Rows come back even with cell errors (the bad cell read as blank), so the preview can show WHICH
  // row is wrong; a caller never stages a parse with errors.
  return { rows, errors };
}

// ─── The batch (BR-KPI-54) ───────────────────────────────────────────────────────────────────────

/** `rowsError` counts ROWS with at least one error (a row with three problems is one bad row). */
export function batchCounts(rowsTotal: number, errors: readonly Pick<ImportRowError, 'rowNo'>[]): { rowsTotal: number; rowsError: number } {
  return { rowsTotal, rowsError: new Set(errors.map((e) => e.rowNo)).size };
}

/**
 * A batch is committed whole or not at all (BR-KPI-54): only a Validating batch, with rows, and no
 * row error. Anything else → ERR-KPI-04 (fix the file and upload it as a new batch).
 */
export function canCommitImport(batch: Pick<ImportBatch, 'status' | 'rowsTotal' | 'rowsError'>): Decision {
  return batch.status === 'Validating' && batch.rowsTotal > 0 && batch.rowsError === 0 ? { ok: true } : { ok: false, code: 'ERR-KPI-04' };
}

/**
 * Only a batch still being checked can be rejected: a Committed batch has written its rows, and
 * rejecting it would leave them in place under a "Rejected" label (ERR-KPI-04).
 */
export function canRejectImport(batch: Pick<ImportBatch, 'status'>): Decision {
  return batch.status === 'Validating' ? { ok: true } : { ok: false, code: 'ERR-KPI-04' };
}

/** A batch's errors grouped by sheet row, in sheet order. */
export function errorsByRow(errors: readonly ImportRowError[]): Map<number, ImportRowError[]> {
  const map = new Map<number, ImportRowError[]>();
  for (const e of [...errors].sort((a, b) => a.rowNo - b.rowNo)) map.set(e.rowNo, [...(map.get(e.rowNo) ?? []), e]);
  return map;
}

/**
 * The preview's row order: rows with errors first (in sheet order), then the rest; `onlyErrors`
 * keeps just the first group. File-level errors (row 1) are not rows and are shown apart.
 */
export function previewOrder<R extends { rowNo: number }>(rows: readonly R[], errors: readonly Pick<ImportRowError, 'rowNo'>[], onlyErrors = false): R[] {
  const bad = new Set(errors.map((e) => e.rowNo));
  const withErrors = rows.filter((r) => bad.has(r.rowNo));
  return onlyErrors ? withErrors : [...withErrors, ...rows.filter((r) => !bad.has(r.rowNo))];
}
