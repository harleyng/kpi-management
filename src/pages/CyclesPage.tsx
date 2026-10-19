import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { CycleDetail, CycleFormDialog } from '@/components/goals/CycleDetail';
import { GoalPlanWorkspace } from '@/components/goals/GoalPlanWorkspace';
import { DataTable } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { CycleStatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import type { PerformanceCycle } from '@/data/types';
import { useCycles } from '@/hooks/queries/goals';
import { defaultCycleId } from '@/lib/cycleRules';
import { cn, formatDate } from '@/lib/utils';

/**
 * "Chu kỳ" (WBS 4.3.1, 4.3.6, Track T3) for HR / C&B: the cycles, then the selected one below —
 * its status step, its periods (generated, lockable) and every Goal Plan of the cycle with lock,
 * unlock and the lock history. A plan opens on the same page (`?plan=`) with a way back.
 */
export default function CyclesPage() {
  const cycles = useCycles();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState<PerformanceCycle | 'new' | null>(null);
  const selectedId = cycles.data ? defaultCycleId(cycles.data, params.get('cycle')) : null;
  const selected = cycles.data?.find((c) => c.id === selectedId) ?? null;
  const planId = params.get('plan');

  const set = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      next.delete('goal');
      next.delete('mode');
      return next;
    });

  if (planId) {
    return (
      <>
        <PageHeader title="Chu kỳ" description={selected ? `Goal Plan trong ${selected.name}` : undefined} />
        <GoalPlanWorkspace goalPlanId={planId} onBack={() => set({ plan: null })} />
      </>
    );
  }

  const sorted = cycles.data ? [...cycles.data].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)) : undefined;

  return (
    <>
      <PageHeader
        title="Chu kỳ"
        description="Chu kỳ đánh giá, các kỳ tháng/quý với hạn nhập số và hạn đánh giá, và Goal Plan của từng chu kỳ."
        actions={
          <Button onClick={() => setForm('new')} disabled={!cycles.data}>
            <Plus aria-hidden />
            Tạo chu kỳ
          </Button>
        }
      />
      <div className="space-y-5">
        <DataTable
          label="Danh sách chu kỳ"
          rows={sorted}
          query={cycles}
          getRowId={(c) => c.id}
          pageSize={null}
          empty="Chưa có chu kỳ nào. Tạo chu kỳ đầu tiên, ví dụ KPI 2027."
          emptyAction={
            <Button size="sm" onClick={() => setForm('new')}>
              Tạo chu kỳ
            </Button>
          }
          columns={[
            {
              id: 'name',
              header: 'Chu kỳ',
              cell: (c) => (
                <button
                  type="button"
                  className={cn('text-left font-medium underline-offset-2 hover:underline', c.id === selectedId && 'text-primary')}
                  aria-current={c.id === selectedId ? 'true' : undefined}
                  onClick={() => set({ cycle: c.id })}
                >
                  {c.name}
                </button>
              ),
            },
            { id: 'dates', header: 'Thời gian', cell: (c) => `${formatDate(c.startDate)} – ${formatDate(c.endDate)}` },
            { id: 'status', header: 'Trạng thái', cell: (c) => <CycleStatusBadge status={c.status} /> },
            {
              id: 'open',
              header: 'Thao tác',
              cell: (c) => (
                <Button variant={c.id === selectedId ? 'secondary' : 'outline'} size="sm" onClick={() => set({ cycle: c.id })} aria-label={`Xem chu kỳ ${c.name}`}>
                  {c.id === selectedId ? 'Đang xem' : 'Xem'}
                </Button>
              ),
            },
          ]}
        />
        {selected && <CycleDetail key={selected.id} cycle={selected} onOpenPlan={(id) => set({ cycle: selected.id, plan: id })} onEdit={() => setForm(selected)} />}
      </div>
      {form && cycles.data && (
        <CycleFormDialog cycle={form === 'new' ? null : form} cycles={cycles.data} onClose={() => setForm(null)} onSaved={(id) => set({ cycle: id })} />
      )}
    </>
  );
}
