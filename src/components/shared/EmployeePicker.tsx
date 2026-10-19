import { useMemo } from 'react';
import type { EmployeeFilter } from '@/integrations/data/types';
import { useEmployees } from '@/hooks/queries/org';
import { compareSortValues } from '@/lib/tableSort';
import { EntityCombobox, type ComboboxOption, type EntityComboboxProps } from './EntityCombobox';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type EmployeePickerProps = DistributiveOmit<
  EntityComboboxProps,
  'options' | 'query' | 'placeholder' | 'searchPlaceholder' | 'emptyText' | 'summarize'
> & {
  /**
   * Narrow the people offered — `managerEmployeeId` for direct reports (cascade), `orgUnitId` +
   * `includeChildUnits` for a unit (launch recipients), `activeOn` for a period. Never a search
   * term: the picker filters the loaded list itself.
   */
  filter?: Omit<EmployeeFilter, 'search' | 'includeResigned'>;
};

/**
 * Pick one or several people — cascade targets (T3), delegates and proxies (T5), launch
 * recipients (D5, `RecipientFilter.employeeIds`). Value = `Employee.id`.
 *
 * Resigned people are always READ (a past assignee must still display) but listed disabled with
 * "Đã nghỉ việc" — they cannot be newly picked.
 */
export function EmployeePicker({ filter, ...props }: EmployeePickerProps) {
  const employees = useEmployees({ ...filter, includeResigned: true });

  const options = useMemo<ComboboxOption[] | undefined>(
    () =>
      employees.data
        ?.slice()
        .sort((a, b) => compareSortValues(a.fullName, b.fullName))
        .map((e) => {
          const resigned = e.employmentStatus === 'Resigned';
          return {
            id: e.id,
            label: e.fullName,
            description: [e.employeeCode, e.email, resigned ? 'Đã nghỉ việc' : null].filter(Boolean).join(', '),
            keywords: [e.employeeCode, e.email],
            disabled: resigned,
          };
        }),
    [employees.data],
  );

  const shared = {
    options,
    query: employees,
    placeholder: 'Chọn nhân viên',
    searchPlaceholder: 'Tìm theo tên, mã nhân viên hoặc email',
    emptyText: 'Chưa có nhân viên nào.',
  };

  return props.multiple ? (
    <EntityCombobox
      {...props}
      {...shared}
      summarize={(labels: string[]) => `${labels[0]} và ${labels.length - 1} người khác`}
    />
  ) : (
    <EntityCombobox {...props} {...shared} />
  );
}
