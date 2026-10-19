import { KpiError } from '@/lib/errorCatalog';
import type { Page, PageRequest } from '../../types';

/**
 * Keyset pagination, newest first: rows are ordered by (`sortKey` desc, `id` desc) and a cursor is
 * the last row's position, so a row inserted between two page reads never repeats or shifts the
 * next page — the way the SQL adapter will page. A cursor names a position, not a row, so a cursor
 * from another tenant just starts somewhere in this tenant's list and reveals nothing.
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

type Position = [string, string];

const encode = (p: Position) => btoa(encodeURIComponent(JSON.stringify(p)));

function decode(cursor: string): Position {
  try {
    const value = JSON.parse(decodeURIComponent(atob(cursor))) as unknown;
    if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'string')) return value as Position;
  } catch {
    // fall through
  }
  throw new KpiError('ERR-KPI-06', 'invalid page cursor');
}

const after = (a: Position, b: Position) => (a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]);

export function paginate<T extends { id: string }>(rows: readonly T[], sortKey: (row: T) => string, page: PageRequest = {}): Page<T> {
  const limit = page.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new KpiError('ERR-KPI-06', `limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  const ordered = rows
    .map((row) => ({ row, pos: [sortKey(row), row.id] as Position }))
    .sort((a, b) => (after(a.pos, b.pos) ? 1 : after(b.pos, a.pos) ? -1 : 0));
  const start = page.cursor === undefined ? ordered : ordered.filter((r) => after(r.pos, decode(page.cursor as string)));
  const items = start.slice(0, limit);
  const more = start.length > limit;
  return { items: items.map((r) => r.row), nextCursor: more ? encode(items[items.length - 1].pos) : null };
}
