import { useParams } from 'react-router-dom';
import { AccessDenied } from '@/components/layout/AccessDenied';
import { PageHeader } from '@/components/shared/PageHeader';
import { ErrorStateCard } from '@/components/shared/ErrorStateCard';
import { FormStatusBadge, OverdueBadge } from '@/components/shared/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { EvaluationFormBody } from '@/components/forms/EvaluationFormBody';
import { FormHistory } from '@/components/forms/FormHistory';
import { FormStepStrip } from '@/components/forms/FormStepStrip';
import { GoalChangeFormBody } from '@/components/forms/GoalChangeFormBody';
import { GoalPlanFormBody } from '@/components/forms/GoalPlanFormBody';
import { actingAsSentence, formPeriodText, formTitle, readOnlySentence, returnedSentence } from '@/components/forms/formCopy';
import { useFormDetail } from '@/components/forms/useFormDetail';
import { useSession } from '@/contexts/useSession';
import { errorSpecOf, KpiError } from '@/lib/errorCatalog';
import { formatDate } from '@/lib/utils';

/**
 * One form (phiếu) — `/forms/:formId`, reached from the inbox, the team list, HR's list and links
 * (WBS 4.5.2–4.5.4). Not a menu item: the route is public within the shell and this page checks the
 * record itself (`useFormDetail.mayView`); the gateway stays the authority on every action.
 */
export default function FormDetailPage() {
  const { formId = '' } = useParams();
  const { user } = useSession();
  const detail = useFormDetail(formId);
  const { form, standing, lookups } = detail;

  if (detail.formQuery.error != null) {
    const error = detail.formQuery.error;
    return (
      <>
        <PageHeader title="Phiếu" />
        <ErrorStateCard spec={errorSpecOf(error)} onAction={error instanceof KpiError && error.code === 'ERR-KPI-02' ? undefined : () => void detail.formQuery.refetch()} />
      </>
    );
  }
  if (detail.query.error != null && !standing) {
    return (
      <>
        <PageHeader title="Phiếu" />
        <ErrorStateCard spec={errorSpecOf(detail.query.error)} onAction={() => void detail.query.refetch()} />
      </>
    );
  }
  if (!form || !standing || detail.mayView === undefined) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!detail.mayView) return <AccessDenied />;

  const title = formTitle(form, lookups);
  const cycleName = lookups.cycle(detail.plan?.cycleId ?? null)?.name ?? null;
  const periodText = formPeriodText(form, cycleName, lookups);
  const atMyStep = standing.readOnlyReason === null && standing.actions.some((a) => a !== 'CANCEL');
  // At most two, the most important first: frozen, then who the user acts as, then why they only read.
  const notices = [
    standing.frozen ? readOnlySentence(form, { ...standing, readOnlyReason: 'FROZEN' }, lookups) : null,
    returnedSentence(detail.history, standing, lookups),
    actingAsSentence(standing, lookups),
    standing.frozen ? null : readOnlySentence(form, standing, lookups),
  ]
    .filter((n): n is string => n !== null)
    .slice(0, 2);
  const body =
    form.formType === 'KPI_EVAL' ? (
      <EvaluationFormBody detail={detail} title={title} />
    ) : form.formType === 'GOAL_SETTING' ? (
      <GoalPlanFormBody detail={detail} title={title} />
    ) : (
      <GoalChangeFormBody detail={detail} title={title} />
    );

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={[periodText, `Hạn phiếu ${formatDate(form.dueDate)}`].filter(Boolean).join('. ') + '.'}
        actions={
          <span className="flex flex-wrap items-center gap-1.5">
            <FormStatusBadge status={form.status} atMyStep={atMyStep} />
            {standing.overdue && <OverdueBadge />}
          </span>
        }
      />

      <section aria-label="Tiến trình phiếu" className="space-y-2">
        <FormStepStrip form={form} steps={standing.steps} />
        {standing.step && (
          <p className="text-sm text-muted-foreground">
            Bước {standing.step.stepNo}/{standing.steps.length}: <span className="text-foreground">{standing.step.name}</span>.{' '}
            Người xử lý: <span className="text-foreground">{standing.assignees.length ? standing.assignees.map((id) => (id === user.id ? 'bạn' : lookups.userName(id))).join(', ') : 'chưa có'}</span>.{' '}
            {standing.deadline && (
              <>
                Hạn bước <span className="tabular text-foreground">{formatDate(standing.deadline)}</span>.
              </>
            )}
          </p>
        )}
        {notices.length > 0 && (
          <div className="space-y-1.5">
            {notices.map((n) => (
              <p key={n} role="status" className="rounded-md border bg-surface-alt px-3 py-2 text-sm">
                {n}
              </p>
            ))}
          </div>
        )}
      </section>

      {body}

      <FormHistory
        actions={detail.history}
        error={detail.historyQuery.error}
        onRetry={() => void detail.historyQuery.refetch()}
        steps={standing.steps}
        lookups={lookups}
      />
    </div>
  );
}
