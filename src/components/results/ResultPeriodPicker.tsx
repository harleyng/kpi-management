import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PERIOD_TYPE_LABEL } from '@/data/types';
import type { ResultPeriodSelection } from './useResultPeriod';

/** "Chu kỳ" and "Kỳ" selects for the result screens. `showPeriod={false}` for cycle-wide content. */
export function ResultPeriodPicker({ selection, showPeriod = true }: { selection: ResultPeriodSelection; showPeriod?: boolean }) {
  const cycleId = useId();
  const periodId = useId();
  const { cycles, periods, cycle, period, setCycle, setPeriod } = selection;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1">
        <Label htmlFor={cycleId} className="text-xs text-muted-foreground">
          Chu kỳ
        </Label>
        <Select value={cycle?.id ?? ''} onValueChange={setCycle} disabled={!cycles}>
          <SelectTrigger id={cycleId} className="h-9 w-44">
            <SelectValue placeholder="Đang tải…" />
          </SelectTrigger>
          <SelectContent>
            {cycles?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showPeriod && (
        <div className="grid gap-1">
          <Label htmlFor={periodId} className="text-xs text-muted-foreground">
            Kỳ
          </Label>
          <Select value={period?.id ?? ''} onValueChange={setPeriod} disabled={!periods || periods.length === 0}>
            <SelectTrigger id={periodId} className="h-9 w-40">
              <SelectValue placeholder={periods && periods.length === 0 ? 'Chu kỳ chưa có kỳ' : 'Đang tải…'} />
            </SelectTrigger>
            <SelectContent>
              {periods?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label} ({PERIOD_TYPE_LABEL[p.periodType].toLowerCase()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
