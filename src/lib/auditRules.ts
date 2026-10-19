/**
 * Reading the audit log (WBS 4.8.4, BR-KPI-49) — what changed in an entry, what the entry is about,
 * and the instants a "from day … to day" filter means in the tenant's zone. Pure.
 *
 * The audit log stores whole row snapshots before and after (`beforeData` / `afterData`); the screen
 * shows only the fields that differ, so a status change does not read as a wall of unchanged columns.
 */

import type { AuditLog, IsoDate, IsoDateTime, JsonValue } from '@/data/types';
import { addDays, fromZonedLocalInput, isIsoDate } from './isoDate';

/** Columns every row has that say nothing about the change. */
const NOT_SHOWN = new Set(['id', 'tenantId']);

export interface AuditFieldChange {
  field: string;
  /** `undefined` = the column did not exist on that side (a creation, a deletion). */
  before: JsonValue | undefined;
  after: JsonValue | undefined;
}

type Snapshot = { [key: string]: JsonValue };

const asObject = (value: JsonValue | null): Snapshot | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;

const same = (a: JsonValue | undefined, b: JsonValue | undefined) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The fields an entry changed, in the row's column order (the after-image first, then columns only the
 * before-image has). A creation lists every column it set (non-null); a deletion every column it had;
 * an update only the columns whose value differs. A snapshot that is not an object (a corrupt entry)
 * gives `null`, so the screen can say it cannot read it rather than show "no change".
 */
export function auditChanges(entry: Pick<AuditLog, 'beforeData' | 'afterData'>): AuditFieldChange[] | null {
  const before = entry.beforeData === null ? {} : asObject(entry.beforeData);
  const after = entry.afterData === null ? {} : asObject(entry.afterData);
  if (before === null || after === null) return null;
  const fields = [...new Set([...Object.keys(after), ...Object.keys(before)])].filter((f) => !NOT_SHOWN.has(f));
  const created = entry.beforeData === null;
  const deleted = entry.afterData === null;
  return fields
    .map((field) => ({ field, before: before[field], after: after[field] }))
    .filter((c) => {
      if (created) return c.after !== null && c.after !== undefined;
      if (deleted) return c.before !== null && c.before !== undefined;
      return !same(c.before, c.after);
    });
}

/** The columns that name a row, most specific first — what an entry is "about" on screen. */
const NAME_FIELDS = ['name', 'fullName', 'displayName', 'label', 'fileName', 'subject', 'code', 'login'] as const;

/** The columns that point at the person a row is about (a plan's owner, a form's subject…). */
const PERSON_FIELDS = ['ownerEmployeeId', 'subjectEmployeeId', 'employeeId'] as const;

/**
 * A human name for the entry's row, from its snapshots (after first): its own name column, else the
 * person it is about (`employeeName` resolves an employee id). `null` when it has neither — a plan or
 * a form has no name of its own.
 */
export function auditSubjectName(
  entry: Pick<AuditLog, 'beforeData' | 'afterData'>,
  employeeName: (employeeId: string) => string | undefined = () => undefined,
): string | null {
  const rows = [entry.afterData, entry.beforeData].map(asObject).filter((r): r is Snapshot => r !== null);
  for (const row of rows) {
    for (const field of NAME_FIELDS) {
      const value = row[field];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
  }
  for (const row of rows) {
    for (const field of PERSON_FIELDS) {
      const value = row[field];
      const name = typeof value === 'string' ? employeeName(value) : undefined;
      if (name) return name;
    }
  }
  return null;
}

/**
 * A "from day … to day" filter as instants: from the start of `from` to the end of `to` in the
 * tenant's zone, both inclusive. A blank day leaves that side open. `null` when a day is not a real
 * date or the range runs backwards — the screen then shows the error and does not query.
 */
export function dayRangeToInstants(
  from: IsoDate | null,
  to: IsoDate | null,
  timeZone: string,
): { from?: IsoDateTime; to?: IsoDateTime } | null {
  if ((from !== null && !isIsoDate(from)) || (to !== null && !isIsoDate(to))) return null;
  if (from !== null && to !== null && to < from) return null;
  const range: { from?: IsoDateTime; to?: IsoDateTime } = {};
  if (from !== null) range.from = fromZonedLocalInput(`${from}T00:00`, timeZone) ?? undefined;
  if (to !== null) {
    const nextDay = fromZonedLocalInput(`${addDays(to, 1)}T00:00`, timeZone);
    // The last millisecond of `to`: the audit log compares `createdAt <= to`.
    if (nextDay) range.to = new Date(Date.parse(nextDay) - 1).toISOString();
  }
  return range;
}
