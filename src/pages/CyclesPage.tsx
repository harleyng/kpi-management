import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { CycleFormDialog } from '@/components/goals/CycleDetail';
import { DataTable } from '@/components/shared/DataTable';
import { PageHeader } from '@/components/shared/PageHeader';
import { CycleStatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { useCycles } from '@/hooks/queries/goals';
import { formatDate } from '@/lib/utils';

/**
 * "Chu kỳ" (WBS 4.3.1, 4.3.6, Track T3) for HR / C&B: the cycles, newest first. A cycle opens on its
 * own page (`/admin/cycles/:cycleId`) — its status step, periods and Goal Plans.
 */
export default function CyclesPage() {
  const cycles = useCycles();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const open = (id: string) => navigate(`/admin/cycles/${encodeURIComponent(id)}`);
  const sorted = cycles.data ? [...cycles.data].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)) : undefined;

  return (
    <>
      <PageHeader title="Chu kỳ" description="Chu kỳ đánh giá, các kỳ tháng/quý với hạn nhập số và hạn đánh giá, và Goal Plan của từng chu kỳ." />
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
