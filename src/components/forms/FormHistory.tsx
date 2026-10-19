import { History } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorStateCard';
import { SectionTitle } from '@/components/shared/SectionTitle';
import { Skeleton } from '@/components/ui/skeleton';
import { STEP_ACTION_LABEL, type FormStepAction, type WorkflowStep } from '@/data/types';
import { errorSpecOf } from '@/lib/errorCatalog';
import { formatDateTime } from '@/lib/utils';
import type { FormLookups } from './useFormLookups';

interface FormHistoryProps {
  actions: readonly FormStepAction[] | undefined;
  error: unknown;
  onRetry: () => void;
  steps: readonly WorkflowStep[];
  lookups: Pick<FormLookups, 'userName'>;
}

/**
 * "Lịch sử xử lý" — every recorded action, oldest first. A proxy or delegated action names BOTH
 * people (BR-KPI-21); the scheduler's AUTO_* moves name the system. "Lưu nháp" is not history (EDIT is
 * a permission, not an action — BR-KPI-23); the audit log holds those edits.
 */
export function FormHistory({ actions, error, onRetry, steps, lookups }: FormHistoryProps) {
  const who = (a: FormStepAction) => {
    if (a.actorUserId === null) return 'Hệ thống';
    const actor = lookups.userName(a.actorUserId);
    if (a.onBehalfOfUserId === null) return actor;
    const behalf = lookups.userName(a.onBehalfOfUserId);
    return a.delegationId ? `${actor} (thay ${behalf}, theo ủy quyền)` : `${actor} (thao tác thay ${behalf})`;
  };

  let body;
  if (error != null) body = <ErrorState spec={errorSpecOf(error)} onAction={onRetry} />;
  else if (!actions) body = <Skeleton className="h-16 w-full" />;
  else if (actions.length === 0) body = <EmptyState>Chưa có thao tác nào trên phiếu.</EmptyState>;
  else
    body = (
      <ol className="divide-y">
        {actions.map((a) => (
          <li key={a.id} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[10rem_1fr]">
            <span className="tabular text-muted-foreground">{formatDateTime(a.actedAt)}</span>
            <div className="min-w-0">
              <p>
                <span className="font-medium">{STEP_ACTION_LABEL[a.action]}</span>
                <span className="text-muted-foreground"> ở bước {steps.find((s) => s.id === a.stepId)?.name ?? '—'}, bởi </span>
                {who(a)}
              </p>
              {a.comment && <p className="mt-0.5 whitespace-pre-line break-words text-muted-foreground">{a.comment}</p>}
            </div>
          </li>
        ))}
      </ol>
    );

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <SectionTitle icon={History} title="Lịch sử xử lý" />
        {body}
      </CardContent>
    </Card>
  );
}
