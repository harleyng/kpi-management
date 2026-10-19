// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ruleIssue } from './errorCatalog';
import { fieldIssues, ORG_ISSUE_COPY, orgIssueText, otherIssues } from './orgIssueCopy';

const dir = fileURLToPath(new URL('.', import.meta.url));
/** Every detail the T1 rules can raise, read from their source (`ruleIssue(code, ref, 'DETAIL'…)`, `push(…, 'DETAIL')`). */
const raised = ['orgAdminRules.ts', 'accessAdminRules.ts', 'orgImportRules.ts'].flatMap((file) =>
  [...readFileSync(`${dir}/${file}`, 'utf8').matchAll(/'ERR-KPI-\d{2}',\s*(?:[^,()]+,\s*)?'([A-Z_]+)'/g)].map((m) => m[1]),
);

describe('ORG_ISSUE_COPY', () => {
  it('finds the details the rules raise', () => {
    expect(raised).toEqual(expect.arrayContaining(['UNIT_HAS_STAFF', 'LAST_ADMIN', 'REPORTING_CYCLE', 'DUPLICATE_IN_FILE']));
  });
  it.each([...new Set(raised)])('has a sentence for %s', (detail) => {
    expect(ORG_ISSUE_COPY[detail]).toBeDefined();
  });
  it('fills in the counts, and falls back to the catalogue title', () => {
    expect(orgIssueText(ruleIssue('ERR-KPI-14', 'status', 'UNIT_HAS_STAFF', { count: 6 }))).toBe('Chưa thể ngừng dùng: còn 6 nhân viên đang thuộc đơn vị này.');
    expect(orgIssueText(ruleIssue('ERR-KPI-06', null, 'SOMETHING_NEW'))).toBe('Dữ liệu chưa hợp lệ');
  });
});

describe('fieldIssues / otherIssues', () => {
  const issues = [ruleIssue('ERR-KPI-06', 'login', 'LOGIN_TAKEN'), ruleIssue('ERR-KPI-06', 'login', 'REQUIRED'), ruleIssue('ERR-KPI-15', null, 'LAST_ADMIN'), ruleIssue('ERR-KPI-06', 'status', 'EMPLOYEE_LEFT')];
  it('keeps the first sentence per field', () => {
    expect(fieldIssues(issues)).toEqual({ login: 'Tên đăng nhập này đã được dùng.', status: 'Nhân viên đã nghỉ việc, không thể mở tài khoản.' });
  });
  it('lists what no field of the form shows', () => {
    expect(otherIssues(issues, ['login'])).toEqual(['Không thể thực hiện: đây là tài khoản quản trị cuối cùng của công ty.', 'Nhân viên đã nghỉ việc, không thể mở tài khoản.']);
  });
});
