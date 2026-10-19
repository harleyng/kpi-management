import { describe, expect, it } from 'vitest';
import { auditChanges, auditSubjectName, dayRangeToInstants } from './auditRules';

const TZ = 'Asia/Ho_Chi_Minh';

describe('auditChanges — the fields an entry changed', () => {
  it('lists only the differing columns of an update, never id or tenantId', () => {
    const before = { id: 'p1', tenantId: 't1', status: 'Approved', lockedAt: null, cycleId: 'c1' };
    const after = { id: 'p1', tenantId: 't1', status: 'Locked', lockedAt: '2027-01-11T02:00:00.000Z', cycleId: 'c1' };
    expect(auditChanges({ beforeData: before, afterData: after })).toEqual([
      { field: 'status', before: 'Approved', after: 'Locked' },
      { field: 'lockedAt', before: null, after: '2027-01-11T02:00:00.000Z' },
    ]);
  });

  it('compares nested values by content', () => {
    const before = { recipientFilter: { orgUnitIds: ['a'] }, allowedActions: ['SUBMIT'] };
    expect(auditChanges({ beforeData: before, afterData: { recipientFilter: { orgUnitIds: ['a'] }, allowedActions: ['SUBMIT', 'EDIT'] } })).toEqual([
      { field: 'allowedActions', before: ['SUBMIT'], after: ['SUBMIT', 'EDIT'] },
    ]);
  });

  it('a creation lists what it set; a deletion what it had', () => {
    expect(auditChanges({ beforeData: null, afterData: { id: 'x', name: 'KPI 2027', ratingScaleId: null } })).toEqual([
      { field: 'name', before: undefined, after: 'KPI 2027' },
    ]);
    expect(auditChanges({ beforeData: { id: 'x', name: 'A' }, afterData: null })).toEqual([{ field: 'name', before: 'A', after: undefined }]);
  });

  it('a partial snapshot (the seed records only the status) still diffs', () => {
    expect(auditChanges({ beforeData: { status: 'Scheduled' }, afterData: { status: 'Cancelled' } })).toEqual([
      { field: 'status', before: 'Scheduled', after: 'Cancelled' },
    ]);
  });

  it('a snapshot that is not an object cannot be read — null, not "no change"', () => {
    expect(auditChanges({ beforeData: 'garbled', afterData: { a: 1 } })).toBeNull();
    expect(auditChanges({ beforeData: null, afterData: [1, 2] })).toBeNull();
  });
});

describe('auditSubjectName', () => {
  it('takes the most specific name column, after-image first', () => {
    expect(auditSubjectName({ beforeData: { name: 'Cũ' }, afterData: { name: 'Mới', code: 'X' } })).toBe('Mới');
    expect(auditSubjectName({ beforeData: { fullName: 'Nguyễn Văn An' }, afterData: null })).toBe('Nguyễn Văn An');
    expect(auditSubjectName({ beforeData: { status: 'Approved' }, afterData: { status: 'Locked' } })).toBeNull();
  });

  it('names a plan or a form by the person it is about when it has no name of its own', () => {
    const names = (id: string) => ({ e1: 'Nguyễn Văn An' })[id];
    expect(auditSubjectName({ beforeData: null, afterData: { ownerEmployeeId: 'e1', status: 'Draft' } }, names)).toBe('Nguyễn Văn An');
    expect(auditSubjectName({ beforeData: { subjectEmployeeId: 'e1' }, afterData: null }, names)).toBe('Nguyễn Văn An');
    expect(auditSubjectName({ beforeData: null, afterData: { ownerEmployeeId: 'unknown' } }, names)).toBeNull();
  });
});

describe('dayRangeToInstants — the day filter in the tenant zone', () => {
  it('runs from the start of the first day to the last millisecond of the last', () => {
    expect(dayRangeToInstants('2027-04-01', '2027-04-06', TZ)).toEqual({
      from: '2027-03-31T17:00:00.000Z',
      to: '2027-04-06T16:59:59.999Z',
    });
  });

  it('leaves a blank side open', () => {
    expect(dayRangeToInstants(null, null, TZ)).toEqual({});
    expect(dayRangeToInstants('2027-04-01', null, TZ)).toEqual({ from: '2027-03-31T17:00:00.000Z' });
  });

  it('refuses a backwards range or a day that is not real', () => {
    expect(dayRangeToInstants('2027-04-06', '2027-04-01', TZ)).toBeNull();
    expect(dayRangeToInstants('2027-02-30', null, TZ)).toBeNull();
  });

  it('a one-day range covers the whole day', () => {
    const r = dayRangeToInstants('2027-04-05', '2027-04-05', TZ);
    expect(r?.from && r.to && r.from < '2027-04-05T08:00:00.000Z' && '2027-04-05T08:00:00.000Z' <= r.to).toBe(true);
  });
});
