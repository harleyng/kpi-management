import { useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BlockedReason } from '@/components/shared/BlockedReason';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { PageHeader, type Crumb } from '@/components/shared/PageHeader';
import { RecordStatusBadge, StatusBadge } from '@/components/shared/StatusBadge';
import { ORG_STRUCTURE_URL } from '@/components/org/OrgStructureTab';
import { UnitSheet } from '@/components/org/UnitSheet';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/contexts/useSession';
import { ORG_UNIT_TYPE_LABEL, type EmployeeAssignment, type OrgUnit } from '@/data/types';
import { useOrgDirectory, useSaveOrgUnit, type OrgDirectory } from '@/hooks/queries/org';
import { ERROR_CATALOG, errorSpecOf } from '@/lib/errorCatalog';
import { orgIssueText } from '@/lib/orgIssueCopy';
import { unitEndIssues } from '@/lib/orgAdminRules';
import { isEffectiveOn, unitAncestry } from '@/lib/orgRules';
import { formatDate } from '@/lib/utils';

type SheetState = { unit: OrgUnit | null; parentId: string | null } | null;

/**
 * One org unit (WBS 4.1.2) — opened from the "Cơ cấu" tree. The trail is "Cơ cấu" then the unit's
 * parents, each a link, so the user climbs the tree from here. The unit comes from the tenant's
 * (cached) directory: still loading → skeleton; not in it → ERR-KPI-02 under the trail.
 */
export default function OrgUnitDetailPage() {
  const { unitId } = useParams();
  const { data, query } = useOrgDirectory();
  const base: Crumb[] = [{ label: 'Cơ cấu', to: ORG_STRUCTURE_URL }];

  if (query.error != null) {
    return (
      <>
        <PageHeader breadcrumb={base} title="Cơ cấu" />
        <ErrorStateCard spec={errorSpecOf(query.error)} onAction={() => void query.refetch()} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader breadcrumb={base} title="Cơ cấu" />
        <Skeleton className="h-64 w-full" />
      </>
    );
  }
  const unit = data.units.find((u) => u.id === unitId);
  if (!unit) {
    return (
      <>
        <PageHeader breadcrumb={base} title="Không tìm thấy đơn vị" />
        <ErrorStateCard spec={ERROR_CATALOG['ERR-KPI-02']} />
      </>
    );
  }
  return <UnitDetail key={unit.id} unit={unit} directory={data} base={base} />;
}

interface StaffRow {
  assignment: EmployeeAssignment;
  name: string;
  code: string;
  position: string;
  manager: string | null;
  isHead: boolean;
}

