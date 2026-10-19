import { useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EditSheet } from '@/components/shared/EditSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { EmploymentStatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/contexts/useSession';
import { EMPLOYMENT_STATUS_LABEL, type Employee, type EmployeeAssignment } from '@/data/types';
import { issuesOf, useSaveEmployee, type OrgDirectory } from '@/hooks/queries/org';
import { fieldIssues, otherIssues } from '@/lib/orgIssueCopy';
import { employeeIssues, type Draft } from '@/lib/orgAdminRules';
import { isEffectiveOn, isStillEmployedOn } from '@/lib/orgRules';
import { formatDate } from '@/lib/utils';
import { AssignmentDialog, type AssignmentMode } from './AssignmentDialog';
import { ResignDialog } from './ResignDialog';

const FIELDS = ['employeeCode', 'fullName', 'email', 'hireDate', 'employmentStatus', 'leftOn'];

interface EmployeeSheetProps {
  /** `null` = a new person. */
  employee: Employee | null;
  /** `?emp=` named someone who is not (or no longer) in this tenant. */
  notFound: boolean;
  directory: OrgDirectory;
  onClose: () => void;
  onCreated: (employee: Employee) => void;
}

/** One person: "Hồ sơ" (the profile form) and "Phân công" (their assignment history). WBS 4.1.3–4.1.4. */
export function EmployeeSheet({ employee, notFound, directory, onClose, onCreated }: EmployeeSheetProps) {
  const { today } = useSession();
  const save = useSaveEmployee();
  const initial: Draft<Employee> = useMemo(
    () => employee ?? { employeeCode: '', fullName: '', email: '', hireDate: today, employmentStatus: 'Probation', leftOn: null },
    [employee, today],
  );
  const [draft, setDraft] = useState(initial);
  const [shownIssues, setShownIssues] = useState<ReturnType<typeof issuesOf>>([]);
  const [dialog, setDialog] = useState<{ mode: AssignmentMode; assignment: EmployeeAssignment | null } | null>(null);
  const [resigning, setResigning] = useState(false);
  const set = <K extends keyof Draft<Employee>>(key: K, value: Draft<Employee>[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const submit = () => {
    const issues = employeeIssues(draft, employee, directory);
    setShownIssues(issues);
    if (issues.length > 0) return;
    save.mutate(draft, {
      onSuccess: (saved) => (employee ? undefined : onCreated(saved)),
      onError: (error) => setShownIssues(issuesOf(error)),
    });
  };
  const errors = fieldIssues(shownIssues);

  if (notFound) {
    return (
      <EditSheet open onOpenChange={(open) => !open && onClose()} title="Không tìm thấy nhân viên" dirty={false}>
        <EmptyState>Nhân viên này không tồn tại hoặc không thuộc công ty hiện tại.</EmptyState>
      </EditSheet>
    );
  }

  const working = employee ? isStillEmployedOn(employee, today) : true;

  return (
    <>
    <EditSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={employee ? employee.fullName : 'Thêm nhân viên'}
      description={employee ? `Mã ${employee.employeeCode}` : 'Lưu hồ sơ trước, sau đó thêm phân công chính.'}
      dirty={dirty}
      onSubmit={submit}
      submitLabel={employee ? 'Lưu hồ sơ' : 'Thêm nhân viên'}
      submitting={save.isPending}
      problems={otherIssues(shownIssues, FIELDS)}
      wide
      footerStart={
        employee && employee.employmentStatus !== 'Resigned' ? (
          <Button type="button" variant="outline" className="text-support-negative" onClick={() => setResigning(true)}>
            Cho nghỉ việc
          </Button>
        ) : undefined
      }
    >
      <section aria-labelledby="emp-profile" className="space-y-4">
        <h3 id="emp-profile" className="text-sm font-semibold">
          Hồ sơ
        </h3>
        <RequiredLegend />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Mã nhân viên" required error={errors.employeeCode}>
            {(c) => <Input {...c} value={draft.employeeCode} onChange={(e) => set('employeeCode', e.target.value.toUpperCase())} className="font-mono" />}
          </FormField>
          <FormField label="Họ và tên" required error={errors.fullName}>
            {(c) => <Input {...c} value={draft.fullName} onChange={(e) => set('fullName', e.target.value)} />}
          </FormField>
          <FormField label="Email" required error={errors.email}>
            {(c) => <Input {...c} type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />}
          </FormField>
          <FormField label="Ngày vào làm" required error={errors.hireDate}>
            {(c) => <Input {...c} type="date" value={draft.hireDate} onChange={(e) => set('hireDate', e.target.value)} />}
          </FormField>
          {draft.employmentStatus === 'Resigned' ? (
            <div className="space-y-1.5 text-sm">
              <p className="font-medium">Trạng thái</p>
              <p className="flex items-center gap-2">
                <EmploymentStatusBadge status="Resigned" />
                <span className="tabular-nums text-muted-foreground">Ngày làm việc cuối {draft.leftOn ? formatDate(draft.leftOn) : '—'}</span>
              </p>
            </div>
          ) : (
            <FormField label="Trạng thái" required error={errors.employmentStatus} hint="Nghỉ việc: dùng nút “Cho nghỉ việc”.">
              {(c) => (
                <Select value={draft.employmentStatus} onValueChange={(v) => set('employmentStatus', v as Employee['employmentStatus'])}>
                  <SelectTrigger {...c}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['Probation', 'Official'] as const).map((s) => (
                      <SelectItem key={s} value={s}>
                        {EMPLOYMENT_STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}
        </div>
      </section>

      {employee && (
        <Assignments
          employee={employee}
          directory={directory}
          canAdd={working}
          onOpen={(mode, assignment) => setDialog({ mode, assignment })}
        />
      )}
    </EditSheet>
      {/* Outside the sheet's <form>: a portal still bubbles React events to its tree parent. */}
      {dialog && employee && (
        <AssignmentDialog
          key={`${dialog.mode}-${dialog.assignment?.id ?? 'new'}`}
          mode={dialog.mode}
          employee={employee}
          assignment={dialog.assignment}
          directory={directory}
          onClose={() => setDialog(null)}
        />
      )}
      {resigning && employee && <ResignDialog employee={employee} directory={directory} onClose={() => setResigning(false)} />}
    </>
  );
}

interface AssignmentRow {
  a: EmployeeAssignment;
  unit: string;
  position: string;
  manager: string | null;
  current: boolean;
}

function Assignments({
  employee,
  directory,
  canAdd,
  onOpen,
}: {
  employee: Employee;
  directory: OrgDirectory;
  canAdd: boolean;
  onOpen: (mode: AssignmentMode, assignment: EmployeeAssignment | null) => void;
}) {
  const { today } = useSession();
  const rows = useMemo<AssignmentRow[]>(() => {
    const unit = new Map(directory.units.map((u) => [u.id, u.name]));
    const position = new Map(directory.positions.map((p) => [p.id, p.name]));
    const person = new Map(directory.employees.map((e) => [e.id, e.fullName]));
    return directory.assignments
      .filter((a) => a.employeeId === employee.id)
      .sort((x, y) => y.effectiveFrom.localeCompare(x.effectiveFrom))
      .map((a) => ({
        a,
        unit: unit.get(a.orgUnitId) ?? '—',
        position: position.get(a.positionId) ?? '—',
        manager: a.managerEmployeeId ? (person.get(a.managerEmployeeId) ?? null) : null,
        current: isEffectiveOn(a, today) || a.effectiveFrom > today,
      }));
  }, [directory, employee.id, today]);
  const hasPrimary = rows.some((r) => r.a.isPrimary && r.current);

  const columns: DataTableColumn<AssignmentRow>[] = [
    { id: 'unit', header: 'Đơn vị', cell: (r) => r.unit },
    { id: 'position', header: 'Chức danh', cell: (r) => r.position },
    { id: 'manager', header: 'Quản lý trực tiếp', cell: (r) => r.manager },
    { id: 'type', header: 'Loại', cell: (r) => (r.a.isPrimary ? 'Chính' : 'Kiêm nhiệm'), className: 'w-24' },
    {
      id: 'dates',
      header: 'Hiệu lực',
      cell: (r) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatDate(r.a.effectiveFrom)} – {r.a.effectiveTo ? formatDate(r.a.effectiveTo) : 'nay'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Thao tác',
      cell: (r) =>
        r.current && r.a.effectiveTo === null && canAdd ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpen('end', r.a)} aria-label={`Kết thúc phân công tại ${r.unit}`}>
            Kết thúc
          </Button>
        ) : null,
      className: 'w-24',
    },
  ];

  return (
    <section aria-labelledby="emp-assignments" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="emp-assignments" className="text-sm font-semibold">
          Phân công
        </h3>
        {canAdd && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onOpen(hasPrimary ? 'transfer' : 'first', null)}>
              {hasPrimary ? 'Điều chuyển' : 'Thêm phân công chính'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpen('concurrent', null)} disabled={!hasPrimary}>
              Thêm kiêm nhiệm
            </Button>
          </div>
        )}
      </div>
      <DataTable
        label={`Phân công của ${employee.fullName}`}
        columns={columns}
        rows={rows}
        query={{ isPending: false, fetchStatus: 'idle', error: null, refetch: () => undefined }}
        getRowId={(r) => r.a.id}
        empty="Chưa có phân công. Thêm phân công chính để nhân viên thuộc một đơn vị."
        pageSize={null}
      />
    </section>
  );
}
