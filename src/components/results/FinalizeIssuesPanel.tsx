import { useMemo } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Id } from '@/data/types';
import { useGoalRows } from '@/hooks/queries/goals';
import { ERROR_CATALOG, type RuleIssue } from '@/lib/errorCatalog';
import type { ResultRow } from '@/lib/resultView';
import { formatNumber } from '@/lib/utils';

interface FinalizeIssuesPanelProps {
  issues: readonly RuleIssue[];
  rows: readonly ResultRow[];
  onShow: (resultId: Id) => void;
  onDismiss: () => void;
}

/**
 * What blocked a finalise (all-or-none, BR-KPI-43): every issue of every result, grouped by result,
 * in plain words. Stays until the next attempt, a period change or "Đóng". `role="alert"` announces it.
 */
export function FinalizeIssuesPanel({ issues, rows, onShow, onDismiss }: FinalizeIssuesPanelProps) {
  const byResult = useMemo(() => {
    const groups = new Map<Id, RuleIssue[]>();
    for (const issue of issues) {
      const resultId = issue.data?.resultId;
      if (typeof resultId !== 'string') continue;
      groups.set(resultId, [...(groups.get(resultId) ?? []), issue]);
    }
    return groups;
  }, [issues]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.result.id, r])), [rows]);
  const planIds = useMemo(
    () => [...new Set([...byResult.keys()].map((id) => rowById.get(id)?.result.goalPlanId).filter((id): id is Id => id !== undefined))].sort(),
    [byResult, rowById],
  );
  const goals = useGoalRows({ goalPlanIds: planIds }, { enabled: planIds.length > 0 });
  const goalName = (goalId: string | null) => (goalId ? goals.data?.find((g) => g.id === goalId)?.name : undefined);

  const describe = (issue: RuleIssue): string => {
    const name = goalName(issue.ref);
    const goal = name ? `Chỉ tiêu "${name}"` : 'Một chỉ tiêu';
    switch (issue.code) {
      case 'ERR-KPI-07':
        return typeof issue.data?.totalWeight === 'number' ? `Tổng trọng số là ${formatNumber(issue.data.totalWeight, 2)}%, cần 100%.` : ERROR_CATALOG['ERR-KPI-07'].title;
      case 'ERR-KPI-09':
        return issue.detail === 'NO_GOALS' ? 'Kế hoạch không có chỉ tiêu nào đang áp dụng.' : `${goal} chưa có điểm.`;
      case 'ERR-KPI-12':
        return `${goal}: ${ERROR_CATALOG['ERR-KPI-12'].title.toLowerCase()}.`;
      case 'ERR-KPI-04':
        return issue.detail === 'NOT_ELIGIBLE' ? 'Goal Plan không còn ở trạng thái Đã duyệt hoặc Đã khóa.' : ERROR_CATALOG['ERR-KPI-04'].title;
      default:
        return ERROR_CATALOG[issue.code].title;
    }
  };

  const count = byResult.size;
  return (
    <section role="alert" aria-labelledby="finalize-issues-title" className="rounded-lg border border-support-negative/40 bg-support-negative-subtle px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-support-negative" aria-hidden />
          <div>
            <h2 id="finalize-issues-title" className="text-sm font-semibold">
              Không chốt được: {count} kết quả còn vướng. Chưa có kết quả nào được chốt.
            </h2>
            <p className="text-xs text-muted-foreground">Sửa các chỗ vướng dưới đây (hoặc bỏ chọn các kết quả này) rồi chốt lại.</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDismiss} aria-label="Đóng danh sách vướng">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ul className="mt-2 space-y-2">
        {[...byResult].map(([resultId, list]) => {
          const row = rowById.get(resultId);
          const owner = row?.ownerName ?? 'Kết quả không còn trong kỳ';
          return (
            <li key={resultId} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-background px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{owner}</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {list.map((issue, i) => (
                    <li key={i}>{describe(issue)}</li>
                  ))}
                </ul>
              </div>
              {row && (
                <Button variant="outline" size="sm" onClick={() => onShow(resultId)} aria-label={`Xem ${owner}`}>
                  Xem
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
