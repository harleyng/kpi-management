import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENTS, type NotificationTemplate } from '@/data/types';
import { NOTIFICATION_TEXTS } from '@/data/fixtures/catalog';
import {
  MAX_SUBJECT_LENGTH,
  NOTIFICATION_VARIABLES,
  VARIABLES_BY_EVENT,
  deadlineConsequence,
  formatViDate,
  inAppTemplateFor,
  isInAppNotification,
  notificationRecipients,
  notificationRef,
  notificationSourceKey,
  periodPhrase,
  renderTemplate,
  stepActedNotification,
  templateIssues,
  templateVariables,
} from './notificationRules';

const template = (o: Partial<NotificationTemplate> = {}): NotificationTemplate => ({
  id: 'tpl1', tenantId: 't1', eventCode: 'STEP_ASSIGNED', channel: 'InApp', language: 'vi',
  subject: 'Bạn có phiếu {{formType}} cần xử lý', body: 'Phiếu của {{subjectName}}.', ...o,
});
const details = (issues: { detail: string | null }[]) => issues.map((i) => i.detail);

describe('templateVariables', () => {
  it('lists each variable once, in order, tolerating inner spaces', () => {
    expect(templateVariables('{{ a }} {{b}} {{a}}')).toEqual(['a', 'b']);
    expect(templateVariables('không có biến')).toEqual([]);
  });
});

describe('templateIssues — what saveNotificationTemplate refuses (BR-KPI-47)', () => {
  it('accepts every seeded template', () => {
    for (const t of NOTIFICATION_TEXTS) {
      expect(templateIssues({ eventCode: t.event, subject: t.subject, body: t.body }), `${t.event}/${t.channel}`).toEqual([]);
    }
  });

  it('refuses an empty subject or body, pointing at the field', () => {
    expect(templateIssues(template({ subject: '  ' }))).toEqual([expect.objectContaining({ code: 'ERR-KPI-06', ref: 'subject', detail: 'TEMPLATE_TEXT_REQUIRED' })]);
    expect(templateIssues(template({ body: '' }))).toEqual([expect.objectContaining({ ref: 'body', detail: 'TEMPLATE_TEXT_REQUIRED' })]);
  });

  it('refuses a subject longer than the limit', () => {
    expect(details(templateIssues(template({ subject: 'x'.repeat(MAX_SUBJECT_LENGTH + 1) })))).toEqual(['TEMPLATE_TEXT_TOO_LONG']);
  });

  it('refuses a variable the event does not supply, naming it', () => {
    // `reason` exists, but only RETURNED fills it.
    const issues = templateIssues(template({ body: 'Lý do: {{reason}} {{abc}}' }));
    expect(issues).toEqual([
      expect.objectContaining({ ref: 'body', detail: 'TEMPLATE_UNKNOWN_VARIABLE', data: { variable: 'reason' } }),
      expect.objectContaining({ ref: 'body', detail: 'TEMPLATE_UNKNOWN_VARIABLE', data: { variable: 'abc' } }),
    ]);
  });

  it('refuses a brace left open in either direction', () => {
    expect(details(templateIssues(template({ subject: 'Phiếu {{formType' })))).toEqual(['TEMPLATE_UNCLOSED_BRACE']);
    expect(details(templateIssues(template({ body: 'xong }}' })))).toEqual(['TEMPLATE_UNCLOSED_BRACE']);
  });

  it('every event supplies only known variables', () => {
    for (const event of NOTIFICATION_EVENTS) {
      for (const v of VARIABLES_BY_EVENT[event]) expect(NOTIFICATION_VARIABLES).toContain(v);
    }
  });
});

describe('renderTemplate', () => {
  it('fills the variables', () => {
    expect(renderTemplate('Phiếu {{formType}} của {{ subjectName }}', { formType: 'Đánh giá KPI', subjectName: 'An' })).toBe('Phiếu Đánh giá KPI của An');
    expect(renderTemplate('Bước {{stepNo}}/{{stepCount}}', { stepNo: 1, stepCount: 3 })).toBe('Bước 1/3');
  });

  it('renders a missing, null or unknown variable as nothing and tidies the spaces it leaves', () => {
    expect(renderTemplate('Hạn là {{dueDate}}. {{consequence}}', { dueDate: '13/04/2027', consequence: '' })).toBe('Hạn là 13/04/2027.');
    expect(renderTemplate('Đợt {{formType}} {{period}} đã bắt đầu', { formType: 'Đăng ký KPI', period: null })).toBe('Đợt Đăng ký KPI đã bắt đầu');
    expect(renderTemplate('A {{nope}} B {{reason}} .', {})).toBe('A B.');
  });

  it('keeps line breaks (the e-mail body has paragraphs)', () => {
    expect(renderTemplate('Kính gửi {{recipientName}},\n\nTrân trọng', { recipientName: 'An' })).toBe('Kính gửi An,\n\nTrân trọng');
  });

  it('never leaves a {{ in its output, whatever the input', () => {
    const texts = ['{{a}}', '{{ {{b}} }}', '{{{c}}}', 'x {{ formType', '{{}}', '{{stepNo}}{{stepNo}}'];
    for (const text of texts) {
      for (const vars of [{}, { stepNo: 2, formType: '{{reason}}' }]) {
        expect(renderTemplate(text, vars).match(/\{\{[^{}]*\}\}/), `${text}`).toBeNull();
      }
    }
  });
});

