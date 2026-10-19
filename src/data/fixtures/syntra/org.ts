import type { EmploymentStatus, Id, JobLevel, OrgUnit, OrgUnitType, RoleCode, UserAccount } from '@/data/types';
import { addRoles, type IdFn, type SeedRows } from '../shared';
import { T } from '../timeline';

/**
 * Syntra's organisation (plan §6.4): root → 3 divisions → 9 departments (the 8 DATX sheets + Kinh
 * doanh, decision D-c), 42 fictional people. No name comes from the DATX "TH KQ" sheet (BR-KPI-51).
 *
 * Phase 1.3 requirements met here (fixtures README, "Identity and permissions"): one root; managers
 * whose unit has children (CEO, division directors); a concurrent assignment (E034); a resigned
 * employee with a closed assignment (E024); a dated move between units (E021, CSKH → MKT on
 * 2027-01-01); an Inactive unit with a historical plan (BL, see goals.ts); an Inactive account whose
 * employee is still Official (E033's old login); a system account holding ADMIN.
 */

export const UNITS: readonly { code: string; name: string; type: OrgUnitType; parent: string | null; head: string | null; inactive?: boolean }[] = [
  { code: 'SYN', name: 'Công ty Syntra', type: 'Company', parent: null, head: 'E001' },
  { code: 'KD', name: 'Khối Kinh doanh', type: 'Division', parent: 'SYN', head: 'E003' },
  { code: 'VH', name: 'Khối Vận hành', type: 'Division', parent: 'SYN', head: 'E004' },
  { code: 'HT', name: 'Khối Hỗ trợ', type: 'Division', parent: 'SYN', head: 'E005' },
  { code: 'KDBH', name: 'Phòng Kinh doanh', type: 'Department', parent: 'KD', head: 'E006' },
  { code: 'MKT', name: 'Phòng Marketing', type: 'Department', parent: 'KD', head: 'E007' },
  { code: 'CSKH', name: 'Phòng Chăm sóc khách hàng', type: 'Department', parent: 'KD', head: 'E008' },
  { code: 'MH', name: 'Phòng Mua hàng', type: 'Department', parent: 'VH', head: 'E009' },
  { code: 'VHN', name: 'Phòng Vận hành', type: 'Department', parent: 'VH', head: 'E010' },
  { code: 'CN', name: 'Phòng Công nghệ', type: 'Department', parent: 'VH', head: 'E011' },
  { code: 'HCNS', name: 'Phòng Hành chính nhân sự', type: 'Department', parent: 'HT', head: 'E012' },
  { code: 'KT', name: 'Phòng Kế toán', type: 'Department', parent: 'HT', head: 'E013' },
  { code: 'KH', name: 'Phòng Kế hoạch', type: 'Department', parent: 'HT', head: 'E014' },
  { code: 'BL', name: 'Phòng Bán lẻ (đã giải thể)', type: 'Department', parent: 'KD', head: null, inactive: true },
];

export const DEPARTMENTS = ['KDBH', 'MKT', 'CSKH', 'MH', 'VHN', 'CN', 'HCNS', 'KT', 'KH'] as const;
export type DepartmentCode = (typeof DEPARTMENTS)[number];

const POSITIONS: readonly { code: string; name: string; level: JobLevel; inactive?: boolean }[] = [
  { code: 'CEO', name: 'Tổng giám đốc', level: 'Director' },
  { code: 'DCEO', name: 'Phó tổng giám đốc', level: 'Director' },
  { code: 'DIR', name: 'Giám đốc khối', level: 'Director' },
  { code: 'HEAD', name: 'Trưởng phòng', level: 'DeptHead' },
  { code: 'TL', name: 'Trưởng nhóm', level: 'TeamLead' },
  { code: 'SPEC', name: 'Chuyên viên', level: 'Specialist' },
  { code: 'STAFF', name: 'Nhân viên', level: 'Staff' },
  { code: 'CTV', name: 'Cộng tác viên', level: 'Collaborator', inactive: true },
];

export interface Person {
  code: string;
  name: string;
  login: string;
  unit: string;
  position: string;
  manager: string | null;
  hired: string;
  status?: EmploymentStatus;
  /** Extra roles beyond EMPLOYEE (MANAGER comes from heading a unit). */
  roles?: readonly RoleCode[];
}

