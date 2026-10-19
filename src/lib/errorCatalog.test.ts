import { describe, expect, it } from 'vitest';
import { ERROR_CATALOG, ISSUE_DETAIL_COPY, ISSUE_DETAILS, KpiDeferredError, KpiError, errorSpecOf, issueText, isRetryable, ruleIssue, toKpiError, type ErrorCode } from './errorCatalog';

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

describe('isRetryable', () => {
  it('retries a failed read or write and an uncoded error', () => {
    expect(isRetryable(new KpiError('ERR-KPI-01'))).toBe(true);
    expect(isRetryable(new KpiError('ERR-KPI-03'))).toBe(true);
    expect(isRetryable(new Error('network'))).toBe(true);
  });

  it('does not retry answers that will not change: not found, wrong state, not entitled, invalid', () => {
    for (const code of ['ERR-KPI-02', 'ERR-KPI-04', 'ERR-KPI-05', 'ERR-KPI-06'] as const) {
      expect(isRetryable(new KpiError(code))).toBe(false);
    }
  });

  it('never retries a method that is waiting for its rule, though it keeps the read/write code', () => {
    const read = new KpiDeferredError('read', 'forms.listInbox', 'Phase 1.5 workflowRules');
    const write = new KpiDeferredError('write', 'forms.act', 'Phase 1.5 workflowRules');
    expect(read.code).toBe('ERR-KPI-01');
    expect(write.code).toBe('ERR-KPI-03');
    expect(write).toBeInstanceOf(KpiError);
    expect(write.message).toBe('ERR-KPI-03: forms.act requires Phase 1.5 workflowRules');
    expect(isRetryable(read)).toBe(false);
    expect(isRetryable(write)).toBe(false);
  });
});

describe('rule-specific codes ERR-KPI-07…13 (Phase 1.5)', () => {
  it('numbers the catalogue contiguously from 01, with no gap', () => {
    const numbers = Object.keys(ERROR_CATALOG).map((code) => Number(code.slice(-2))).sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it.each([
    ['ERR-KPI-07', 'Tổng trọng số chưa đạt 100%'],
    ['ERR-KPI-08', 'Số chỉ tiêu phải từ 5 đến 8'],
    ['ERR-KPI-09', 'Còn chỉ tiêu chưa chấm điểm hoặc chưa nhận xét'],
    ['ERR-KPI-10', 'Liên kết này tạo vòng lặp giữa các chỉ tiêu'],
    ['ERR-KPI-11', 'Phân giao vượt mục tiêu của chỉ tiêu cha'],
    ['ERR-KPI-12', 'Chưa tính được % hoàn thành'],
    ['ERR-KPI-13', 'Cấu hình tính điểm chưa hợp lệ'],
  ] as const)('%s is an inline message: %s', (code, title) => {
    expect(ERROR_CATALOG[code].title).toBe(title);
    expect(ERROR_CATALOG[code].surface).toBe('inline');
    expect(isRetryable(new KpiError(code))).toBe(false);
  });
});

describe('toKpiError', () => {
  it('throws the first issue\'s code and keeps every issue for the screen', () => {
    const issues = [ruleIssue('ERR-KPI-09', 'item-1'), ruleIssue('ERR-KPI-09', 'item-2')];
    const error = toKpiError(issues);
    expect(error.code).toBe('ERR-KPI-09');
    expect(error.issues.map((issue) => issue.ref)).toEqual(['item-1', 'item-2']);
  });

  it('refuses an empty list — there is nothing to report', () => {
    expect(() => toKpiError([])).toThrow();
  });

  it('gives a plain KpiError an empty issue list', () => {
    expect(new KpiError('ERR-KPI-04').issues).toEqual([]);
  });
});

describe('ISSUE_DETAIL_COPY / issueText (rule 6 — detail codes rendered from the catalogue)', () => {
  it('gives every detail code a non-empty Vietnamese sentence', () => {
    expect(Object.keys(ISSUE_DETAIL_COPY).sort()).toEqual([...ISSUE_DETAILS].sort());
    for (const detail of ISSUE_DETAILS) expect(ISSUE_DETAIL_COPY[detail].trim(), detail).not.toBe('');
  });

  it('renders a code, shows an older stored sentence as it is, and falls back to the code title', () => {
    expect(issueText('PERIOD_LOCKED')).toBe('Kỳ đã khóa số liệu.');
    expect(issueText('Không tìm thấy người dùng nam.hv2')).toBe('Không tìm thấy người dùng nam.hv2');
    expect(issueText(null, 'ERR-KPI-04')).toBe(ERROR_CATALOG['ERR-KPI-04'].title);
  });
});
