/**
 * In-app notifications (WBS 4.8.1–4.8.2, BR-KPI-45…47) — which event notifies whom, the variables a
 * template may use, how a template renders, and what `saveNotificationTemplate` refuses. Pure: the
 * listener (`src/integrations/data/notificationListener.ts`) gathers the rows and calls these.
 *
 * Wording that ends up in a notification (a period, a date, what happens at the deadline) is decided
 * here, so the preview on the template screen and the stored text can never disagree.
 */

import {
  FORM_TYPE_LABEL,
  type CyclePeriod,
  type FormType,
  type Id,
  type IsoDate,
  type KpiNotification,
  type NotificationEvent,
  type NotificationRefType,
  type NotificationTemplate,
  type OverdueBehaviour,
  type PerformanceCycle,
  type StepAction,
} from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';

// ─── Variables ─────────────────────────────────────────────────────────────────────────────────

/** Every `{{variable}}` a template can name. */
export const NOTIFICATION_VARIABLES = [
  'recipientName',
  'subjectName',
  'formType',
  'period',
  'stepName',
  'stepNo',
  'stepCount',
  'dueDate',
  'actorName',
  'reason',
  'consequence',
  'launchName',
] as const;
export type NotificationVariable = (typeof NOTIFICATION_VARIABLES)[number];

const COMMON = ['recipientName', 'subjectName', 'formType', 'period', 'stepName'] as const;

/**
 * The variables the listener fills for each event (BR-KPI-47). A template naming any other is
 * refused, so a variable can never silently render empty because its event does not supply it.
 * For DEADLINE_REMIND `dueDate` is the STEP's deadline; for the others, the form's due date.
 */
export const VARIABLES_BY_EVENT: Readonly<Record<NotificationEvent, readonly NotificationVariable[]>> = {
  FORM_LAUNCHED: [...COMMON, 'stepNo', 'stepCount', 'dueDate', 'launchName'],
  STEP_ASSIGNED: [...COMMON, 'stepNo', 'stepCount', 'dueDate', 'actorName'],
  DEADLINE_REMIND: [...COMMON, 'dueDate', 'consequence'],
  RETURNED: [...COMMON, 'actorName', 'reason'],
};

export type NotificationVars = Partial<Record<NotificationVariable, string | number | null>>;

const VARIABLE = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** The variable names `text` uses, in order of first appearance (malformed names included). */
export function templateVariables(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(VARIABLE)) if (!names.includes(match[1])) names.push(match[1]);
  return names;
}

/** Subject length a notification row shows in full (the bell clamps the body, never the subject). */
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 2000;

const isVariable = (name: string): name is NotificationVariable => (NOTIFICATION_VARIABLES as readonly string[]).includes(name);

/**
 * What `saveNotificationTemplate` refuses (ERR-KPI-06, `ref` = the field): an empty subject or body,
 * one too long, a `{{name}}` the event does not supply (`data.variable`), or a brace left open
 * (`{{` without `}}` or the reverse) — which would otherwise reach the reader as raw text.
 */
export function templateIssues(t: Pick<NotificationTemplate, 'eventCode' | 'subject' | 'body'>): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const allowed = VARIABLES_BY_EVENT[t.eventCode] ?? [];
  const fields = [
    ['subject', t.subject, MAX_SUBJECT_LENGTH],
    ['body', t.body, MAX_BODY_LENGTH],
  ] as const;
  for (const [field, raw, max] of fields) {
    const text = typeof raw === 'string' ? raw : '';
    if (text.trim() === '') {
      issues.push(ruleIssue('ERR-KPI-06', field, 'TEMPLATE_TEXT_REQUIRED'));
      continue;
    }
    if (text.length > max) issues.push(ruleIssue('ERR-KPI-06', field, 'TEMPLATE_TEXT_TOO_LONG', { max }));
    for (const name of templateVariables(text)) {
      if (!isVariable(name) || !allowed.includes(name)) {
        issues.push(ruleIssue('ERR-KPI-06', field, 'TEMPLATE_UNKNOWN_VARIABLE', { variable: name }));
      }
    }
    const rest = text.replace(VARIABLE, '');
    if (rest.includes('{{') || rest.includes('}}')) issues.push(ruleIssue('ERR-KPI-06', field, 'TEMPLATE_UNCLOSED_BRACE'));
  }
  return issues;
}

/**
 * The text with every `{{variable}}` replaced (BR-KPI-47). A variable with no value — or one the
 * renderer does not know — becomes empty, never a literal `{{x}}`; the spaces it leaves behind are
 * collapsed on each line and a space before punctuation is dropped. Line breaks are kept.
 */
export function renderTemplate(text: string, vars: NotificationVars): string {
  const filled = text.replace(VARIABLE, (_, name: string) => {
    const value = isVariable(name) ? vars[name] : undefined;
    return value === null || value === undefined ? '' : String(value);
  });
  return filled
    // A brace pair the pattern could not read (`{{ {{a}} }}` leaves `{{  }}`) never reaches the reader.
    .replace(/\{\{|\}\}/g, '')
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]+/g, ' ')
        .replace(/ ([.,;:!?)])/g, '$1')
        .trim(),
    )
    .join('\n')
    .trim();
}

