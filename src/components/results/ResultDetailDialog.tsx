import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MissingValue } from '@/components/shared/DataTable';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { PeriodResultStatusBadge } from '@/components/shared/StatusBadge';
import { OWNER_TYPE_LABEL, type CyclePeriod, type RatingLevel } from '@/data/types';
import { useResultBreakdown, useSetAdjustment } from '@/hooks/queries/results';
import { errorSpecOf } from '@/lib/errorCatalog';
import { isWeightComplete } from '@/lib/goalPlanRules';
import { loadPhase } from '@/lib/queryState';
import { formatPoints, payoutState, type ResultRow } from '@/lib/resultView';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { AdjustmentValue, PayoutValue, RatingValue } from './ResultCells';

interface ResultDetailDialogProps {
  row: ResultRow | null;
  period: Pick<CyclePeriod, 'label'> | null;
  levels: readonly RatingLevel[];
  onOpenChange: (open: boolean) => void;
  /** HR / C&B on `/admin/results`: a Draft's adjustment can be edited. */
  canAdjust: boolean;
  /** Read by the scale's banner — "Thang mẫu" while the scale is an assumption (Q2). */
  scaleName?: string | null;
}

/**
 * One result, goal by goal (WBS 4.6.1–4.6.2): each goal's achievement %, weight and weighted points,
 * then the three parts of the score side by side — they are never summed on screen, because the 0
 * floor and the one-time rounding sit between them (`scoreRules.scoreBreakdown`).
 */
