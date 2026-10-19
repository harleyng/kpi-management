import { useMemo, useState, type ReactNode } from "react";
import { Check, Compass, Loader2, Pencil, Plus, Ruler, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { SectionTitle } from "@/components/shared/SectionTitle";
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

/** "Danh mục" (WBS 4.2.1): the BSC perspectives (rename / reorder) and the measure units. */
export function CataloguesPanel({ canManage }: { canManage: boolean }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="min-w-0 space-y-2">
        <SectionTitle icon={Compass} title="Viễn cảnh BSC">
          Bốn viễn cảnh là cố định. Có thể đổi tên hiển thị và thứ tự.
        </SectionTitle>
        <PerspectivesTable canManage={canManage} />
      </section>
      <section className="min-w-0 space-y-2">
        <SectionTitle icon={Ruler} title="Đơn vị đo">
          Đơn vị đang được chỉ tiêu hoặc mục tiêu dùng thì giữ nguyên mã.
        </SectionTitle>
        <UnitsTable canManage={canManage} />
      </section>
    </div>
  );
}

function FieldError({ children }: { children?: string }) {
  return children ? (
    <p role="alert" className="mt-1 text-xs text-support-negative">
      {children}
    </p>
  ) : null;
}

function RowActions({
  label,
  editing,
  saving,
  canEdit,
  onEdit,
  onSave,
  onCancel,
}: {
  label: string;
  editing: boolean;
  saving: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}): ReactNode {
  if (!editing) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onEdit}
        disabled={!canEdit}
        aria-label={`Sửa ${label}`}
      >
        <Pencil className="h-4 w-4" aria-hidden />
      </Button>
    );
  }
  return (
    <span className="flex justify-end gap-1">
      <Button
        size="icon"
        className="h-8 w-8"
        onClick={onSave}
        disabled={saving}
        aria-label={`Lưu ${label}`}
        aria-busy={saving || undefined}
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Check className="h-4 w-4" aria-hidden />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onCancel}
        disabled={saving}
        aria-label={`Hủy sửa ${label}`}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </span>
  );
}

// ─── Perspectives ──────────────────────────────────────────────────────────────────────────────

function PerspectivesTable({ canManage }: { canManage: boolean }) {
  const perspectives = usePerspectives();
  const save = useSavePerspective();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", sortOrder: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const start = (p: BscPerspective) => {
    setEditingId(p.id);
    setDraft({ name: p.name, sortOrder: String(p.sortOrder) });
    setErrors({});
  };

  const commit = async (p: BscPerspective) => {
    const sortOrder = parseNumberInput(draft.sortOrder);
    try {
      await save.mutateAsync({
        id: p.id,
        code: p.code,
        name: draft.name.trim(),
        sortOrder: sortOrder ?? Number.NaN,
      });
      toastSuccess("Đã lưu viễn cảnh");
      setEditingId(null);
    } catch (error) {
      setErrors(fieldErrors(error, ["name", "sortOrder"]));
      toastError(error);
    }
  };

  const columns: DataTableColumn<BscPerspective>[] = [
    {
      id: "code",
      header: "Mã",
      cell: (p) => <span className="font-mono text-xs">{p.code}</span>,
      className: "w-16",
    },
    {
      id: "name",
      header: "Tên hiển thị",
      cell: (p) =>
        editingId === p.id ? (
          <>
            <Input
              aria-label={`Tên viễn cảnh ${p.code}`}
              className="h-8"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
              autoFocus
            />
            <FieldError>{errors.name ?? errors._form}</FieldError>
          </>
        ) : (
          p.name
        ),
    },
    {
      id: "order",
      header: "Thứ tự",
      numeric: true,
      cell: (p) =>
        editingId === p.id ? (
          <>
            <Input
              aria-label={`Thứ tự viễn cảnh ${p.code}`}
              inputMode="numeric"
              className="tabular h-8 w-16 text-right"
              value={draft.sortOrder}
              onChange={(e) =>
                setDraft((d) => ({ ...d, sortOrder: e.target.value }))
              }
            />
            <FieldError>{errors.sortOrder}</FieldError>
          </>
        ) : (
          p.sortOrder
        ),
      className: "w-24",
    },
    {
      id: "actions",
      header: "Thao tác",
      cell: (p) =>
        canManage ? (
          <RowActions
            label={`viễn cảnh ${p.name}`}
            editing={editingId === p.id}
            saving={save.isPending}
            canEdit={editingId === null}
            onEdit={() => start(p)}
            onSave={() => void commit(p)}
            onCancel={() => setEditingId(null)}
          />
        ) : null,
      className: "w-24 text-right",
    },
  ];

  return (
    <DataTable
      label="Viễn cảnh BSC"
      columns={canManage ? columns : columns.filter((c) => c.id !== "actions")}
      rows={perspectives.data}
      query={perspectives}
      getRowId={(p) => p.id}
      empty="Chưa có viễn cảnh BSC. Hãy nạp lại dữ liệu mẫu."
      pageSize={null}
    />
  );
}

