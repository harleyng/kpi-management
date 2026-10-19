// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isIsoDate, isWithin, minDate, todayOf, toZonedDate } from './isoDate';

describe('isIsoDate', () => {
  it.each([
    ['2027-01-31', true],
    ['2028-02-29', true], // leap year
    ['2027-02-29', false],
    ['2027-02-30', false],
    ['2027-1-31', false],
    ['31/01/2027', false],
    ['', false],
  ])('%s → %s', (value, expected) => {
    expect(isIsoDate(value)).toBe(expected);
  });
});

describe('toZonedDate', () => {
  it.each([
    // Asia/Ho_Chi_Minh is UTC+7 with no DST: local midnight is 17:00Z the day before.
    ['2027-01-31T16:59:59.999Z', 'Asia/Ho_Chi_Minh', '2027-01-31'],
    ['2027-01-31T17:00:00.000Z', 'Asia/Ho_Chi_Minh', '2027-02-01'],
    ['2027-12-31T17:30:00.000Z', 'Asia/Ho_Chi_Minh', '2028-01-01'],
    ['2027-02-01T08:00:00+07:00', 'Asia/Ho_Chi_Minh', '2027-02-01'],
    // A DST zone proves the conversion is the zone's, not fixed-offset arithmetic.
    ['2027-03-14T06:59:00.000Z', 'America/New_York', '2027-03-14'], // 01:59 EST
    ['2027-03-15T03:59:00.000Z', 'America/New_York', '2027-03-14'], // 23:59 EDT
    ['2027-03-15T04:00:00.000Z', 'America/New_York', '2027-03-15'], // 00:00 EDT
  ])('%s in %s is %s', (instant, zone, expected) => {
    expect(toZonedDate(instant, zone)).toBe(expected);
  });

  it('rejects an unparsable instant instead of returning a wrong date', () => {
    expect(() => toZonedDate('not-a-date', 'Asia/Ho_Chi_Minh')).toThrow(RangeError);
  });
});

describe('addDays / daysBetween', () => {
  it.each([
    ['2027-01-31', 1, '2027-02-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2027-02-28', 1, '2027-03-01'],
    ['2027-12-31', 1, '2028-01-01'],
    ['2027-03-01', -1, '2027-02-28'],
    ['2027-02-01', 7, '2027-02-08'],
    ['2027-02-01', 0, '2027-02-01'],
  ])('%s %+d days → %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
    expect(daysBetween(date, expected)).toBe(days);
  });

  it('refuses an invalid date', () => {
    expect(() => addDays('2027-02-30', 1)).toThrow(RangeError);
  });
});

describe('minDate / isWithin', () => {
  it('picks the earlier date', () => {
    expect(minDate('2027-02-08', '2027-02-05')).toBe('2027-02-05');
    expect(minDate('2027-02-05', '2027-02-08')).toBe('2027-02-05');
  });

  it.each([
    ['2027-01-01', '2027-01-01', '2027-01-31', true],
    ['2027-01-31', '2027-01-01', '2027-01-31', true],
    ['2027-02-01', '2027-01-01', '2027-01-31', false],
    ['2026-12-31', '2027-01-01', null, false],
    ['2099-01-01', '2027-01-01', null, true],
    ['2000-01-01', null, null, true],
  ] as const)('%s within [%s, %s] → %s', (date, from, to, expected) => {
    expect(isWithin(date, from, to)).toBe(expected);
  });
});

describe('todayOf', () => {
  it('reads today in the tenant zone, not UTC', () => {
    expect(todayOf({ now: '2027-01-31T17:00:00.000Z', tz: 'Asia/Ho_Chi_Minh' })).toBe('2027-02-01');
  });
});
