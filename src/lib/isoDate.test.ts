// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addDaysToInstant,
  daysBetween,
  fromZonedLocalInput,
  isIsoDate,
  isWithin,
  minDate,
  todayOf,
  toZonedDate,
  toZonedLocalInput,
  zoneOffsetLabel,
} from './isoDate';

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

const VN = 'Asia/Ho_Chi_Minh';

describe('addDaysToInstant — calendar days in the zone, keeping the wall-clock time', () => {
  it.each([
    // [instant, days, zone, expected]
    ['2027-04-06T02:00:00.000Z', 1, VN, '2027-04-07T02:00:00.000Z'], // 06/04 09:00 → 07/04 09:00
    ['2027-04-06T02:00:00.000Z', 7, VN, '2027-04-13T02:00:00.000Z'],
    ['2027-01-31T03:00:00.000Z', 1, VN, '2027-02-01T03:00:00.000Z'], // month end
    ['2027-02-28T03:00:00.000Z', 1, VN, '2027-03-01T03:00:00.000Z'], // February, not a leap year
    ['2028-02-28T03:00:00.000Z', 1, VN, '2028-02-29T03:00:00.000Z'], // leap year
    ['2027-12-31T03:00:00.000Z', 1, VN, '2028-01-01T03:00:00.000Z'], // year end
    ['2027-04-28T03:00:00.000Z', 7, VN, '2027-05-05T03:00:00.000Z'], // +7 across a month end
    // 01/02 00:30 local is still 31/01 in UTC — the zone's date moves, not the UTC date.
    ['2027-01-31T17:30:00.000Z', 7, VN, '2027-02-07T17:30:00.000Z'],
    ['2027-03-01T03:00:00.000Z', -1, VN, '2027-02-28T03:00:00.000Z'], // backwards
    ['2027-04-06T02:00:00.123Z', 0, VN, '2027-04-06T02:00:00.123Z'], // seconds and ms kept
    // A DST zone keeps 12:00 local across the spring-forward (EST −5 → EDT −4).
    ['2027-03-13T17:00:00.000Z', 1, 'America/New_York', '2027-03-14T16:00:00.000Z'],
  ])('%s %+d days in %s → %s', (instant, days, zone, expected) => {
    expect(addDaysToInstant(instant, days, zone)).toBe(expected);
  });

  it('rejects a bad instant and a fractional day', () => {
    expect(() => addDaysToInstant('soon', 1, VN)).toThrow(RangeError);
    expect(() => addDaysToInstant('2027-04-06T02:00:00.000Z', 0.5, VN)).toThrow(RangeError);
  });
});

describe('datetime-local values in the zone', () => {
  it('reads an instant as the zone\'s wall clock', () => {
    expect(toZonedLocalInput('2027-04-06T02:00:00.000Z', VN)).toBe('2027-04-06T09:00');
    expect(toZonedLocalInput('2027-01-31T17:30:00.000Z', VN)).toBe('2027-02-01T00:30');
  });

  it.each([
    ['2027-04-06T09:00', '2027-04-06T02:00:00.000Z'],
    ['2027-02-01T00:30', '2027-01-31T17:30:00.000Z'],
    ['2027-04-06T09:00:30', '2027-04-06T02:00:30.000Z'],
  ])('%s in Vietnam is %s', (local, expected) => {
    expect(fromZonedLocalInput(local, VN)).toBe(expected);
  });

  it.each(['', '2027-02-30T10:00', '2027-04-06T24:00', '2027-04-06T09:60', '2027-04-06', '06/04/2027 09:00'])(
    '%j is not a date and time',
    (local) => {
      expect(fromZonedLocalInput(local, VN)).toBeNull();
    },
  );

  it('round-trips, in a DST zone too', () => {
    for (const instant of ['2027-04-06T02:00:00.000Z', '2027-07-01T15:45:00.000Z']) {
      expect(fromZonedLocalInput(toZonedLocalInput(instant, 'America/New_York'), 'America/New_York')).toBe(instant);
      expect(fromZonedLocalInput(toZonedLocalInput(instant, VN), VN)).toBe(instant);
    }
  });
});

describe('zoneOffsetLabel', () => {
  it.each([
    ['2027-04-06T02:00:00.000Z', VN, 'GMT+7'],
    ['2027-01-15T12:00:00.000Z', 'America/New_York', 'GMT-5'],
    ['2027-07-15T12:00:00.000Z', 'America/New_York', 'GMT-4'],
    ['2027-07-15T12:00:00.000Z', 'Asia/Kolkata', 'GMT+5:30'],
    ['2027-07-15T12:00:00.000Z', 'UTC', 'GMT'],
  ])('%s in %s is %s', (instant, zone, expected) => {
    expect(zoneOffsetLabel(instant, zone)).toBe(expected);
  });
});
