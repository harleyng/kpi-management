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
  | 'ERR-KPI-06'
  | 'ERR-KPI-07'
  | 'ERR-KPI-08'
  | 'ERR-KPI-09'
  | 'ERR-KPI-10'
  | 'ERR-KPI-11'
  | 'ERR-KPI-12'
  | 'ERR-KPI-13';

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
      'A write is not allowed in the record\'s current state (e.g. editing a locked Goal Plan, entering an actual into a locked period, changing a Final or Locked result, acting on a step that has already moved on)',
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
  // ERR-KPI-07…13 are raised by the Phase 1.5 rules (`src/lib/*Rules.ts`) as `RuleIssue`s. Numbers the
  // screen shows beside the copy ("hiện tại 90%") travel in `RuleIssue.data`, never in a retyped string.
  'ERR-KPI-07': {
    code: 'ERR-KPI-07',
    trigger: 'The active goals\' weights do not sum to 100% within ±0.01 (goalPlanRules, formRules) — BR-KPI-04',
    surface: 'inline',
    title: 'Tổng trọng số chưa đạt 100%',
    message: 'Hãy điều chỉnh trọng số các chỉ tiêu để tổng bằng 100% trước khi gửi.',
    action: null,
  },
  'ERR-KPI-08': {
    code: 'ERR-KPI-08',
    trigger: 'A Goal Plan has fewer than 5 or more than 8 active goals (goalPlanRules) — BR-KPI-03',
    surface: 'inline',
    title: 'Số chỉ tiêu phải từ 5 đến 8',
    message: 'Hãy thêm hoặc bớt chỉ tiêu cho đúng số lượng trước khi gửi.',
    action: null,
  },
  'ERR-KPI-09': {
    code: 'ERR-KPI-09',
    trigger: 'An evaluation item lacks the current step\'s score, or its comment when the step requires one (formRules) — BR-KPI-18',
    surface: 'inline',
    title: 'Còn chỉ tiêu chưa chấm điểm hoặc chưa nhận xét',
    message: 'Hãy chấm điểm (và nhận xét, nếu bắt buộc) cho mọi chỉ tiêu được đánh dấu.',
    action: null,
  },
  'ERR-KPI-10': {
    code: 'ERR-KPI-10',
    trigger: 'A cascade/link would make a goal its own ancestor (alignmentRules) — BR-KPI-07',
    surface: 'inline',
    title: 'Liên kết này tạo vòng lặp giữa các chỉ tiêu',
    message: 'Một chỉ tiêu không thể vừa là cấp trên vừa là cấp dưới của chính nó. Hãy chọn chỉ tiêu khác.',
    action: null,
  },
  'ERR-KPI-11': {
    code: 'ERR-KPI-11',
    trigger: 'The values cascaded from a goal (plus its self-assigned share) exceed its target (alignmentRules) — BR-KPI-07',
    surface: 'inline',
    title: 'Phân giao vượt mục tiêu của chỉ tiêu cha',
    message: 'Tổng giá trị đã giao và tự giao không được lớn hơn mục tiêu của chỉ tiêu cha.',
    action: null,
  },
  'ERR-KPI-12': {
    code: 'ERR-KPI-12',
    trigger:
      'An achievement % cannot be computed from the data (RATIO_UP target 0, no tier, no level match, formula ÷0) (calcRules) — BR-KPI-32',
    surface: 'inline',
    title: 'Chưa tính được % hoàn thành',
    message: 'Số liệu hoặc mục tiêu của chỉ tiêu này chưa đủ để tính. Chỉ tiêu được coi là chưa có điểm, không phải 0%.',
    action: null,
  },
  'ERR-KPI-13': {
    code: 'ERR-KPI-13',
    trigger:
      'A scoring configuration is invalid: floor above cap, a ratio method without a cap, overlapping tiers, levels out of order, an unparsable formula, a rating scale with gaps (calcRules, ratingRules) — BR-KPI-31, 41',
    surface: 'inline',
    title: 'Cấu hình tính điểm chưa hợp lệ',
    message: 'Hãy kiểm tra lại các mục được đánh dấu.',
    action: null,
  },
};

/**
 * The detail codes Track T4 raises (actual entry, imports, the API sync). A `RuleIssue.detail`, an
 * `ImportRowError.detail` and a sync-run log line carry the CODE; the screen renders the sentence
 * below with `issueText` — the copy lives here, never in a rule, the mock or a screen (rule 6).
 */
