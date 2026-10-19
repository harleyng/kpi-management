/**
 * Error catalogue ERR-KPI-xx — every user-facing failure message lives HERE (CLAUDE.md, rule 6).
 *
 * There is no i18n library, so the Vietnamese copy sits in the catalogue itself, next to the
 * structure (where it surfaces, whether it carries an action). Screens never retype a message:
 * they throw or receive a `KpiError` and render `ERROR_CATALOG[error.code]`.
 *
 * Adding a code: append it to `ErrorCode`, give it an entry below with a `trigger` written in
 * English (what makes it happen), then add the case to `errorCatalog.test.ts`.
 */

export type ErrorCode =
  | 'ERR-KPI-01'
  | 'ERR-KPI-02'
  | 'ERR-KPI-03'
  | 'ERR-KPI-04'
  | 'ERR-KPI-05'
  | 'ERR-KPI-06';

/** Where the message surfaces — determines which component renders it. */
export type ErrorSurface = 'toast' | 'banner' | 'inline' | 'empty-state' | 'modal';

export interface ErrorSpec {
  code: ErrorCode;
  /** Trigger condition, kept so the code stays traceable. English, for developers. */
  trigger: string;
  surface: ErrorSurface;
  /** One line saying what went wrong. Vietnamese, shown to the user. */
  title: string;
  /** Why, or what to expect. `null` when the title says everything. */
  message: string | null;
  /** The action button's label, or `null` when there is nothing the user can do. */
  action: string | null;
}

export const ERROR_CATALOG: Record<ErrorCode, ErrorSpec> = {
  'ERR-KPI-01': {
    code: 'ERR-KPI-01',
    trigger: 'A read through the DataGateway failed',
    surface: 'empty-state',
    title: 'Không tải được dữ liệu',
    message: 'Đã có lỗi khi đọc dữ liệu. Dữ liệu cũ không được hiển thị để tránh nhầm lẫn.',
    action: 'Thử lại',
  },
  // ERR-KPI-02…06 are the generic failures the DataGateway contract names (Phase 1.1). Rule-specific
  // codes (weights ≠ 100%, an unscored item…) are added beside the rule that raises them (Phase 1.5).
  'ERR-KPI-02': {
    code: 'ERR-KPI-02',
    trigger:
      'A get/update named an id that does not exist in the caller\'s tenant (an id from another tenant answers the same way)',
    surface: 'empty-state',
    title: 'Không tìm thấy dữ liệu',
    message: 'Bản ghi không tồn tại hoặc đã bị xóa.',
    action: null,
  },
  'ERR-KPI-03': {
    code: 'ERR-KPI-03',
    trigger: 'A write through the DataGateway failed for a reason the caller cannot fix (storage, network)',
    surface: 'toast',
    title: 'Không lưu được thay đổi',
    message: 'Thay đổi chưa được lưu. Hãy thử lại.',
    action: 'Thử lại',
  },
  'ERR-KPI-04': {
    code: 'ERR-KPI-04',
    trigger:
      'A write is not allowed in the record\'s current state (e.g. editing a locked Goal Plan, acting on a step that has already moved on)',
    surface: 'toast',
    title: 'Thao tác không còn hợp lệ',
    message: 'Trạng thái đã thay đổi, có thể do người khác vừa xử lý. Hãy tải lại để xem trạng thái mới nhất.',
    action: 'Tải lại',
  },
  'ERR-KPI-05': {
    code: 'ERR-KPI-05',
    trigger: 'The actor is not entitled to the action (not the step\'s actor, no valid delegation, no permission)',
    surface: 'toast',
    title: 'Bạn không có quyền thực hiện thao tác này',
    message: null,
    action: null,
  },
  'ERR-KPI-06': {
    code: 'ERR-KPI-06',
    trigger: 'The input is invalid (a required field missing, a reference that does not resolve, a duplicate)',
    surface: 'inline',
    title: 'Dữ liệu chưa hợp lệ',
    message: 'Hãy kiểm tra lại các trường được đánh dấu.',
    action: null,
  },
};

/**
 * A coded error. Throw this instead of a bare `Error` so the catch site knows which catalogue
 * entry — and therefore which surface and copy — applies.
 */
export class KpiError extends Error {
  readonly code: ErrorCode;
  /** Extra detail for logs (e.g. which row of an import failed). Not shown in place of the copy. */
  readonly detail?: string;

  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'KpiError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Whether trying the same call again could succeed. Only a failed read/write (ERR-KPI-01, 03) or an
 * uncoded error is transient; "not found", "wrong state", "not entitled" and "invalid input" will
 * answer the same way every time, and retrying them only delays the message the user needs.
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof KpiError)) return true;
  return error.code === 'ERR-KPI-01' || error.code === 'ERR-KPI-03';
}

/**
 * The catalogue entry for any thrown value — unknown errors fall back to ERR-KPI-01. The entry's
 * `surface` is where a READ shows it; a failed write always shows as a toast with the same copy.
 */
export function errorSpecOf(error: unknown): ErrorSpec {
  if (error instanceof KpiError) return ERROR_CATALOG[error.code];
  return ERROR_CATALOG['ERR-KPI-01'];
}
