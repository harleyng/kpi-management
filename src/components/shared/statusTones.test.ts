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
      Locked: 'muted',
    });
  });

  it('Form', () => {
    expect(FORM_STATUS_TONE).toEqual({
      Open: 'muted',
      InProgress: 'info',
      Completed: 'positive',
      Cancelled: 'muted',
    });
  });

  it('Cycle', () => {
    expect(CYCLE_STATUS_TONE).toEqual({
      Planning: 'muted',
      Active: 'info',
      Evaluating: 'warning',
      Closed: 'positive',
    });
  });

  it('Period result', () => {
    expect(PERIOD_RESULT_STATUS_TONE).toEqual({ Draft: 'muted', Final: 'info', Locked: 'positive' });
  });

  it('Delegation (derived): only one granting now is marked', () => {
    expect(DELEGATION_STATE_TONE).toEqual({ Upcoming: 'muted', Active: 'info', Expired: 'muted', Revoked: 'muted' });
    expect(PLAN_ADJUSTING_TONE).toBe('info');
  });

  it('Record: only Inactive is badged', () => {
    expect(RECORD_STATUS_TONE).toEqual({ Active: null, Inactive: 'muted' });
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
    expect(formTone('Open', true)).toBe('muted');
    expect(formTone('Completed', true)).toBe('positive');
    expect(formTone('Cancelled', true)).toBe('muted');
  });
});
