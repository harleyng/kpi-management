import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { LaunchStatusBadge } from '@/components/shared/StatusBadge';
import { toastError } from '@/components/shared/toastError';
import { useFormLookups } from '@/components/forms/useFormLookups';
import { FORM_TYPE_LABEL, LAUNCH_TIMING_LABEL, type FormLaunch, type Id } from '@/data/types';
import { useCancelLaunch, useLaunches } from '@/hooks/queries/forms';
import { combineQueries } from '@/lib/queryState';
import { formatDateTime } from '@/lib/utils';
import { canCancelLaunch } from '@/lib/workflowRules';
import { recipientSummary } from './recipients';

/**
 * "Đợt khởi chạy" (D5): every launch — one-off and those a recurring rule produced — newest first,
 * with "Tạo đợt khởi chạy" opening its own page (`NewLaunchPage`). A launched one opens its forms;
 * only a Scheduled one (no forms yet) can be cancelled (`canCancelLaunch`).
 */
export function LaunchesTab({ onOpenForms }: { onOpenForms: (launchId: Id) => void }) {
  const launches = useLaunches();
  const lookups = useFormLookups();
  const cancel = useCancelLaunch();
  const navigate = useNavigate();
  const [cancelling, setCancelling] = useState<FormLaunch | null>(null);

  const rows = launches.data?.slice().sort((a, b) => (a.scheduledAt < b.scheduledAt ? 1 : -1));
  const columns: DataTableColumn<FormLaunch>[] = [
    { id: 'name', header: 'Tên đợt', cell: (l) => <span className="font-medium">{l.name}</span>, sortValue: (l) => l.name, className: 'min-w-[14rem]' },
    { id: 'type', header: 'Loại phiếu', cell: (l) => FORM_TYPE_LABEL[l.formType] },
    {
      id: 'period',
      header: 'Kỳ / chu kỳ',
      cell: (l) => {
        const period = lookups.period(l.periodId);
        const cycle = lookups.cycle(l.cycleId ?? period?.cycleId ?? null);
        return [period?.label, cycle?.name].filter(Boolean).join(', ');
      },
    },
    {
      id: 'when',
      header: 'Thời điểm',
      cell: (l) => (
        <span>
          {LAUNCH_TIMING_LABEL[l.timing]}
          <span className="tabular block text-xs text-muted-foreground">{formatDateTime(l.scheduledAt)}</span>
        </span>
      ),
      sortValue: (l) => l.scheduledAt,
    },
    { id: 'due', header: 'Hạn (ngày)', numeric: true, cell: (l) => l.dueDays },
    { id: 'recipients', header: 'Người nhận', cell: (l) => recipientSummary(l.recipientMode, l.recipientFilter) },
    { id: 'status', header: 'Trạng thái', cell: (l) => <LaunchStatusBadge status={l.status} /> },
    {
      id: 'actions',
      header: 'Thao tác',
      cell: (l) =>
        l.status === 'Launched' ? (
          <Button variant="ghost" size="sm" onClick={() => onOpenForms(l.id)}>
            Mở phiếu
          </Button>
        ) : canCancelLaunch(l).ok ? (
          <Button variant="ghost" size="sm" className="text-support-negative" onClick={() => setCancelling(l)}>
            Hủy đợt
          </Button>
        ) : (
          ''
        ),
    },
  ];

  return (
    <>
      <DataTable
        label="Đợt khởi chạy"
        columns={columns}
        rows={lookups.ready ? rows : undefined}
        query={combineQueries([launches, lookups.query])}
        getRowId={(l) => l.id}
        empty="Chưa có đợt khởi chạy nào. Tạo đợt đầu tiên để gửi phiếu đăng ký hoặc đánh giá."
        actions={
          <Button onClick={() => navigate('/admin/launches/runs/new')}>
            <Plus className="h-4 w-4" aria-hidden />
            Tạo đợt khởi chạy
          </Button>
        }
      />
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Hủy đợt khởi chạy"
        body={`Hủy đợt "${cancelling?.name ?? ''}"? Đợt chưa khởi chạy nên chưa có phiếu nào được tạo; đợt sẽ không khởi chạy nữa.`}
        confirmLabel="Hủy đợt"
        cancelLabel="Quay lại"
        destructive
        onConfirm={() => {
          if (cancelling) cancel.mutate(cancelling.id, { onSuccess: () => toast.success('Đã hủy đợt khởi chạy'), onError: toastError });
          setCancelling(null);
        }}
      />
    </>
  );
}
