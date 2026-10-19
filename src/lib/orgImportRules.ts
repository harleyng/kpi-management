/**
 * WBS 4.1.7 — the "Tổ chức & nhân sự" import: its columns and its per-row validation, pure. T4's
 * shared framework (4.4.3) parses the uploaded file into `OrgDataImportRow`s with `ORG_DATA_COLUMNS`,
 * stages them with these errors, and commits a clean batch through `mock/groups/orgTx.ts` in the
 * order employees → assignments → accounts, as of the gateway clock's "today":
 * - `employeeCode` matches an existing employee case-insensitively → update name and email (never the
 *   hire date); otherwise a new employee (hire date required);
 * - a unit / position / manager different from the current primary assignment → a transfer from
 *   today (B1); the same ones → nothing. A NEW person's first assignment starts on the later of their
 *   hire date and today (a future hire is valid);
 * - a person who has already left is refused on the row (EMPLOYEE_LEFT_IMPORT);
 * - `login` given and the person has no Active account → a new account (B2 grants EMPLOYEE / Self).
 *
 * The rules here are the screen ones (`orgAdminRules`) seen from a file: a manager defined further
 * down the same file is valid, and a reporting loop is looked for across the file AND the tenant.
 */

import type { Employee, EmployeeAssignment, ImportRowError, IsoDate, JobPosition, OrgDataImportRow, OrgUnit, UserAccount } from '@/data/types';
import type { ErrorCode } from './errorCatalog';
import { headerOf, type ImportColumn } from './importColumns';
import { isIsoDate } from './isoDate';
import { isEmployedOn, isStillEmployedOn, managerOf } from './orgRules';

export const ORG_DATA_COLUMNS: readonly ImportColumn<OrgDataImportRow>[] = [
  { key: 'employeeCode', header: 'Mã nhân viên', required: true, kind: 'text', hint: 'Mã đã có: cập nhật hồ sơ. Mã mới: thêm nhân viên.', example: 'E100', width: 16 },
  { key: 'fullName', header: 'Họ và tên', required: true, kind: 'text', hint: 'Họ tên đầy đủ, có dấu.', example: 'Nguyễn Thị Mẫu', width: 26 },
  { key: 'email', header: 'Email', required: true, kind: 'text', hint: 'Email công việc, không trùng người khác.', example: 'mau.nt@congty.example', width: 28 },
  { key: 'hireDate', header: 'Ngày vào làm', required: false, kind: 'date', hint: 'Bắt buộc với nhân viên mới. Định dạng ngày.', example: '2027-05-01', width: 16 },
  { key: 'orgUnitCode', header: 'Mã đơn vị', required: true, kind: 'text', hint: 'Xem sheet "Mã đơn vị".', example: 'KDBH', width: 14 },
  { key: 'positionCode', header: 'Mã chức danh', required: true, kind: 'text', hint: 'Xem sheet "Mã chức danh".', example: 'STAFF', width: 14 },
  { key: 'managerEmployeeCode', header: 'Mã quản lý trực tiếp', required: false, kind: 'text', hint: 'Mã nhân viên của quản lý, có thể là người trong cùng file.', example: 'E006', width: 20 },
  { key: 'login', header: 'Tên đăng nhập', required: false, kind: 'text', hint: 'Để trống nếu chưa cấp tài khoản.', example: 'mau.nt', width: 18 },
];

export interface OrgImportContext {
  units: readonly OrgUnit[];
  positions: readonly JobPosition[];
  employees: readonly Employee[];
  assignments: readonly EmployeeAssignment[];
  accounts: readonly UserAccount[];
  today: IsoDate;
}

const key = (value: string | null | undefined) => (value ?? '').trim().toLocaleLowerCase('vi');
const blank = (value: string | null | undefined) => key(value) === '';
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LOGIN = /^[a-z0-9._-]+$/i;

