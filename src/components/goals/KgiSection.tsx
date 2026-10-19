import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Kgi } from '@/data/types';
import { useDeleteKgi, useSaveKgi, type GoalLookups, type PlanWorkspaceData } from '@/hooks/queries/goals';
import { toastSaved } from '@/hooks/queries/toasts';
import { KGI_COUNT } from '@/lib/goalPlanRules';
import { formatDecimalInput, parseDecimalInput } from '@/lib/numberInput';
import { formatNumber } from '@/lib/utils';

const NO_UNIT = '__none';

/**
 * The plan's KGI (BR-KPI-02): 3–5 key goals, advisory (a warning in the readiness strip, never a
 * block). A KGI may carry a target, never scored (`ASSUMPTION Q9`). Collapsed once it has 3 or more.
 * Adding or editing one opens a dialog — the list never turns into a form.
 */
export function KgiSection({ data, lookups, editable }: { data: PlanWorkspaceData; lookups: GoalLookups; editable: boolean }) {
  const [open, setOpen] = useState(data.kgis.length < KGI_COUNT.min);
  const [editing, setEditing] = useState<Kgi | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Kgi | null>(null);
  const remove = useDeleteKgi();
  const goalCount = (kgiId: string) => data.goals.filter((g) => g.kgiId === kgiId && g.status === 'Active').length;

  return (
    <section aria-labelledby="kgi-title" className="rounded-md border">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button type="button" className="flex items-center gap-2 text-sm font-semibold" aria-expanded={open} aria-controls="kgi-list" id="kgi-title" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          KGI ({data.kgis.length})
          <span className="font-normal text-muted-foreground">
            · nên có {KGI_COUNT.min}–{KGI_COUNT.max}
          </span>
        </button>
        {editable && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(true);
              setEditing('new');
            }}
          >
            <Plus aria-hidden />
            Thêm KGI
          </Button>
        )}
      </div>
      {open && (
        <div id="kgi-list" className="border-t px-4 py-3">
          {data.kgis.length === 0 && <p className="text-sm text-muted-foreground">Chưa có KGI nào.</p>}
          <ol className="space-y-2">
            {data.kgis.map((kgi, i) => (
              <li key={kgi.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium">
                    {i + 1}. {kgi.name}
                  </span>
                  {kgi.targetValue !== null && (
                    <span className="tabular-nums text-muted-foreground">
                      {' '}
                      · mục tiêu {formatNumber(kgi.targetValue)} {kgi.unitId ? lookups.unit.get(kgi.unitId)?.name : ''}
                    </span>
                  )}
                  <span className="text-muted-foreground"> · {goalCount(kgi.id)} chỉ tiêu</span>
                  {kgi.description && <p className="text-xs text-muted-foreground">{kgi.description}</p>}
                </div>
                {editable && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(kgi)} aria-label={`Sửa KGI ${kgi.name}`}>
                      Sửa
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(kgi)} aria-label={`Xóa KGI ${kgi.name}`}>
                      Xóa
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {editing && <KgiDialog key={editing === 'new' ? 'new' : editing.id} data={data} lookups={lookups} kgi={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Xóa KGI "${deleting?.name ?? ''}"?`}
        body={deleting && goalCount(deleting.id) > 0 ? `${goalCount(deleting.id)} chỉ tiêu đang gắn với KGI này sẽ không còn gắn KGI nào.` : 'KGI bị xóa khỏi Goal Plan.'}
        confirmLabel="Xóa KGI"
        destructive
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => toastSaved('Đã xóa KGI') })}
      />
    </section>
  );
}

/** Add / edit one KGI in a dialog (same fields and checks as before). */
function KgiDialog({ data, lookups, kgi, onDone }: { data: PlanWorkspaceData; lookups: GoalLookups; kgi: Kgi | null; onDone: () => void }) {
  const [name, setName] = useState(kgi?.name ?? '');
  const [description, setDescription] = useState(kgi?.description ?? '');
  const [target, setTarget] = useState(formatDecimalInput(kgi?.targetValue ?? null));
  const [unitId, setUnitId] = useState(kgi?.unitId ?? NO_UNIT);
  const [submitted, setSubmitted] = useState(false);
  const save = useSaveKgi();
  const targetValue = parseDecimalInput(target);
  const nameError = name.trim() === '' ? 'Nhập tên KGI.' : undefined;
  const targetError = targetValue !== null && Number.isNaN(targetValue) ? 'Mục tiêu phải là số.' : undefined;

  const onSave = () => {
    setSubmitted(true);
    if (nameError || targetError) return;
    save.mutate(
      {
        ...(kgi ? { id: kgi.id } : {}),
        goalPlanId: data.plan.id,
        name: name.trim(),
        description: description.trim() || null,
        sortOrder: kgi?.sortOrder ?? data.kgis.reduce((max, k) => Math.max(max, k.sortOrder + 1), 0),
        targetValue,
        unitId: unitId === NO_UNIT ? null : unitId,
      },
      {
        onSuccess: () => {
          toastSaved(kgi ? 'Đã lưu KGI' : 'Đã thêm KGI');
          onDone();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onDone()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{kgi ? `Sửa KGI "${kgi.name}"` : 'Thêm KGI'}</DialogTitle>
          <DialogDescription>KGI là mục tiêu then chốt của Goal Plan (nên có {KGI_COUNT.min}–{KGI_COUNT.max}); chỉ tiêu gắn vào KGI để thấy chúng phục vụ điều gì.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Tên KGI" required error={submitted ? nameError : undefined} className="sm:col-span-2">
              {(control) => <Input {...control} value={name} onChange={(e) => setName(e.target.value)} />}
            </FormField>
            <FormField label="Mục tiêu" hint="Không bắt buộc, không tính điểm (giả định Q9)." error={targetError}>
              {(control) => <Input {...control} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />}
            </FormField>
            <FormField label="Đơn vị đo">
              {(control) => (
                <Select value={unitId} onValueChange={setUnitId}>
                  <SelectTrigger {...control}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_UNIT}>Không có</SelectItem>
                    {lookups.units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          </div>
          <FormField label="Mô tả">
            {(control) => <Input {...control} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={save.isPending}>
            Hủy
          </Button>
          <Button onClick={onSave} disabled={save.isPending} aria-busy={save.isPending}>
            {kgi ? 'Lưu KGI' : 'Thêm KGI'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
