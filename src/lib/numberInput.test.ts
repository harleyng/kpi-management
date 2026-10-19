import { describe, expect, it } from 'vitest';
import { formatDecimalInput, parseDecimalInput } from './numberInput';

describe('parseDecimalInput — what a person types in a vi-VN form', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['0', 0],
    ['92,5', 92.5],
    ['92.5', 92.5],
    ['9.600.000.000', 9_600_000_000],
    ['9.600', 9600],
    ['1.234,5', 1234.5],
    ['9600000000', 9_600_000_000],
    ['-3,25', -3.25],
    ['0,005', 0.005],
    [' 1 000 ', 1000],
    ['9.60', 9.6], // not a thousands group (two digits): a decimal point
    ['-1.234,5', -1234.5],
  ])('%j → %s', (text, expected) => {
    expect(parseDecimalInput(text)).toBe(expected);
  });

  it.each(['abc', '1,2,3', '12a', '1..2', '--1'])('%j → NaN', (text) => {
    expect(parseDecimalInput(text)).toBeNaN();
  });

  it('formatDecimalInput round-trips', () => {
    for (const v of [92.5, 9_600_000_000, 0, -3.25, 0.005]) expect(parseDecimalInput(formatDecimalInput(v))).toBe(v);
    expect(formatDecimalInput(null)).toBe('');
  });
});
