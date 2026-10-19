/**
 * Reading a number a person typed in a Vietnamese form — and writing one back for editing.
 *
 * vi-VN writes `9.600.000.000` (dots group thousands) and `92,5` (comma is the decimal mark), but
 * people also paste `92.5` or `9600000000`. The reading, in order: blank → `null` (no value, never 0
 * — BR-KPI-32); a comma present → it is the decimal mark and every dot groups thousands; more than one
 * dot, or one dot followed by exactly three digits after a group of 1–3 digits (`9.600`) → dots group
 * thousands; otherwise a single dot is the decimal mark. Anything else → `NaN` (the field says so).
 */
export function parseDecimalInput(text: string): number | null {
  const raw = text.trim().replace(/\s+/g, '');
  if (raw === '') return null;
  const grouped = /^-?\d{1,3}(\.\d{3})+/;
  let normalized: string;
  if (raw.includes(',')) {
    // `1.234,5` or `92,5` — dots may only group thousands.
    if (!/^-?(\d{1,3}(\.\d{3})+|\d+),\d+$/.test(raw)) return Number.NaN;
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if ((raw.match(/\./g) ?? []).length > 1 || /^-?\d{1,3}\.\d{3}$/.test(raw)) {
    if (!new RegExp(`${grouped.source}$`).test(raw)) return Number.NaN;
    normalized = raw.replace(/\./g, '');
  } else {
    normalized = raw;
  }
  if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

/** A stored number as the edit field shows it: comma decimal, no grouping (`92,5`, `9600000000`). */
export function formatDecimalInput(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(value).replace('.', ',');
}