export const ISSUE_DETAILS = [
  // actualRules.actualIssues (BR-KPI-52)
  'PLAN_NOT_APPROVED', 'PERIOD_LOCKED', 'RESULT_FINAL', 'GOAL_NOT_ACTIVE', 'PERIOD_NOT_IN_CYCLE',
  'PERIOD_NOT_MONTH', 'PERIOD_NOT_STARTED', 'ACTUAL_REQUIRED', 'ACTUAL_TYPE_MISMATCH',
  // importRules — reading the file (BR-KPI-53)
  'FILE_EMPTY', 'FILE_TOO_LARGE', 'FILE_UNREADABLE', 'HEADER_MISSING', 'HEADER_DUPLICATE',
  'CELL_REQUIRED', 'CELL_NOT_NUMBER', 'CELL_NOT_DATE',
  // actualImportRules — one actuals row (BR-KPI-53)
  'GOAL_KEY_REQUIRED', 'GOAL_NOT_FOUND', 'GOAL_NOT_IN_CYCLE', 'USER_NOT_FOUND', 'KPI_NOT_FOUND',
  'GOAL_AMBIGUOUS', 'GOAL_KEY_CONFLICT', 'PERIOD_NOT_FOUND', 'DUPLICATE_ROW', 'EVIDENCE_URL_INVALID',
  // preview warnings — shown, never blocking (BR-KPI-53)
  'OVERWRITES_ACTUAL', 'PERCENT_SUSPECT',
  // the API sync (BR-KPI-56)
  'CONNECTION_INACTIVE', 'NO_MAPPED_GOAL', 'NO_PERIOD_TARGET', 'HUMAN_ACTUAL_KEPT',
  // the data-source catalogue form (WBS 4.4.1)
  'FIELD_REQUIRED', 'SOURCE_CODE_TAKEN',
] as const;
export type IssueDetail = (typeof ISSUE_DETAILS)[number];

export const ISSUE_DETAIL_COPY: Readonly<Record<IssueDetail, string>> = {
  PLAN_NOT_APPROVED: 'Kế hoạch mục tiêu chưa được duyệt hoặc khóa, chưa nhập số được.',
  PERIOD_LOCKED: 'Kỳ đã khóa số liệu.',
  RESULT_FINAL: 'Kết quả của kỳ đã chốt, không nhập thêm số thực tế.',
  GOAL_NOT_ACTIVE: 'Chỉ tiêu đã được điều chỉnh hoặc đã hủy.',
  PERIOD_NOT_IN_CYCLE: 'Kỳ không thuộc chu kỳ của chỉ tiêu.',
  PERIOD_NOT_MONTH: 'Chỉ nhập số theo tháng; quý, nửa năm và năm tự cộng từ các tháng.',
  PERIOD_NOT_STARTED: 'Kỳ chưa bắt đầu.',
  ACTUAL_REQUIRED: 'Thiếu giá trị thực tế.',
  ACTUAL_TYPE_MISMATCH: 'Sai kiểu giá trị: chỉ tiêu dạng số nhận một số, chỉ tiêu dạng chữ nhận chữ (ví dụ Đạt).',
  FILE_EMPTY: 'Tệp không có dòng dữ liệu nào.',
  FILE_TOO_LARGE: 'Tệp có quá nhiều dòng. Hãy chia thành nhiều tệp nhỏ hơn.',
  FILE_UNREADABLE: 'Không đọc được tệp. Hãy dùng tệp .xlsx tạo từ mẫu.',
  HEADER_MISSING: 'Thiếu cột bắt buộc ở dòng tiêu đề.',
  HEADER_DUPLICATE: 'Cột này xuất hiện hai lần ở dòng tiêu đề.',
  CELL_REQUIRED: 'Ô bắt buộc đang để trống.',
  CELL_NOT_NUMBER: 'Không phải số hợp lệ. Viết số không có dấu phân cách hàng nghìn, hoặc dạng 1.234,5.',
  CELL_NOT_DATE: 'Không phải ngày hợp lệ (dd/mm/yyyy).',
  GOAL_KEY_REQUIRED: 'Cần mã chỉ tiêu được giao, hoặc tên đăng nhập cùng mã KPI.',
  GOAL_NOT_FOUND: 'Không tìm thấy chỉ tiêu được giao.',
  GOAL_NOT_IN_CYCLE: 'Chỉ tiêu không thuộc chu kỳ của lô import.',
  USER_NOT_FOUND: 'Không tìm thấy người dùng.',
  KPI_NOT_FOUND: 'Không tìm thấy mã KPI trong thư viện.',
  GOAL_AMBIGUOUS: 'Người này có nhiều chỉ tiêu cùng mã KPI. Hãy ghi mã chỉ tiêu được giao.',
  GOAL_KEY_CONFLICT: 'Mã chỉ tiêu được giao và tên đăng nhập + mã KPI trỏ tới hai chỉ tiêu khác nhau.',
  PERIOD_NOT_FOUND: 'Kỳ không có trong chu kỳ của lô import.',
  DUPLICATE_ROW: 'Chỉ tiêu và kỳ này xuất hiện ở nhiều dòng.',
  EVIDENCE_URL_INVALID: 'Link bằng chứng phải bắt đầu bằng http:// hoặc https://.',
  OVERWRITES_ACTUAL: 'Sẽ thay số thực tế hiện có của chỉ tiêu trong kỳ.',
  PERCENT_SUSPECT: 'Đơn vị là %, giá trị nhỏ hơn 1. Có phải bạn định nhập dạng 85 cho 85%?',
  CONNECTION_INACTIVE: 'Kết nối đang ngừng hoạt động.',
  NO_MAPPED_GOAL: 'Không có chỉ tiêu nào khớp ánh xạ của kết nối trong kỳ này.',
  NO_PERIOD_TARGET: 'Chỉ tiêu không có mục tiêu số cho kỳ, bỏ qua.',
  HUMAN_ACTUAL_KEPT: 'Đã có số nhập tay hoặc Excel, giữ nguyên và bỏ qua.',
  FIELD_REQUIRED: 'Hãy nhập trường này.',
  SOURCE_CODE_TAKEN: 'Mã nguồn này đã có. Hãy dùng mã khác.',
};

