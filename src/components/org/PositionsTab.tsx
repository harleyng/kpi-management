import { useId, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { BlockedReason } from '@/components/shared/BlockedReason';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { EditSheet } from '@/components/shared/EditSheet';
import { FormField, RequiredLegend } from '@/components/shared/FormField';
import { RecordStatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSession } from '@/contexts/useSession';
import { JOB_LEVEL_LABEL, JOB_LEVELS, RECORD_STATUS_LABEL, RECORD_STATUSES, type JobLevel, type JobPosition, type RecordStatus } from '@/data/types';
import { issuesOf, useOrgDirectory, useSavePosition, type OrgDirectory } from '@/hooks/queries/org';
import { fieldIssues, orgIssueText, otherIssues } from '@/lib/orgIssueCopy';
import { positionIssues, positionUsage, type Draft } from '@/lib/orgAdminRules';

interface Row {
  position: JobPosition;
  inUse: number;
}

/** "Chức danh" — positions and their level (WBS 4.1.3). */
export function PositionsTab() {
  const { today } = useSession();
  const { data, query } = useOrgDirectory();
  const [editing, setEditing] = useState<JobPosition | 'new' | null>(null);

  const rows = useMemo<Row[] | undefined>(
    () => data?.positions.map((position) => ({ position, inUse: positionUsage(position.id, { assignments: data.assignments, today }) })),
    [data, today],
  );

  const columns: DataTableColumn<Row>[] = [
    { id: 'code', header: 'Mã', cell: (r) => <span className="font-mono text-xs">{r.position.code}</span>, sortValue: (r) => r.position.code, className: 'w-24' },
    {
      id: 'name',
      header: 'Tên chức danh',
      cell: (r) => (
        <button type="button" className="text-left font-medium text-primary hover:underline focus-visible:underline" onClick={() => setEditing(r.position)}>
          {r.position.name}
        </button>
      ),
      sortValue: (r) => r.position.name,
    },
    { id: 'level', header: 'Cấp bậc', cell: (r) => JOB_LEVEL_LABEL[r.position.jobLevel], sortValue: (r) => JOB_LEVELS.indexOf(r.position.jobLevel) },
    { id: 'inUse', header: 'Đang phân công', numeric: true, cell: (r) => r.inUse, sortValue: (r) => r.inUse, className: 'w-36' },
    { id: 'status', header: 'Trạng thái', cell: (r) => <RecordStatusBadge status={r.position.status} />, className: 'w-28' },
  ];

  return (
    <>
      <DataTable
        label="Danh sách chức danh"
        columns={columns}
        rows={rows}
        query={query}
        getRowId={(r) => r.position.id}
        empty="Chưa có chức danh nào."
        pageSize={null}
        toolbar={
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setEditing('new')} disabled={!data}>
              <Plus aria-hidden />
              Thêm chức danh
            </Button>
          </div>
        }
      />
      {editing && data && (
        <PositionSheet key={editing === 'new' ? 'new' : editing.id} position={editing === 'new' ? null : editing} directory={data} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function PositionSheet({ position, directory, onClose }: { position: JobPosition | null; directory: OrgDirectory; onClose: () => void }) {
  const { today } = useSession();
  const save = useSavePosition();
  const initial: Draft<JobPosition> = position ?? { code: '', name: '', jobLevel: 'Staff', status: 'Active' };
  const [draft, setDraft] = useState(initial);
  const [shownIssues, setShownIssues] = useState<ReturnType<typeof issuesOf>>([]);
  const reasonId = useId();
  const set = <K extends keyof Draft<JobPosition>>(key: K, value: Draft<JobPosition>[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Stopping a position still in use is refused; say so beside the status before anyone tries.
  const stopBlock = position && position.status === 'Active' ? positionIssues({ ...position, status: 'Inactive' }, position, { assignments: directory.assignments, today })[0] : undefined;

  const submit = () => {
    const issues = positionIssues(draft, position, { assignments: directory.assignments, today });
    setShownIssues(issues);
    if (issues.length > 0) return;
    save.mutate(draft, { onSuccess: onClose, onError: (error) => setShownIssues(issuesOf(error)) });
  };
  const errors = fieldIssues(shownIssues);

  return (
    <EditSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={position ? `Sửa chức danh ${position.name}` : 'Thêm chức danh'}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      onSubmit={submit}
      submitting={save.isPending}
      problems={otherIssues(shownIssues, ['code', 'name', 'jobLevel', 'status'])}
    >
      <RequiredLegend />
      <FormField label="Tên chức danh" required error={errors.name}>
        {(c) => <Input {...c} value={draft.name} onChange={(e) => set('name', e.target.value)} />}
      </FormField>
      <FormField label="Mã chức danh" required error={errors.code}>
        {(c) => <Input {...c} value={draft.code} onChange={(e) => set('code', e.target.value.toUpperCase())} className="font-mono" />}
      </FormField>
      <FormField label="Cấp bậc" required error={errors.jobLevel}>
        {(c) => (
          <Select value={draft.jobLevel} onValueChange={(v) => set('jobLevel', v as JobLevel)}>
            <SelectTrigger {...c}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JOB_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {JOB_LEVEL_LABEL[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      {position && (
        <FormField label="Trạng thái" required error={errors.status} hint={stopBlock ? <BlockedReason id={reasonId}>{orgIssueText(stopBlock)}</BlockedReason> : undefined}>
          {(c) => (
            <Select value={draft.status} onValueChange={(v) => set('status', v as RecordStatus)}>
              <SelectTrigger {...c}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECORD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s} disabled={s === 'Inactive' && stopBlock !== undefined}>
                    {RECORD_STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}
    </EditSheet>
  );
}
