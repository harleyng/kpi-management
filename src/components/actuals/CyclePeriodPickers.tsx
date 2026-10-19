import { useEffect, useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/contexts/useSession';
import { CYCLE_STATUS_LABEL, type CyclePeriod, type Id, type PerformanceCycle } from '@/data/types';
import { useCycles, usePeriods } from '@/hooks/queries/goals';
import { defaultCycle, defaultMonth, monthsOf } from '@/lib/actualEntryRules';

/**
 * The cycle and month pickers the actuals screens share. Each picks its default once its data is in
 * (the Active cycle; the latest month that has started) — `actualEntryRules` decides which.
 */
export function CycleSelect({ value, onChange }: { value: Id | null; onChange: (id: Id) => void }) {
  const cycles = useCycles();
  useEffect(() => {
    if (value === null && cycles.data) {
      const pick = defaultCycle(cycles.data);
      if (pick) onChange(pick.id);
    }
  }, [value, cycles.data, onChange]);
  if (cycles.isPending && cycles.fetchStatus !== 'idle') return <Skeleton className="h-9 w-44" />;
  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={!cycles.data}>
      <SelectTrigger className="w-60" aria-label="Chu kỳ">
        <SelectValue placeholder="Chọn chu kỳ" />
      </SelectTrigger>
      <SelectContent>
        {(cycles.data ?? []).map((c: PerformanceCycle) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
            <span className="ml-2 text-muted-foreground">{CYCLE_STATUS_LABEL[c.status]}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MonthSelect({
  cycleId,
  value,
  onChange,
  label = 'Kỳ',
}: {
  cycleId: Id | null;
  value: Id | null;
  onChange: (period: CyclePeriod) => void;
  label?: string;
}) {
  const { today } = useSession();
  const periods = usePeriods(cycleId);
  const months = useMemo(() => monthsOf(periods.data ?? []), [periods.data]);
  const current = months.find((p) => p.id === value) ?? null;
  useEffect(() => {
    if (periods.data && (value === null || !months.some((p) => p.id === value))) {
      const pick = defaultMonth(months, today);
      if (pick) onChange(pick);
    }
  }, [periods.data, months, value, today, onChange]);
  if (cycleId === null || (periods.isPending && periods.fetchStatus !== 'idle')) return <Skeleton className="h-9 w-28" />;
  return (
    <Select value={current?.id} onValueChange={(id) => onChange(months.find((p) => p.id === id) as CyclePeriod)} disabled={months.length === 0}>
      <SelectTrigger className="w-28" aria-label={label}>
        <SelectValue placeholder="Chọn kỳ" />
      </SelectTrigger>
      <SelectContent>
        {months.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