export function orgDataRowErrors(rows: readonly OrgDataImportRow[], ctx: OrgImportContext): ImportRowError[] {
  const errors: ImportRowError[] = [];
  const col = (k: keyof OrgDataImportRow & string) => headerOf(ORG_DATA_COLUMNS, k);
  const push = (rowNo: number, k: (keyof OrgDataImportRow & string) | null, code: ErrorCode, detail: string) =>
    errors.push({ rowNo, column: k === null ? null : col(k), code, detail });

  const employeeByCode = new Map(ctx.employees.map((e) => [key(e.employeeCode), e]));
  const unitByCode = new Map(ctx.units.map((u) => [key(u.code), u]));
  const positionByCode = new Map(ctx.positions.map((p) => [key(p.code), p]));
  const count = (pick: (r: OrgDataImportRow) => string | null) => {
    const seen = new Map<string, number>();
    for (const r of rows) if (!blank(pick(r))) seen.set(key(pick(r)), (seen.get(key(pick(r))) ?? 0) + 1);
    return seen;
  };
  const codesInFile = count((r) => r.employeeCode);
  const emailsInFile = count((r) => r.email);
  const loginsInFile = count((r) => r.login);

  for (const r of rows) {
    for (const c of ORG_DATA_COLUMNS) {
      const value = r[c.key];
      if (c.required && (value === null || (typeof value === 'string' && blank(value)))) push(r.rowNo, c.key, 'ERR-KPI-06', 'REQUIRED');
    }
    const existing = employeeByCode.get(key(r.employeeCode));
    if (existing && !isStillEmployedOn(existing, ctx.today)) push(r.rowNo, 'employeeCode', 'ERR-KPI-06', 'EMPLOYEE_LEFT_IMPORT');
    if (!blank(r.employeeCode) && (codesInFile.get(key(r.employeeCode)) ?? 0) > 1) push(r.rowNo, 'employeeCode', 'ERR-KPI-06', 'DUPLICATE_IN_FILE');

    if (r.hireDate === null) {
      if (!existing) push(r.rowNo, 'hireDate', 'ERR-KPI-06', 'REQUIRED');
    } else if (!isIsoDate(r.hireDate)) push(r.rowNo, 'hireDate', 'ERR-KPI-06', 'DATE_INVALID');

    if (!blank(r.email)) {
      if (!EMAIL.test(r.email.trim())) push(r.rowNo, 'email', 'ERR-KPI-06', 'EMAIL_INVALID');
      else if ((emailsInFile.get(key(r.email)) ?? 0) > 1) push(r.rowNo, 'email', 'ERR-KPI-06', 'DUPLICATE_IN_FILE');
      else if (ctx.employees.some((e) => e.id !== existing?.id && key(e.email) === key(r.email))) push(r.rowNo, 'email', 'ERR-KPI-06', 'EMAIL_TAKEN');
    }

    if (!blank(r.orgUnitCode)) {
      const unit = unitByCode.get(key(r.orgUnitCode));
      if (!unit) push(r.rowNo, 'orgUnitCode', 'ERR-KPI-06', 'UNIT_UNKNOWN');
      else if (unit.status === 'Inactive' || (unit.effectiveTo !== null && unit.effectiveTo < ctx.today)) push(r.rowNo, 'orgUnitCode', 'ERR-KPI-06', 'UNIT_INACTIVE');
    }
    if (!blank(r.positionCode)) {
      const position = positionByCode.get(key(r.positionCode));
      if (!position) push(r.rowNo, 'positionCode', 'ERR-KPI-06', 'POSITION_UNKNOWN');
      else if (position.status === 'Inactive') push(r.rowNo, 'positionCode', 'ERR-KPI-06', 'POSITION_INACTIVE');
    }

    if (!blank(r.managerEmployeeCode)) {
      const managerKey = key(r.managerEmployeeCode);
      const manager = employeeByCode.get(managerKey);
      if (managerKey === key(r.employeeCode)) push(r.rowNo, 'managerEmployeeCode', 'ERR-KPI-16', 'SELF_MANAGER');
      else if (!manager && !codesInFile.has(managerKey)) push(r.rowNo, 'managerEmployeeCode', 'ERR-KPI-06', 'MANAGER_UNKNOWN');
      else if (manager && !isEmployedOn(manager, ctx.today)) push(r.rowNo, 'managerEmployeeCode', 'ERR-KPI-16', 'MANAGER_NOT_EMPLOYED');
    }

    if (r.login !== null && !blank(r.login)) {
      const ownAccounts = new Set(ctx.accounts.filter((a) => existing && a.employeeId === existing.id).map((a) => a.id));
      if (!LOGIN.test(r.login.trim())) push(r.rowNo, 'login', 'ERR-KPI-06', 'LOGIN_INVALID');
      else if ((loginsInFile.get(key(r.login)) ?? 0) > 1) push(r.rowNo, 'login', 'ERR-KPI-06', 'DUPLICATE_IN_FILE');
      else if (ctx.accounts.some((a) => !ownAccounts.has(a.id) && key(a.login) === key(r.login))) push(r.rowNo, 'login', 'ERR-KPI-06', 'LOGIN_TAKEN');
    }
  }

  for (const rowNo of reportingLoopRows(rows, ctx)) push(rowNo, 'managerEmployeeCode', 'ERR-KPI-16', 'REPORTING_CYCLE');
  return errors.sort((a, b) => a.rowNo - b.rowNo);
}

/**
 * Rows whose line, after the import, loops back to themselves: the tenant's current primary lines
 * (by employee code) overridden by every row of the file.
 */
function reportingLoopRows(rows: readonly OrgDataImportRow[], ctx: OrgImportContext): number[] {
  const codeOf = new Map(ctx.employees.map((e) => [e.id, key(e.employeeCode)]));
  const line = new Map<string, string | null>();
  for (const e of ctx.employees) {
    const manager = managerOf(e.id, ctx.assignments, ctx.today);
    line.set(key(e.employeeCode), manager === null ? null : (codeOf.get(manager) ?? null));
  }
  for (const r of rows) if (!blank(r.employeeCode)) line.set(key(r.employeeCode), blank(r.managerEmployeeCode) ? null : key(r.managerEmployeeCode));

  return rows
    .filter((r) => {
      const self = key(r.employeeCode);
      if (self === '' || blank(r.managerEmployeeCode) || key(r.managerEmployeeCode) === self) return false;
      const seen = new Set<string>();
      for (let current = line.get(self) ?? null; current !== null && !seen.has(current); current = line.get(current) ?? null) {
        if (current === self) return true;
        seen.add(current);
      }
      return false;
    })
    .map((r) => r.rowNo);
}
