import { describe, expect, it } from 'vitest';
import { matchesSearch } from './search';

describe('matchesSearch', () => {
  it('matches a query typed without diacritics', () => {
    expect(matchesSearch('nguyen van', ['Nguyễn Văn An'])).toBe(true);
    expect(matchesSearch('doanh thu', ['Doanh thu thuần'])).toBe(true);
  });

  it('folds đ/Đ, which NFD does not decompose', () => {
    expect(matchesSearch('dat', ['Đạt chỉ tiêu'])).toBe(true);
    expect(matchesSearch('Đạt', ['dat chi tieu'])).toBe(true);
  });

  it('requires every word, each in any field', () => {
    expect(matchesSearch('an nv001', ['Nguyễn Văn An', 'NV001'])).toBe(true);
    expect(matchesSearch('an nv002', ['Nguyễn Văn An', 'NV001'])).toBe(false);
  });

  it('matches everything for a blank or whitespace query', () => {
    expect(matchesSearch('', ['x'])).toBe(true);
    expect(matchesSearch('   ', [])).toBe(true);
  });

  it('ignores missing fields instead of matching the text "null"', () => {
    expect(matchesSearch('null', [null, undefined, 'Doanh thu'])).toBe(false);
  });
});
