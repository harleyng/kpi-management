import { ERROR_CATALOG, type RuleIssue } from '@/lib/errorCatalog';
import type { PlanEditReason } from '@/lib/planAccessRules';
import type { TemplateSkipReason } from '@/lib/templateApplyRules';
import { OWNER_TYPE_LABEL, type Goal, type GoalPlan, type MeasureUnit } from '@/data/types';
import type { GoalLookups } from '@/hooks/queries/goals';
import { formatNumber } from '@/lib/utils';

/**
 * The words the Goal Plan screens use for the rules' answers. The catalogue (`errorCatalog.ts`) owns
 * every error TITLE; this file only adds the specific "why" a rule's `detail` / `reason` carries, so
 * a person reads what to do — not a code.
 */

/** One line under the plan header saying why the plan is read-only (or nothing when editable). */
export const EDIT_REASON_COPY: Readonly<Record<PlanEditReason, string | null>> = {
  EDITABLE: null,
  UNKNOWN: 'Chưa xác định được quyền chỉnh sửa (dữ liệu chưa tải xong). Goal Plan đang ở chế độ chỉ xem.',
  LOCKED: 'Goal Plan đã khóa. Muốn thay đổi chỉ tiêu, cần phiếu điều chỉnh KPI hoặc HR mở khóa.',
  CYCLE_CLOSED: 'Chu kỳ đã đóng. Goal Plan chỉ còn để xem.',
  STEP_NO_EDIT: 'Bước hiện tại của phiếu đăng ký không cho phép chỉnh sửa Goal Plan.',
  NOT_STEP_ACTOR: 'Phiếu đăng ký đang ở bước của người khác. Bạn chỉ xem được Goal Plan lúc này.',
  DELEGATION_EXPIRED: 'Ủy quyền của bạn cho bước này đã hết hạn.',
  SELF_APPROVAL: 'Bạn không xử lý bước duyệt trên Goal Plan của chính mình.',
  NOT_OWNER: 'Chỉ chủ Goal Plan hoặc HR được sửa Goal Plan khi chưa khởi chạy phiếu đăng ký.',
  ADMIN_ONLY: 'Goal Plan đã gửi hoặc đã duyệt. Chỉ HR được sửa trực tiếp.',
  NO_PERMISSION: 'Bạn không có quyền sửa Goal Plan này.',
};

/** Extra words for an issue `detail` (the catalogue title is shown beside it). */
const DETAIL_COPY: Readonly<Record<string, string>> = {
  KGI_COUNT: 'Goal Plan nên có 3–5 KGI.',
  NAME_REQUIRED: 'Chưa có tên chỉ tiêu.',
  WEIGHT_INVALID: 'Trọng số phải lớn hơn 0.',
  DATA_SOURCE_REQUIRED: 'Chưa chọn nguồn số liệu (KPI phải đo được).',
  TARGET_REQUIRED: 'Chưa có mục tiêu.',
  DATES_INVALID: 'Ngày kết thúc trước ngày bắt đầu.',
  SPLIT_MISMATCH: 'Phân bổ theo kỳ không khớp mục tiêu.',
  SPLIT_INCOMPLETE: 'Phân bổ theo kỳ còn thiếu kỳ — kỳ thiếu sẽ dùng mục tiêu cả năm khi tính quý/năm.',
  SPLIT_MIXED_TYPES: 'Phân bổ lẫn kỳ tháng và kỳ quý.',
  SPLIT_NO_AGGREGATION: 'KPI không thuộc thư viện — phân bổ chỉ áp dụng theo tháng.',
  LEVELS_MISSING: 'Phương pháp định mức cần ít nhất 2 mức L1/L2/L3.',
  TARGET_TYPE_MISMATCH: 'Mục tiêu dạng chữ nhưng phương pháp tính chỉ tính được số.',
  SELF_ASSIGNED_INVALID: '"Tự giao" phải là số không âm.',
  PARENT_NOT_NUMERIC: 'Chỉ phân giao được chỉ tiêu có mục tiêu dạng số.',
  ALLOCATION_REQUIRED: 'Nhập phần giao lớn hơn 0.',
  CALC_METHOD_REQUIRED: 'Chọn phương pháp tính cho phần giao (định mức, bậc thang, công thức của chỉ tiêu cha không áp dụng cho một phần).',
  CONTRIBUTION_INVALID: 'Tỉ lệ đóng góp phải trong khoảng 0–100%.',
  REASON_REQUIRED: 'Nhập lý do.',
  DUE_DATE_INVALID: 'Hạn mới không được trước hôm nay.',
  NOT_LOCKED: 'Goal Plan không còn ở trạng thái khóa.',
  CYCLE_NOT_WHOLE_MONTHS: 'Chu kỳ phải bắt đầu ngày 1 và kết thúc ngày cuối tháng để tạo kỳ tự động.',
  CYCLE_TOO_LONG: 'Chu kỳ dài quá 12 tháng — không tạo kỳ tự động được.',
  DEADLINE_DAYS_INVALID: 'Số ngày đến hạn phải là số nguyên không âm.',
  PERIODS_REQUIRED: 'Chu kỳ cần ít nhất một kỳ hợp lệ trước khi bắt đầu.',
  STATUS_STEP_INVALID: 'Chu kỳ chỉ chuyển tới bước kế tiếp.',
};

