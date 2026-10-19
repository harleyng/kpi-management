import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** The product operates on Vietnam time, whatever the browser's own zone is. */
const TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** UI copy is Vietnamese only (no i18n), so numbers and dates are always rendered `vi-VN`. */
const INTL_LOCALE = 'vi-VN';

/** Merge Tailwind classes; later classes win within the same group. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Date WITHOUT the time — "20/08/2026". */
export function formatDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(INTL_LOCALE, {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Date and time — "21:17 21/08/2026" in `vi-VN`.
 *
 * ⚠️ Never slice this to get the time alone: `vi-VN` puts the time FIRST, so `.slice(-5)` prints
 * the year. Ask `Intl` for the fields you want instead (see common-pitfalls.md).
 */
export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(INTL_LOCALE, {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * `Intl.NumberFormat` constructors are expensive and these run once per table cell, so they are
 * cached by a key that includes every option that varies.
 */
const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(key: string, build: () => Intl.NumberFormat): Intl.NumberFormat {
  const cached = numberFormats.get(key);
  if (cached) return cached;
  const made = build();
  numberFormats.set(key, made);
  return made;
}

/**
 * A number with Vietnamese grouping — "1.180", "13.400.000.000".
 *
 * Returns `—` for a missing value and a real `0` for a genuine zero: "no actual entered yet" and
 * "the actual is zero" are different answers, and a KPI score depends on which one it is.
 */
export function formatNumber(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return numberFormat(`n:${maximumFractionDigits}`, () =>
    new Intl.NumberFormat(INTL_LOCALE, { maximumFractionDigits }),
  ).format(value);
}

/**
 * A value already expressed in PERCENT UNITS — `formatPercent(85.5)` is "85,5%", not "8550%".
 * Achievement %, weights and payout % are all stored in percent units.
 */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return numberFormat('p', () =>
    new Intl.NumberFormat(INTL_LOCALE, { style: 'percent', maximumFractionDigits: 1 }),
  ).format(value / 100);
}

/**
 * Strip Vietnamese tone marks so "doanh thu" finds "Doanh thu" and "nguyen" finds "Nguyễn".
 *
 * Users routinely type without diacritics; a search that demands them finds nothing and reads as
 * broken. NFD decomposition handles the tone marks; `đ`/`Đ` are separate letters that NFD does NOT
 * decompose, so they are mapped explicitly.
 */
export function foldDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Hand a file to the browser's own download (Excel templates, payroll exports).
 *
 * ⚠️ The object URL is revoked on a TIMEOUT, not immediately. Revoking in the same tick races the
 * browser's own read of it and the download arrives empty.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Hand a file the gateway already serves as a URL (`system.getFileUrl`) to the browser's download,
 * then release the URL — on a timeout, for the same reason as `downloadBlob`.
 */
export function downloadUrl(url: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.click();
  if (url.startsWith('blob:')) window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
