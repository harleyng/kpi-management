import { Database, FileSpreadsheet, PenLine } from 'lucide-react';
import { MissingValue } from '@/components/shared/DataTable';
import { SOURCE_TYPE_LABEL, type GoalActual, type SourceType } from '@/data/types';
import { cn, formatNumber } from '@/lib/utils';

/** An actual's value: the number (vi-VN, tabular), the text, or `—` when there is none — never 0. */
export function ActualValue({ actual, className }: { actual: Pick<GoalActual, 'actualValue' | 'actualText'> | null; className?: string }) {
  if (!actual || (actual.actualValue === null && (actual.actualText === null || actual.actualText === ''))) return <MissingValue />;
  return <span className={cn('tabular', className)}>{actual.actualValue !== null ? formatNumber(actual.actualValue) : actual.actualText}</span>;
}

const SOURCE_ICON = { MANUAL: PenLine, EXCEL: FileSpreadsheet, API: Database } as const;

/** Where a number came from (BR-KPI-52) — a category, not a status, so plain muted text with its icon. */
export function SourceTypeTag({ sourceType, className }: { sourceType: SourceType; className?: string }) {
  const Icon = SOURCE_ICON[sourceType];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground', className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {SOURCE_TYPE_LABEL[sourceType]}
    </span>
  );
}
