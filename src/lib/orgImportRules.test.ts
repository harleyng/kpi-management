import { describe, expect, it } from 'vitest';
import type { OrgDataImportRow } from '@/data/types';
import { assignment, employee, orgUnit, position, user } from '@/test/builders';
import { ORG_DATA_COLUMNS, orgDataRowErrors } from './orgImportRules';

const ctx = {
  units: [orgUnit({ id: 'root', code: 'SYN' }), orgUnit({ id: 'kd', code: 'KD', parentId: 'root', unitType: 'Department' }), orgUnit({ id: 'old', code: 'OLD', parentId: 'root', unitType: 'Department', status: 'Inactive' })],
  positions: [position({ id: 'staff', code: 'STAFF' }), position({ id: 'ctv', code: 'CTV', status: 'Inactive' })],
  employees: [
    employee({ id: 'm', employeeCode: 'M1', email: 'm1@x.test' }),
    employee({ id: 'e', employeeCode: 'E1', email: 'e1@x.test' }),
    employee({ id: 'gone', employeeCode: 'G1', email: 'g1@x.test', employmentStatus: 'Resigned', leftOn: '2027-01-31' }),
  ],
  assignments: [assignment({ id: 'a-e', employeeId: 'e', orgUnitId: 'kd', managerEmployeeId: 'm' }), assignment({ id: 'a-m', employeeId: 'm', orgUnitId: 'kd' })],
  accounts: [user({ id: 'u-m', employeeId: 'm', login: 'm1' }), user({ id: 'u-e', employeeId: 'e', login: 'e1' })],
  today: '2027-04-06',
};
const row = (o: Partial<OrgDataImportRow> = {}): OrgDataImportRow => ({
  rowNo: 2, employeeCode: 'N1', fullName: 'Người Mới', email: 'n1@x.test', hireDate: '2027-05-01',
  orgUnitCode: 'KD', positionCode: 'STAFF', managerEmployeeCode: 'M1', login: 'n1', ...o,
});
const errorsOf = (rows: OrgDataImportRow[]) => orgDataRowErrors(rows, ctx).map((e) => `${e.rowNo}|${e.column ?? '-'}|${e.code}|${e.detail}`);

describe('OrgData import — WBS 4.1.7', () => {
  it('declares one column per row field, the required ones first-class', () => {
    expect(ORG_DATA_COLUMNS.map((c) => c.key)).toEqual(['employeeCode', 'fullName', 'email', 'hireDate', 'orgUnitCode', 'positionCode', 'managerEmployeeCode', 'login']);
    expect(ORG_DATA_COLUMNS.filter((c) => c.required).map((c) => c.key)).toEqual(['employeeCode', 'fullName', 'email', 'orgUnitCode', 'positionCode']);
  });

  it('accepts a clean new row, and an update of an existing person with no hire date', () => {
    expect(errorsOf([row(), row({ rowNo: 3, employeeCode: 'e1', fullName: 'Đổi tên', email: 'e1@x.test', hireDate: null, login: 'e1' })])).toEqual([]);
  });

  it.each([
    ['a blank required cell', { fullName: ' ' }, ['2|Họ và tên|ERR-KPI-06|REQUIRED']],
    ['no hire date for a new person', { hireDate: null }, ['2|Ngày vào làm|ERR-KPI-06|REQUIRED']],
    ['a bad date', { hireDate: '2027-02-30' }, ['2|Ngày vào làm|ERR-KPI-06|DATE_INVALID']],
    ['an unknown unit', { orgUnitCode: 'NOPE' }, ['2|Mã đơn vị|ERR-KPI-06|UNIT_UNKNOWN']],
    ['an Inactive unit', { orgUnitCode: 'old' }, ['2|Mã đơn vị|ERR-KPI-06|UNIT_INACTIVE']],
    ['an Inactive position', { positionCode: 'CTV' }, ['2|Mã chức danh|ERR-KPI-06|POSITION_INACTIVE']],
    ['an email of someone else', { email: 'E1@x.test' }, ['2|Email|ERR-KPI-06|EMAIL_TAKEN']],
    ['a login of someone else', { login: 'M1' }, ['2|Tên đăng nhập|ERR-KPI-06|LOGIN_TAKEN']],
    ['a malformed login', { login: 'n 1' }, ['2|Tên đăng nhập|ERR-KPI-06|LOGIN_INVALID']],
    ['the person as their own manager', { managerEmployeeCode: 'n1' }, ['2|Mã quản lý trực tiếp|ERR-KPI-16|SELF_MANAGER']],
    ['an unknown manager', { managerEmployeeCode: 'X9' }, ['2|Mã quản lý trực tiếp|ERR-KPI-06|MANAGER_UNKNOWN']],
    ['a manager who has left', { managerEmployeeCode: 'G1' }, ['2|Mã quản lý trực tiếp|ERR-KPI-16|MANAGER_NOT_EMPLOYED']],
    ['a row for someone who has left', { employeeCode: 'G1', email: 'g1@x.test', hireDate: null, login: null }, ['2|Mã nhân viên|ERR-KPI-06|EMPLOYEE_LEFT_IMPORT']],
  ] as const)('reports %s', (_, change, expected) => {
    expect(errorsOf([row(change)])).toEqual(expected);
  });

  it('reports duplicates inside the file on every row involved', () => {
    expect(errorsOf([row(), row({ rowNo: 3, fullName: 'Khác', email: 'n1@X.test', login: 'other' })])).toEqual([
      '2|Mã nhân viên|ERR-KPI-06|DUPLICATE_IN_FILE',
      '2|Email|ERR-KPI-06|DUPLICATE_IN_FILE',
      '3|Mã nhân viên|ERR-KPI-06|DUPLICATE_IN_FILE',
      '3|Email|ERR-KPI-06|DUPLICATE_IN_FILE',
    ]);
  });

  it('accepts a manager defined further down the same file', () => {
    expect(errorsOf([row({ managerEmployeeCode: 'N2' }), row({ rowNo: 3, employeeCode: 'N2', email: 'n2@x.test', login: 'n2', managerEmployeeCode: 'M1' })])).toEqual([]);
  });

  it('finds a reporting loop across the file and the tenant', () => {
    // E1 reports to M1 in the tenant; the file makes M1 report to E1.
    expect(errorsOf([row({ employeeCode: 'M1', email: 'm1@x.test', login: 'm1', hireDate: null, managerEmployeeCode: 'E1' })])).toEqual(['2|Mã quản lý trực tiếp|ERR-KPI-16|REPORTING_CYCLE']);
    // Inside the file only: N1 → N2 → N1.
    expect(errorsOf([row({ managerEmployeeCode: 'N2' }), row({ rowNo: 3, employeeCode: 'N2', email: 'n2@x.test', login: 'n2', managerEmployeeCode: 'N1' })])).toEqual([
      '2|Mã quản lý trực tiếp|ERR-KPI-16|REPORTING_CYCLE',
      '3|Mã quản lý trực tiếp|ERR-KPI-16|REPORTING_CYCLE',
    ]);
  });
});