function UnitDetail({ unit, directory, base }: { unit: OrgUnit; directory: OrgDirectory; base: Crumb[] }) {
  const { today } = useSession();
  const navigate = useNavigate();
  const save = useSaveOrgUnit();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const reasonId = useId();

  const unitById = useMemo(() => new Map(directory.units.map((u) => [u.id, u])), [directory.units]);
  const byId = useMemo(() => new Map(directory.employees.map((e) => [e.id, e])), [directory.employees]);
  // Root first, the unit itself left out — it is the title.
  const trail: Crumb[] = [
    ...base,
    ...unitAncestry(unit.id, directory.units)
      .slice(1)
      .reverse()
      .map((id) => ({ label: unitById.get(id)?.name ?? id, to: `${ORG_STRUCTURE_URL}/${id}` })),
  ];
  const parent = unit.parentId ? unitById.get(unit.parentId) : undefined;
  const head = unit.headEmployeeId ? byId.get(unit.headEmployeeId) : undefined;
  const children = directory.units.filter((u) => u.parentId === unit.id).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const staff = useMemo<StaffRow[]>(
    () =>
      directory.assignments
        .filter((a) => a.orgUnitId === unit.id && isEffectiveOn(a, today))
        .map((a) => ({
          assignment: a,
          name: byId.get(a.employeeId)?.fullName ?? '—',
          code: byId.get(a.employeeId)?.employeeCode ?? '',
          position: directory.positions.find((p) => p.id === a.positionId)?.name ?? '—',
          manager: a.managerEmployeeId ? (byId.get(a.managerEmployeeId)?.fullName ?? null) : null,
          isHead: a.employeeId === unit.headEmployeeId,
        }))
        .sort((x, y) => Number(y.isHead) - Number(x.isHead) || x.name.localeCompare(y.name, 'vi')),
    [directory, unit, today, byId],
  );

  // The plans check needs the goals data (T3): the gateway makes it, and its refusal names the reason.
  const isRoot = unit.parentId === null;
  const stopIssues = unit.status === 'Active' && !isRoot ? unitEndIssues(unit, today, { ...directory, plans: [], cycles: [], today }) : [];
  const canStop = unit.status === 'Active' && stopIssues.length === 0;

  const columns: DataTableColumn<StaffRow>[] = [
    { id: 'code', header: 'Mã', cell: (r) => <span className="font-mono text-xs">{r.code}</span>, sortValue: (r) => r.code, className: 'w-20' },
    {
      id: 'name',
      header: 'Họ tên',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className="truncate" title={r.name}>
            {r.name}
          </span>
          {r.isHead && <StatusBadge tone="info">Trưởng đơn vị</StatusBadge>}
        </span>
      ),
      sortValue: (r) => r.name,
    },
    { id: 'position', header: 'Chức danh', cell: (r) => r.position, sortValue: (r) => r.position },
    { id: 'manager', header: 'Quản lý trực tiếp', cell: (r) => r.manager, sortValue: (r) => r.manager },
    { id: 'type', header: 'Loại', cell: (r) => (r.assignment.isPrimary ? 'Chính' : 'Kiêm nhiệm'), className: 'w-28' },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={trail}
        title={unit.name}
        status={unit.status === 'Inactive' ? <RecordStatusBadge status={unit.status} /> : undefined}
        description={
          <>
            <span className="font-mono">{unit.code}</span>, {ORG_UNIT_TYPE_LABEL[unit.unitType]}
            {parent && <>, thuộc {parent.name}</>}
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setSheet({ unit, parentId: unit.parentId })}>
              Sửa
            </Button>
            {unit.status === 'Active' && unit.unitType !== 'Team' && (
              <Button variant="outline" size="sm" onClick={() => setSheet({ unit: null, parentId: unit.id })}>
                Thêm đơn vị trực thuộc
              </Button>
            )}
            {unit.status === 'Active' && !isRoot && (
              <Button variant="outline" size="sm" disabled={!canStop} aria-describedby={canStop ? undefined : reasonId} onClick={() => setConfirmStop(true)}>
                Ngừng dùng
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-6">
        {!canStop && unit.status === 'Active' && !isRoot && (
          <div id={reasonId} className="space-y-0.5">
            {stopIssues.map((i) => (
              <BlockedReason key={i.detail}>{orgIssueText(i)}</BlockedReason>
            ))}
          </div>
        )}
        <Card>
          <CardContent className="p-4">
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Trưởng đơn vị:</dt>
                <dd>{head?.fullName ?? '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Hiệu lực:</dt>
                <dd className="tabular-nums">
                  {formatDate(unit.effectiveFrom)} – {unit.effectiveTo ? formatDate(unit.effectiveTo) : 'nay'}
                </dd>
              </div>
              {children.length > 0 && (
                <div className="flex gap-2 sm:col-span-2">
                  <dt className="shrink-0 text-muted-foreground">Đơn vị trực thuộc:</dt>
                  <dd>
                    <ul className="flex flex-wrap gap-x-3 gap-y-1">
                      {children.map((c) => (
                        <li key={c.id}>
                          <Link to={`${ORG_STRUCTURE_URL}/${c.id}`} className="text-primary underline-offset-4 hover:underline focus-visible:underline">
                            {c.name}
                          </Link>
                          {c.status === 'Inactive' && <span className="ml-1 text-xs text-muted-foreground">(ngừng dùng)</span>}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <section aria-labelledby="unit-staff">
          <h2 id="unit-staff" className="mb-2 text-base font-semibold">
            Nhân sự <span className="font-normal tabular-nums text-muted-foreground">({staff.length})</span>
          </h2>
          <DataTable
            label={`Nhân sự của ${unit.name}`}
            columns={columns}
            rows={staff}
            query={{ isPending: false, fetchStatus: 'idle', error: null, refetch: () => undefined }}
            getRowId={(r) => r.assignment.id}
            empty="Đơn vị này chưa có nhân sự. Chuyển nhân viên đến từ trang Nhân sự."
            pageSize={null}
          />
        </section>
      </div>

      {sheet && (
        <UnitSheet
          key={sheet.unit?.id ?? `new-${sheet.parentId}`}
          open
          onOpenChange={(open) => !open && setSheet(null)}
          unit={sheet.unit}
          parentId={sheet.parentId}
          directory={directory}
          onSaved={(saved) => {
            setSheet(null);
            if (saved.id !== unit.id) navigate(`${ORG_STRUCTURE_URL}/${saved.id}`);
          }}
        />
      )}
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={`Ngừng dùng đơn vị ${unit.name}?`}
        body="Đơn vị sẽ không còn được chọn khi phân công. Dữ liệu cũ vẫn được giữ."
        confirmLabel="Ngừng dùng"
        destructive
        onConfirm={() => {
          setConfirmStop(false);
          save.mutate({ ...unit, status: 'Inactive', effectiveTo: unit.effectiveTo ?? today });
        }}
      />
    </>
  );
}
