import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod } from '@/data/types';
import { useAllPeriods } from '@/hooks/queries/goals';
import type { QueryState } from '@/lib/queryState';
import { defaultWorkMonth } from '@/lib/workRules';
import { monthText } from './workCopy';

/**
 * The month a monthly-work screen shows, kept in `?month=` (a period id). Unknown or absent → the
 * month of today (`workRules.defaultWorkMonth`). Every Month period of every cycle, newest first.
 */
export function useWorkMonth(): { months: CyclePeriod[]; month: CyclePeriod | null; setMonth: (id: string) => void; query: QueryState } {
  const { today } = useSession();
  const periods = useAllPeriods();
  const [params, setParams] = useSearchParams();
  const months = useMemo(
    () => (periods.data ?? []).filter((p) => p.periodType === 'Month').sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    [periods.data],
  );
  const asked = params.get('month');
  const month = months.find((p) => p.id === asked) ?? defaultWorkMonth(months, today);
  const setMonth = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('month', id);
        return next;
      },
      { replace: true },
    );
  return { months, month, setMonth, query: periods.query };
}

export function WorkMonthSelect({ months, month, onChange }: { months: readonly CyclePeriod[]; month: CyclePeriod | null; onChange: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="work-month" className="text-sm font-normal text-muted-foreground">
        Tháng
      </Label>
      <Select value={month?.id} onValueChange={onChange} disabled={months.length === 0}>
        <SelectTrigger id="work-month" className="h-9 w-32">
          <SelectValue placeholder="Chọn tháng" />
        </SelectTrigger>
        <SelectContent>
          {months.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {monthText(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