// ─── Wording ───────────────────────────────────────────────────────────────────────────────────

/** `2027-04-13` → `13/04/2027`. */
export function formatViDate(date: IsoDate): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * The period as a notification says it: "tháng 03/2027", "quý 1/2027", "nửa đầu năm 2027",
 * "năm 2027". A form with no period (registration, adjustment) names its cycle ("KPI 2027").
 */
export function periodPhrase(
  period: Pick<CyclePeriod, 'periodType' | 'startDate'> | null,
  cycle: Pick<PerformanceCycle, 'name'> | null,
): string {
  if (!period) return cycle?.name ?? '';
  const [y, m] = period.startDate.split('-');
  const month = Number(m);
  switch (period.periodType) {
    case 'Month':
      return `tháng ${m}/${y}`;
    case 'Quarter':
      return `quý ${Math.floor((month - 1) / 3) + 1}/${y}`;
    case 'Half':
      return month <= 6 ? `nửa đầu năm ${y}` : `nửa cuối năm ${y}`;
    case 'Year':
      return `năm ${y}`;
  }
}

/**
 * What a reminder warns will happen at the deadline — the step's overdue behaviour (BR-KPI-13; the
 * "Email nhắc Deadline" says the plan is then locked). Nothing extra for REMIND or no behaviour.
 */
export function deadlineConsequence(onOverdue: OverdueBehaviour | null): string {
  switch (onOverdue) {
    case 'LOCK':
      return 'Quá hạn, Goal Plan sẽ bị khóa và không thể chỉnh sửa.';
    case 'AUTO_FORWARD':
      return 'Quá hạn, phiếu sẽ tự chuyển sang bước tiếp theo.';
    default:
      return '';
  }
}

/** The form type as the templates name it ("Đánh giá KPI"). */
export const formTypePhrase = (formType: FormType) => FORM_TYPE_LABEL[formType];

// ─── Who is told what (BR-KPI-45) ──────────────────────────────────────────────────────────────

/**
 * The people to notify: the assignees, each once, minus the excluded (the person who acted — nobody
 * is told about their own action). Delegates are already among the assignees (`assigneesOf`), so a
 * delegator and their active delegate are both told.
 */
export function notificationRecipients(assignees: readonly Id[], exclude: readonly (Id | null)[]): Id[] {
  return [...new Set(assignees)].filter((id) => !exclude.includes(id));
}

/**
 * What a step action tells the people now holding the form: a RETURN → RETURNED; a move to another
 * step (SUBMIT, APPROVE, AUTO_FORWARD) → STEP_ASSIGNED. A completed or cancelled form (no next step)
 * and an AUTO_LOCK (the form stays, frozen) notify nobody in P1 (`ASSUMPTION Q19`).
 */
export function stepActedNotification(action: StepAction, nextStepId: Id | null): NotificationEvent | null {
  if (nextStepId === null) return null;
  if (action === 'RETURN') return 'RETURNED';
  if (action === 'SUBMIT' || action === 'APPROVE' || action === 'AUTO_FORWARD') return 'STEP_ASSIGNED';
  return null;
}

/**
 * What a notification points at — where clicking it leads. A launch notice points at the launch; a
 * registration sent back points at the Goal Plan its owner must fix; everything else at the form.
 */
export function notificationRef(
  eventCode: NotificationEvent,
  form: { id: Id; formType: FormType; goalPlanId: Id | null; launchId: Id | null },
): { refType: NotificationRefType; refId: Id } {
  if (eventCode === 'FORM_LAUNCHED' && form.launchId !== null) return { refType: 'Launch', refId: form.launchId };
  if (eventCode === 'RETURNED' && form.formType === 'GOAL_SETTING' && form.goalPlanId !== null) {
    return { refType: 'GoalPlan', refId: form.goalPlanId };
  }
  return { refType: 'Form', refId: form.id };
}

/**
 * The idempotency key of one notification (`recordNotification` is idempotent per (key, recipient)).
 * One event can concern many forms (a launch), so the form and the notice are part of the key. A
 * reminder uses the scheduler's `reminderKey` instead, so every tick in the window writes it once.
 */
export const notificationSourceKey = (eventId: Id, formId: Id, eventCode: NotificationEvent) => `${eventId}:${formId}:${eventCode}`;

/** The template a notice is rendered from: the tenant's in-app Vietnamese one, if it has it. */
export function inAppTemplateFor(templates: readonly NotificationTemplate[], eventCode: NotificationEvent): NotificationTemplate | null {
  return templates.find((t) => t.eventCode === eventCode && t.channel === 'InApp' && t.language === 'vi') ?? null;
}

/**
 * Whether a notification belongs in the bell: written from an in-app template, or from none. E-mail
 * rows (P1 sends no e-mail) are delivery records, never shown as in-app notices.
 */
export function isInAppNotification(
  n: Pick<KpiNotification, 'templateId'>,
  templatesById: ReadonlyMap<Id, Pick<NotificationTemplate, 'channel'>>,
): boolean {
  if (n.templateId === null) return true;
  const template = templatesById.get(n.templateId);
  return template === undefined || template.channel === 'InApp';
}
