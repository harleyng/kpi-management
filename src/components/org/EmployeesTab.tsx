import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { SearchInput } from '@/components/shared/SearchInput';
import { EmploymentStatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/contexts/useSession';
import type { Employee } from '@/data/types';
import { useOrgDirectory } from '@/hooks/queries/org';
import { useSearchParamState } from '@/hooks/useSearchParamState';
import { descendantUnitIds, isStillEmployedOn, primaryAssignmentOn } from '@/lib/orgRules';
import { matchesSearch } from '@/lib/search';
import { formatDate } from '@/lib/utils';
import { EmployeeSheet } from './EmployeeSheet';
import { ImportActions } from './ImportActions';

const ALL = 'all';
type StatusFilter = 'working' | 'left' | typeof ALL;

interface Row {
  employee: Employee;
  unit: string | null;
  unitId: string | null;
  position: string | null;
  manager: string | null;
}

/** "Nhân sự" — every person, their primary assignment today, and the profile sheet (`?emp=`). WBS 4.1.3–4.1.4. */
export function EmployeesTab() {
  const { today } = useSession();
  const { data, query } = useOrgDirectory();
  const [empParam, setEmpParam] = useSearchParamState('emp');
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState(ALL);
  const [status, setStatus] = useState<StatusFilter>('working');
  // A person just created is shown at once, before the refreshed list includes them.
  const [created, setCreated] = useState<Employee | null>(null);

  const rows = useMemo<Row[] | undefined>(() => {
    if (!data) return undefined;
    const units = new Map(data.units.map((u) => [u.id, u]));
    const positions = new Map(data.positions.map((p) => [p.id, p]));
    const people = new Map(data.employees.map((e) => [e.id, e]));
    return data.employees.map((employee) => {
      // Today's primary line; for someone who has left, the last one they had.
      const current =
        primaryAssignmentOn(employee.id, data.assignments, today) ??
        [...data.assignments].filter((a) => a.employeeId === employee.id && a.isPrimary).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ??
        null;
      return {
        employee,
        unitId: current?.orgUnitId ?? null,
        unit: current ? (units.get(current.orgUnitId)?.name ?? null) : null,
        position: current ? (positions.get(current.positionId)?.name ?? null) : null,
        manager: current?.managerEmployeeId ? (people.get(current.managerEmployeeId)?.fullName ?? null) : null,
      };
    });
  }, [data, today]);

  const inUnit = useMemo(() => (data && unitFilter !== ALL ? descendantUnitIds(data.units, unitFilter) : null), [data, unitFilter]);
  const filtered = rows?.filter((r) => {
    const working = isStillEmployedOn(r.employee, today);
    if (status === 'working' && !working) return false;
    if (status === 'left' && working) return false;
    if (inUnit && (r.unitId === null || !inUnit.has(r.unitId))) return false;
    return matchesSearch(search, [r.employee.fullName, r.employee.employeeCode, r.employee.email]);
  });
  const isFiltered = search !== '' || unitFilter !== ALL || status !== 'working';

  const columns: DataTableColumn<Row>[] = [
    { id: 'code', header: 'Mã', cell: (r) => <span className="font-mono text-xs">{r.employee.employeeCode}</span>, sortValue: (r) => r.employee.employeeCode, className: 'w-20' },
    {
      id: 'name',
      header: 'Họ tên',
      cell: (r) => (
        <button type="button" className="max-w-[16rem] truncate text-left font-medium text-primary hover:underline focus-visible:underline" title={r.employee.fullName} onClick={() => setEmpParam(r.employee.id)}>
          {r.employee.fullName}
        </button>
      ),
      sortValue: (r) => r.employee.fullName,
    },
    { id: 'unit', header: 'Đơn vị chính', cell: (r) => r.unit, sortValue: (r) => r.unit },
    { id: 'position', header: 'Chức danh', cell: (r) => r.position, sortValue: (r) => r.position },
    { id: 'manager', header: 'Quản lý trực tiếp', cell: (r) => r.manager, sortValue: (r) => r.manager },
    { id: 'hired', header: 'Ngày vào làm', cell: (r) => <span className="tabular-nums">{formatDate(r.employee.hireDate)}</span>, sortValue: (r) => r.employee.hireDate, className: 'w-32' },
    { id: 'status', header: 'Trạng thái', cell: (r) => <EmploymentStatusBadge status={r.employee.employmentStatus} />, sortValue: (r) => r.employee.employmentStatus, className: 'w-28' },
  ];

  const sheetOpen = empParam !== null && data !== undefined;
  const editing = empParam === 'new' ? null : (data?.employees.find((e) => e.id === empParam) ?? (created?.id === empParam ? created : null));

  return (
    <>
      <DataTable
        label="Danh sách nhân sự"
        columns={columns}
        rows={filtered}
        query={query}
        getRowId={(r) => r.employee.id}
        empty="Chưa có nhân viên nào. Thêm nhân viên đầu tiên."
        isFiltered={isFiltered}
        onClearFilters={() => {
          setSearch('');
          setUnitFilter(ALL);
          setStatus('working');
        }}
        pageResetKey={`${search}|${unitFilter}|${status}`}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Tìm theo tên, mã hoặc email" className="w-64" />
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="h-9 w-56" aria-label="Lọc theo đơn vị">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Mọi đơn vị</SelectItem>
                {data?.units
                  .filter((u) => u.status === 'Active')
                  .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="h-9 w-44" aria-label="Lọc theo trạng thái">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="working">Đang làm việc</SelectItem>
                <SelectItem value="left">Đã nghỉ việc</SelectItem>
                <SelectItem value={ALL}>Tất cả</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ImportActions directory={data} />
            <Button size="sm" onClick={() => setEmpParam('new')} disabled={!data}>
              <Plus aria-hidden />
              Thêm nhân viên
            </Button>
          </div>
        }
      />
      {sheetOpen && (
        <EmployeeSheet
          key={empParam}
          employee={editing}
          notFound={empParam !== 'new' && editing === null}
          directory={data}
          onClose={() => setEmpParam(null)}
          onCreated={(employee) => {
            setCreated(employee);
            setEmpParam(employee.id);
          }}
        />
      )}
    </>
  );
}
