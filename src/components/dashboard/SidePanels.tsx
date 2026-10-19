import { useId, useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { AttentionBadge } from '@/components/shared/StatusBadge';
import type { Id } from '@/data/types';
import { AT_RISK_ACHIEVEMENT_PCT, UNCLASSIFIED_PERSPECTIVE, type AttentionItem, type PerspectiveRow, type TrendPoint } from '@/lib/dashboardRules';
import { errorSpecOf } from '@/lib/errorCatalog';
import { loadPhase, type QueryState } from '@/lib/queryState';
import { formatNumber } from '@/lib/utils';

/** A side-column panel: a heading, and its own loading / error state so one failure never blanks the page. */
export function Panel({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2 rounded-md border bg-card px-4 py-3">
      <div>
        <h3 id={headingId} className="text-sm font-semibold">
          {title}
        </h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function PanelState({ query, hasData, children }: { query: QueryState; hasData: boolean; children: ReactNode }) {
  const phase = loadPhase(query, hasData);
  if (phase === 'error') return <ErrorState spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />;
  if (phase === 'loading') return <Skeleton className="h-24 w-full" />;
  return <>{children}</>;
}

const ATTENTION_ROWS = 5;

/** "Chỉ tiêu cần chú ý" of the unit's own result — worst first, five then "Xem tất cả". */
export function AttentionList({ items, hiddenCount }: { items: AttentionItem[]; hiddenCount: number }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Không có chỉ tiêu nào dưới ngưỡng hay thiếu số liệu.</p>;
  const named = items.filter((i) => i.name !== null);
  const shown = all ? named : named.slice(0, ATTENTION_ROWS);
  return (
    <div className="space-y-2">
      <ul id={listId} className="divide-y text-sm">
        {shown.map((item) => (
          <li key={item.goalId} className="flex items-start justify-between gap-3 py-1.5">
            <span className="min-w-0">{item.name}</span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {item.achievementPct !== null && <span className="tabular">{formatNumber(item.achievementPct, 2)}%</span>}
              <AttentionBadge kind={item.kind} />
            </span>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && <p className="text-xs text-muted-foreground">và {hiddenCount} chỉ tiêu không thuộc phạm vi xem.</p>}
      {named.length > ATTENTION_ROWS && (
        <Button type="button" variant="link" size="sm" className="h-auto p-0" aria-expanded={all} aria-controls={listId} onClick={() => setAll((v) => !v)}>
          {all ? 'Thu gọn' : `Xem tất cả (${named.length})`}
        </Button>
      )}
    </div>
  );
}

/**
 * "Theo viễn cảnh BSC": one neutral bar per perspective, its average achievement printed at the end
 * against a 100% line, and its weight share beside it — the bars are NOT parts of the total score.
 */
export function PerspectiveBars({ rows, names }: { rows: PerspectiveRow[]; names: ReadonlyMap<Id, string> }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Kết quả này không có chỉ tiêu nào.</p>;
  const scale = 120; // the cap of the ratio methods — a bar never runs off the panel
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">% hoàn thành bình quân theo viễn cảnh BSC, có trọng số</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Viễn cảnh</th>
          <th scope="col">% hoàn thành</th>
          <th scope="col">Tỉ trọng</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const name = row.perspectiveId === UNCLASSIFIED_PERSPECTIVE ? 'Chưa phân loại' : (names.get(row.perspectiveId) ?? 'Chưa phân loại');
          const width = row.achievement === null ? 0 : Math.min(row.achievement, scale) / scale;
          return (
            <tr key={row.perspectiveId} className="align-top">
              <th scope="row" className="w-32 py-1.5 pr-2 text-left font-normal">
                {name}
              </th>
              <td className="py-1.5">
                <div className="relative h-4 rounded-sm bg-neutral-10" aria-hidden>
                  <div className="h-4 rounded-sm bg-primary/70" style={{ width: `${width * 100}%` }} />
                  <div className="absolute inset-y-0 border-l border-dashed border-foreground/50" style={{ left: `${(100 / scale) * 100}%` }} />
                </div>
                <span className="text-xs">
                  {row.achievement === null ? 'Chưa có số liệu' : <span className="tabular">{formatNumber(row.achievement, 2)}%</span>}
                  {row.missing > 0 && row.achievement !== null && <span className="text-muted-foreground"> (chưa đủ số liệu)</span>}
                </span>
              </td>
              <td className="w-16 py-1.5 pl-2 text-right text-xs text-muted-foreground">
                <span className="tabular">{row.weightShare === null ? '—' : `${formatNumber(row.weightShare, 0)}%`}</span>
                <span className="block">tỉ trọng</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * "Xu hướng" — the unit's stored score month by month. A Draft point is hollow and named "tạm tính";
 * the figures are also a table ("Xem dạng bảng"), never in the tooltip only.
 */
export function TrendChart({ points, name }: { points: TrendPoint[]; name: string }) {
  const [asTable, setAsTable] = useState(false);
  const scored = points.filter((p) => p.score !== null);
  if (scored.length < 2) return <p className="text-sm text-muted-foreground">Chưa đủ kỳ có điểm để vẽ xu hướng.</p>;
  const first = scored[0];
  const last = scored[scored.length - 1];
  const summary = `Điểm của ${name} theo tháng, ${first.label} ${formatNumber(first.score, 2)} đến ${last.label} ${formatNumber(last.score, 2)}${last.provisional ? ' (tạm tính)' : ''}.`;
  return (
    <div className="space-y-2">
      {asTable ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{summary}</caption>
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="text-left font-normal">
                Kỳ
              </th>
              <th scope="col" className="text-right font-normal">
                Điểm
              </th>
            </tr>
          </thead>
          <tbody>
            {scored.map((p) => (
              <tr key={p.periodId}>
                <th scope="row" className="text-left font-normal">
                  {p.label}
                </th>
                <td className="tabular text-right">
                  {formatNumber(p.score, 2)}
                  {p.provisional ? ' (tạm tính)' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div role="img" aria-label={summary} className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} width={44} />
              <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
              <Tooltip formatter={(value: number) => formatNumber(value, 2)} labelFormatter={(label: string) => `Kỳ ${label}`} />
              <Line
                type="linear"
                dataKey="score"
                name="Điểm"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                connectNulls={false}
                isAnimationActive={false}
                dot={(props: { cx?: number; cy?: number; payload?: TrendPoint; index?: number }) => (
                  <circle
                    key={props.index}
                    cx={props.cx}
                    cy={props.cy}
                    r={props.payload?.score === null ? 0 : 3.5}
                    fill={props.payload?.provisional ? 'hsl(var(--background))' : 'hsl(var(--primary))'}
                    stroke="hsl(var(--primary))"
                    strokeWidth={1.5}
                  />
                )}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Chấm rỗng: tạm tính. Đường đứt: 100 điểm.</span>
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Xem dạng biểu đồ' : 'Xem dạng bảng'}
        </Button>
      </div>
    </div>
  );
}

export const ATTENTION_HINT = `Dưới ngưỡng: % hoàn thành dưới ${AT_RISK_ACHIEVEMENT_PCT}% (giả định Q41). Thiếu số liệu: chưa tính được %.`;
