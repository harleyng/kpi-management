import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { EmployeePicker } from '@/components/shared/EmployeePicker';
import { EntityCombobox } from '@/components/shared/EntityCombobox';
import { FormField } from '@/components/shared/FormField';
import { OrgUnitTree } from '@/components/shared/OrgUnitTree';
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABEL,
  JOB_LEVELS,
  JOB_LEVEL_LABEL,
  RECIPIENT_MODES,
  RECIPIENT_MODE_LABEL,
  type EmploymentStatus,
  type JobLevel,
  type RecipientFilter,
  type RecipientMode,
} from '@/data/types';
import { usePositions } from '@/hooks/queries/org';

const STATIC = { isPending: false, fetchStatus: 'idle', error: null, refetch: () => undefined } as const;
const list = (labels: string[]) => labels.join(', ');

interface RecipientFilterFieldsProps {
  mode: RecipientMode;
  filter: RecipientFilter;
  onModeChange: (mode: RecipientMode) => void;
  onFilterChange: (filter: RecipientFilter) => void;
}

/**
 * "Người nhận" (HR guide p. 93, BR-KPI-19): everyone, or a filter — units (with their children),
 * positions, job levels, employment status, named people; AND across fields, OR within one, an empty
 * list = any. Recipients are resolved when the launch FIRES, so this names a rule, not a list.
 */
export function RecipientFilterFields({ mode, filter, onModeChange, onFilterChange }: RecipientFilterFieldsProps) {
  const positions = usePositions();
  const set = (patch: Partial<RecipientFilter>) => onFilterChange({ ...filter, ...patch });

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Người nhận</legend>
      <div role="group" aria-label="Người nhận" className="flex flex-wrap gap-1">
        {RECIPIENT_MODES.map((m) => (
          <Button key={m} type="button" size="sm" variant={mode === m ? 'secondary' : 'ghost'} aria-pressed={mode === m} onClick={() => onModeChange(m)}>
            {RECIPIENT_MODE_LABEL[m]}
          </Button>
        ))}
      </div>
      {mode === 'FILTER' && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 md:row-span-3">
            <OrgUnitTree label="Đơn vị nhận phiếu" multiple selected={filter.orgUnitIds} onSelectedChange={(ids) => set({ orgUnitIds: ids })} className="max-h-72 overflow-y-auto rounded-md border p-2" />
            <div className="flex items-center gap-2">
              <Switch id="recipients-children" checked={filter.includeChildUnits} onCheckedChange={(v) => set({ includeChildUnits: v })} />
              <Label htmlFor="recipients-children" className="text-sm font-normal">
                Gồm cả đơn vị con
              </Label>
            </div>
          </div>
          <FormField label="Chức danh">
            {(control) => (
              <EntityCombobox
                {...control}
                multiple
                options={positions.data?.map((p) => ({ id: p.id, label: p.name, description: p.code }))}
                query={positions}
                value={filter.positionIds}
                onChange={(ids) => set({ positionIds: ids })}
                placeholder="Mọi chức danh"
                searchPlaceholder="Tìm chức danh"
                emptyText="Chưa có chức danh nào."
                summarize={list}
              />
            )}
          </FormField>
          <FormField label="Cấp bậc">
            {(control) => (
              <EntityCombobox
                {...control}
                multiple
                options={JOB_LEVELS.map((l) => ({ id: l, label: JOB_LEVEL_LABEL[l] }))}
                query={STATIC}
                value={filter.jobLevels}
                onChange={(ids) => set({ jobLevels: ids as JobLevel[] })}
                placeholder="Mọi cấp bậc"
                searchPlaceholder="Tìm cấp bậc"
                emptyText="Không có cấp bậc."
                summarize={list}
              />
            )}
          </FormField>
          <FormField label="Tình trạng làm việc">
            {(control) => (
              <EntityCombobox
                {...control}
                multiple
                options={EMPLOYMENT_STATUSES.map((s) => ({ id: s, label: EMPLOYMENT_STATUS_LABEL[s] }))}
                query={STATIC}
                value={filter.employmentStatuses}
                onChange={(ids) => set({ employmentStatuses: ids as EmploymentStatus[] })}
                placeholder="Mọi tình trạng"
                searchPlaceholder="Tìm tình trạng"
                emptyText="Không có tình trạng."
                summarize={list}
              />
            )}
          </FormField>
          <FormField label="Người cụ thể" hint="Chỉ những người này (cùng các điều kiện khác).">
            {(control) => <EmployeePicker {...control} multiple value={filter.employeeIds} onChange={(ids) => set({ employeeIds: ids })} />}
          </FormField>
        </div>
      )}
    </fieldset>
  );
}
