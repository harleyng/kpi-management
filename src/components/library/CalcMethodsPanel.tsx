import { useMemo, useRef, useState } from 'react';
import { Lock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { CALC_METHOD_TYPE_LABEL, type CalcMethod } from '@/data/types';
import { useCalcMethods, useCalcTiers, useLibraryGoalUsage } from '@/hooks/queries/library';
import { libraryUsage } from '@/lib/libraryRules';
import { combineQueries } from '@/lib/queryState';
import { formatPercent } from '@/lib/utils';
import { CalcMethodSheet } from './CalcMethodSheet';
import { UsageUnavailable } from './UsageUnavailable';

/** "Phương pháp tính" (WBS 4.2.2): the tenant's methods, how many goals each scores, and its editor. */
export function CalcMethodsPanel({ canManage }: { canManage: boolean }) {
  const methods = useCalcMethods();
  const tiers = useCalcTiers();
  const goals = useLibraryGoalUsage();
  const [editing, setEditing] = useState<CalcMethod | 'new' | null>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);

  const usage = useMemo(() => (goals.data ? libraryUsage(goals.data, []).goalsByMethod : null), [goals.data]);
  const goalsUsing = (id: string) => (usage ? (usage.get(id) ?? 0) : null);

  const rows = useMemo(
    () => (methods.data && tiers.data ? [...methods.data].sort((a, b) => a.code.localeCompare(b.code, 'vi')) : undefined),
    [methods.data, tiers.data],
  );

  const columns: DataTableColumn<CalcMethod>[] = [
    { id: 'code', header: 'Mã', cell: (m) => <span className="font-mono text-xs">{m.code}</span>, sortValue: (m) => m.code, className: 'w-[9rem]' },
    {
      id: 'name',
      header: 'Tên',
      cell: (m) => (
        <button
          type="button"
          className="rounded-sm text-left font-medium underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => {
            lastTrigger.current = e.currentTarget;
            setEditing(m);
          }}
        >
          {m.name}
        </button>
      ),
      sortValue: (m) => m.name,
    },
    { id: 'type', header: 'Loại', cell: (m) => CALC_METHOD_TYPE_LABEL[m.methodType] },
    { id: 'cap', header: 'Trần', numeric: true, cell: (m) => (m.capPct === null ? null : formatPercent(m.capPct)) },
    { id: 'floor', header: 'Sàn', numeric: true, cell: (m) => (m.floorPct === null ? null : formatPercent(m.floorPct)) },
    {
      id: 'goals',
      header: 'Đang dùng',
      numeric: true,
      cell: (m) => {
        const n = goalsUsing(m.id);
        if (n === null) return null;
        return (
          <span className="inline-flex items-center justify-end gap-1.5">
            {n > 0 && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Cách tính đã khóa" />}
            {n}
          </span>
        );
      },
      sortValue: (m) => goalsUsing(m.id),
    },
  ];

  return (
    <>
      {goals.error != null && (
        <div className="mb-2">
          <UsageUnavailable onRetry={() => void goals.refetch()} />
        </div>
      )}
      <DataTable
        label="Phương pháp tính"
        columns={columns}
        rows={rows}
        query={combineQueries([methods, tiers])}
        getRowId={(m) => m.id}
        empty="Chưa có phương pháp tính nào."
        pageSize={null}
        toolbar={
          <>
            <p className="text-sm text-muted-foreground">Phương pháp đã dùng cho mục tiêu thì giữ nguyên cách tính; muốn đổi, hãy tạo phương pháp mới.</p>
            {canManage && (
              <Button
                size="sm"
                className="ml-auto"
                onClick={(e) => {
                  lastTrigger.current = e.currentTarget;
                  setEditing('new');
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                Thêm phương pháp
              </Button>
            )}
          </>
        }
      />
      <CalcMethodSheet
        editing={editing}
        onClose={() => setEditing(null)}
        readOnly={!canManage}
        methods={methods.data ?? []}
        tiers={tiers.data ?? []}
        goalsUsing={goalsUsing}
        returnFocus={() => lastTrigger.current?.focus()}
      />
    </>
  );
}
