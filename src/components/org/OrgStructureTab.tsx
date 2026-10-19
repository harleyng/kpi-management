import { useId, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { BlockedReason } from '@/components/shared/BlockedReason';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { OrgUnitTreeView } from '@/components/shared/OrgUnitTree';
import { RecordStatusBadge, StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useSession } from '@/contexts/useSession';
import { ORG_UNIT_TYPE_LABEL, type EmployeeAssignment, type OrgUnit } from '@/data/types';
import { useOrgDirectory, useSaveOrgUnit, type OrgDirectory } from '@/hooks/queries/org';
import { useSearchParamState } from '@/hooks/useSearchParamState';
import { errorSpecOf } from '@/lib/errorCatalog';
import { orgIssueText } from '@/lib/orgIssueCopy';
import { unitEndIssues } from '@/lib/orgAdminRules';
import { isEffectiveOn } from '@/lib/orgRules';
import { formatDate } from '@/lib/utils';
import { UnitSheet } from './UnitSheet';

type SheetState = { unit: OrgUnit | null; parentId: string | null } | null;

/** "Cơ cấu" — the org tree beside the selected unit's detail (WBS 4.1.2). Selection is `?unit=`. */
export function OrgStructureTab() {
  const { data, query } = useOrgDirectory();
  const [unitParam, setUnitParam] = useSearchParamState('unit');
  const [inactiveParam, setInactiveParam] = useSearchParamState('inactive');
  const showInactive = inactiveParam === '1';
  const [sheet, setSheet] = useState<SheetState>(null);
  const switchId = useId();

  const root = data?.units.find((u) => u.parentId === null) ?? null;
  const selectedId = unitParam ?? root?.id ?? null;
  const selected = data?.units.find((u) => u.id === selectedId) ?? null;
  const treeUnits = useMemo(() => data?.units.filter((u) => showInactive || u.status === 'Active' || u.id === selectedId), [data, showInactive, selectedId]);

  return (
    <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Cây tổ chức</h2>
            <Button size="sm" onClick={() => setSheet({ unit: null, parentId: selected?.id ?? root?.id ?? null })} disabled={!data}>
              <Plus aria-hidden />
              Thêm đơn vị
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Switch id={switchId} checked={showInactive} onCheckedChange={(on) => setInactiveParam(on ? '1' : null)} />
            <Label htmlFor={switchId} className="text-xs font-normal text-muted-foreground">
              Hiện đơn vị ngừng dùng
            </Label>
          </div>
          <OrgUnitTreeView label="Cây tổ chức" units={treeUnits} query={query} selected={selectedId ? [selectedId] : []} onSelectedChange={(ids) => setUnitParam(ids[0] ?? null)} />
        </CardContent>
      </Card>

      <section role="region" aria-labelledby={selected ? `unit-${selected.id}` : undefined} className="min-w-0">
        {query.error != null ? (
          <Card>
            <CardContent className="p-4">
              <ErrorState spec={errorSpecOf(query.error)} onAction={() => query.refetch()} />
            </CardContent>
          </Card>
        ) : !data ? (
          <Card>
            <CardContent className="space-y-3 p-4" aria-busy>
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ) : data.units.length === 0 ? (
          <Card>
            <CardContent className="p-4">
              <EmptyState>Chưa có đơn vị nào. Thêm đơn vị gốc để bắt đầu.</EmptyState>
            </CardContent>
          </Card>
        ) : !selected ? (
          <Card>
            <CardContent className="p-4">
              <EmptyState action={<Button variant="outline" size="sm" onClick={() => setUnitParam(null)}>Về đơn vị gốc</Button>}>Không tìm thấy đơn vị.</EmptyState>
            </CardContent>
          </Card>
        ) : (
          <UnitDetail
            unit={selected}
            directory={data}
            onEdit={() => setSheet({ unit: selected, parentId: selected.parentId })}
            onAddChild={() => setSheet({ unit: null, parentId: selected.id })}
          />
        )}
      </section>

      {sheet && data && (
        <UnitSheet
          key={sheet.unit?.id ?? `new-${sheet.parentId}`}
          open
          onOpenChange={(open) => !open && setSheet(null)}
          unit={sheet.unit}
          parentId={sheet.parentId}
          directory={data}
          onSaved={(saved) => {
            setSheet(null);
            setUnitParam(saved.id);
          }}
        />
      )}
    </div>
  );
}

interface StaffRow {
  assignment: EmployeeAssignment;
  name: string;
  code: string;
  position: string;
  manager: string | null;
  isHead: boolean;
}

function UnitDetail({ unit, directory, onEdit, onAddChild }: { unit: OrgUnit; directory: OrgDirectory; onEdit: () => void; onAddChild: () => void }) {
  const { today } = useSession();
  const save = useSaveOrgUnit();
  const [confirmStop, setConfirmStop] = useState(false);
  const reasonId = useId();

  const byId = useMemo(() => new Map(directory.employees.map((e) => [e.id, e])), [directory.employees]);
  const parent = directory.units.find((u) => u.id === unit.parentId);
  const head = unit.headEmployeeId ? byId.get(unit.headEmployeeId) : undefined;
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
          <span className="truncate" title={r.name}>{r.name}</span>
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
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={`unit-${unit.id}`} className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                <span className="break-words">{unit.name}</span>
                <RecordStatusBadge status={unit.status} />
              </h2>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono">{unit.code}</span>, {ORG_UNIT_TYPE_LABEL[unit.unitType]}
                {parent && <>, thuộc {parent.name}</>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onEdit}>
                Sửa
              </Button>
              {unit.status === 'Active' && unit.unitType !== 'Team' && (
                <Button variant="outline" size="sm" onClick={onAddChild}>
                  Thêm đơn vị trực thuộc
                </Button>
              )}
              {unit.status === 'Active' && !isRoot && (
                <Button variant="outline" size="sm" disabled={!canStop} aria-describedby={canStop ? undefined : reasonId} onClick={() => setConfirmStop(true)}>
                  Ngừng dùng
                </Button>
              )}
            </div>
          </div>
          {!canStop && unit.status === 'Active' && !isRoot && (
            <div id={reasonId} className="space-y-0.5">
              {stopIssues.map((i) => (
                <BlockedReason key={i.detail}>{orgIssueText(i)}</BlockedReason>
              ))}
            </div>
          )}
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
          </dl>
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Nhân sự <span className="font-normal tabular-nums text-muted-foreground">({staff.length})</span>
        </h3>
        <DataTable
          label={`Nhân sự của ${unit.name}`}
          columns={columns}
          rows={staff}
          query={{ isPending: false, fetchStatus: 'idle', error: null, refetch: () => undefined }}
          getRowId={(r) => r.assignment.id}
          empty="Đơn vị này chưa có nhân sự. Chuyển nhân viên đến từ tab Nhân sự."
          pageSize={null}
        />
      </div>

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
    </div>
  );
}