// ─── Measure units ─────────────────────────────────────────────────────────────────────────────

const NEW = "__new";
type UnitRow = MeasureUnit | { id: typeof NEW };
const isNew = (row: UnitRow): row is { id: typeof NEW } => row.id === NEW;

function UnitsTable({ canManage }: { canManage: boolean }) {
  const units = useMeasureUnits();
  const definitions = useKpiDefinitions();
  const goals = useLibraryGoalUsage();
  const save = useSaveMeasureUnit();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ code: "", name: "", decimals: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Advisory (the gateway refuses a recode either way): goals + library items per unit; `null` = unknown.
  const usage = useMemo(
    () =>
      goals.data && definitions.data
        ? libraryUsage(goals.data, definitions.data).usesByUnit
        : null,
    [goals.data, definitions.data],
  );
  const usesOf = (id: string) => (usage ? (usage.get(id) ?? 0) : null);

  const start = (row: UnitRow) => {
    setEditingId(row.id);
    setDraft(
      isNew(row)
        ? { code: "", name: "", decimals: "0" }
        : {
            code: row.code,
            name: row.name,
            decimals: numberText(row.decimals),
          },
    );
    setErrors({});
  };

  const commit = async (row: UnitRow) => {
    const decimals = parseNumberInput(draft.decimals);
    try {
      await save.mutateAsync({
        ...(isNew(row) ? {} : { id: row.id }),
        code: draft.code,
        name: draft.name.trim(),
        decimals: decimals ?? Number.NaN,
      });
      toastSuccess(isNew(row) ? "Đã thêm đơn vị đo" : "Đã lưu đơn vị đo");
      setEditingId(null);
    } catch (error) {
      setErrors(fieldErrors(error, ["code", "name", "decimals"]));
      toastError(error);
    }
  };

  const rows: UnitRow[] | undefined = units.data
    ? [
        ...(editingId === NEW ? [{ id: NEW } as const] : []),
        ...[...units.data].sort((a, b) => a.code.localeCompare(b.code, "vi")),
      ]
    : undefined;

  const columns: DataTableColumn<UnitRow>[] = [
    {
      id: "code",
      header: "Mã",
      cell: (row) => {
        if (editingId !== row.id)
          return isNew(row) ? null : (
            <span className="font-mono text-xs">{row.code}</span>
          );
        const locked = !isNew(row) && (usesOf(row.id) ?? 1) > 0;
        return (
          <>
            <Input
              aria-label="Mã đơn vị đo"
              className="h-8 w-28 font-mono uppercase"
              value={draft.code}
              onChange={(e) =>
                setDraft((d) => ({ ...d, code: e.target.value }))
              }
              disabled={locked}
              aria-describedby={locked ? `unit-lock-${row.id}` : undefined}
              autoFocus={!locked}
            />
            {locked && (
              <p
                id={`unit-lock-${row.id}`}
                className="mt-1 max-w-[14rem] text-xs text-muted-foreground"
              >
                Đang được sử dụng, không đổi mã được.
              </p>
            )}
            <FieldError>{errors.code}</FieldError>
          </>
        );
      },
      className: "w-32",
    },
    {
      id: "name",
      header: "Tên",
      cell: (row) =>
        editingId === row.id ? (
          <>
            <Input
              aria-label="Tên đơn vị đo"
              className="h-8"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
            />
            <FieldError>{errors.name ?? errors._form}</FieldError>
          </>
        ) : isNew(row) ? null : (
          row.name
        ),
    },
    {
      id: "decimals",
      header: "Số chữ số thập phân",
      numeric: true,
      cell: (row) =>
        editingId === row.id ? (
          <>
            <Input
              aria-label="Số chữ số thập phân"
              inputMode="numeric"
              className="tabular ml-auto h-8 w-16 text-right"
              value={draft.decimals}
              onChange={(e) =>
                setDraft((d) => ({ ...d, decimals: e.target.value }))
              }
            />
            <FieldError>{errors.decimals}</FieldError>
          </>
        ) : isNew(row) ? null : (
          row.decimals
        ),
      className: "w-36",
    },
    {
      id: "uses",
      header: "Đang dùng",
      numeric: true,
      cell: (row) => (isNew(row) ? null : usesOf(row.id)),
      className: "w-24",
    },
    {
      id: "actions",
      header: "Thao tác",
      cell: (row) => (
        <RowActions
          label={isNew(row) ? "đơn vị mới" : `đơn vị ${row.name}`}
          editing={editingId === row.id}
          saving={save.isPending}
          canEdit={editingId === null}
          onEdit={() => start(row)}
          onSave={() => void commit(row)}
          onCancel={() => setEditingId(null)}
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
        getRowId={(row) => row.id}
        empty="Chưa có đơn vị đo nào."
        pageSize={null}
        toolbar={
          canManage ? (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => start({ id: NEW })}
              disabled={editingId !== null}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Thêm đơn vị
            </Button>
          ) : undefined
        }
      />
    </>
  );
}
