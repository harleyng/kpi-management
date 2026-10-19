import { FORM_TYPE_LABEL, type FormInstance, type MeasureUnit } from '@/data/types';
import { ERROR_CATALOG, type ErrorCode, type RuleIssue } from '@/lib/errorCatalog';
import type { FormStanding } from '@/lib/formViewRules';
import { formatNumber, formatPercent } from '@/lib/utils';
import type { FormLookups } from './useFormLookups';

/**
 * The words the forms screens put around the rules' answers. Error and blocker copy comes from the
 * catalogue (`ERROR_CATALOG[code].title`); only the numbers the rule carries in `RuleIssue.data` are
 * added beside it — never a retyped message (CLAUDE.md rule 6).
 */

/** "Đánh giá KPI — Nguyễn Văn An". */
export function formTitle(form: Pick<FormInstance, 'formType' | 'subjectEmployeeId'>, lookups: Pick<FormLookups, 'employeeName'>): string {
  return `${FORM_TYPE_LABEL[form.formType]} — ${lookups.employeeName(form.subjectEmployeeId)}`;
}

/** "Kỳ T03, KPI 2027" for an evaluation; the cycle for a plan's forms. */
export function formPeriodText(form: Pick<FormInstance, 'periodId'>, cycleName: string | null, lookups: Pick<FormLookups, 'period' | 'cycle'>): string | null {
  const period = lookups.period(form.periodId);
  if (period) return `Kỳ ${period.label}, ${lookups.cycle(period.cycleId)?.name ?? ''}`.replace(/, $/, '');
  return cycleName;
}

/** One sentence per kind of blocker, from the catalogue, with the rule's own numbers. */
export function blockerSentences(issues: readonly RuleIssue[]): string[] {
  const byCode = new Map<ErrorCode, RuleIssue[]>();
  for (const issue of issues) byCode.set(issue.code, [...(byCode.get(issue.code) ?? []), issue]);
  return [...byCode.entries()].map(([code, list]) => {
    const { title } = ERROR_CATALOG[code];
    const data = list[0].data;
    if (code === 'ERR-KPI-07' && typeof data?.totalWeight === 'number') return `${title} (hiện ${formatPercent(data.totalWeight)}).`;
    if (code === 'ERR-KPI-08' && typeof data?.count === 'number') return `${title} (hiện có ${data.count}).`;
    const rows = list.filter((i) => i.ref !== null).length;
    return rows > 0 ? `${title} (${rows} chỉ tiêu).` : `${title}.`;
  });
}

/** Why the user has no step action now, in plain words. `null` when they have one. */
export function readOnlySentence(form: FormInstance, standing: FormStanding, lookups: Pick<FormLookups, 'userName'>): string | null {
  switch (standing.readOnlyReason) {
    case null:
      return null;
    case 'CLOSED':
      return form.status === 'Cancelled' ? 'Phiếu đã bị hủy.' : 'Phiếu đã hoàn thành. Bạn chỉ xem được.';
    case 'LOADING':
      return 'Đang tải Goal Plan của phiếu…';
    case 'OWN_REVIEW':
      return 'Bước này do người khác xử lý: không ai tự duyệt phiếu của chính mình. Bạn chỉ xem được.';
    case 'FROZEN':
      return 'Phiếu đang bị khóa: bước đã quá hạn hoặc Goal Plan đã bị khóa. HR cần mở khóa Goal Plan với hạn mới.';
    case 'NOT_YOUR_STEP': {
      const names = standing.assignees.map((id) => lookups.userName(id));
      return names.length > 0
        ? `Phiếu đang ở bước của ${names.join(', ')}. Bạn chỉ xem được.`
        : 'Bước này chưa có người xử lý. HR có thể thao tác thay.';
    }
  }
}

/** Who the user is acting as, when it is not simply themself. */
export function actingAsSentence(standing: FormStanding, lookups: Pick<FormLookups, 'userName'>): string | null {
  const behalf = standing.standing?.onBehalfOfUserId ?? null;
  if (standing.mode === 'DELEGATE' && behalf) return `Bạn đang xử lý thay ${lookups.userName(behalf)} theo ủy quyền.`;
  if (standing.mode === 'PROXY') {
    return behalf
      ? `Bạn đang thao tác thay ${lookups.userName(behalf)} với quyền HR. Lịch sử ghi nhận cả hai người.`
      : 'Bước này chưa có người xử lý. Bạn thao tác thay với quyền HR.';
  }
  return null;
}

/** A value in its unit — "13.400.000.000 VNĐ", "85,5 %"; `—` for a missing value, a real 0 for zero. */
export function formatInUnit(value: number | null, unit: MeasureUnit | undefined): string | null {
  if (value === null) return null;
  return unit ? `${formatNumber(value, unit.decimals)} ${unit.name}` : formatNumber(value);
}

/**
 * "Trả lại" just happened and the form now waits on this user: who sent it back and why — the reason
 * the RETURN required (BR-KPI-23), shown where the fixing happens, not only in the history.
 */
export function returnedSentence(
  history: readonly { action: string; comment: string | null; actorUserId: string | null }[] | undefined,
  standing: FormStanding,
  lookups: Pick<FormLookups, 'userName'>,
): string | null {
  const last = history?.[history.length - 1];
  if (!last || last.action !== 'RETURN' || standing.readOnlyReason !== null) return null;
  return `Phiếu được ${lookups.userName(last.actorUserId)} trả lại${last.comment ? `: "${last.comment}"` : '.'}`;
}
