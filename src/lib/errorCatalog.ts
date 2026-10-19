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

export type ErrorCode = 'ERR-KPI-01';

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

/** The catalogue entry for any thrown value — unknown errors fall back to ERR-KPI-01. */
export function errorSpecOf(error: unknown): ErrorSpec {
  if (error instanceof KpiError) return ERROR_CATALOG[error.code];
  return ERROR_CATALOG['ERR-KPI-01'];
}
