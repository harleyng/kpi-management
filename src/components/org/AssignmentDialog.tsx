import { useMemo, useState, type FormEvent } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { EmployeePicker } from '@/components/shared/EmployeePicker';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/contexts/useSession';
import type { Employee, EmployeeAssignment } from '@/data/types';
import { issuesOf, useSaveAssignment, type OrgDirectory } from '@/hooks/queries/org';
import { fieldIssues, otherIssues } from '@/lib/orgIssueCopy';
import { assignmentIssues, managerOutsideUnit, transferPlan, type Draft } from '@/lib/orgAdminRules';
import { primaryAssignmentOn } from '@/lib/orgRules';
import { formatDate } from '@/lib/utils';

/** `first` = the first primary line · `transfer` = a new primary line (B1) · `concurrent` = kiêm nhiệm · `end` = close a row. */
export type AssignmentMode = 'first' | 'transfer' | 'concurrent' | 'end';

const TITLE: Record<AssignmentMode, string> = {
  first: 'Thêm phân công chính',
  transfer: 'Điều chuyển',
  concurrent: 'Thêm kiêm nhiệm',
  end: 'Kết thúc phân công',
};
const FIELDS = ['orgUnitId', 'positionId', 'managerEmployeeId', 'effectiveFrom', 'effectiveTo'];

interface AssignmentDialogProps {
  mode: AssignmentMode;
  employee: Employee;
  /** The row to end (`end`). */
  assignment: EmployeeAssignment | null;
  directory: OrgDirectory;
  onClose: () => void;
}

export function AssignmentDialog({ mode, employee, assignment, directory, onClose }: AssignmentDialogProps) {
  const { today } = useSession();
  const save = useSaveAssignment();
  const current = primaryAssignmentOn(employee.id, directory.assignments, today);
  const [draft, setDraft] = useState<Draft<EmployeeAssignment>>(() =>
    mode === 'end' && assignment
      ? { ...assignment, effectiveTo: today }
      : {
          employeeId: employee.id,
          orgUnitId: mode === 'transfer' ? (current?.orgUnitId ?? '') : '',
          positionId: mode === 'transfer' ? (current?.positionId ?? '') : '',
          managerEmployeeId: mode === 'transfer' ? (current?.managerEmployeeId ?? null) : null,
          isPrimary: mode !== 'concurrent',
          effectiveFrom: mode === 'first' ? employee.hireDate : today,
          effectiveTo: null,
        },
  );
  const [shownIssues, setShownIssues] = useState<ReturnType<typeof issuesOf>>([]);
  const set = <K extends keyof Draft<EmployeeAssignment>>(key: K, value: Draft<EmployeeAssignment>[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const units = useMemo(() => directory.units.filter((u) => u.status === 'Active').sort((a, b) => a.name.localeCompare(b.name, 'vi')), [directory.units]);
  const positions = useMemo(() => directory.positions.filter((p) => p.status === 'Active').sort((a, b) => a.name.localeCompare(b.name, 'vi')), [directory.positions]);
  const plan = mode === 'end' ? null : transferPlan(draft, null, directory.assignments);
  const outside = mode !== 'end' && draft.orgUnitId !== '' && managerOutsideUnit(draft, directory);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const missing = mode === 'end' ? [] : (['orgUnitId', 'positionId', 'effectiveFrom'] as const).filter((f) => draft[f] === '');
    const issues = [
      ...missing.map((f) => ({ code: 'ERR-KPI-06' as const, ref: f, detail: 'REQUIRED', data: null })),
      ...(missing.length ? [] : [...(plan?.issues ?? []), ...assignmentIssues(draft, mode === 'end' ? assignment : null, directory)]),
    ];
    setShownIssues(issues);
    if (issues.length > 0) return;
    save.mutate(draft, { onSuccess: onClose, onError: (error) => setShownIssues(issuesOf(error)) });
  };
  const errors = fieldIssues(shownIssues);
  const problems = otherIssues(shownIssues, FIELDS);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{TITLE[mode]}</DialogTitle>
            <DialogDescription>{employee.fullName}</DialogDescription>
          </DialogHeader>

          {mode === 'end' ? (
            <FormField label="Ngày kết thúc" required error={errors.effectiveTo}>
              {(c) => <Input {...c} type="date" value={draft.effectiveTo ?? ''} onChange={(e) => set('effectiveTo', e.target.value || null)} />}
            </FormField>
          ) : (
            <>
              <FormField label="Đơn vị" required error={errors.orgUnitId}>
                {(c) => (
                  <Select value={draft.orgUnitId || undefined} onValueChange={(v) => set('orgUnitId', v)}>
                    <SelectTrigger {...c}>
                      <SelectValue placeholder="Chọn đơn vị" />
                    </SelectTrigger>
                    <SelectContent>
                      {units.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label="Chức danh" required error={errors.positionId}>
                {(c) => (
                  <Select value={draft.positionId || undefined} onValueChange={(v) => set('positionId', v)}>
                    <SelectTrigger {...c}>
                      <SelectValue placeholder="Chọn chức danh" />
                    </SelectTrigger>
                    <SelectContent>
                      {positions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label="Quản lý trực tiếp" error={errors.managerEmployeeId} hint="Để trống nếu là người đứng đầu công ty.">
                {(c) => <EmployeePicker {...c} value={draft.managerEmployeeId} onChange={(id) => set('managerEmployeeId', id)} filter={{ activeOn: draft.effectiveFrom || today }} />}
              </FormField>
              {outside && (
                <p role="status" className="-mt-2 flex items-center gap-1.5 text-xs">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-support-warning" aria-hidden />
                  Quản lý này không thuộc đơn vị của nhân viên. Vẫn có thể lưu.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <FormField label={mode === 'transfer' ? 'Điều chuyển từ ngày' : 'Từ ngày'} required error={errors.effectiveFrom}>
                  {(c) => <Input {...c} type="date" value={draft.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />}
                </FormField>
                <FormField label="Đến ngày" error={errors.effectiveTo} hint="Để trống nếu chưa xác định.">
                  {(c) => <Input {...c} type="date" value={draft.effectiveTo ?? ''} onChange={(e) => set('effectiveTo', e.target.value || null)} />}
                </FormField>
              </div>
              {plan?.end && (
                <div role="status" className="space-y-1 rounded-md bg-surface-alt px-3 py-2 text-sm">
                  <p>
                    Điều chuyển từ ngày <span className="tabular-nums">{formatDate(draft.effectiveFrom)}</span>. Phân công hiện tại sẽ kết thúc ngày{' '}
                    <span className="tabular-nums">{formatDate(plan.end.effectiveTo as string)}</span>.
                  </p>
                  <p className="text-xs text-muted-foreground">Các bước của quản lý trên phiếu đang mở sẽ chuyển cho quản lý trực tiếp mới.</p>
                </div>
              )}
            </>
          )}

          {problems.length > 0 && (
            <ul role="alert" className="space-y-1 text-sm text-support-negative">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" disabled={save.isPending} aria-busy={save.isPending || undefined}>
              {save.isPending && <Loader2 className="motion-safe:animate-spin" aria-hidden />}
              {mode === 'end' ? 'Kết thúc phân công' : mode === 'transfer' ? 'Điều chuyển' : 'Lưu phân công'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
