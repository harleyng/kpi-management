import type {
  CyclePeriod,
  Delegation,
  FormInstance,
  GoalPlan,
  Id,
  NotificationEvent,
  NotificationTemplate,
  PerformanceCycle,
  WorkflowStep,
} from '@/data/types';
import { todayOf, type Clock } from '@/lib/isoDate';
import {
  deadlineConsequence,
  formTypePhrase,
  formatViDate,
  inAppTemplateFor,
  notificationRecipients,
  notificationRef,
  notificationSourceKey,
  periodPhrase,
  renderTemplate,
  stepActedNotification,
  type NotificationVars,
} from '@/lib/notificationRules';
import { isEmployedOn } from '@/lib/orgRules';
import {
  assigneesOf,
  effectiveOverdueBehaviour,
  isFrozen,
  isTerminal,
  resolveStepActors,
  userOfEmployee,
  type ActorDirectory,
} from '@/lib/workflowRules';
import type { DataGateway, DomainEvent, DomainEventListener, EntityChangedEvent, NewNotificationInput } from './types';

/**
 * T7's notification listener (WBS 4.8.2, BR-KPI-45…47): turns the workflow's domain events into
 * in-app notifications rendered from the tenant's templates.
 *
 * It speaks ONLY the `DataGateway` contract — reads, then `system.recordNotification` — so any
 * adapter can run it; the mock registers it once, at construction, on its system bus. Who is told
 * what is `notificationRules` / `workflowRules`; this file gathers the rows and writes.
 *
 * | Event | Notice → to whom |
 * |---|---|
 * | `form.launched` | FORM_LAUNCHED → each subject; STEP_ASSIGNED → step-1 assignees other than the subject (they already have the launch notice) |
 * | a form started by hand (`FormInstance` created without a launch) | STEP_ASSIGNED → step-1 assignees |
 * | a form re-entering its step (HR unlocked its plan with a new due date) | STEP_ASSIGNED → the step's assignees |
 * | `form.stepActed` SUBMIT / APPROVE / AUTO_FORWARD to a next step | STEP_ASSIGNED → the new assignees |
 * | `form.stepActed` RETURN | RETURNED → whoever it went back to, with who returned it and why |
 * | `form.dueSoon` | DEADLINE_REMIND → the assignees, once per step entry (`reminderKey`) |
 *
 * Never told: the person who acted, nor the person they acted for. No overdue notice
 * (`ASSUMPTION Q19`), no notice of completion, no e-mail (P1). An event with no in-app template
 * notifies nobody. Every other event — including the `Notification` rows this listener writes — is
 * ignored at once, so it can never feed itself.
 *
 * Best effort: a failed read or write is reported to `onDiagnostic` (the console in the mock) and
 * never touches the write that emitted the event. A real backend moves this to a server-side outbox
 * (Phase 5) so a notice cannot be lost.
 */

export interface NotificationListenerOptions {
  onDiagnostic: (message: string, error: unknown) => void;
  /** Changes when the data is reset: work started before the reset writes nothing after it. */
  generation?: () => number;
}

export interface NotificationListener {
  listener: DomainEventListener;
  /** Resolves once every event received so far has been handled (tests, the dev toolbar). */
  settled(): Promise<void>;
}

const SYSTEM_ACTOR_NAME = 'Hệ thống';
const PAGE_LIMIT = 500;

type Gateway = Pick<DataGateway, 'clock' | 'platform' | 'org' | 'goals' | 'forms' | 'system'>;

/** The rows every notice of one event is rendered from — read once per event, after the commit. */
interface Context {
  tenantId: Id;
  tz: string;
  dir: ActorDirectory;
  delegations: Delegation[];
  steps: WorkflowStep[];
  templates: NotificationTemplate[];
  cycles: PerformanceCycle[];
  periods: CyclePeriod[];
  plans: GoalPlan[];
}

interface Notice {
  eventCode: NotificationEvent;
  sourceEventId: string;
  recipients: Id[];
  form: FormInstance;
  /** The step named in the notice: the form's step now (for RETURNED, the one it went back to). */
  step: WorkflowStep | null;
  vars: NotificationVars;
}

function isRelevant(event: DomainEvent): boolean {
  switch (event.type) {
    case 'form.launched':
    case 'form.stepActed':
    case 'form.dueSoon':
      return true;
    case 'entity.changed':
      return event.entityName === 'FormInstance' && (startedByHand(event) || reenteredStep(event));
    default:
      return false;
  }
}

