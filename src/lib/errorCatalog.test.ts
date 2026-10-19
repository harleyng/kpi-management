import { describe, expect, it } from 'vitest';
import { ERROR_CATALOG, KpiError, errorSpecOf, type ErrorCode } from './errorCatalog';

describe('ERROR_CATALOG', () => {
  const entries = Object.entries(ERROR_CATALOG) as [ErrorCode, (typeof ERROR_CATALOG)[ErrorCode]][];

  it('keys every entry by its own code', () => {
    for (const [key, spec] of entries) expect(spec.code).toBe(key);
  });

  it('uses the ERR-KPI-NN format for every code', () => {
    for (const [key] of entries) expect(key).toMatch(/^ERR-KPI-\d{2}$/);
  });

  it('gives every entry a non-empty title and trigger', () => {
    for (const [, spec] of entries) {
      expect(spec.title.trim()).not.toBe('');
      expect(spec.trigger.trim()).not.toBe('');
    }
  });

  it('never leaves an action label empty — null means "no button", not ""', () => {
    for (const [, spec] of entries) {
      if (spec.action !== null) expect(spec.action.trim()).not.toBe('');
    }
  });

  it('ships ERR-KPI-01 as the failed-read message with a retry', () => {
    const spec = ERROR_CATALOG['ERR-KPI-01'];
    expect(spec.title).toBe('Không tải được dữ liệu');
    expect(spec.surface).toBe('empty-state');
    expect(spec.action).toBe('Thử lại');
  });
});

describe('KpiError / errorSpecOf', () => {
  it('resolves a coded error to its own catalogue entry', () => {
    const error = new KpiError('ERR-KPI-01', 'goals.list');
    expect(error.code).toBe('ERR-KPI-01');
    expect(error.message).toBe('ERR-KPI-01: goals.list');
    expect(errorSpecOf(error)).toBe(ERROR_CATALOG['ERR-KPI-01']);
  });

  it('falls back to ERR-KPI-01 for an unknown thrown value', () => {
    expect(errorSpecOf(new Error('boom'))).toBe(ERROR_CATALOG['ERR-KPI-01']);
    expect(errorSpecOf('a string')).toBe(ERROR_CATALOG['ERR-KPI-01']);
  });
});
