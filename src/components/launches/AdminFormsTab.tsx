import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormStatusSelect, FormTypeSelect } from '@/components/forms/FormFilters';
import { FormsTable } from '@/components/forms/FormsTable';
import { useFormLookups } from '@/components/forms/useFormLookups';
import type { FormStatus, FormType, Id } from '@/data/types';
import type { FormFilter } from '@/integrations/data/types';
import { useForms, useLaunches } from '@/hooks/queries/forms';
import { useAllPeriods } from '@/hooks/queries/goals';

const PAGE_SIZE = 50;
const ALL = 'all';

/**
 * "Phiếu" — every form of the tenant, for HR to follow a period, act as proxy or cancel (open the form).
 * The gateway pages it with a keyset cursor: "Trang sau" follows `nextCursor`, "Trang trước" walks back
 * the cursors already seen (a total is not part of the contract).
 */
export function AdminFormsTab({ launchId, onLaunchChange }: { launchId: Id | null; onLaunchChange: (id: Id | null) => void }) {
  const lookups = useFormLookups();
  const periods = useAllPeriods();
  const launches = useLaunches();
  const [type, setType] = useState<FormType | null>(null);
  const [status, setStatus] = useState<FormStatus | null>(null);
  const [periodId, setPeriodId] = useState<Id | null>(null);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);

  const filter: FormFilter = {
    ...(type ? { formType: type } : {}),
    ...(status ? { status } : {}),
    ...(periodId ? { periodId } : {}),
    ...(launchId ? { launchId } : {}),
  };
  const filterKey = JSON.stringify(filter);
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setCursors([undefined]);
  }
  const page = useForms(filter, { limit: PAGE_SIZE, cursor: cursors[cursors.length - 1] });
  const filtered = type !== null || status !== null || periodId !== null || launchId !== null;
  const clear = () => {
    setType(null);
    setStatus(null);
    setPeriodId(null);
    onLaunchChange(null);
  };

  const monthPeriods = (periods.data ?? []).filter((p) => p.periodType === 'Month').sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  const launch = launches.data?.find((l) => l.id === launchId);

  return (
    <div className="space-y-2">
      <FormsTable
        label="Phiếu đã phát hành"
        rows={page.data?.items}
        query={page}
        pageSize={null}
        empty="Chưa có phiếu nào. Phiếu được tạo khi một đợt khởi chạy chạy hoặc khi bắt đầu điều chỉnh."
        isFiltered={filtered}
        onClearFilters={clear}
        toolbar={
          <>
            <FormTypeSelect value={type} onChange={setType} />
            <FormStatusSelect value={status} onChange={setStatus} />
            <Select value={periodId ?? ALL} onValueChange={(v) => setPeriodId(v === ALL ? null : v)}>
              <SelectTrigger className="h-8 w-36" aria-label="Kỳ đánh giá">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Mọi kỳ</SelectItem>
                {monthPeriods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label} ({lookups.cycle(p.cycleId)?.name ?? ''})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {launch && (
              <Button variant="secondary" size="sm" onClick={() => onLaunchChange(null)} aria-label={`Bỏ lọc theo đợt ${launch.name}`}>
                Đợt: {launch.name} ×
              </Button>
            )}
          </>
        }
      />
      <nav aria-label="Phân trang phiếu" className="flex items-center justify-end gap-2">
        <span className="tabular text-sm text-muted-foreground">Trang {cursors.length}</span>
        <Button variant="outline" size="sm" disabled={cursors.length === 1 || page.isFetching} onClick={() => setCursors(cursors.slice(0, -1))}>
          Trang trước
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!page.data?.nextCursor || page.isPlaceholderData || page.isFetching}
          onClick={() => page.data?.nextCursor && setCursors([...cursors, page.data.nextCursor])}
        >
          Trang sau
        </Button>
      </nav>
    </div>
  );
}
