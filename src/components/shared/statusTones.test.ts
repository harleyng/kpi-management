import { describe, expect, it } from 'vitest';
import {
  CYCLE_STATUS_LABEL,
  FORM_STATUS_LABEL,
  GOAL_PLAN_STATUS_LABEL,
  PERIOD_RESULT_STATUS_LABEL,
} from '@/data/types';
import {
  CYCLE_STATUS_TONE,
  DELEGATION_STATE_TONE,
  PLAN_ADJUSTING_TONE,
  FORM_STATUS_TONE,
  GOAL_PLAN_STATUS_TONE,
  PERIOD_RESULT_STATUS_TONE,
  RECORD_STATUS_TONE,
  WORK_TASK_STATUS_TONE,
  formTone,
} from './statusTones';

/**
 * Pins the tables in design-system.md ("Status → tone mapping"). A tone that changes here without
 * the document changing is the drift the single mapping exists to prevent.
 */
describe('status tones match design-system.md', () => {
  it('Goal Plan', () => {
    expect(GOAL_PLAN_STATUS_TONE).toEqual({
      Draft: 'muted',
      Submitted: 'info',
      Returned: 'warning',
      Approved: 'positive',
      Locked: 'positive',
    });
  });

  it('Monthly task (PEND-14)', () => {
    expect(WORK_TASK_STATUS_TONE).toEqual({ NotStarted: 'muted', InProgress: 'info', Done: 'positive', Cancelled: 'muted' });
  });

  it('Form', () => {
    expect(FORM_STATUS_TONE).toEqual({
      Open: 'info',
      InProgress: 'info',
      Completed: 'positive',
      Cancelled: 'muted',
    });
  });

  it('Cycle', () => {
    expect(CYCLE_STATUS_TONE).toEqual({
      Planning: 'info',
      Active: 'positive',
      Evaluating: 'warning',
      Closed: 'muted',
    });
  });

  it('Period result', () => {
    expect(PERIOD_RESULT_STATUS_TONE).toEqual({ Draft: 'muted', Final: 'info', Locked: 'positive' });
  });

  it('Delegation (derived): in effect is green, upcoming is waiting', () => {
    expect(DELEGATION_STATE_TONE).toEqual({ Upcoming: 'info', Active: 'positive', Expired: 'muted', Revoked: 'muted' });
    expect(PLAN_ADJUSTING_TONE).toBe('info');
  });

  it('Record: active is green, inactive grey', () => {
    expect(RECORD_STATUS_TONE).toEqual({ Active: 'positive', Inactive: 'muted' });
  });
});

describe('labels the badges render (src/data/types.ts)', () => {
  it('keeps the Vietnamese labels the design system documents', () => {
    expect(GOAL_PLAN_STATUS_LABEL).toEqual({
      Draft: 'Nháp',
      Submitted: 'Đã gửi',
      Returned: 'Bị trả lại',
      Approved: 'Đã duyệt',
      Locked: 'Đã khóa',
    });
    expect(FORM_STATUS_LABEL.InProgress).toBe('Đang xử lý');
    expect(CYCLE_STATUS_LABEL.Evaluating).toBeTruthy();
    expect(PERIOD_RESULT_STATUS_LABEL.Final).toBe('Đã chốt');
  });
});

describe('formTone', () => {
  it('turns an in-progress form at my step into a warning', () => {
    expect(formTone('InProgress', true)).toBe('warning');
  });

  it('leaves an in-progress form at someone else’s step as info', () => {
    expect(formTone('InProgress', false)).toBe('info');
  });

  it('ignores "my step" for any other status', () => {
    expect(formTone('Open', true)).toBe('info');
    expect(formTone('Completed', true)).toBe('positive');
    expect(formTone('Cancelled', true)).toBe('muted');
  });
});

describe('dashboard attention flags (BR-KPI-86)', () => {
  it('each flag has its words and a tone; a missing figure is muted, never a warning', async () => {
    const { ATTENTION_LABEL, ATTENTION_TONE } = await import('./statusTones');
    expect(Object.keys(ATTENTION_TONE).sort()).toEqual(Object.keys(ATTENTION_LABEL).sort());
    expect(ATTENTION_TONE.MISSING).toBe('muted');
    expect(ATTENTION_LABEL.BELOW_THRESHOLD).toBe('Dưới ngưỡng');
  });
});

