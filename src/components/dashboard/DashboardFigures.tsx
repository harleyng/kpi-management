import type { ReactNode } from 'react';
import { MissingValue } from '@/components/shared/DataTable';
import type { ScoreDelta } from '@/lib/dashboardRules';
import { formatPoints } from '@/lib/resultView';
import { cn, formatNumber } from '@/lib/utils';

/**
 * The dashboard's own figure cells (the result cells — score, rating, payout — are T6's
 * `ResultCells`). A missing figure always says why in words, never a bare dash alone.
 */

/** "Chênh lệch so với kỳ trước (điểm)": signed points, "(tạm tính)" when a Draft is on either side. */
export function DeltaValue({ delta, hasPrevious }: { delta: ScoreDelta; hasPrevious: boolean }) {
  if (delta.points === null) {
    return (
      <span className="flex flex-col items-end">
        <MissingValue />
        <span className="text-xs text-muted-foreground">{hasPrevious ? 'Thiếu điểm để so sánh' : 'Chưa có kỳ trước'}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end">
      <span className={cn('tabular', delta.provisional && 'text-muted-foreground')}>{formatPoints(delta.points)}</span>
      {delta.provisional && <span className="text-xs text-muted-foreground">(tạm tính)</span>}
    </span>
  );
}

/** "Điểm trung bình nhân viên (không trọng số)" with its basis (n / m) — never 0 when nobody counts. */
export function StaffAverageValue({ average, counted, total }: { average: number | null; counted: number; total: number }) {
  return (
    <span className="flex flex-col items-end">
      {average === null ? <MissingValue /> : <span className="tabular">{formatNumber(average, 2)}</span>}
      <span className="text-xs text-muted-foreground">
        {total === 0 ? 'Không có nhân viên' : `${counted}/${total} người đã chốt`}
      </span>
    </span>
  );
}

/** One term / value pair of a summary strip — label above value, no card chrome. */
export function Figure({ term, children, note }: { term: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-base font-semibold">{children}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}
