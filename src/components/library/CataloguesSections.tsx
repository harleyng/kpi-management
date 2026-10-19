import { useMemo, useRef, useState, type FormEvent } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { FormField } from "@/components/shared/FormField";
import { toastError, toastSuccess } from "@/components/shared/notify";
import type { BscPerspective, MeasureUnit } from "@/data/types";
import {
  useKpiDefinitions,
  useLibraryGoalUsage,
  useMeasureUnits,
  usePerspectives,
  useSavePerspective,
  useSaveMeasureUnit,
} from "@/hooks/queries/library";
import { libraryUsage } from "@/lib/libraryRules";
import { combineQueries } from "@/lib/queryState";
import { fieldErrors, numberText, parseNumberInput } from "./libraryCopy";
import { UsageUnavailable } from "./UsageUnavailable";

/** "Viễn cảnh BSC" (WBS 4.2.1): the four fixed BSC perspectives — rename and reorder, one Dialog per row. */
export function PerspectivesSection({ canManage }: { canManage: boolean }) {
  return <PerspectivesTable canManage={canManage} />;
}

/** "Đơn vị đo" (WBS 4.2.1): the measure units — add and edit in a Dialog. */
export function UnitsSection({ canManage }: { canManage: boolean }) {
  return <UnitsTable canManage={canManage} />;
}

/** A rule issue with no field of its own (`_form`) — shown above the dialog's buttons. */
function FormError({ children }: { children?: string }) {
  return children ? (
    <p
      role="alert"
      className="rounded-md bg-support-negative-subtle px-3 py-2 text-sm text-support-negative"
    >
      {children}
    </p>
  ) : null;
}

function EditButton({
  label,
  onClick,
}: {
  label: string;
  onClick: (trigger: HTMLElement) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={(e) => onClick(e.currentTarget)}
      aria-label={`Sửa ${label}`}
    >
      <Pencil className="h-4 w-4" aria-hidden />
    </Button>
  );
}

