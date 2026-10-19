import { beforeEach, describe, expect, it } from 'vitest';
import { parseStoredSelection, sessionActions, useSessionStore } from './sessionStore';

describe('parseStoredSelection', () => {
  it.each([
    ['nothing stored', null],
    ['invalid JSON', '{nope'],
    ['a JSON string', '"t1"'],
    ['a JSON array', '[1,2]'],
  ])('ignores %s', (_label, raw) => {
    expect(parseStoredSelection(raw)).toEqual({ tenantId: null, userIdByTenant: {} });
  });

  it('keeps only string ids', () => {
    const raw = JSON.stringify({ tenantId: 't1', userIdByTenant: { t1: 'u1', t2: 42, t3: null } });
    expect(parseStoredSelection(raw)).toEqual({ tenantId: 't1', userIdByTenant: { t1: 'u1' } });
    expect(parseStoredSelection(JSON.stringify({ tenantId: 7 }))).toEqual({ tenantId: null, userIdByTenant: {} });
  });
});

describe('sessionActions', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionActions.reload();
  });

  it('remembers the person per tenant and persists the choice', () => {
    sessionActions.selectUser('t1', 'u1');
    sessionActions.selectUser('t2', 'u9');
    sessionActions.selectTenant('t1');
    expect(useSessionStore.getState()).toEqual({ tenantId: 't1', userIdByTenant: { t1: 'u1', t2: 'u9' } });
    sessionActions.reload();
    expect(useSessionStore.getState().userIdByTenant.t2).toBe('u9');
  });

  it('does not notify subscribers when nothing changes', () => {
    sessionActions.selectUser('t1', 'u1');
    const before = useSessionStore.getState();
    sessionActions.selectUser('t1', 'u1');
    sessionActions.selectTenant('t1');
    expect(useSessionStore.getState()).toBe(before);
  });
});
