import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable';
import { FormStatusBadge, OverdueBadge } from '@/components/shared/StatusBadge';
import { FORM_TYPE_LABEL, type FormInstance, type Id } from '@/data/types';
import { useGatewayClock } from '@/hooks/queries/session';
import { stepTiming } from '@/lib/formViewRules';
import { combineQueries, type QueryState } from '@/lib/queryState';
import { formatDate } from '@/lib/utils';
import { useFormLookups } from './useFormLookups';

interface FormsTableProps {
  label: string;
  rows: readonly FormInstance[] | undefined;
  query: QueryState;
  empty: ReactNode;
  /** Forms waiting on the person looking — their status turns amber ("my turn"). */
  atMyStep?: ReadonlySet<Id> | 'all';
  /** "Phiếu của tôi": the subject is always the viewer, so the first column names the form type. */
  showSubject?: boolean;
  toolbar?: ReactNode;
  /** The list's primary action — the right of the toolbar row (`DataTable`'s `actions`). */
  actions?: ReactNode;
  isFiltered?: boolean;
  onClearFilters?: () => void;
  /** `null` turns client paging off (a list the gateway pages, with its own pager below). */
  pageSize?: number | null;
  pageResetKey?: unknown;
}

/**
 * A list of forms — the inbox, "Phiếu của tôi", the team's forms and HR's monitoring list. Each row
 * shows only facts that are cheap to derive (`stepTiming`: step, step deadline, overdue); who must
 * act is resolved on the form itself, never per row (R7, T5 phase 2).
 */
export function FormsTable({
  label,
  rows,
  query,
  empty,
  atMyStep,
  showSubject = true,
  toolbar,
  actions,
  isFiltered,
  onClearFilters,
  pageSize,
  pageResetKey,
}: FormsTableProps) {
  const navigate = useNavigate();
  const lookups = useFormLookups();
  const clock = useGatewayClock();
  const mine = (form: FormInstance) => atMyStep === 'all' || (atMyStep?.has(form.id) ?? false);

  const open = (form: FormInstance, text: string) => (
    <Button
      variant="link"
      className="h-auto p-0 text-left font-medium"
      onClick={() => navigate(`/forms/${form.id}`)}
      aria-label={`Mở phiếu ${FORM_TYPE_LABEL[form.formType]} của ${lookups.employeeName(form.subjectEmployeeId)}`}
    >
      {text}
    </Button>
  );

  const columns: DataTableColumn<FormInstance>[] = [
    showSubject
      ? {
          id: 'subject',
          header: 'Người được đánh giá',
          cell: (f) => open(f, lookups.employeeName(f.subjectEmployeeId)),
          sortValue: (f) => lookups.employeeName(f.subjectEmployeeId),
        }
      : { id: 'type', header: 'Phiếu', cell: (f) => open(f, FORM_TYPE_LABEL[f.formType]), sortValue: (f) => FORM_TYPE_LABEL[f.formType] },
    ...(showSubject ? [{ id: 'type', header: 'Loại phiếu', cell: (f: FormInstance) => FORM_TYPE_LABEL[f.formType] }] : []),
    {
      id: 'period',
      header: 'Kỳ',
      cell: (f) => lookups.period(f.periodId)?.label ?? null,
      sortValue: (f) => lookups.period(f.periodId)?.startDate ?? null,
    },
    { id: 'step', header: 'Bước hiện tại', cell: (f) => stepTiming(f, lookups.steps, clock).step?.name ?? null },
    {
      id: 'deadline',
      header: 'Hạn bước',
      numeric: true,
      cell: (f) => {
        const { deadline } = stepTiming(f, lookups.steps, clock);
        return deadline ? formatDate(deadline) : null;
      },
      sortValue: (f) => stepTiming(f, lookups.steps, clock).deadline,
    },
    {
      id: 'status',
      header: 'Trạng thái',
      cell: (f) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <FormStatusBadge status={f.status} atMyStep={mine(f)} />
          {stepTiming(f, lookups.steps, clock).overdue && (
            <OverdueBadge subject={`${FORM_TYPE_LABEL[f.formType]} của ${lookups.employeeName(f.subjectEmployeeId)}`} />
          )}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      label={label}
      columns={columns}
      // Names and steps first: a row must never render with "—" where a name belongs.
      rows={lookups.ready ? rows : undefined}
      query={combineQueries([query, lookups.query])}
      getRowId={(f) => f.id}
      empty={empty}
      toolbar={toolbar}
      actions={actions}
      isFiltered={isFiltered}
      onClearFilters={onClearFilters}
      pageSize={pageSize}
      pageResetKey={pageResetKey}
    />
  );
}
