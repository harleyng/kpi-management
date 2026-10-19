import { useSession } from '@/contexts/useSession';
import type { FormInstance, FormStepAction, GoalPlan, Id } from '@/data/types';
import { useDelegations, useForm, useFormActions } from '@/hooks/queries/forms';
import { useGoalPlan } from '@/hooks/queries/goals';
import { useGatewayClock } from '@/hooks/queries/session';
import { formStanding, type FormStanding } from '@/lib/formViewRules';
import { resourceOfOwner, resourceOfSubject, type PermissionResource } from '@/lib/permissionRules';
import { combineQueries, type QueryState } from '@/lib/queryState';
import { useFormLookups, type FormLookups } from './useFormLookups';

export interface FormDetail {
  form: FormInstance | undefined;
  /** The form query alone — its error (not found, refused) decides the page's state. */
  formQuery: ReturnType<typeof useForm>;
  /** Everything the standing needs; the page waits for it before showing any button. */
  query: QueryState;
  /** `null` while the form has no plan; `undefined` while it loads. */
  plan: GoalPlan | null | undefined;
  history: FormStepAction[] | undefined;
  historyQuery: ReturnType<typeof useFormActions>;
  standing: FormStanding | undefined;
  lookups: FormLookups;
  /** The resource the form's data belongs to — its plan's owner, else its subject (`permissionRules`). */
  resource: PermissionResource | null;
  /**
   * Whether this person may look at the form at all: its subject, someone who must act or acted on it,
   * or someone who may view the plan's owner (HR, the unit's manager). A screen hint only — the gateway
   * decides what it serves (Phase 5: per-user reads are RLS).
   */
  mayView: boolean | undefined;
}

/**
 * One form, as the form screen needs it: the rows, the names, and `formStanding` — what this user may
 * do now — composed from the same rules the gateway runs (`formViewRules`). Read on every render with
 * the gateway clock, so a delegation that expires or a deadline that passes shows without a reload.
 */
export function useFormDetail(formId: Id): FormDetail {
  const { tenantId, user, can } = useSession();
  const formQuery = useForm(formId);
  const form = formQuery.data;
  const lookups = useFormLookups();
  const planQuery = useGoalPlan(form?.goalPlanId ?? null);
  const delegations = useDelegations();
  const historyQuery = useFormActions(formId);
  const clock = useGatewayClock();

  const plan: GoalPlan | null | undefined = form ? (form.goalPlanId ? planQuery.data : null) : undefined;
  const subject = form ? resourceOfSubject(tenantId, form.subjectEmployeeId) : null;
  const resource = plan ? resourceOfOwner(tenantId, plan) : subject;

  const standing =
    form && lookups.actorDirectory && lookups.ready && delegations.data
      ? formStanding({
          form,
          steps: lookups.steps,
          plan,
          directory: lookups.actorDirectory,
          delegations: delegations.data,
          userId: user.id,
          mayProxy: can('form.proxy', subject),
          mayCancel: can('form.cancel', subject),
          clock,
        })
      : undefined;

  const history = historyQuery.data;
  const mayView =
    form === undefined || standing === undefined || (form.goalPlanId !== null && plan === undefined)
      ? undefined
      : form.subjectEmployeeId === user.employeeId ||
        standing.assignees.includes(user.id) ||
        (history?.some((a) => a.actorUserId === user.id || a.onBehalfOfUserId === user.id) ?? false) ||
        can('goalplan.view', resource) ||
        can('form.proxy', subject);

  return {
    form,
    formQuery,
    query: combineQueries([formQuery, lookups.query, delegations, ...(form?.goalPlanId ? [planQuery] : [])]),
    plan,
    history,
    historyQuery,
    standing,
    lookups,
    resource,
    mayView,
  };
}
