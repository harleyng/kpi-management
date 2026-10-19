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

// ─── Wall-clock time in a zone (the dev toolbar's simulated clock) ───────────────────────────────

/** No formatter cache: a rule module holds no state (`rulesPurity.test.ts`). */
function wallFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function parseInstant(instant: IsoDateTime): number {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) throw new RangeError(`Not an ISO instant: ${instant}`);
  return ms;
}

/**
 * The wall clock `ms` shows in `timeZone`, as if it were UTC — so calendar arithmetic on it (add a
 * day, read the parts) is plain UTC arithmetic. Read through `formatToParts`, never by slicing.
 */
function wallMsOf(ms: number, timeZone: string): number {
  const parts = wallFormat(timeZone).formatToParts(new Date(ms));
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'), ((ms % 1000) + 1000) % 1000);
}

/** The zone's offset from UTC at instant `ms`, in milliseconds (UTC+7 → +25 200 000). */
function offsetMsAt(ms: number, timeZone: string): number {
  return wallMsOf(ms, timeZone) - ms;
}

/**
 * The instant a wall-clock reading in `timeZone` names. Two passes, so a reading near a DST change
 * resolves to the offset in force at the result; a reading skipped by a spring-forward resolves to
 * the instant just after the gap.
 */
function wallToInstantMs(wallMs: number, timeZone: string): number {
  const guess = wallMs - offsetMsAt(wallMs, timeZone);
  return wallMs - offsetMsAt(guess, timeZone);
}

/**
 * `instant` moved by `days` calendar days in `timeZone`, keeping its wall-clock time — `+1` from
 * 31/01 10:00 is 01/02 10:00 in the zone, across month and year ends and DST changes alike.
 */
export function addDaysToInstant(instant: IsoDateTime, days: number, timeZone: string): IsoDateTime {
  if (!Number.isInteger(days)) throw new RangeError(`Not a whole number of days: ${days}`);
  const wall = wallMsOf(parseInstant(instant), timeZone);
  return new Date(wallToInstantMs(wall + days * 86_400_000, timeZone)).toISOString();
}

/** `instant` as a `datetime-local` value (`YYYY-MM-DDTHH:mm`) in `timeZone`. */
export function toZonedLocalInput(instant: IsoDateTime, timeZone: string): string {
  return new Date(wallMsOf(parseInstant(instant), timeZone)).toISOString().slice(0, 16);
}

const LOCAL_INPUT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * The instant a `datetime-local` value (`YYYY-MM-DDTHH:mm`, optional `:ss`) names in `timeZone`, or
 * `null` when it is not a real date and time (`2027-02-30T10:00`, `24:00`, an empty string).
 */
export function fromZonedLocalInput(value: string, timeZone: string): IsoDateTime | null {
  const match = LOCAL_INPUT.exec(value);
  if (!match) return null;
  const [, date, hh, mm, ss = '00'] = match;
  const [hour, minute, second] = [hh, mm, ss].map(Number);
  if (!isIsoDate(date) || hour > 23 || minute > 59 || second > 59) return null;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(wallToInstantMs(Date.UTC(y, m - 1, d, hour, minute, second), timeZone)).toISOString();
}

/** The zone's offset at `instant` as a label — `GMT+7`, `GMT-4`, `GMT+5:30`, `GMT`. */
export function zoneOffsetLabel(instant: IsoDateTime, timeZone: string): string {
  const minutes = Math.round(offsetMsAt(parseInstant(instant), timeZone) / 60_000);
  if (minutes === 0) return 'GMT';
  const sign = minutes > 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}
