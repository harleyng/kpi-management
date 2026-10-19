import { LIBRARY_STATUS_LABEL, type LibraryStatus } from '@/data/types';
import { KpiError, type RuleIssue } from '@/lib/errorCatalog';
import { formatPercent } from '@/lib/utils';

/**
 * The library screens' inline copy for a rule issue (`libraryRules`, `calcRules.validateCalcMethod`).
 * The issue's catalogue entry (ERR-KPI-xx) is the toast; this is the sentence beside the field —
 * written from the issue's `detail` code and its `data`, so no number is ever retyped.
 */
export function issueMessage(issue: RuleIssue): string {
  const d = issue.data ?? {};
  switch (issue.detail) {
    case 'CODE_REQUIRED':
      return 'Nhập mã.';
    case 'CODE_TAKEN':
      return `Mã ${d.code ?? ''} đã được dùng. Chọn mã khác.`;
    case 'NAME_REQUIRED':
      return 'Nhập tên.';
    case 'SYSTEM_CODE_LOCKED':
      return 'Mã của chỉ tiêu chuẩn không đổi được.';
    case 'PERSPECTIVE_REQUIRED':
      return 'Chọn viễn cảnh BSC.';
    case 'UNIT_REQUIRED':
      return 'Chọn đơn vị đo.';
    case 'METHOD_REQUIRED':
      return 'Chọn phương pháp tính.';
    case 'DATA_SOURCE_REQUIRED':
      return 'Cần nguồn dữ liệu mặc định để áp dụng chỉ tiêu.';
    case 'IN_ACTIVE_TEMPLATE':
      return `Chưa thể đổi trạng thái: chỉ tiêu đang nằm trong bộ mẫu đang áp dụng: ${d.templates ?? ''}. Gỡ khỏi bộ mẫu trước.`;
    case 'PERSPECTIVE_FIXED':
      return 'Bốn viễn cảnh BSC là cố định, không thêm được.';
    case 'CODE_LOCKED':
      return 'Mã viễn cảnh không đổi được.';
    case 'SORT_ORDER_INVALID':
      return 'Thứ tự là số nguyên không âm.';
    case 'UNIT_CODE_IN_USE':
      return 'Đơn vị đã được chỉ tiêu hoặc mục tiêu sử dụng, không đổi mã được. Tên và số chữ số thập phân vẫn sửa được.';
    case 'DECIMALS_INVALID':
      return `Số chữ số thập phân từ 0 đến ${d.max ?? 6}.`;
    case 'METHOD_IN_USE':
      return methodLockedMessage(typeof d.goals === 'number' ? d.goals : null);
    case 'TIERS_NOT_ALLOWED':
      return 'Chỉ phương pháp bậc thang mới có bậc.';
    case 'FORMULA_NOT_ALLOWED':
      return 'Chỉ phương pháp công thức mới có công thức.';
    case 'LEVELS_NO_CAP':
      return 'Định mức L1/L2/L3 không có trần hay sàn: điểm của mức cao nhất là trần.';
    case 'CAP_REQUIRED':
      return 'Phương pháp này cần trần % để chặn điểm khi vượt mục tiêu.';
    case 'CAP_NOT_POSITIVE':
      return 'Trần phải lớn hơn 0.';
    case 'FLOOR_NEGATIVE':
      return 'Sàn không được âm.';
    case 'FLOOR_ABOVE_CAP':
      return 'Sàn không được lớn hơn trần.';
    case 'FORMULA_INVALID':
      return 'Chưa đọc được công thức. Chỉ dùng actual, target, số, + - * /, ngoặc, min( ) và max( ).';
    case 'TIERS_REQUIRED':
      return 'Cần ít nhất một bậc.';
    case 'TIER_EMPTY':
      return '"Từ" phải nhỏ hơn "Đến".';
    case 'TIER_PCT_INVALID':
      return '% hoàn thành phải là số không âm.';
    case 'TIERS_OVERLAP':
      return 'Bậc này chồng lên bậc trước.';
    case 'UNIT_AND_POSITION':
      return 'Bộ mẫu chỉ áp dụng cho một đơn vị hoặc một chức danh, không cả hai.';
    case 'DUPLICATE_KPI':
      return 'Chỉ tiêu này đã có trong bộ mẫu.';
    case 'WEIGHT_INVALID':
      return 'Trọng số là số không âm.';
    case 'TARGET_INVALID':
      return 'Mục tiêu mặc định phải là số.';
    case 'KPI_NOT_ACTIVE':
      return `Chỉ tiêu đang ở trạng thái ${statusWord(d.status)}, không thêm vào bộ mẫu được.`;
    case 'INACTIVE_KPI':
      return `Chỉ tiêu này đang ở trạng thái ${statusWord(d.status)}. Hãy thay bằng chỉ tiêu đang áp dụng.`;
    default:
      return 'Giá trị chưa hợp lệ.';
  }
}

function statusWord(status: unknown): string {
  return typeof status === 'string' && status in LIBRARY_STATUS_LABEL ? LIBRARY_STATUS_LABEL[status as LibraryStatus] : 'không áp dụng';
}

export function methodLockedMessage(goals: number | null): string {
  const who = goals === null ? 'đang được mục tiêu sử dụng' : `đang dùng cho ${goals} mục tiêu`;
  return `Phương pháp ${who} nên loại, trần, sàn, công thức và bậc không sửa được. Tạo phương pháp mới để thay đổi cách tính.`;
}

/** How far a template's weight total is from 100% (`ASSUMPTION Q26`): a warning, never a block. */
export function weightGapMessage(total: number): string {
  const diff = total - 100;
  return diff < 0 ? `Thiếu ${formatPercent(-diff)} so với 100%.` : `Vượt ${formatPercent(diff)} so với 100%.`;
}

/**
 * A refused save's issues by the field they name. Issues that name no field of the form (a tier's
 * id, a whole-row problem) gather under `_form`. Several issues on one field: the first wins.
 */
export function fieldErrors(error: unknown, fields: readonly string[]): Record<string, string> {
  if (!(error instanceof KpiError)) return {};
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.ref !== null && fields.includes(issue.ref) ? issue.ref : '_form';
    out[key] ??= issueMessage(issue);
  }
  return out;
}

/**
 * A number typed in a Vietnamese form: "12,5" and "12.5" both read 12.5; blank is `null`; anything
 * else is `NaN`, which the rules refuse — never silently 0.
 */
export function parseNumberInput(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export const numberText = (value: number | null): string => (value === null ? '' : String(value).replace('.', ','));
