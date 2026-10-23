import type { PeriodResult, RatingLevel } from '@/data/types';
import { formatPoints, type PayoutState } from '@/lib/resultView';
import { cn, formatNumber } from '@/lib/utils';
import { MissingValue } from '@/components/shared/DataTable';

/**
 * The cells the result screens share. Every value is the STORED one; a missing value says why in
 * visible text (never a tooltip alone, never a bare glyph).
 */

/** A score to 2 decimals; a Draft's (unrounded, provisional) in muted text — its badge says "Tạm tính". */
export function ScoreValue({ result }: { result: Pick<PeriodResult, 'totalScore' | 'status'> }) {
  if (result.totalScore === null) return <MissingValue />;
  return (
    <span className={cn('tabular', result.status === 'Draft' && 'text-muted-foreground')}>
      {formatNumber(result.totalScore, 2)}
    </span>
  );
}

export function AdjustmentValue({ points }: { points: number }) {
  return <span className={cn('tabular', points === 0 && 'text-muted-foreground')}>{formatPoints(points)}</span>;
}

/** The level's code, or why there is none. */
export function RatingValue({ result, level }: { result: Pick<PeriodResult, 'ratingLevelId' | 'status'>; level: RatingLevel | null }) {
  if (level) return <span className="font-medium">{level.code}</span>;
  return (
    <span className="flex flex-col">
      <MissingValue />
      <span className="text-xs text-muted-foreground">{result.ratingLevelId === null ? 'Chưa xếp loại' : 'Không tìm thấy xếp loại'}</span>
    </span>
  );
}

/** "% hưởng lương KPI": the %, "Không áp dụng" for a unit result, or why there is no figure. */
export function PayoutValue({ state }: { state: PayoutState }) {
  if (state.kind === 'value') return <span className="tabular">{formatNumber(state.pct, 2)}</span>;
  if (state.kind === 'notApplicable') return <span className="text-xs text-muted-foreground">Không áp dụng</span>;
  if (state.kind === 'tracked') {
    return (
      <span className="text-xs text-muted-foreground" title="Kết quả tháng dùng để theo dõi liên tục; lương chỉ tính theo quý và năm.">
        Theo dõi — không tính lương
      </span>
    );
  }
  const reason = state.kind === 'noRule' ? 'Chưa có quy tắc' : state.kind === 'notRated' ? 'Chưa xếp loại' : 'Không tìm thấy xếp loại';
  return (
    <span className="flex flex-col items-end">
      <MissingValue />
      <span className="text-xs text-muted-foreground">{reason}</span>
    </span>
  );
}
