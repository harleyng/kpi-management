import type { FormLaunch, FormStepAction, Id } from '@/data/types';
import {
  dueScheduledLaunches,
  launchPeriodIssues,
  launchRuleFirings,
  markHandled,
  overdueActions,
  reminderKey,
  remindersDue,
  stepDeadline,
  isFrozen,
  transition,
} from '@/lib/workflowRules';
import type { SchedulerGateway, SchedulerReport } from '../../types';
import { clockOf } from '../authorize';
import { newId } from '../rows';
import type { Runtime } from '../runtime';
import { applyColumnEntry, assigneesFor, fireLaunch, planOfForm, setPlanStatus, stepOf, stepsOf, syncWorkPlan } from '../workflowContext';

/**
 * `scheduler.runDue` — one tick of the clock-driven jobs, as of the gateway clock, in ONE system
 * transaction (no actor): due SCHEDULED launches, recurring rule firings (D5), overdue steps
 * (BR-KPI-13) and deadline reminders. Every decision is `workflowRules`'; this file only writes.
 *
 * Idempotent by the rows: a fired launch is Launched; a rule fires once per (rule, period) because
 * its launch row exists; an overdue step is handled once per entry (`overdueHandledAt`). Reminders
 * are NOT deduplicated here (product owner, Gate 1): `form.dueSoon` carries `reminderKey`, which T7's
 * listener uses as the notification's `sourceEventId`, so a reminder repeated by later ticks inside
 * the reminder window writes one notification.
 */
export function schedulerGroup(rt: Runtime): SchedulerGateway {
  return {
    runDue: rt.system('scheduler.runDue', (tx): SchedulerReport => {
      const clock = clockOf(tx);
      const report: SchedulerReport = { launchesFired: [], formsCreated: [], overdueHandled: [], remindersDue: [] };
      // The forms as the tick found them: one move per form per tick (`overdueActions`).
      const formsAtStart = tx.all('FormInstance');
      const steps = tx.all('WorkflowStep');

      const fire = (launch: FormLaunch) => {
        const fired = fireLaunch(tx, launch);
        report.launchesFired.push(launch.id);
        report.formsCreated.push(...fired.formIds);
      };

      /** PEND-09 — a launch for a period its form type does not take (`LAUNCH_PERIOD_TYPES`). */
      const wrongPeriod = (formType: FormLaunch['formType'], periodId: Id | null) =>
        launchPeriodIssues(formType, periodId === null ? null : (tx.find('CyclePeriod', periodId) ?? null)).length > 0;

      // 1. One-off launches whose time has come. One stored for a period its type no longer takes (a
      // monthly evaluation scheduled before PEND-09) is cancelled, never fired — and never throws, so
      // the rest of the tick still runs.
      for (const launch of dueScheduledLaunches(tx.all('FormLaunch'), clock)) {
        if (wrongPeriod(launch.formType, launch.periodId)) tx.update('FormLaunch', { ...launch, status: 'Cancelled' });
        else fire(launch);
      }

      // 2. Recurring rules: one launch per (rule, period), missed periods caught up in order.
      const firings = launchRuleFirings(tx.all('FormLaunchRule'), tx.all('CyclePeriod'), tx.all('PerformanceCycle'), tx.all('FormLaunch'), clock);
      for (const firing of firings) {
        const rule = tx.get('FormLaunchRule', firing.ruleId);
        const period = tx.get('CyclePeriod', firing.periodId);
        const workflow = tx.get('WorkflowTemplate', rule.workflowId);
        // An active rule for a period its form type does not take (one stored before PEND-09, or written
        // around `saveLaunchRule`) fires nothing and writes nothing.
        if (wrongPeriod(workflow.formType, period.id)) continue;
        const launch = tx.insert('FormLaunch', {
          id: newId(),
          tenantId: tx.tenantId,
          workflowId: rule.workflowId,
          formType: workflow.formType,
          name: `${rule.name} – ${period.label}`,
          timing: 'RECURRING',
          scheduledAt: tx.now,
          launchRuleId: rule.id,
          cycleId: firing.cycleId,
          periodId: firing.periodId,
          dueDays: rule.dueDays,
          recipientMode: rule.recipientMode,
          recipientFilter: rule.recipientFilter,
          status: 'Scheduled',
          launchedAt: null,
          createdBy: null,
          createdAt: tx.now,
          // A rule's recurring launches start at step 1 (a rule has no start step).
          startStepNo: null,
        });
        fire(launch);
      }

      // 3. Overdue steps, once per entry into the step.
      for (const due of overdueActions(formsAtStart, steps, clock)) {
        const form = tx.get('FormInstance', due.formId);
        // A frozen form (HR locked its registration plan by hand) is not moved: moving it would unlock the plan.
        const dueStep = stepOf(form, stepsOf(tx, form.workflowId));
        if (due.action !== null && dueStep && isFrozen(form, dueStep, planOfForm(tx, form))) continue;
        const missedBy: Id[] = assigneesFor(tx, form);
        if (due.action === null) {
          const handled = markHandled(form, clock);
          if (handled) tx.update('FormInstance', { ...form, ...handled });
        } else {
          const moved = transition(form, stepsOf(tx, form.workflowId), due.action, { clock, comment: null });
          if (!moved.ok) {
            // A step reconfigured since: handle it as a reminder rather than retry it every tick.
            tx.update('FormInstance', { ...form, overdueHandledAt: tx.now });
          } else {
            const saved = tx.update('FormInstance', { ...form, ...moved.form });
            if (moved.nextStep) applyColumnEntry(tx, saved, moved.nextStep, stepOf(form, stepsOf(tx, form.workflowId)), due.action);
            // The system acted: nobody, on behalf of nobody (BR-KPI-13).
            const history: FormStepAction = { id: newId(), tenantId: tx.tenantId, ...moved.record, actorUserId: null, onBehalfOfUserId: null, delegationId: null };
            tx.insert('FormStepAction', history);
            const plan = planOfForm(tx, form);
            if (moved.planStatus && plan) setPlanStatus(tx, plan, moved.planStatus, due.action);
            syncWorkPlan(tx, form, moved.workPlanStatus, null, due.action);
            if (due.action === 'AUTO_FORWARD') {
              tx.emit({
                type: 'form.stepActed',
                formId: form.id,
                stepId: history.stepId,
                action: history.action,
                nextStepId: moved.nextStep?.id ?? null,
                assigneeUserIds: assigneesFor(tx, saved),
                formStatus: saved.status,
              });
            }
          }
        }
        tx.emit({ type: 'form.overdue', formId: form.id, stepId: due.stepId, behaviour: due.behaviour, assigneeUserIds: missedBy });
        report.overdueHandled.push({ formId: due.formId, stepId: due.stepId, behaviour: due.behaviour });
      }

      // 4. Reminders, on the forms as they are now (a form launched this tick may already be due).
      const forms = tx.all('FormInstance');
      for (const due of remindersDue(forms, steps, clock)) {
        const form = forms.find((f) => f.id === due.formId);
        const step = form ? stepOf(form, stepsOf(tx, form.workflowId)) : undefined;
        if (!form || !step) continue;
        tx.emit({
          type: 'form.dueSoon',
          formId: form.id,
          stepId: step.id,
          assigneeUserIds: assigneesFor(tx, form),
          deadline: stepDeadline(form, step, clock.tz),
          reminderKey: reminderKey(form),
        });
        report.remindersDue.push({ formId: due.formId, stepId: due.stepId });
      }
      return report;
    }),
  };
}
