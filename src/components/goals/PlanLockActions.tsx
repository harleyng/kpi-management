import { useState } from 'react';
import { History, Lock, LockOpen } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useSession } from '@/contexts/useSession';
import { AUDIT_ACTION_LABEL, type FormInstance, type GoalPlan, type PerformanceCycle } from '@/data/types';
import { useLockGoalPlan, useUnlockGoalPlan } from '@/hooks/queries/goals';
import { useAuditEntries } from '@/hooks/queries/system';
import { toastSaved } from '@/hooks/queries/toasts';
import { errorSpecOf, KpiError } from '@/lib/errorCatalog';
import { canLock, canUnlock } from '@/lib/goalPlanRules';
import { addDays } from '@/lib/isoDate';
import { readGatewayNow } from '@/hooks/queries/session';
import { formatDateTime } from '@/lib/utils';
import { firstIssueText } from './goalCopy';

interface PlanLockActionsProps {
  plan: GoalPlan;
  cycle: PerformanceCycle;
  /** The plan's open registration form — an unlock gives it a new due date (BR-KPI-13). */
  registration: FormInstance | null;
  /** The plan's name in dialogs ("Goal Plan của Nguyễn Văn An"). */
  planName: string;
  /** Compact buttons for a table row. */
  compact?: boolean;
}

/**
 * HR's lock / unlock and the plan's lock history (WBS 4.3.6, BR-KPI-14) — on the plan header and on
 * HR's plan table. Shown only to holders of `goalplan.lock`; in a Closed cycle the buttons stay but
 * explain that the plan can no longer be edited either way.
 */
export function PlanLockActions({ plan, cycle, registration, planName, compact = false }: PlanLockActionsProps) {
  const { can } = useSession();
  const [dialog, setDialog] = useState<'lock' | 'unlock' | 'history' | null>(null);
  if (!can('goalplan.lock')) return null;
  const closed = cycle.status === 'Closed';
  const size = compact ? 'sm' : 'default';
  return (
    <>
      {plan.status === 'Locked' ? (
        <Button variant="outline" size={size} onClick={() => setDialog('unlock')} disabled={closed} title={closed ? 'Chu kỳ đã đóng — mở khóa không còn tác dụng.' : undefined}>
          <LockOpen aria-hidden />
          Mở khóa
        </Button>
      ) : (
        <Button variant="outline" size={size} onClick={() => setDialog('lock')} disabled={!canLock(plan).ok || closed} title={closed ? 'Chu kỳ đã đóng.' : undefined}>
          <Lock aria-hidden />
          Khóa
        </Button>
      )}
      <Button variant="ghost" size={size} onClick={() => setDialog('history')}>
        <History aria-hidden />
        Lịch sử khóa
      </Button>
      <LockDialog plan={plan} planName={planName} hasOpenForm={registration !== null} open={dialog === 'lock'} onOpenChange={(o) => setDialog(o ? 'lock' : null)} />
      {dialog === 'unlock' && <UnlockDialog plan={plan} planName={planName} registration={registration} onClose={() => setDialog(null)} />}
      {dialog === 'history' && <HistoryDialog plan={plan} planName={planName} onClose={() => setDialog(null)} />}
    </>
  );
}

