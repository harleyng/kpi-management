import { ERROR_CATALOG, type RuleIssue } from './errorCatalog';

/**
 * The inline sentence for each `RuleIssue.detail` the T1 guards raise (`orgAdminRules`,
 * `accessAdminRules`, `orgImportRules`) — the reason shown under a field or beside a blocked action.
 * The catalogue entry (ERR-KPI-06 / 14 / 15 / 16) stays the title and the toast; this says WHICH rule.
 * `orgIssueCopy.test.ts` fails if a rule raises a detail that has no sentence here.
 */
type Copy = string | ((data: Readonly<Record<string, number | string>>) => string);

export const ORG_ISSUE_COPY: Readonly<Record<string, Copy>> = {
  REQUIRED: 'Trường này bắt buộc.',
  CODE_TAKEN: 'Mã này đã được dùng.',
  // Units
  UNIT_TYPE_ORDER: 'Loại đơn vị phải thấp hơn đơn vị cấp trên (Công ty › Khối › Phòng ban › Nhóm).',
  PARENT_INACTIVE: 'Đơn vị cấp trên đã ngừng dùng.',
  ROOT_CANNOT_END: 'Không thể ngừng dùng đơn vị gốc của công ty.',
  UNIT_HAS_CHILDREN: (d) => `Chưa thể ngừng dùng: còn ${d.count} đơn vị trực thuộc đang dùng.`,
  UNIT_HAS_STAFF: (d) => `Chưa thể ngừng dùng: còn ${d.count} nhân viên đang thuộc đơn vị này.`,
  UNIT_HAS_PLANS: (d) => `Chưa thể ngừng dùng: còn ${d.count} bảng mục tiêu chưa đóng kỳ.`,
  HEAD_NOT_EMPLOYED: 'Người này không còn làm việc.',
  HEAD_NOT_IN_UNIT: 'Trưởng đơn vị phải đang được phân công vào đơn vị này hoặc đơn vị trực thuộc.',
  // Positions
  POSITION_IN_USE: (d) => `Chưa thể ngừng dùng: còn ${d.count} phân công đang dùng chức danh này.`,
  // Employees
  EMAIL_INVALID: 'Email chưa đúng định dạng.',
  EMAIL_TAKEN: 'Email này đã thuộc về nhân viên khác.',
  LEFT_ON_REQUIRED: 'Nhân viên nghỉ việc cần có ngày làm việc cuối.',
  LEFT_ON_NEEDS_RESIGNED: 'Chỉ nhân viên nghỉ việc mới có ngày làm việc cuối.',
  LEFT_BEFORE_HIRED: 'Ngày làm việc cuối không được trước ngày vào làm.',
  ASSIGNMENT_BEFORE_HIRE: 'Có phân công bắt đầu trước ngày vào làm mới.',
  // Assignments
  DATES_ORDER: 'Ngày kết thúc phải sau ngày bắt đầu.',
  OUTSIDE_EMPLOYMENT: 'Phân công phải nằm trong thời gian làm việc của nhân viên.',
  UNIT_INACTIVE: 'Đơn vị đã ngừng dùng hoặc kết thúc trước ngày này.',
  POSITION_INACTIVE: 'Chức danh đã ngừng dùng.',
  SELF_MANAGER: 'Nhân viên không thể là quản lý trực tiếp của chính mình.',
  MANAGER_NOT_EMPLOYED: 'Quản lý này không làm việc trong suốt thời gian phân công.',
  REPORTING_CYCLE: 'Quan hệ này tạo vòng báo cáo: quản lý đang báo cáo (trực tiếp hoặc gián tiếp) cho nhân viên này.',
  TRANSFER_BOUNDED: 'Điều chuyển có ngày kết thúc sẽ cắt mất phần sau của phân công hiện tại. Để trống ngày kết thúc, hoặc kết thúc phân công hiện tại trước.',
  ASSIGNMENT_AFTER_LEFT_ON: 'Còn phân công bắt đầu sau ngày làm việc cuối. Hãy kết thúc hoặc bỏ phân công đó trước.',
  PRIMARY_OVERLAP: 'Trùng với một phân công chính khác. Điều chuyển phải bắt đầu sau ngày bắt đầu của phân công hiện tại.',
  // Tenant
  TIMEZONE_INVALID: 'Múi giờ không hợp lệ.',
  SUSPEND_OWN_TENANT: 'Không thể tạm ngưng chính công ty bạn đang quản trị.',
  // Accounts and roles
  LOGIN_INVALID: 'Tên đăng nhập chỉ gồm chữ không dấu, số và các ký tự . _ -',
  LOGIN_TAKEN: 'Tên đăng nhập này đã được dùng.',
  EMPLOYEE_IMMUTABLE: 'Không thể đổi nhân viên của một tài khoản đã tạo.',
  ACCOUNT_EXISTS: 'Nhân viên này đã có một tài khoản đang hoạt động.',
  EMPLOYEE_LEFT: 'Nhân viên đã nghỉ việc, không thể mở tài khoản.',
  EMPLOYEE_SELF_REQUIRED: 'Vai trò Nhân viên (bản thân) luôn đi kèm tài khoản của nhân viên, không gỡ hay sửa được.',
  EMPLOYEE_ROLE_NEEDS_EMPLOYEE: 'Tài khoản hệ thống không gắn với nhân viên nên không có vai trò Nhân viên.',
  SELF_SCOPE_ROLE: 'Chỉ vai trò Nhân viên dùng phạm vi Bản thân.',
  ROLE_DUPLICATE: 'Tài khoản đã có vai trò này với cùng phạm vi.',
  LAST_ADMIN: 'Không thể thực hiện: đây là tài khoản quản trị cuối cùng của công ty.',
  ADMIN_PERMISSIONS: 'Vai trò Quản trị hệ thống luôn giữ quyền quản lý tổ chức và người dùng.',
  SELF_LOCKOUT: 'Không thể thực hiện: bạn sẽ mất quyền quản lý người dùng của chính mình.',
  // Import rows
  DUPLICATE_IN_FILE: 'Giá trị này lặp lại trong file.',
  DATE_INVALID: 'Ngày không hợp lệ.',
  UNIT_UNKNOWN: 'Không có đơn vị với mã này.',
  POSITION_UNKNOWN: 'Không có chức danh với mã này.',
  EMPLOYEE_LEFT_IMPORT: 'Nhân viên này đã nghỉ việc; không cập nhật được qua file nhập.',
  MANAGER_UNKNOWN: 'Không có nhân viên với mã này, trong công ty hay trong file.',
};

/** The sentence for an issue; an unknown detail falls back to its catalogue title (never blank). */
export function orgIssueText(issue: Pick<RuleIssue, 'code' | 'detail' | 'data'>): string {
  const copy = issue.detail ? ORG_ISSUE_COPY[issue.detail] : undefined;
  if (copy === undefined) return ERROR_CATALOG[issue.code].title;
  return typeof copy === 'function' ? copy(issue.data ?? {}) : copy;
}

/** The first sentence per field (`RuleIssue.ref`) — what a form puts under each control. */
export function fieldIssues(issues: readonly RuleIssue[]): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const issue of issues) if (issue.ref !== null && out[issue.ref] === undefined) out[issue.ref] = orgIssueText(issue);
  return out;
}

/** The sentences of issues that name no field of the form — shown above its actions. */
export function otherIssues(issues: readonly RuleIssue[], fields: readonly string[]): string[] {
  return [...new Set(issues.filter((i) => i.ref === null || !fields.includes(i.ref)).map(orgIssueText))];
}