describe('wording', () => {
  it('formats a date as dd/MM/yyyy', () => {
    expect(formatViDate('2027-04-13')).toBe('13/04/2027');
  });

  it.each([
    ['Month', '2027-03-01', 'tháng 03/2027'],
    ['Quarter', '2027-04-01', 'quý 2/2027'],
    ['Half', '2027-07-01', 'nửa cuối năm 2027'],
    ['Half', '2027-01-01', 'nửa đầu năm 2027'],
    ['Year', '2027-01-01', 'năm 2027'],
  ] as const)('%s starting %s → %s', (periodType, startDate, phrase) => {
    expect(periodPhrase({ periodType, startDate }, { name: 'KPI 2027' })).toBe(phrase);
  });

  it('names the cycle when the form has no period, and nothing when neither is known', () => {
    expect(periodPhrase(null, { name: 'KPI 2027' })).toBe('KPI 2027');
    expect(periodPhrase(null, null)).toBe('');
  });

  it('warns what happens at the deadline only for LOCK and AUTO_FORWARD', () => {
    expect(deadlineConsequence('LOCK')).toMatch(/khóa/);
    expect(deadlineConsequence('AUTO_FORWARD')).toMatch(/tự chuyển/);
    expect(deadlineConsequence('REMIND')).toBe('');
    expect(deadlineConsequence(null)).toBe('');
  });
});

describe('who is told what (BR-KPI-45)', () => {
  it('notifies each assignee once, never the person who acted', () => {
    expect(notificationRecipients(['u1', 'u2', 'u1', 'u3'], ['u2', null])).toEqual(['u1', 'u3']);
    expect(notificationRecipients([], ['u1'])).toEqual([]);
  });

  it.each([
    ['RETURN', 's2', 'RETURNED'],
    ['SUBMIT', 's2', 'STEP_ASSIGNED'],
    ['APPROVE', 's2', 'STEP_ASSIGNED'],
    ['AUTO_FORWARD', 's2', 'STEP_ASSIGNED'],
    ['APPROVE', null, null], // completed
    ['CANCEL', null, null],
    ['AUTO_LOCK', 's2', null], // frozen at its step — ASSUMPTION Q29
  ] as const)('%s with next step %s → %s', (action, next, expected) => {
    expect(stepActedNotification(action, next)).toBe(expected);
  });

  it('points a launch notice at the launch, a returned registration at its plan, the rest at the form', () => {
    const f = { id: 'f1', formType: 'GOAL_SETTING' as const, goalPlanId: 'p1', launchId: 'l1' };
    expect(notificationRef('FORM_LAUNCHED', f)).toEqual({ refType: 'Launch', refId: 'l1' });
    expect(notificationRef('FORM_LAUNCHED', { ...f, launchId: null })).toEqual({ refType: 'Form', refId: 'f1' });
    expect(notificationRef('RETURNED', f)).toEqual({ refType: 'GoalPlan', refId: 'p1' });
    expect(notificationRef('RETURNED', { ...f, formType: 'KPI_EVAL', goalPlanId: null })).toEqual({ refType: 'Form', refId: 'f1' });
    expect(notificationRef('STEP_ASSIGNED', f)).toEqual({ refType: 'Form', refId: 'f1' });
  });

  it('keys a notice by event, form and kind, so one launch tells a manager about each report', () => {
    expect(notificationSourceKey('e1', 'f1', 'STEP_ASSIGNED')).not.toBe(notificationSourceKey('e1', 'f2', 'STEP_ASSIGNED'));
    expect(notificationSourceKey('e1', 'f1', 'STEP_ASSIGNED')).not.toBe(notificationSourceKey('e1', 'f1', 'FORM_LAUNCHED'));
  });
});

describe('templates and channels', () => {
  const inApp = template({ id: 'a' });
  const email = template({ id: 'b', channel: 'Email' });

  it('renders from the in-app Vietnamese template of the event, or none', () => {
    expect(inAppTemplateFor([email, inApp], 'STEP_ASSIGNED')).toBe(inApp);
    expect(inAppTemplateFor([email], 'STEP_ASSIGNED')).toBeNull();
  });

  it('keeps e-mail rows out of the bell', () => {
    const byId = new Map([[inApp.id, inApp], [email.id, email]]);
    expect(isInAppNotification({ templateId: 'a' }, byId)).toBe(true);
    expect(isInAppNotification({ templateId: 'b' }, byId)).toBe(false);
    expect(isInAppNotification({ templateId: null }, byId)).toBe(true);
  });
});
