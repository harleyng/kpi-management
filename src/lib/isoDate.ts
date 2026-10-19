/**
 * Calendar-date arithmetic for the rules — on `IsoDate` strings (`YYYY-MM-DD`), with no clock.
 *
 * Rules never read the time themselves (no `Date.now()`, no `new Date()` without an argument): the
 * caller passes `now` from the gateway's one clock, and "today" is that instant read in the tenant's
 * time zone (BR-KPI-13). `IsoDate` strings compare correctly as plain strings, so `<`/`>` are safe.
 */

import type { IsoDate, IsoDateTime } from '@/data/types';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `true` for a real calendar date in `YYYY-MM-DD` form (rejects `2027-02-30`). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parse(date: IsoDate): Date {
  if (!isIsoDate(date)) throw new RangeError(`Not an ISO date: ${date}`);
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

/**
 * The calendar date an instant falls on in `timeZone` — e.g. `2027-01-31T17:00:00Z` is `2027-02-01`
 * in `Asia/Ho_Chi_Minh`. Read through `formatToParts`, never by slicing formatted output, because the
 * shape of `Intl` output differs between ICU builds (`common-pitfalls.md`).
 */
export function toZonedDate(instant: IsoDateTime, timeZone: string): IsoDate {
  const when = new Date(instant);
  if (Number.isNaN(when.getTime())) throw new RangeError(`Not an ISO instant: ${instant}`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(when);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** `date` moved by `days` calendar days (negative goes back). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/** Whole days from `from` to `to` (`to` − `from`); negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

/** `from ≤ date ≤ to`, both ends inclusive; a `null` end is open. */
export function isWithin(date: IsoDate, from: IsoDate | null, to: IsoDate | null): boolean {
  return (from === null || from <= date) && (to === null || date <= to);
}

/**
 * The clock every time-aware rule takes: the gateway's one `now` and the tenant's time zone
 * (`Tenant.timezone`). Rules derive "today" from it with `todayOf` — never from the machine.
 */
export interface Clock {
  now: IsoDateTime;
  tz: string;
}

/** Today in the tenant's time zone. */
export function todayOf(clock: Clock): IsoDate {
  return toZonedDate(clock.now, clock.tz);
}
