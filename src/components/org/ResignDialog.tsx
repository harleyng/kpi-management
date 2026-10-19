import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSession } from '@/contexts/useSession';
import type { Employee } from '@/data/types';
import { issuesOf, ResignError, useResignEmployee, type OrgDirectory } from '@/hooks/queries/org';
import { fieldIssues, otherIssues } from '@/lib/orgIssueCopy';
import { employeeIssues, resignationImpact } from '@/lib/orgAdminRules';

/**
 * "Cho nghỉ việc" (BR-KPI-68). States what the resignation leaves behind (`resignationImpact`) —
 * nothing of it is changed by itself — then sets the login Inactive and records the last working day
 * (`useResignEmployee`, in that order). A partial failure keeps the dialog open with a retry.
 */
export function ResignDialog({ employee, directory, onClose }: { employee: Employee; directory: OrgDirectory; onClose: () => void }) {
  const { today } = useSession();
  const resign = useResignEmployee();
  const [leftOn, setLeftOn] = useState(today);
  const [shownIssues, setShownIssues] = useState<ReturnType<typeof issuesOf>>([]);
  const impact = resignationImpact(employee.id, { ...directory, today });
  const failedAt = resign.error instanceof ResignError ? resign.error.stage : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const issues = leftOn === '' ? [{ code: 'ERR-KPI-06' as const, ref: 'leftOn', detail: 'REQUIRED', data: null }] : employeeIssues({ ...employee, employmentStatus: 'Resigned', leftOn }, employee, directory);
    setShownIssues(issues);
    if (issues.length > 0) return;
    resign.mutate(
      { employee, leftOn, activeAccounts: impact.activeAccounts },
      { onSuccess: onClose, onError: (error) => setShownIssues(issuesOf(error instanceof ResignError ? error.cause : error)) },
    );
  };
  const errors = fieldIssues(shownIssues);
  const problems = otherIssues(shownIssues, ['leftOn']);
  const reports = impact.directReports.length;
  const heads = impact.headedUnits.length;

  return (
    <Dialog open onOpenChange={(open) => !open && !resign.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Cho nghỉ việc {employee.fullName}?</DialogTitle>
            <DialogDescription>Các phân công đang có sẽ kết thúc vào ngày làm việc cuối. Lịch sử và kết quả cũ vẫn được giữ.</DialogDescription>
          </DialogHeader>
          <FormField label="Ngày làm việc cuối" required error={errors.leftOn}>
            {(c) => <Input {...c} type="date" value={leftOn} onChange={(e) => setLeftOn(e.target.value)} disabled={failedAt === 'resign'} />}
          </FormField>

          <div className="space-y-1.5 text-sm">
            <p className="font-medium">Ảnh hưởng</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Tài khoản đăng nhập: {impact.activeAccounts.length > 0 ? 'sẽ chuyển sang Ngừng dùng' : 'không có tài khoản đang hoạt động'}.</li>
              {(reports > 0 || heads > 0) && (
                <li>
                  {employee.fullName} đang là {[reports > 0 && `quản lý trực tiếp của ${reports} người`, heads > 0 && `trưởng ${heads} đơn vị`].filter(Boolean).join(' và ')}. Hãy chỉ định người thay
                  thế; hệ thống không tự đổi.
                </li>
              )}
              <li>Các phiếu đang mở của nhân viên vẫn tiếp tục theo quy trình.</li>
            </ul>
            {reports > 0 && (
              <p className="text-xs text-muted-foreground">Cấp dưới trực tiếp: {impact.directReports.map((e) => e.fullName).join(', ')}.</p>
            )}
          </div>

          {failedAt && (
            <p role="alert" className="rounded-md bg-support-negative-subtle px-3 py-2 text-sm text-support-negative">
              {failedAt === 'resign' ? 'Đã ngừng dùng tài khoản đăng nhập, nhưng chưa ghi nhận nghỉ việc.' : 'Chưa ngừng dùng được tài khoản đăng nhập. Chưa có thay đổi nào được lưu.'}
            </p>
          )}
          {problems.length > 0 && (
            <ul role="alert" className="space-y-1 text-sm text-support-negative">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={resign.isPending}>
              Hủy
            </Button>
            <Button type="submit" variant="destructive" disabled={resign.isPending} aria-busy={resign.isPending || undefined}>
              {resign.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
              {failedAt ? 'Thử lại' : 'Cho nghỉ việc'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
