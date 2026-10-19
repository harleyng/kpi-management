import { useMemo, useState } from 'react';
import { EditSheet } from '@/components/shared/EditSheet';
import { EmployeePicker } from '@/components/shared/EmployeePicker';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/contexts/useSession';
import { ORG_UNIT_TYPE_LABEL, ORG_UNIT_TYPES, type OrgUnit, type OrgUnitType } from '@/data/types';
import { issuesOf, useSaveOrgUnit, type OrgDirectory } from '@/hooks/queries/org';
import { fieldIssues, otherIssues } from '@/lib/orgIssueCopy';
import { unitIssues, type Draft } from '@/lib/orgAdminRules';
import { descendantUnitIds } from '@/lib/orgRules';

const FIELDS = ['name', 'code', 'unitType', 'parentId', 'headEmployeeId', 'effectiveFrom', 'effectiveTo'];

interface UnitSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The unit being edited, or `null` to add one under `parentId`. */
  unit: OrgUnit | null;
  parentId: string | null;
  directory: OrgDirectory;
  onSaved: (unit: OrgUnit) => void;
}

/** Add or edit a unit of the tree (WBS 4.1.2). Stopping a unit is its own action on the detail panel. */
export function UnitSheet({ open, onOpenChange, unit, parentId, directory, onSaved }: UnitSheetProps) {
  const { today } = useSession();
  const save = useSaveOrgUnit();
  const initial: Draft<OrgUnit> = useMemo(
    () =>
      unit ?? {
        parentId,
        code: '',
        name: '',
        unitType: childTypeOf(directory.units.find((u) => u.id === parentId)?.unitType),
        headEmployeeId: null,
        effectiveFrom: today,
        effectiveTo: null,
        status: 'Active',
      },
    [unit, parentId, directory.units, today],
  );
  const [draft, setDraft] = useState(initial);
  const [shownIssues, setShownIssues] = useState<ReturnType<typeof issuesOf>>([]);
  const set = <K extends keyof Draft<OrgUnit>>(key: K, value: Draft<OrgUnit>[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  // A unit cannot move under itself or below: offer only Active units outside its own subtree.
  const parents = useMemo(() => {
    const own = unit ? descendantUnitIds(directory.units, unit.id) : new Set<string>();
    return directory.units.filter((u) => u.status === 'Active' && !own.has(u.id)).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [directory.units, unit]);
  const isRoot = unit !== null && unit.parentId === null;

  const submit = () => {
    const ctx = { ...directory, plans: [], cycles: [], today };
    const issues = unitIssues(draft, unit, ctx);
    setShownIssues(issues);
    if (issues.length > 0) return;
    save.mutate(draft, {
      onSuccess: (saved) => onSaved(saved),
      onError: (error) => setShownIssues(issuesOf(error)),
    });
  };
  const errors = fieldIssues(shownIssues);

  return (
    <EditSheet
      open={open}
      onOpenChange={onOpenChange}
      title={unit ? `Sửa đơn vị ${unit.name}` : 'Thêm đơn vị'}
      dirty={dirty}
      onSubmit={submit}
      submitting={save.isPending}
      problems={otherIssues(shownIssues, FIELDS)}
    >
      <RequiredLegend />
      <FormField label="Tên đơn vị" required error={errors.name}>
        {(c) => <Input {...c} value={draft.name} onChange={(e) => set('name', e.target.value)} />}
      </FormField>
      <FormField label="Mã đơn vị" required error={errors.code} hint="Dùng trong file nhập dữ liệu, không trùng đơn vị khác.">
        {(c) => <Input {...c} value={draft.code} onChange={(e) => set('code', e.target.value.toUpperCase())} className="font-mono" />}
      </FormField>
      <FormField label="Loại đơn vị" required error={errors.unitType}>
        {(c) => (
          <Select value={draft.unitType} onValueChange={(v) => set('unitType', v as OrgUnitType)} disabled={isRoot}>
            <SelectTrigger {...c}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORG_UNIT_TYPES.filter((t) => (isRoot ? t === 'Company' : t !== 'Company')).map((t) => (
                <SelectItem key={t} value={t}>
                  {ORG_UNIT_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      {!isRoot && (
        <FormField label="Thuộc đơn vị" required error={errors.parentId} hint="Chọn đơn vị khác để chuyển đơn vị này cùng các đơn vị trực thuộc.">
          {(c) => (
            <Select value={draft.parentId ?? undefined} onValueChange={(v) => set('parentId', v)}>
              <SelectTrigger {...c}>
                <SelectValue placeholder="Chọn đơn vị cấp trên" />
              </SelectTrigger>
              <SelectContent>
                {parents.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({ORG_UNIT_TYPE_LABEL[u.unitType]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}
      <FormField
        label="Trưởng đơn vị"
        error={errors.headEmployeeId}
        hint={unit ? 'Người đang được phân công vào đơn vị này hoặc đơn vị trực thuộc.' : 'Chọn sau khi đã phân công nhân sự vào đơn vị.'}
      >
        {(c) => (
          <EmployeePicker
            {...c}
            value={draft.headEmployeeId}
            onChange={(id) => set('headEmployeeId', id)}
            disabled={!unit}
            filter={unit ? { orgUnitId: unit.id, includeChildUnits: true, activeOn: today } : undefined}
          />
        )}
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Hiệu lực từ" required error={errors.effectiveFrom}>
          {(c) => <Input {...c} type="date" value={draft.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />}
        </FormField>
        <FormField label="Đến ngày" error={errors.effectiveTo ?? errors.status} hint="Để trống nếu đơn vị còn hoạt động.">
          {(c) => <Input {...c} type="date" value={draft.effectiveTo ?? ''} onChange={(e) => set('effectiveTo', e.target.value || null)} />}
        </FormField>
      </div>
    </EditSheet>
  );
}

/** A sensible default type one rank below the parent. */
function childTypeOf(parent: OrgUnitType | undefined): OrgUnitType {
  switch (parent) {
    case 'Company':
      return 'Division';
    case 'Division':
      return 'Department';
    default:
      return 'Team';
  }
}
