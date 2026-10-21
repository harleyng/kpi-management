import { useMemo } from 'react';
import type { FormInstance, FormType, GoalPlan, Id, IsoDate, WorkflowStep, WorkflowTemplate } from '@/data/types';
import type { RuleIssue } from '@/lib/errorCatalog';
import { addDays, todayOf } from '@/lib/isoDate';
import { planOwnerOf } from '@/lib/planAccessRules';
import { combineQueries, type QueryState } from '@/lib/queryState';
import { canStartForm, defaultStartDueDays, isTerminal, registrationRoute, type ActorDirectory, type RouteStep } from '@/lib/workflowRules';
import { useFormList, useWorkflows, useWorkflowSteps } from './forms';
import { useActorDirectory, useCycles } from './goals';
import { useGatewayClock } from './session';

/**
 * A form started by hand on a plan (BR-KPI-15 adjustment, BR-KPI-19 unit registration) — everything
 * `forms.startForm` will check, read once for the button and its dialog. Lives in its own file: it
 * reads both `forms.ts` and `goals.ts`, and `goals.ts` already imports `forms.ts`.
 */
export interface StartFormContext {
  /** `ready` only when every read has loaded; `error` keeps the failure visible (never a hidden button). */
  status: 'loading' | 'error' | 'ready';
  query: QueryState;
  /** The form type's default workflow (`isDefault`, else the first); `null` when the tenant has none. */
  workflow: WorkflowTemplate | null;
  /** The workflow's steps in order. */
  steps: WorkflowStep[];
  /** Who the form is about: the plan's employee, or its unit's head. */
  ownerId: Id | null;
  /** This type's form already open on the plan (linked instead of offered twice). */
  openForm: FormInstance | null;
  /** Who acts at each step now (`registrationRoute`); `null` without an owner or a directory. */
  route: RouteStep[] | null;
  /** The session directory the route was read from (names of the step actors). */
  dir: ActorDirectory | null;
  /** Today in the tenant's zone, from the gateway clock. */
  today: IsoDate;
  /** Today + the sum of the steps' SLAs (`defaultStartDueDays`). */
  defaultDueDate: IsoDate;
  /** `canStartForm` for a due date — exactly the gateway's check, with the same context. */
  issuesFor: (dueDate: IsoDate) => RuleIssue[];
}

export function useStartFormContext(plan: GoalPlan, formType: FormType): StartFormContext {
  const clock = useGatewayClock();
  const workflows = useWorkflows(formType);
  const allSteps = useWorkflowSteps();
  const cycles = useCycles();
  const planForms = useFormList({ goalPlanId: plan.id });
  const { dir, query: dirQuery } = useActorDirectory();
  const query = combineQueries([workflows, allSteps, cycles, planForms, dirQuery]);

  const workflow = workflows.data?.find((w) => w.isDefault) ?? workflows.data?.[0] ?? null;
  const steps = useMemo(
    () => (workflow && allSteps.data ? allSteps.data.filter((s) => s.workflowId === workflow.id).sort((a, b) => a.stepNo - b.stepNo) : []),
    [workflow, allSteps.data],
  );
  const ownerId = dir ? planOwnerOf(plan, dir.units) : null;
  const openForm = planForms.data?.find((f) => f.formType === formType && !isTerminal(f)) ?? null;
  const today = todayOf(clock);
  // Not memoised: the gateway clock is read fresh each render (the dev toolbar moves it).
  const route = dir && ownerId && steps.length ? registrationRoute(steps, ownerId, dir, clock) : null;

  const loaded = workflows.data !== undefined && allSteps.data !== undefined && cycles.data !== undefined && planForms.data !== undefined && dir !== null;
  const status = query.error != null ? 'error' : loaded ? 'ready' : 'loading';
  const cycle = cycles.data?.find((c) => c.id === plan.cycleId) ?? null;

  return {
    status,
    query,
    workflow,
    steps,
    ownerId,
    openForm,
    route,
    dir,
    today,
    defaultDueDate: addDays(today, defaultStartDueDays(steps)),
    issuesFor: (dueDate) =>
      canStartForm(
        // Without an owner the subject is unknown: canStartForm answers SUBJECT_NOT_OWNER itself.
        { subjectEmployeeId: ownerId ?? '', goalPlanId: plan.id, periodId: null, dueDate },
        { formType, plan, planOwnerEmployeeId: ownerId, cycle, forms: planForms.data ?? [], clock },
      ),
  };
}
