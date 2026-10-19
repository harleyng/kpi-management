import { useMemo } from 'react';
import { LIBRARY_STATUS_LABEL } from '@/data/types';
import { useKpiDefinitions, useMeasureUnits, usePerspectives } from '@/hooks/queries/library';
import { combineQueries } from '@/lib/queryState';
import { compareSortValues } from '@/lib/tableSort';
import { EntityCombobox, type ComboboxOption, type EntityComboboxProps } from './EntityCombobox';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type KpiPickerProps = DistributiveOmit<
  EntityComboboxProps,
  'options' | 'query' | 'placeholder' | 'searchPlaceholder' | 'emptyText' | 'summarize'
> & {
  /** KPIs already in the plan or template — hidden from the list unless they are the value. */
  excludeIds?: readonly string[];
};

/**
 * Pick a KPI from the tenant's library (WBS 4.2.3) — used by Goal Plans (T3), templates (T2) and
 * imports. Value = `KpiDefinition.id`.
 *
 * The WHOLE library is read, not only Active items: a goal may point at a KPI that has since been
 * archived, and that value must still display. Only Active items can be newly picked; Draft and
 * Archived ones are listed disabled with their status. Grouped by BSC perspective, in the
 * perspective's order.
 */
export function KpiPicker({ excludeIds, ...props }: KpiPickerProps) {
  const definitions = useKpiDefinitions();
  const perspectives = usePerspectives();
  const units = useMeasureUnits();

  const options = useMemo<ComboboxOption[] | undefined>(() => {
    if (!definitions.data || !perspectives.data || !units.data) return undefined;
    const selected = new Set(props.multiple ? props.value : props.value ? [props.value] : []);
    const excluded = new Set(excludeIds);
    const perspectiveById = new Map(perspectives.data.map((p) => [p.id, p]));
    const unitById = new Map(units.data.map((u) => [u.id, u]));

    return definitions.data
      .filter((d) => selected.has(d.id) || !excluded.has(d.id))
      .map((d) => ({ def: d, perspective: perspectiveById.get(d.perspectiveId) }))
      .sort(
        (a, b) =>
          (a.perspective?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.perspective?.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
          compareSortValues(a.def.code, b.def.code),
      )
      .map(({ def, perspective }) => {
        const unit = unitById.get(def.unitId)?.name;
        const status = def.status === 'Active' ? null : LIBRARY_STATUS_LABEL[def.status];
        return {
          id: def.id,
          label: def.name,
          description: [def.code, unit, status].filter(Boolean).join(', '),
          keywords: [def.code],
          group: perspective?.name,
          disabled: def.status !== 'Active',
        };
      });
  }, [definitions.data, perspectives.data, units.data, excludeIds, props.multiple, props.value]);

  const query = combineQueries([definitions, perspectives, units]);
  const shared = {
    options,
    query,
    placeholder: 'Chọn chỉ tiêu',
    searchPlaceholder: 'Tìm theo mã hoặc tên chỉ tiêu',
    emptyText: 'Chưa có chỉ tiêu nào trong thư viện.',
  };

  return props.multiple ? (
    <EntityCombobox {...props} {...shared} summarize={(labels: string[]) => `${labels.length} chỉ tiêu đã chọn`} />
  ) : (
    <EntityCombobox {...props} {...shared} />
  );
}
