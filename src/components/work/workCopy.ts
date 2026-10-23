import type { CyclePeriod, WorkPlan } from '@/data/types';
import { issueText, type RuleIssue } from '@/lib/errorCatalog';
import { formatDate, formatPercent } from '@/lib/utils';

/**
 * The sentences around the monthly work rules (PEND-14). Rule refusals keep the catalogue's words
 * (`issueText`); this file only places them and names the month and the people.
 */

/** "04/2027" — the month as the CMC form prints it. */
export function monthText(period: Pick<CyclePeriod, 'startDate'> | null | undefined): string {
  if (!period) return '—';
  const [y, m] = period.startDate.split('-');
  return `${m}/${y}`;
}

/** What blocks sending or approving, one sentence per problem kind; `verb` = "gửi" / "duyệt". */
export function planBlockerSentences(issues: readonly RuleIssue[], verb: 'gửi' | 'duyệt' = 'gửi'): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    const sentence =
      issue.code === 'ERR-KPI-07' && typeof issue.data?.totalWeight === 'number'
        ? `Tổng trọng số đang là ${formatPercent(issue.data.totalWeight)}. Cần đủ 100% để ${verb}.`
        : issue.detail === 'PLAN_EMPTY'
          ? `Kế hoạch chưa có việc nào. Thêm ít nhất một việc để ${verb}.`
          : issueText(issue.detail, issue.code);
    if (!out.includes(sentence)) out.push(sentence);
  }
  return out;
}

/** The rule refusal of one task edit, in words. */
export const taskIssueText = (issue: RuleIssue) => issueText(issue.detail, issue.code);

export type WorkViewer = 'subject' | 'manager' | 'other';

export interface PlanNoticeInput {
  viewer: WorkViewer;
  plan: Pick<WorkPlan, 'status' | 'approvedAt'>;
  month: string;
  employeeName: string;
  managerName: string;
  approverName: string | null;
  /** The comment of the RETURN that sent the plan back, when it is Returned. */
  returnComment: string | null;
  /** The employee's step was handed on by the scheduler (AUTO_FORWARD), never sent. */
  autoForwarded: boolean;
  /** The current step's deadline, when the form is open. */
  deadline: string | null;
  /** The viewer may edit the list now (the step allows EDIT and they are entitled). */
  canEdit: boolean;
}

/** The one sentence that says whose turn it is on a month's plan (ui-ux, B2). `null` when nothing helps. */
export function planNotice(n: PlanNoticeInput): string | null {
  const due = n.deadline ? ` Hạn: ${formatDate(n.deadline)}.` : '';
  const by = n.approverName && n.approverName !== n.managerName ? `${n.approverName} (thay ${n.managerName})` : n.managerName;
  switch (n.plan.status) {
    case 'Draft':
      if (n.viewer === 'subject')
        return n.canEdit
          ? `Bạn đang lập kế hoạch tháng ${n.month}. Thay đổi được lưu ngay; quản lý chỉ nhận khi bạn bấm Gửi.${due}`
          : `Kế hoạch tháng ${n.month} chưa đến bước của bạn.`;
      if (n.viewer === 'manager')
        return n.canEdit ? `Bạn đang giao việc tháng ${n.month} cho ${n.employeeName}. Thay đổi được lưu ngay.${due}` : `${n.employeeName} đang lập kế hoạch, chưa gửi cho bạn.`;
      return `${n.employeeName} đang lập kế hoạch tháng ${n.month}.`;
    case 'Returned':
      if (n.viewer === 'subject')
        return `${n.managerName} đã trả lại kế hoạch${n.returnComment ? `: "${n.returnComment}"` : ''}. Sửa rồi gửi lại.${due}`;
      return `Kế hoạch đã được trả lại cho ${n.employeeName}${n.returnComment ? `: "${n.returnComment}"` : ''}.`;
    case 'Submitted':
      if (n.viewer === 'manager') {
        const lead = n.autoForwarded ? `${n.employeeName} chưa gửi kế hoạch; hệ thống đã chuyển cho bạn khi quá hạn.` : `${n.employeeName} đã gửi kế hoạch.`;
        return n.canEdit ? `${lead} Bạn có thể sửa trước khi duyệt. Duyệt sẽ khóa kế hoạch.${due}` : lead;
      }
      if (n.viewer === 'subject')
        return n.autoForwarded
          ? `Kế hoạch đã tự chuyển cho ${n.managerName} vì quá hạn. Bạn chưa sửa được cho đến khi quản lý duyệt hoặc trả lại.`
          : `Đã gửi ${n.managerName} duyệt. Bạn chưa sửa được cho đến khi quản lý duyệt hoặc trả lại.`;
      return `Kế hoạch đang chờ ${n.managerName} duyệt.`;
    case 'Locked': {
      const when = n.plan.approvedAt ? ` ngày ${formatDate(n.plan.approvedAt)}` : '';
      if (n.viewer === 'subject') return `${by} đã duyệt và khóa kế hoạch${when}. Bạn cập nhật tiến độ trong tháng; muốn hủy việc, nhờ quản lý.`;
      if (n.viewer === 'manager') return `Đã khóa${when}. Bạn có thể hủy việc kèm lý do và cập nhật tiến độ.`;
      return `Kế hoạch đã được ${by} duyệt và khóa${when}.`;
    }
  }
}

/** The weight-total footnote when a cancelled task changed the shares (ASSUMPTION Q64). */
export const RENORMALISED_NOTE = 'Việc đã hủy không còn trọng số; các việc còn hiệu lực được tính lại theo tỷ lệ cho đủ 100%.';