export const PEOPLE: readonly Person[] = [
  { code: 'E001', name: 'Trần Minh Khang', login: 'khang.tm', unit: 'SYN', position: 'CEO', manager: null, hired: '2016-03-01', roles: ['BOD'] },
  { code: 'E002', name: 'Lê Thu Hà', login: 'ha.lt', unit: 'SYN', position: 'DCEO', manager: 'E001', hired: '2017-05-15', roles: ['BOD'] },
  { code: 'E003', name: 'Phạm Quốc Bảo', login: 'bao.pq', unit: 'KD', position: 'DIR', manager: 'E001', hired: '2018-01-08' },
  { code: 'E004', name: 'Võ Thanh Tùng', login: 'tung.vt', unit: 'VH', position: 'DIR', manager: 'E001', hired: '2018-04-02' },
  { code: 'E005', name: 'Nguyễn Thị Mai', login: 'mai.nt', unit: 'HT', position: 'DIR', manager: 'E001', hired: '2018-06-11' },
  { code: 'E006', name: 'Đỗ Văn Hùng', login: 'hung.dv', unit: 'KDBH', position: 'HEAD', manager: 'E003', hired: '2019-02-18' },
  { code: 'E007', name: 'Hoàng Ngọc Lan', login: 'lan.hn', unit: 'MKT', position: 'HEAD', manager: 'E003', hired: '2019-07-01' },
  { code: 'E008', name: 'Bùi Đức Anh', login: 'anh.bd', unit: 'CSKH', position: 'HEAD', manager: 'E003', hired: '2020-03-09' },
  { code: 'E009', name: 'Đặng Thị Hồng', login: 'hong.dt', unit: 'MH', position: 'HEAD', manager: 'E004', hired: '2019-09-16' },
  { code: 'E010', name: 'Phan Văn Long', login: 'long.pv', unit: 'VHN', position: 'HEAD', manager: 'E004', hired: '2020-01-06' },
  { code: 'E011', name: 'Ngô Minh Tuấn', login: 'tuan.nm', unit: 'CN', position: 'HEAD', manager: 'E004', hired: '2019-11-04' },
  { code: 'E012', name: 'Trịnh Thị Thu', login: 'thu.tt', unit: 'HCNS', position: 'HEAD', manager: 'E005', hired: '2018-10-01', roles: ['HR'] },
  { code: 'E013', name: 'Lý Văn Đạt', login: 'dat.lv', unit: 'KT', position: 'HEAD', manager: 'E005', hired: '2019-03-25' },
  { code: 'E014', name: 'Vũ Thị Ngân', login: 'ngan.vt', unit: 'KH', position: 'HEAD', manager: 'E005', hired: '2020-08-17' },
  { code: 'E015', name: 'Mai Quang Huy', login: 'huy.mq', unit: 'KDBH', position: 'TL', manager: 'E006', hired: '2021-04-05' },
  { code: 'E016', name: 'Nguyễn Văn An', login: 'an.nv', unit: 'KDBH', position: 'STAFF', manager: 'E006', hired: '2022-06-01' },
  { code: 'E017', name: 'Trần Thị Bình', login: 'binh.tt', unit: 'KDBH', position: 'SPEC', manager: 'E006', hired: '2022-09-12' },
  { code: 'E018', name: 'Lê Hoàng Phúc', login: 'phuc.lh', unit: 'KDBH', position: 'STAFF', manager: 'E006', hired: T.newHireHired, status: 'Probation' },
  { code: 'E019', name: 'Cao Thị Yến', login: 'yen.ct', unit: 'MKT', position: 'TL', manager: 'E007', hired: '2021-01-11' },
  { code: 'E020', name: 'Lâm Văn Phú', login: 'phu.lv', unit: 'MKT', position: 'SPEC', manager: 'E007', hired: '2022-02-14' },
  { code: 'E021', name: 'Đinh Thị Thảo', login: 'thao.dt', unit: 'MKT', position: 'STAFF', manager: 'E007', hired: '2024-03-01' },
  { code: 'E022', name: 'Hồ Văn Nam', login: 'nam.hv', unit: 'CSKH', position: 'TL', manager: 'E008', hired: '2021-06-07' },
  { code: 'E023', name: 'Tạ Thị Quyên', login: 'quyen.tt', unit: 'CSKH', position: 'SPEC', manager: 'E008', hired: '2022-11-21' },
  { code: 'E024', name: 'Dương Văn Sơn', login: 'son.dv', unit: 'CSKH', position: 'STAFF', manager: 'E008', hired: '2023-05-02', status: 'Resigned' },
  { code: 'E025', name: 'Kiều Thị Oanh', login: 'oanh.kt', unit: 'MH', position: 'TL', manager: 'E009', hired: '2020-10-12' },
  { code: 'E026', name: 'La Văn Thắng', login: 'thang.lv', unit: 'MH', position: 'SPEC', manager: 'E009', hired: '2021-08-23' },
  { code: 'E027', name: 'Mạc Thị Vân', login: 'van.mt', unit: 'MH', position: 'STAFF', manager: 'E009', hired: '2023-02-06' },
  { code: 'E028', name: 'Quách Văn Lộc', login: 'loc.qv', unit: 'VHN', position: 'TL', manager: 'E010', hired: '2020-12-01' },
  { code: 'E029', name: 'Lưu Thị Nhung', login: 'nhung.lt', unit: 'VHN', position: 'SPEC', manager: 'E010', hired: '2022-04-18' },
  { code: 'E030', name: 'Ông Văn Tài', login: 'tai.ov', unit: 'VHN', position: 'STAFF', manager: 'E010', hired: '2023-09-04' },
  { code: 'E031', name: 'Thái Văn Khoa', login: 'khoa.tv', unit: 'CN', position: 'TL', manager: 'E011', hired: '2020-07-20' },
  { code: 'E032', name: 'Châu Thị Ly', login: 'ly.ct', unit: 'CN', position: 'SPEC', manager: 'E011', hired: '2021-10-04', roles: ['ADMIN'] },
  { code: 'E033', name: 'Âu Văn Định', login: 'dinh.av', unit: 'CN', position: 'STAFF', manager: 'E011', hired: '2022-12-12' },
  { code: 'E034', name: 'Triệu Thị Hạnh', login: 'hanh.tt', unit: 'HCNS', position: 'TL', manager: 'E012', hired: '2019-05-06' },
  { code: 'E035', name: 'Kha Thị Duyên', login: 'duyen.kt', unit: 'HCNS', position: 'SPEC', manager: 'E012', hired: '2020-02-17', roles: ['HR'] },
  { code: 'E036', name: 'Tôn Văn Quân', login: 'quan.tv', unit: 'HCNS', position: 'SPEC', manager: 'E012', hired: '2021-03-15', roles: ['CNB'] },
  { code: 'E037', name: 'Viên Thị Hương', login: 'huong.vt', unit: 'KT', position: 'TL', manager: 'E013', hired: '2019-12-02' },
  { code: 'E038', name: 'Lò Văn Hiếu', login: 'hieu.lv', unit: 'KT', position: 'SPEC', manager: 'E013', hired: '2022-01-10' },
  { code: 'E039', name: 'Giang Thị Trang', login: 'trang.gt', unit: 'KT', position: 'STAFF', manager: 'E013', hired: '2023-07-17' },
  { code: 'E040', name: 'Hà Văn Phong', login: 'phong.hv', unit: 'KH', position: 'TL', manager: 'E014', hired: '2020-05-25' },
  { code: 'E041', name: 'Văn Thị Nga', login: 'nga.vt', unit: 'KH', position: 'SPEC', manager: 'E014', hired: '2021-09-13' },
  { code: 'E042', name: 'Mã Văn Kiên', login: 'kien.mv', unit: 'KH', position: 'STAFF', manager: 'E014', hired: '2023-11-06' },
];