function LockDialog({ plan, planName, hasOpenForm, open, onOpenChange }: { plan: GoalPlan; planName: string; hasOpenForm: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const lock = useLockGoalPlan();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Khóa ${planName}?`}
      body={
        hasOpenForm
          ? 'Goal Plan không sửa được nữa, và phiếu đăng ký đang mở sẽ dừng ở bước hiện tại cho tới khi mở khóa. Việc khóa được ghi vào lịch sử.'
          : 'Goal Plan không sửa được nữa; muốn thay đổi chỉ tiêu cần phiếu điều chỉnh KPI. Việc khóa được ghi vào lịch sử.'
      }
      confirmLabel="Khóa Goal Plan"
      onConfirm={() => lock.mutate(plan.id, { onSuccess: () => toastSaved('Đã khóa Goal Plan') })}
    />
  );
}

function UnlockDialog({ plan, planName, registration, onClose }: { plan: GoalPlan; planName: string; registration: FormInstance | null; onClose: () => void }) {
  const { today, tenant } = useSession();
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState(() => addDays(today, 7));
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlock = useUnlockGoalPlan();
  // With no open form the new due date is not used (the plan returns to Approved) — send today.
  const effectiveDue = registration ? dueDate : today;
  const check = canUnlock(plan, { reason, newDueDate: effectiveDue }, { now: readGatewayNow(), tz: tenant.timezone });
  const issueOf = (ref: string) => (!check.ok ? firstIssueText(check.issues.filter((i) => i.ref === ref)) : undefined);

  const onConfirm = () => {
    setSubmitted(true);
    setError(null);
    if (!check.ok) return;
    unlock.mutate(
      { goalPlanId: plan.id, reason: reason.trim(), newDueDate: effectiveDue },
      {
        onSuccess: () => {
          toastSaved('Đã mở khóa Goal Plan');
          onClose();
        },
        onError: (e) => setError(e instanceof KpiError ? (firstIssueText(e.issues) ?? errorSpecOf(e).title) : null),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mở khóa {planName}</DialogTitle>
          <DialogDescription>
            {registration
              ? 'Phiếu đăng ký đang mở sẽ chạy lại bước hiện tại từ lúc mở khóa, với hạn mới bên dưới.'
              : 'Goal Plan trở về trạng thái Đã duyệt và sửa được trực tiếp bởi HR. Lý do được ghi vào lịch sử.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Lý do mở khóa" required error={submitted ? issueOf('reason') : undefined}>
            {(control) => <Textarea {...control} rows={3} placeholder="Lý do mở khóa (bắt buộc)" value={reason} onChange={(e) => setReason(e.target.value)} />}
          </FormField>
          {registration && (
            <FormField label="Hạn mới của phiếu đăng ký" required error={submitted ? issueOf('newDueDate') : undefined}>
              {(control) => <Input {...control} type="date" min={today} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
            </FormField>
          )}
          {error && (
            <p role="alert" className="text-sm text-support-negative">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={unlock.isPending}>
            Hủy
          </Button>
          <Button onClick={onConfirm} disabled={unlock.isPending} aria-busy={unlock.isPending}>
            Mở khóa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reasons the system writes, in words. */
const SYSTEM_REASON: Readonly<Record<string, string>> = { AUTO_LOCK: 'Tự động khóa do quá hạn bước' };

function HistoryDialog({ plan, planName, onClose }: { plan: GoalPlan; planName: string; onClose: () => void }) {
  const { people } = useSession();
  const entries = useAuditEntries({ entityName: 'GoalPlan', entityId: plan.id });
  const rows = (entries.data ?? []).filter((e) => e.action === 'LOCK' || e.action === 'UNLOCK').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const nameOf = (userId: string | null) => (userId === null ? 'Hệ thống' : (people.find((p) => p.userId === userId)?.name ?? 'Người dùng khác'));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lịch sử khóa · {planName}</DialogTitle>
          <DialogDescription>Mỗi lần khóa và mở khóa Goal Plan, kèm người thực hiện và lý do.</DialogDescription>
        </DialogHeader>
        {entries.error ? (
          <ErrorState spec={errorSpecOf(entries.error)} onAction={() => void entries.refetch()} />
        ) : entries.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Goal Plan chưa từng bị khóa.</p>
        ) : (
          <Table aria-label="Lịch sử khóa Goal Plan">
            <TableHeader>
              <TableRow>
                <TableHead>Thời điểm</TableHead>
                <TableHead>Thao tác</TableHead>
                <TableHead>Người thực hiện</TableHead>
                <TableHead>Lý do</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatDateTime(e.createdAt)}</TableCell>
                  <TableCell>{AUDIT_ACTION_LABEL[e.action]}</TableCell>
                  <TableCell>
                    {nameOf(e.userId)}
                    {e.onBehalfOfUserId && <span className="block text-xs text-muted-foreground">thay mặt {nameOf(e.onBehalfOfUserId)}</span>}
                  </TableCell>
                  <TableCell className="text-sm">{e.reason ? (SYSTEM_REASON[e.reason] ?? e.reason) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