const isIssueDetail = (value: string): value is IssueDetail => Object.prototype.hasOwnProperty.call(ISSUE_DETAIL_COPY, value);

/**
 * The sentence for a detail code. A detail that is not a code (an older stored sentence, e.g. the
 * seed's import errors) is shown as it is; no detail falls back to the code's catalogue title.
 */
export function issueText(detail: string | null | undefined, code: ErrorCode = 'ERR-KPI-06'): string {
  if (!detail) return ERROR_CATALOG[code].title;
  return isIssueDetail(detail) ? ISSUE_DETAIL_COPY[detail] : detail;
}

/**
 * One problem a rule found — what every `src/lib/*Rules.ts` check returns instead of throwing.
 * `ref` points at the row it is about (a goal, an evaluation item, a tier, a level) so a screen can
 * mark it inline; `data` carries the numbers shown beside the copy (`{ totalWeight: 90 }`).
 */
export interface RuleIssue {
  code: ErrorCode;
  ref: string | null;
  detail: string | null;
  data: Readonly<Record<string, number | string>> | null;
}

/** Builds a `RuleIssue`; `ref`, `detail` and `data` default to `null`. */
export function ruleIssue(
  code: ErrorCode,
  ref: string | null = null,
  detail: string | null = null,
  data: Readonly<Record<string, number | string>> | null = null,
): RuleIssue {
  return { code, ref, detail, data };
}

/**
 * A coded error. Throw this instead of a bare `Error` so the catch site knows which catalogue
 * entry — and therefore which surface and copy — applies.
 */
export class KpiError extends Error {
  readonly code: ErrorCode;
  /** Extra detail for logs (e.g. which row of an import failed). Not shown in place of the copy. */
  readonly detail?: string;
  /** Every problem a rule found, so a screen can mark each row inline. Empty when not from a rule. */
  readonly issues: readonly RuleIssue[];

  constructor(code: ErrorCode, detail?: string, issues: readonly RuleIssue[] = []) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'KpiError';
    this.code = code;
    this.detail = detail;
    this.issues = issues;
  }
}

/**
 * The one way an adapter turns a rule's issue list into a thrown error: the FIRST issue's code (the
 * rules list the most important problem first), every issue kept on `issues`.
 */
export function toKpiError(issues: readonly RuleIssue[]): KpiError {
  if (issues.length === 0) throw new Error('toKpiError needs at least one issue');
  const [first] = issues;
  return new KpiError(first.code, first.detail ?? undefined, issues);
}

/**
 * A gateway method whose behaviour depends on a rule that is not wired yet (Phase 1.2 → Gate 1).
 * It keeps the read/write split of the generic codes — a read answers ERR-KPI-01, a write
 * ERR-KPI-03 — so a screen shows its usual failure state, but it is never retried: it answers the
 * same way until `owner` lands. The mock lists such methods in `DEFERRED_METHODS`.
 */
export class KpiDeferredError extends KpiError {
  /** `group.method`, e.g. `forms.act`. */
  readonly method: string;
  /** What it waits for, e.g. `Phase 1.5 workflowRules`. */
  readonly owner: string;

  constructor(kind: 'read' | 'write', method: string, owner: string) {
    super(kind === 'read' ? 'ERR-KPI-01' : 'ERR-KPI-03', `${method} requires ${owner}`);
    this.name = 'KpiDeferredError';
    this.method = method;
    this.owner = owner;
  }
}

/**
 * Whether trying the same call again could succeed. Only a failed read/write (ERR-KPI-01, 03) or an
 * uncoded error is transient; "not found", "wrong state", "not entitled" and "invalid input" will
 * answer the same way every time, and retrying them only delays the message the user needs. A
 * deferred method (`KpiDeferredError`) is not transient either.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof KpiDeferredError) return false;
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
