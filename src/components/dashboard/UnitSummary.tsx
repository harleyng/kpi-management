import { ChevronRight } from 'lucide-react';
import { MissingValue } from '@/components/shared/DataTable';
import { PeriodResultStatusBadge } from '@/components/shared/StatusBadge';
import type { Id } from '@/data/types';
import type { DashboardModel, UnitNode } from '@/lib/dashboardRules';
import { unitPath } from '@/lib/dashboardRules';
import { formatNumber } from '@/lib/utils';
import { RatingValue } from '@/components/results/ResultCells';
import { DeltaValue, Figure } from './DashboardFigures';

/**
 * "Đường dẫn" — the units from the viewer's highest visible unit down to the one in focus. A manager's
 * path starts at their own unit: there is no dead "Công ty" link above it.
 */
export function UnitBreadcrumb({ model, focusId, onSelect }: { model: DashboardModel; focusId: Id; onSelect: (unitId: Id) => void }) {
  const path = unitPath(model, focusId);
  return (
    <nav aria-label="Đường dẫn">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {path.map((node, index) => {
          const last = index === path.length - 1;
          return (
            <li key={node.unit.id} className="flex items-center gap-1">
              {last ? (
                <span aria-current="page" className="font-medium">
                  {node.unit.name}
                </span>
              ) : (
                <button type="button" className="text-primary hover:underline focus-visible:underline focus-visible:outline-none" onClick={() => onSelect(node.unit.id)}>
                  {node.unit.name}
                </button>
              )}
              {!last && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The figures of the unit in focus, as a plain definition strip. */
export function UnitSummary({ node, previousLabel }: { node: UnitNode; previousLabel: string | null }) {
  const { own } = node;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border bg-card px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
      <Figure
        term="Điểm đơn vị"
        note={node.ownPlan === null ? 'Chưa có kế hoạch riêng' : own === null ? 'Chưa có kết quả kỳ này' : own.status === 'Draft' ? 'Chưa chốt — chưa vào thống kê chính thức' : null}
      >
        <span className="flex flex-wrap items-center gap-2">
          {own?.totalScore != null ? <span className={own.status === 'Draft' ? 'tabular text-muted-foreground' : 'tabular'}>{formatNumber(own.totalScore, 2)}</span> : <MissingValue />}
          {own && <PeriodResultStatusBadge status={own.status} />}
        </span>
      </Figure>
      <Figure term="Xếp loại" note={node.ownLevel?.label !== node.ownLevel?.code ? node.ownLevel?.label : null}>
        {own ? <RatingValue result={own} level={node.ownLevel} /> : <MissingValue />}
      </Figure>
      <Figure term={previousLabel ? `Chênh lệch so với ${previousLabel} (điểm)` : 'Chênh lệch so với kỳ trước (điểm)'}>
        <span className="flex justify-start [&>span]:items-start">
          <DeltaValue delta={node.delta} hasPrevious={previousLabel !== null} />
        </span>
      </Figure>
      <Figure term="Nhân viên có kết quả" note="Đã chốt / làm việc trong kỳ">
        <span className="tabular">
          {node.staffCounted}/{node.staffTotal}
        </span>
      </Figure>
      <Figure term="Điểm trung bình nhân viên" note="Không trọng số, chỉ kết quả đã chốt (giả định Q40)">
        {node.staffAverage === null ? <MissingValue /> : <span className="tabular">{formatNumber(node.staffAverage, 2)}</span>}
      </Figure>
    </dl>
  );
}