export function ResultDetailDialog({ row, period, levels, onOpenChange, canAdjust, scaleName }: ResultDetailDialogProps) {
  const result = row?.result ?? null;
  const { view, query } = useResultBreakdown(result);
  const phase = loadPhase(query, view !== undefined);

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 p-0">
        {row && result && (
          <>
            <DialogHeader className="border-b px-5 pb-4 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2 pr-8">
                <DialogTitle className="text-lg">{row.ownerName}</DialogTitle>
                <div className="flex flex-col items-end gap-1">
                  <PeriodResultStatusBadge status={result.status} />
                  {result.finalizedAt && <span className="text-xs text-muted-foreground">Chốt lúc {formatDateTime(result.finalizedAt)}</span>}
                </div>
              </div>
              <DialogDescription asChild>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                  <Meta term="Cấp">{OWNER_TYPE_LABEL[result.ownerType]}</Meta>
                  {row.unitName && <Meta term="Đơn vị">{row.unitName}</Meta>}
                  {row.ownerCode && result.ownerType === 'Employee' && <Meta term="Mã nhân viên">{row.ownerCode}</Meta>}
                  {period && <Meta term="Kỳ">{period.label}</Meta>}
                </dl>
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {phase === 'error' && <ErrorState spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />}
              {phase === 'loading' && <Skeleton className="h-40 w-full" />}
              {view && (
                <Table aria-label="Chi tiết từng chỉ tiêu">
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Chỉ tiêu</TableHead>
                      <TableHead scope="col" className="text-right">Trọng số (%)</TableHead>
                      <TableHead scope="col" className="text-right">% hoàn thành</TableHead>
                      <TableHead scope="col" className="text-right">Điểm có trọng số</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="max-w-[18rem]">{line.goalName ?? <span className="text-muted-foreground">Chỉ tiêu không còn trong kế hoạch</span>}</TableCell>
                        <TableCell className="tabular text-right">{formatNumber(line.weight, 2)}</TableCell>
                        <TableCell className="text-right">
                          {line.achievementPct === null ? (
                            <span className="flex flex-col items-end">
                              <MissingValue />
                              <span className="text-xs text-muted-foreground">Chưa có điểm</span>
                            </span>
                          ) : (
                            <span className="tabular">{formatNumber(line.achievementPct, 2)}</span>
                          )}
                        </TableCell>
                        <TableCell className="tabular text-right">{line.weightedScore === null ? <MissingValue /> : formatNumber(line.weightedScore, 2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {view && view.lines.length === 0 && <p className="py-4 text-sm text-muted-foreground">Kết quả này không có chỉ tiêu nào.</p>}
            </div>

            {view && (
              <div className="border-t bg-neutral-05 px-5 py-4">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
                  <Figure term="Điểm tổng hợp chỉ tiêu" note={view.breakdown.complete ? null : 'Tạm tính, còn chỉ tiêu chưa có điểm'}>
                    {view.breakdown.raw === null ? <MissingValue /> : <span className="tabular">{formatNumber(view.breakdown.raw, 2)}</span>}
                  </Figure>
                  <Figure term="Điều chỉnh (điểm)">
                    <AdjustmentValue points={view.breakdown.adjustment} />
                  </Figure>
                  <Figure term={result.status === 'Draft' ? 'Điểm KPI (tạm tính)' : 'Điểm KPI (đã làm tròn)'} note={view.breakdown.clamped ? 'Điều chỉnh đưa điểm về 0' : null}>
                    {result.totalScore === null ? <MissingValue /> : <span className="tabular text-base font-semibold">{formatNumber(result.totalScore, 2)}</span>}
                  </Figure>
                  <Figure term="Xếp loại" note={row.level ? row.level.label : null}>
                    <RatingValue result={result} level={row.level} />
                  </Figure>
                  <Figure term="% hưởng lương KPI">
                    <PayoutValue state={payoutState(result, levels)} />
                  </Figure>
                </dl>
                {!isWeightComplete(view.breakdown.totalWeight) && view.lines.length > 0 && (
                  <p className="mt-2 text-xs text-support-warning">Tổng trọng số là {formatNumber(view.breakdown.totalWeight, 2)}%, cần 100% để xếp loại.</p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Điểm KPI = điểm tổng hợp + điều chỉnh, không thấp hơn 0, làm tròn 2 chữ số khi chốt.
                  {scaleName ? ` Xếp loại theo ${scaleName}.` : ''}
                </p>
                {result.status === 'Draft' && canAdjust ? (
                  <AdjustmentForm resultId={result.id} current={result.adjustmentPct} />
                ) : (
                  canAdjust && <p className="mt-3 text-xs text-muted-foreground">Chỉ chỉnh được điều chỉnh khi kết quả còn là bản tạm tính.</p>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Meta({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="text-foreground">{children}</dd>
    </>
  );
}

function Figure({ term, note = null, children }: { term: string; note?: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd>{children}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}

/** Points to add (violations, attendance) — positive or negative. Parsed here; the gateway decides. */
function parsePoints(text: string): number | null {
  const normalised = text.trim().replace(',', '.').replace('−', '-');
  if (normalised === '' || !/^[+-]?\d+(\.\d+)?$/.test(normalised)) return null;
  return Number(normalised);
}

function AdjustmentForm({ resultId, current }: { resultId: string; current: number }) {
  const inputId = useId();
  const errorId = useId();
  const hintId = useId();
  const [text, setText] = useState(String(current));
  const save = useSetAdjustment();
  useEffect(() => setText(String(current)), [current, resultId]);
  const parsed = parsePoints(text);
  const invalid = text.trim() !== '' && parsed === null;
  const unchanged = parsed === current;

  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed !== null && !unchanged) save.mutate({ resultId, adjustmentPct: parsed });
      }}
    >
      <div className="grid gap-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          Điều chỉnh điểm
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            inputMode="decimal"
            className="tabular h-9 w-28 text-right"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : hintId}
          />
          <span className="text-sm text-muted-foreground">điểm</span>
        </div>
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={parsed === null || unchanged || save.isPending} aria-busy={save.isPending || undefined}>
        {save.isPending ? 'Đang lưu…' : 'Lưu điều chỉnh'}
      </Button>
      {invalid ? (
        <p id={errorId} className="w-full text-xs text-support-negative">
          Nhập một số, ví dụ 1,5 hoặc -2.
        </p>
      ) : (
        <p id={hintId} className="w-full text-xs text-muted-foreground">
          Cộng hoặc trừ điểm do vi phạm, chuyên cần. Hiện tại: {formatPoints(current)} điểm. Xếp loại và % hưởng lương KPI tính lại ngay.
        </p>
      )}
    </form>
  );
}
