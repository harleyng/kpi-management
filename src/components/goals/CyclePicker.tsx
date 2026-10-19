import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CYCLE_STATUS_LABEL, type PerformanceCycle } from '@/data/types';

export function CyclePicker({ cycles, cycle, onChange }: { cycles: PerformanceCycle[] | undefined; cycle: PerformanceCycle | null; onChange: (id: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="cycle-picker" className="text-sm text-muted-foreground">
        Chu kỳ
      </label>
      <Select value={cycle?.id ?? ''} onValueChange={onChange} disabled={!cycles}>
        <SelectTrigger id="cycle-picker" className="w-56">
          <SelectValue placeholder="Chọn chu kỳ" />
        </SelectTrigger>
        <SelectContent>
          {[...(cycles ?? [])]
            .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
            .map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} · {CYCLE_STATUS_LABEL[c.status]}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}