/** The demo's starting persona: the first Active account (Phase 1.3). An employee of the §8.2 cast. */
const FIRST_ACCOUNT = 'E016';

export interface SyntraOrg {
  unitId(code: string): Id;
  unit(code: string): OrgUnit;
  employeeId(code: string): Id;
  /** The person's Active account. */
  userId(code: string): Id;
  person(code: string): Person;
  /** Staff of a department (team lead first), excluding the head. */
  staffOf(dept: DepartmentCode): Person[];
  headOf(dept: DepartmentCode): Person;
  systemUserId: Id;
}

export function buildOrg(s: SeedRows, id: IdFn): SyntraOrg {
  const unitId = (code: string) => id('OrgUnit', code);
  const employeeId = (code: string) => id('Employee', code);
  const userId = (code: string) => id('UserAccount', code);
  const units = new Map<string, OrgUnit>();

  for (const u of UNITS) {
    units.set(
      u.code,
      s.add('OrgUnit', {
        id: unitId(u.code),
        parentId: u.parent ? unitId(u.parent) : null,
        code: u.code,
        name: u.name,
        unitType: u.type,
        headEmployeeId: u.head ? employeeId(u.head) : null,
        effectiveFrom: u.inactive ? '2022-01-01' : '2016-01-01',
        effectiveTo: u.inactive ? '2026-12-31' : null,
        status: u.inactive ? 'Inactive' : 'Active',
      }),
    );
  }
  for (const p of POSITIONS) {
    s.add('JobPosition', { id: id('JobPosition', p.code), code: p.code, name: p.name, jobLevel: p.level, status: p.inactive ? 'Inactive' : 'Active' });
  }

  for (const p of PEOPLE) {
    const resigned = p.status === 'Resigned';
    s.add('Employee', {
      id: employeeId(p.code),
      employeeCode: p.code,
      fullName: p.name,
      email: `${p.login}@syntra.example`,
      hireDate: p.hired,
      employmentStatus: p.status ?? 'Official',
      leftOn: resigned ? T.resignedLeftOn : null,
    });
    const assignment = (key: string, unit: string, from: string, to: string | null, isPrimary: boolean, position = p.position, manager = p.manager) =>
      s.add('EmployeeAssignment', {
        id: id('EmployeeAssignment', p.code, key),
        employeeId: employeeId(p.code),
        orgUnitId: unitId(unit),
        positionId: id('JobPosition', position),
        managerEmployeeId: manager ? employeeId(manager) : null,
        isPrimary,
        effectiveFrom: from,
        effectiveTo: to,
      });
    if (p.code === 'E021') {
      // A dated move: CSKH until the end of 2026, Marketing from 2027.
      assignment('1', 'CSKH', p.hired, '2026-12-31', true, 'STAFF', 'E008');
      assignment('2', p.unit, '2027-01-01', null, true);
    } else {
      assignment('1', p.unit, p.hired, resigned ? T.resignedLeftOn : null, true);
    }
    if (p.code === 'E034') {
      // A concurrent (kiêm nhiệm) assignment in Kế hoạch.
      assignment('2', 'KH', '2027-01-01', null, false, 'SPEC', 'E014');
    }
  }

  // Accounts: the starting persona first, then everyone in code order; resigned → Inactive.
  const ordered = [PEOPLE.find((p) => p.code === FIRST_ACCOUNT) as Person, ...PEOPLE.filter((p) => p.code !== FIRST_ACCOUNT)];
  const accounts: UserAccount[] = ordered.map((p) =>
    s.add('UserAccount', {
      id: userId(p.code),
      employeeId: employeeId(p.code),
      login: p.login,
      displayName: p.name,
      authProvider: p.code === 'E001' ? 'SSO' : 'Local',
      status: p.status === 'Resigned' ? 'Inactive' : 'Active',
      lastLoginAt: null,
    }),
  );
  // An Inactive account whose employee is still Official (an old login replaced in 2026).
  accounts.push(
    s.add('UserAccount', {
      id: id('UserAccount', 'E033', 'old'),
      employeeId: employeeId('E033'),
      login: 'dinh.av.cu',
      displayName: 'Âu Văn Định (tài khoản cũ)',
      authProvider: 'Local',
      status: 'Inactive',
      lastLoginAt: null,
    }),
  );
  const systemUserId = id('UserAccount', 'SYSTEM');
  accounts.push(
    s.add('UserAccount', {
      id: systemUserId,
      employeeId: null,
      login: 'he-thong.tich-hop',
      displayName: 'Tài khoản hệ thống (tích hợp)',
      authProvider: 'Local',
      status: 'Active',
      lastLoginAt: null,
    }),
  );

  // Roles: EMPLOYEE/Self for every account with an employee; MANAGER for unit heads; the rest Tenant.
  const roles = addRoles(s, id);
  const headOfUnit = new Map(UNITS.filter((u) => u.head).map((u) => [u.head as string, u.code]));
  for (const account of accounts) {
    const add = (role: RoleCode, scopeType: 'Self' | 'OrgUnit' | 'Tenant', scopeOrgUnitId: Id | null) =>
      s.add('UserRole', {
        id: id('UserRole', account.id, role),
        userId: account.id,
        roleId: roles[role].id,
        scopeType,
        scopeOrgUnitId,
        includeChildren: scopeType === 'OrgUnit',
      });
    if (account.employeeId === null) {
      add('ADMIN', 'Tenant', null);
      continue;
    }
    add('EMPLOYEE', 'Self', null);
    if (account.status === 'Inactive' && account.login.endsWith('.cu')) continue;
    const person = PEOPLE.find((p) => employeeId(p.code) === account.employeeId) as Person;
    const headed = headOfUnit.get(person.code);
    if (headed) add('MANAGER', 'OrgUnit', unitId(headed));
    for (const role of person.roles ?? []) add(role, 'Tenant', null);
  }

  const people = new Map(PEOPLE.map((p) => [p.code, p]));
  return {
    unitId,
    unit: (code) => units.get(code) as OrgUnit,
    employeeId,
    userId,
    person: (code) => {
      const p = people.get(code);
      if (!p) throw new Error(`seed: unknown person ${code}`);
      return p;
    },
    staffOf: (dept) => PEOPLE.filter((p) => p.unit === dept && p.position !== 'HEAD'),
    headOf: (dept) => PEOPLE.find((p) => p.unit === dept && p.position === 'HEAD') as Person,
    systemUserId,
  };
}
