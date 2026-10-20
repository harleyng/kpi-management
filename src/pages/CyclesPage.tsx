import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { CycleFormDialog, CyclePlansPanel, PeriodsPanel } from '@/components/goals/CycleDetail';
import { CyclePicker } from '@/components/goals/CyclePicker';
import { cycleDetailUrl, cyclePlanUrl } from '@/components/goals/goalNav';
import { useSelectedCycle } from '@/components/goals/useSelectedCycle';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyStateCard } from '@/components/shared/EmptyState';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { CycleStatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCycles } from '@/hooks/queries/goals';
import { errorSpecOf } from '@/lib/errorCatalog';
import { formatDate } from '@/lib/utils';

/**
 * "Chu kỳ" (WBS 4.3.1, 4.3.6, Track T3) for HR / C&B, three sub-pages: "Kỳ đánh giá" — the cycles,
 * newest first, each opening on its own page (`/admin/cycles/list/:cycleId`, status step + edit);
 * "Đợt đánh giá" — the periods of one cycle; "Goal Plan" — the plans of one cycle. The last two keep
 * the cycle in `?cycle=` (carried between siblings).
 */
export default function CyclesPage({ section }: { section: 'list' | 'periods' | 'plans' }) {
  return section === 'list' ? <CycleList /> : <CycleScoped section={section} />;
}

function CycleList() {
  const cycles = useCycles();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const open = (id: string) => navigate(cycleDetailUrl(id));
  const sorted = cycles.data ? [...cycles.data].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)) : undefined;

  return (
    <>
      <PageHeader title="Kỳ đánh giá" description="Các chu kỳ đánh giá KPI: thời gian, trạng thái và bước chuyển trạng thái tiếp theo." />
      <DataTable
        label="Danh sách chu kỳ"
        rows={sorted}
        query={cycles}
        getRowId={(c) => c.id}
        pageSize={null}
        empty="Chưa có chu kỳ nào. Tạo chu kỳ đầu tiên, ví dụ KPI 2027."
        actions={
          <Button onClick={() => setCreating(true)} disabled={!cycles.data}>
            <Plus aria-hidden />
            Tạo chu kỳ
          </Button>
        }
        columns={[
          {
            id: 'name',
            header: 'Chu kỳ',
            cell: (c) => (
              <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => open(c.id)}>
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
              <Button variant="outline" size="sm" onClick={() => open(c.id)} aria-label={`Xem chu kỳ ${c.name}`}>
                Xem
              </Button>
            ),
          },
        ]}
      />
      {creating && cycles.data && <CycleFormDialog cycle={null} cycles={cycles.data} onClose={() => setCreating(false)} onSaved={open} />}
    </>
  );
}

const SCOPED_COPY = {
  periods: { title: 'Đợt đánh giá', description: 'Các kỳ tháng/quý của chu kỳ với hạn nhập số và hạn đánh giá; khóa / mở khóa số liệu khi chu kỳ đang chạy.' },
  plans: { title: 'Goal Plan', description: 'Goal Plan của chu kỳ theo cấp công ty, bộ phận và nhân viên — tạo, khóa / mở khóa và mở từng Goal Plan.' },
} as const;

function CycleScoped({ section }: { section: 'periods' | 'plans' }) {
  const navigate = useNavigate();
  const { cycles, cycle, setCycleId } = useSelectedCycle();

  let body;
  if (cycles.error) body = <ErrorStateCard spec={errorSpecOf(cycles.error)} onAction={() => void cycles.refetch()} />;
  else if (!cycles.data) body = <Skeleton className="h-64 w-full" aria-label="Đang tải" />;
  else if (!cycle) body = <EmptyStateCard>Chưa có chu kỳ nào. Tạo chu kỳ ở mục Kỳ đánh giá.</EmptyStateCard>;
  // Keyed on the cycle so a panel's filters and dialogs start fresh when the picker changes.
  else if (section === 'periods') body = <PeriodsPanel key={cycle.id} cycle={cycle} />;
  else body = <CyclePlansPanel key={cycle.id} cycle={cycle} onOpenPlan={(planId) => navigate(cyclePlanUrl(cycle.id, planId))} />;

  return (
    <>
      <PageHeader title={SCOPED_COPY[section].title} description={SCOPED_COPY[section].description} actions={<CyclePicker cycles={cycles.data} cycle={cycle} onChange={setCycleId} />} />
      {body}
    </>
  );
}