function SaveButton({ saving, children }: { saving: boolean; children: string }) {
  return (
    <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
      {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

/** The trigger of the open dialog, so focus goes back to it on close (the row's pencil, the CTA). */
function useReturnFocus() {
  const trigger = useRef<HTMLElement | null>(null);
  return {
    remember: (el: HTMLElement) => {
      trigger.current = el;
    },
    onCloseAutoFocus: (e: Event) => {
      if (trigger.current) {
        e.preventDefault();
        trigger.current.focus();
      }
    },
  };
}

// ─── Perspectives ──────────────────────────────────────────────────────────────────────────────

function PerspectivesTable({ canManage }: { canManage: boolean }) {
  const perspectives = usePerspectives();
  const [editing, setEditing] = useState<BscPerspective | null>(null);
  const focus = useReturnFocus();

  const columns: DataTableColumn<BscPerspective>[] = [
    {
      id: "code",
      header: "Mã",
      cell: (p) => <span className="font-mono text-xs">{p.code}</span>,
      className: "w-16",
    },
    { id: "name", header: "Tên hiển thị", cell: (p) => p.name },
    {
      id: "order",
      header: "Thứ tự",
      numeric: true,
      cell: (p) => p.sortOrder,
      className: "w-24",
    },
    {
      id: "actions",
      header: "Thao tác",
      cell: (p) => (
        <EditButton
          label={`viễn cảnh ${p.name}`}
          onClick={(el) => {
            focus.remember(el);
            setEditing(p);
          }}
        />
      ),
      className: "w-24 text-right",
    },
  ];

  return (
    <>
      <DataTable
        label="Viễn cảnh BSC"
        columns={canManage ? columns : columns.filter((c) => c.id !== "actions")}
        rows={perspectives.data}
        query={perspectives}
        getRowId={(p) => p.id}
        empty="Chưa có viễn cảnh BSC. Hãy nạp lại dữ liệu mẫu."
        pageSize={null}
      />
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md" onCloseAutoFocus={focus.onCloseAutoFocus}>
          {editing && (
            <PerspectiveForm
              key={editing.id}
              perspective={editing}
              onClose={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PerspectiveForm({
  perspective,
  onClose,
}: {
  perspective: BscPerspective;
  onClose: () => void;
}) {
  const save = useSavePerspective();
  const [draft, setDraft] = useState({
    name: perspective.name,
    sortOrder: String(perspective.sortOrder),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const sortOrder = parseNumberInput(draft.sortOrder);
    try {
      await save.mutateAsync({
        id: perspective.id,
        code: perspective.code,
        name: draft.name.trim(),
        sortOrder: sortOrder ?? Number.NaN,
      });
      toastSuccess("Đã lưu viễn cảnh");
      onClose();
    } catch (error) {
      setErrors(fieldErrors(error, ["name", "sortOrder"]));
      toastError(error);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Sửa viễn cảnh {perspective.name}</DialogTitle>
        <DialogDescription>
          Mã <span className="font-mono">{perspective.code}</span> là cố định. Có thể đổi tên hiển
          thị và thứ tự.
        </DialogDescription>
      </DialogHeader>
      <FormField label="Tên hiển thị" required error={errors.name}>
        {(c) => (
          <Input
            {...c}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            autoFocus
          />
        )}
      </FormField>
      <FormField label="Thứ tự" required error={errors.sortOrder}>
        {(c) => (
          <Input
            {...c}
            inputMode="numeric"
            className="tabular w-24 text-right"
            value={draft.sortOrder}
            onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
          />
        )}
      </FormField>
      <FormError>{errors._form}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
          Hủy
        </Button>
        <SaveButton saving={save.isPending}>Lưu viễn cảnh</SaveButton>
      </DialogFooter>
    </form>
  );
}

// ─── Measure units ─────────────────────────────────────────────────────────────────────────────

function UnitsTable({ canManage }: { canManage: boolean }) {
  const units = useMeasureUnits();
  const definitions = useKpiDefinitions();
  const goals = useLibraryGoalUsage();
  const [editing, setEditing] = useState<MeasureUnit | "new" | null>(null);
  const focus = useReturnFocus();

  // Advisory (the gateway refuses a recode either way): goals + library items per unit; `null` = unknown.
  const usage = useMemo(
    () =>
      goals.data && definitions.data
        ? libraryUsage(goals.data, definitions.data).usesByUnit
        : null,
    [goals.data, definitions.data],
  );
  const usesOf = (id: string) => (usage ? (usage.get(id) ?? 0) : null);

  const rows = useMemo(
    () => (units.data ? [...units.data].sort((a, b) => a.code.localeCompare(b.code, "vi")) : undefined),
    [units.data],
  );

  const columns: DataTableColumn<MeasureUnit>[] = [
    {
      id: "code",
      header: "Mã",
      cell: (u) => <span className="font-mono text-xs">{u.code}</span>,
      className: "w-32",
    },
    { id: "name", header: "Tên", cell: (u) => u.name },
    {
      id: "decimals",
      header: "Số chữ số thập phân",
      numeric: true,
      cell: (u) => u.decimals,
      className: "w-36",
    },
    {
      id: "uses",
      header: "Đang dùng",
      numeric: true,
      cell: (u) => usesOf(u.id),
      className: "w-24",
    },
    {
      id: "actions",
      header: "Thao tác",
      cell: (u) => (
        <EditButton
          label={`đơn vị ${u.name}`}
          onClick={(el) => {
            focus.remember(el);
            setEditing(u);
          }}
        />
      ),
      className: "w-24 text-right",
    },
  ];

  return (
    <>
      {goals.error != null && (
        <UsageUnavailable onRetry={() => void goals.refetch()} />
      )}
      <DataTable
        label="Đơn vị đo"
        columns={
          canManage ? columns : columns.filter((c) => c.id !== "actions")
        }
        rows={rows}
        query={combineQueries([units])}
        getRowId={(u) => u.id}
        empty="Chưa có đơn vị đo nào."
        pageSize={null}
        actions={
          canManage ? (
            <Button
              size="sm"
              onClick={(e) => {
                focus.remember(e.currentTarget);
                setEditing("new");
              }}
              disabled={!units.data}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Thêm đơn vị
            </Button>
          ) : undefined
        }
      />
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md" onCloseAutoFocus={focus.onCloseAutoFocus}>
          {editing && (
            <UnitForm
              key={editing === "new" ? "new" : editing.id}
              unit={editing === "new" ? null : editing}
              // Unknown usage locks the code too: the gateway would refuse a recode of a used unit.
              codeLocked={editing !== "new" && (usesOf(editing.id) ?? 1) > 0}
              onClose={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function UnitForm({
  unit,
  codeLocked,
  onClose,
}: {
  unit: MeasureUnit | null;
  codeLocked: boolean;
  onClose: () => void;
}) {
  const save = useSaveMeasureUnit();
  const [draft, setDraft] = useState(
    unit
      ? { code: unit.code, name: unit.name, decimals: numberText(unit.decimals) }
      : { code: "", name: "", decimals: "0" },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const decimals = parseNumberInput(draft.decimals);
    try {
      await save.mutateAsync({
        ...(unit ? { id: unit.id } : {}),
        code: draft.code,
        name: draft.name.trim(),
        decimals: decimals ?? Number.NaN,
      });
      toastSuccess(unit ? "Đã lưu đơn vị đo" : "Đã thêm đơn vị đo");
      onClose();
    } catch (error) {
      setErrors(fieldErrors(error, ["code", "name", "decimals"]));
      toastError(error);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{unit ? `Sửa đơn vị ${unit.name}` : "Thêm đơn vị đo"}</DialogTitle>
        <DialogDescription>
          Đơn vị đang được chỉ tiêu hoặc mục tiêu dùng thì giữ nguyên mã.
        </DialogDescription>
      </DialogHeader>
      <FormField
        label="Mã đơn vị đo"
        required
        error={errors.code}
        hint={codeLocked ? "Đang được sử dụng, không đổi mã được." : undefined}
      >
        {(c) => (
          <Input
            {...c}
            className="w-40 font-mono uppercase"
            value={draft.code}
            onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
            disabled={codeLocked}
            autoFocus={!codeLocked}
          />
        )}
      </FormField>
      <FormField label="Tên đơn vị đo" required error={errors.name}>
        {(c) => (
          <Input
            {...c}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            autoFocus={codeLocked}
          />
        )}
      </FormField>
      <FormField label="Số chữ số thập phân" required error={errors.decimals}>
        {(c) => (
          <Input
            {...c}
            inputMode="numeric"
            className="tabular w-24 text-right"
            value={draft.decimals}
            onChange={(e) => setDraft((d) => ({ ...d, decimals: e.target.value }))}
          />
        )}
      </FormField>
      <FormError>{errors._form}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
          Hủy
        </Button>
        <SaveButton saving={save.isPending}>{unit ? "Lưu đơn vị đo" : "Thêm đơn vị đo"}</SaveButton>
      </DialogFooter>
    </form>
  );
}