const formOf = (snapshot: object | null) => snapshot as FormInstance | null;

/** A form created without a launch — `forms.startForm`. Launched forms are told by `form.launched`. */
function startedByHand(event: EntityChangedEvent): boolean {
  const after = formOf(event.after);
  return event.action === 'CREATE' && after !== null && after.launchId === null;
}

/**
 * A form that started its CURRENT step again without moving (HR unlocked its plan: new due date,
 * fresh `currentStepEnteredAt`). A move to another step is `form.stepActed`'s, never this.
 */
function reenteredStep(event: EntityChangedEvent): boolean {
  const before = formOf(event.before);
  const after = formOf(event.after);
  return (
    event.action !== 'CREATE' &&
    before !== null &&
    after !== null &&
    !isTerminal(after) &&
    after.currentStepId !== null &&
    before.currentStepId === after.currentStepId &&
    before.currentStepEnteredAt !== after.currentStepEnteredAt
  );
}

export function createNotificationListener(gateway: Gateway, options: NotificationListenerOptions): NotificationListener {
  const generation = options.generation ?? (() => 0);
  const inFlight = new Set<Promise<void>>();

  async function loadContext(tenantId: Id): Promise<Context> {
    const [tenant, employees, assignments, users, userRoles, roles, units, delegations, steps, templates, cycles, plans] = await Promise.all([
      gateway.platform.getTenant(tenantId),
      gateway.org.listEmployees(tenantId, { includeResigned: true }),
      gateway.org.listAssignments(tenantId),
      gateway.org.listUserAccounts(tenantId),
      gateway.org.listUserRoles(tenantId),
      gateway.org.listRoles(tenantId),
      gateway.org.listOrgUnits(tenantId),
      gateway.forms.listDelegations(tenantId),
      gateway.forms.listWorkflowSteps(tenantId),
      gateway.system.listNotificationTemplates(tenantId),
      gateway.goals.listCycles(tenantId),
      gateway.goals.listGoalPlans(tenantId),
    ]);
    const periods = (await Promise.all(cycles.map((c) => gateway.goals.listPeriods(tenantId, c.id)))).flat();
    return {
      tenantId,
      tz: tenant.timezone,
      dir: { employees, assignments, users, userRoles, roles, units },
      delegations,
      steps,
      templates,
      cycles,
      periods,
      plans,
    };
  }

  const stepsOf = (ctx: Context, form: FormInstance) =>
    ctx.steps.filter((s) => s.workflowId === form.workflowId).sort((a, b) => a.stepNo - b.stepNo);
  const stepById = (ctx: Context, form: FormInstance, stepId: Id | null) => stepsOf(ctx, form).find((s) => s.id === stepId) ?? null;
  const planOf = (ctx: Context, form: FormInstance) => ctx.plans.find((p) => p.id === form.goalPlanId) ?? null;
  const userName = (ctx: Context, userId: Id | null) =>
    userId === null ? SYSTEM_ACTOR_NAME : (ctx.dir.users.find((u) => u.id === userId)?.displayName ?? '');

  /** "Trần Thu Hà", or "Trần Thu Hà (thay cho Lê Văn Bình)" when acting for someone (BR-KPI-21). */
  function actorName(ctx: Context, event: DomainEvent): string {
    const actor = userName(ctx, event.actorUserId);
    return event.onBehalfOfUserId ? `${actor} (thay cho ${userName(ctx, event.onBehalfOfUserId)})` : actor;
  }

  /** The variables every notice about `form` shares. */
  function formVars(ctx: Context, form: FormInstance, step: WorkflowStep | null): NotificationVars {
    const period = form.periodId ? (ctx.periods.find((p) => p.id === form.periodId) ?? null) : null;
    const cycleId = period?.cycleId ?? planOf(ctx, form)?.cycleId ?? null;
    return {
      subjectName: ctx.dir.employees.find((e) => e.id === form.subjectEmployeeId)?.fullName ?? '',
      formType: formTypePhrase(form.formType),
      period: periodPhrase(period, ctx.cycles.find((c) => c.id === cycleId) ?? null),
      stepName: step?.name ?? '',
      stepNo: step?.stepNo ?? null,
      stepCount: stepsOf(ctx, form).length,
      dueDate: formatViDate(form.dueDate),
    };
  }

  /**
   * The subject, on a review step of their own form: nobody acts on that (BR-KPI-21), so nobody is
   * told to — even when the subject is also the reviewer's delegate (`assigneesOf` lists delegates
   * without that check). `null` on a SELF step, where the subject IS the one to act.
   */
  const subjectOnOwnReview = (ctx: Context, form: FormInstance, step: WorkflowStep | null): Id | null =>
    step && step.actorRule !== 'SELF' ? (userOfEmployee(form.subjectEmployeeId, ctx.dir.users)?.id ?? null) : null;

  /** Who must act on the form's current step at `now` — the same rules as the gateway's inbox. */
  function currentAssignees(ctx: Context, form: FormInstance, now: string): Id[] {
    const step = stepById(ctx, form, form.currentStepId);
    if (!step || isTerminal(form)) return [];
    const clock: Clock = { now, tz: ctx.tz };
    return assigneesOf(form, resolveStepActors(step, form.subjectEmployeeId, ctx.dir, clock), ctx.delegations, clock);
  }

  async function deliver(ctx: Context, event: DomainEvent, notices: readonly Notice[], startedIn: number): Promise<void> {
    const writes: { input: NewNotificationInput; label: string }[] = [];
    for (const notice of notices) {
      const template = inAppTemplateFor(ctx.templates, notice.eventCode);
      if (!template) continue; // no template = no notice (BR-KPI-45); the template screen warns
      const ref = notificationRef(notice.eventCode, notice.form);
      for (const recipientUserId of notice.recipients) {
        const vars = { ...notice.vars, recipientName: userName(ctx, recipientUserId) };
        writes.push({
          label: `${notice.eventCode} → ${recipientUserId}`,
          input: {
            sourceEventId: notice.sourceEventId,
            templateId: template.id,
            eventCode: notice.eventCode,
            recipientUserId,
            refType: ref.refType,
            refId: ref.refId,
            subject: renderTemplate(template.subject, vars),
            body: renderTemplate(template.body, vars),
          },
        });
      }
    }
    if (generation() !== startedIn) return; // the data was reset while this event was being read
    const results = await Promise.allSettled(writes.map((w) => gateway.system.recordNotification(ctx.tenantId, w.input)));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        options.onDiagnostic(`notification ${writes[i].label} for event ${event.id} was not recorded`, result.reason);
      }
    });
  }

  async function launchedNotices(ctx: Context, event: Extract<DomainEvent, { type: 'form.launched' }>): Promise<Notice[]> {
    const forms: FormInstance[] = [];
    let cursor: string | undefined;
    do {
      const page = await gateway.forms.listForms(ctx.tenantId, { launchId: event.launchId }, { limit: PAGE_LIMIT, cursor });
      forms.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const launch = await gateway.forms.getLaunch(ctx.tenantId, event.launchId);
    const exclude = [event.actorUserId, event.onBehalfOfUserId];
    const today = todayOf({ now: event.occurredAt, tz: ctx.tz });

    return forms
      .filter((form) => event.formIds.includes(form.id) && !isTerminal(form))
      .flatMap((form): Notice[] => {
        const step = stepById(ctx, form, form.currentStepId);
        const vars = { ...formVars(ctx, form, step), launchName: launch.name };
        const subject = ctx.dir.employees.find((e) => e.id === form.subjectEmployeeId);
        const subjectUser = subject && isEmployedOn(subject, today) ? userOfEmployee(subject.id, ctx.dir.users) : null;
        const notices: Notice[] = [
          {
            eventCode: 'FORM_LAUNCHED',
            sourceEventId: notificationSourceKey(event.id, form.id, 'FORM_LAUNCHED'),
            recipients: notificationRecipients(subjectUser ? [subjectUser.id] : [], exclude),
            form,
            step,
            vars,
          },
        ];
        // A registration whose plan is already locked is frozen at once: nobody is asked to act on it.
        if (step && !isFrozen(form, step, planOf(ctx, form))) {
          notices.push({
            eventCode: 'STEP_ASSIGNED',
            sourceEventId: notificationSourceKey(event.id, form.id, 'STEP_ASSIGNED'),
            recipients: notificationRecipients(currentAssignees(ctx, form, event.occurredAt), [...exclude, subjectUser?.id ?? null]),
            form,
            step,
            vars: { ...vars, actorName: actorName(ctx, event) },
          });
        }
        return notices;
      });
  }

  /** A form started by hand, or one that re-entered its step: whoever must act on it now. */
  function assignedNotices(ctx: Context, event: EntityChangedEvent): Notice[] {
    const form = formOf(event.after) as FormInstance;
    const step = stepById(ctx, form, form.currentStepId);
    if (!step || isFrozen(form, step, planOf(ctx, form))) return [];
    return [
      {
        eventCode: 'STEP_ASSIGNED',
        sourceEventId: notificationSourceKey(event.id, form.id, 'STEP_ASSIGNED'),
        recipients: notificationRecipients(currentAssignees(ctx, form, event.occurredAt), [
          event.actorUserId,
          event.onBehalfOfUserId,
          subjectOnOwnReview(ctx, form, step),
        ]),
        form,
        step,
        vars: { ...formVars(ctx, form, step), actorName: actorName(ctx, event) },
      },
    ];
  }

  async function stepActedNotices(ctx: Context, event: Extract<DomainEvent, { type: 'form.stepActed' }>): Promise<Notice[]> {
    const eventCode = stepActedNotification(event.action, event.nextStepId);
    if (eventCode === null) return [];
    const form = await gateway.forms.getForm(ctx.tenantId, event.formId);
    const step = stepById(ctx, form, event.nextStepId);
    const vars: NotificationVars = { ...formVars(ctx, form, step), actorName: actorName(ctx, event) };
    if (eventCode === 'RETURNED') {
      // The comment of THIS return: a step can be returned more than once.
      const returns = (await gateway.forms.listFormActions(ctx.tenantId, form.id))
        .filter((a) => a.action === 'RETURN' && a.stepId === event.stepId)
        .sort((a, b) => (a.actedAt < b.actedAt ? -1 : 1));
      const own = returns.find((a) => a.actedAt === event.occurredAt) ?? returns[returns.length - 1];
      vars.reason = own?.comment ?? '';
    }
    return [
      {
        eventCode,
        sourceEventId: notificationSourceKey(event.id, form.id, eventCode),
        recipients: notificationRecipients(event.assigneeUserIds, [event.actorUserId, event.onBehalfOfUserId, subjectOnOwnReview(ctx, form, step)]),
        form,
        step,
        vars,
      },
    ];
  }

  async function dueSoonNotices(ctx: Context, event: Extract<DomainEvent, { type: 'form.dueSoon' }>): Promise<Notice[]> {
    const form = await gateway.forms.getForm(ctx.tenantId, event.formId);
    const step = stepById(ctx, form, event.stepId);
    if (!step) return [];
    return [
      {
        eventCode: 'DEADLINE_REMIND',
        // The same for every tick inside the window: one notice per recipient per step entry.
        sourceEventId: event.reminderKey,
        recipients: notificationRecipients(event.assigneeUserIds, [subjectOnOwnReview(ctx, form, step)]),
        form,
        step,
        vars: {
          ...formVars(ctx, form, step),
          dueDate: formatViDate(event.deadline),
          // What the scheduler will REALLY do, not what the step says (a misconfigured one reminds).
          consequence: deadlineConsequence(effectiveOverdueBehaviour(form, step, stepsOf(ctx, form))),
        },
      },
    ];
  }

  async function handle(event: DomainEvent): Promise<void> {
    const startedIn = generation();
    const ctx = await loadContext(event.tenantId);
    let notices: Notice[];
    switch (event.type) {
      case 'form.launched':
        notices = await launchedNotices(ctx, event);
        break;
      case 'form.stepActed':
        notices = await stepActedNotices(ctx, event);
        break;
      case 'form.dueSoon':
        notices = await dueSoonNotices(ctx, event);
        break;
      case 'entity.changed':
        notices = assignedNotices(ctx, event);
        break;
      default:
        return;
    }
    await deliver(ctx, event, notices, startedIn);
  }

  return {
    listener(event) {
      if (!isRelevant(event)) return;
      const run: Promise<void> = handle(event)
        .catch((error) => options.onDiagnostic(`notifications for ${event.type} ${event.id} were not sent`, error))
        .finally(() => inFlight.delete(run));
      inFlight.add(run);
    },
    async settled() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}