/** "Tổng trọng số chưa đạt 100% — hiện 92,5%" etc.: the catalogue title, then what the data says. */
export function issueText(issue: RuleIssue): string {
  const title = ERROR_CATALOG[issue.code].title;
  const data = issue.data ?? {};
  switch (issue.code) {
    case 'ERR-KPI-07':
      return `${title} — hiện ${formatNumber(Number(data.totalWeight), 2)}%.`;
    case 'ERR-KPI-08':
      return `${title} — hiện có ${data.count} chỉ tiêu.`;
    case 'ERR-KPI-11':
      return `${title} — mục tiêu ${formatNumber(Number(data.target))}, đã giao ${formatNumber(Number(data.assigned))}, tự giao ${formatNumber(Number(data.selfAssigned))}.`;
    default:
      break;
  }
  if (issue.detail === 'SPLIT_MISMATCH') {
    return `${DETAIL_COPY.SPLIT_MISMATCH} Mục tiêu ${formatNumber(Number(data.expected))}, theo kỳ ${formatNumber(Number(data.actual))}.`;
  }
  if (issue.detail === 'SPLIT_INCOMPLETE') return `${DETAIL_COPY.SPLIT_INCOMPLETE} (${data.covered}/${data.total} kỳ)`;
  if (issue.detail === 'KGI_COUNT') return `${DETAIL_COPY.KGI_COUNT} Hiện có ${data.count}.`;
  return (issue.detail && DETAIL_COPY[issue.detail]) || title;
}

/** The first issue of a list as one sentence — for a field or a dialog. */
export const firstIssueText = (issues: readonly RuleIssue[] | undefined): string | undefined => (issues && issues.length ? issueText(issues[0]) : undefined);

/** A goal's target as the table shows it: "9,6 tỷ đ", "95 %", "Đạt". */
export function formatTarget(goal: Pick<Goal, 'targetType' | 'targetValue' | 'targetText'>, unit: Pick<MeasureUnit, 'name' | 'decimals'> | undefined): string {
  if (goal.targetType === 'TEXT') return goal.targetText?.trim() || '—';
  if (goal.targetValue === null) return '—';
  return `${formatNumber(goal.targetValue, unit?.decimals ?? 2)}${unit ? ` ${unit.name}` : ''}`;
}

/** A weight in percent units with two decimals ("92,5%", "99,99%") — never rounded to look complete. */
export const formatWeight = (value: number) => `${formatNumber(value, 2)}%`;

/** The plan's owner as one line: "Nguyễn Văn An", "Phòng Kinh doanh", "Công ty". */
export function planOwnerName(plan: Pick<GoalPlan, 'ownerType' | 'ownerEmployeeId' | 'ownerOrgUnitId'>, lookups: GoalLookups): string {
  if (plan.ownerType === 'Employee') return lookups.employee.get(plan.ownerEmployeeId ?? '')?.fullName ?? '—';
  const unit = lookups.orgUnit.get(plan.ownerOrgUnitId ?? '');
  return plan.ownerType === 'Company' ? `${OWNER_TYPE_LABEL.Company}${unit ? ` · ${unit.name}` : ''}` : (unit?.name ?? '—');
}

/** Why a template item is not added — short, shown in the preview's last column. */
export const TEMPLATE_SKIP_COPY: Readonly<Record<TemplateSkipReason, string>> = {
  ALREADY_IN_PLAN: 'Đã có trong Goal Plan',
  KPI_NOT_ACTIVE: 'Chỉ tiêu không còn áp dụng',
  NO_DATA_SOURCE: 'Chưa có nguồn số liệu',
};
