import { describe, expect, it } from 'vitest';
import { SYNTRA } from '@/data/fixtures';
import type { PeriodResult, ResultDetail } from '@/data/types';
import type { DomainEvent } from '../types';
import { flush, newGateway, rejection } from './gateway.test-util';

/**
 * The scoring lane's gateway behaviour (Gate 1): `results.calculateResults / setAdjustment /
 * finalizeResults / lockResults`, the guard of `actuals.recordActual`, and the configuration guards
 * (`saveCalcMethod`, `saveRatingScale`, `savePayoutRule`). The numbers themselves are `resultRules`'
 * (its own tests); here: what is written, what is refused, what is announced.
 */

const S = SYNTRA.tenantId;
const admin = SYNTRA.user(SYNTRA.personas.admin);
const cycle = SYNTRA.id('PerformanceCycle', '2027');
const periodId = (label: string) => SYNTRA.id('CyclePeriod', 2027, label);
const planId = (owner: string) => SYNTRA.id('GoalPlan', cycle, owner);
const goalId = (owner: string, key: string) => SYNTRA.id('Goal', planId(owner), key);
const T01 = periodId('T01');
const T02 = periodId('T02');
const T03 = periodId('T03');

const withoutId = (details: ResultDetail[]) => details.map(({ id: _id, ...rest }) => rest);
const byPlan = (results: PeriodResult[], owner: string) => results.find((r) => r.goalPlanId === planId(owner)) as PeriodResult;

describe('results.calculateResults', () => {
  it('recalculating the seeded Drafts reproduces the seeded rows exactly (the seed ran the same rules)', async () => {
    const { gateway } = newGateway();
    const before = await gateway.results.listPeriodResults(S);
    const detailsBefore = await Promise.all(before.map((r) => gateway.results.listResultDetails(S, r.id)));
    for (const p of [T01, T02, T03]) await gateway.results.calculateResults(S, admin, p);
    const after = await gateway.results.listPeriodResults(S);
    expect(after).toEqual(before);
    const detailsAfter = await Promise.all(after.map((r) => gateway.results.listResultDetails(S, r.id)));
    expect(detailsAfter.map(withoutId)).toEqual(detailsBefore.map(withoutId));
  });

  it('keeps a Draft\'s id and adjustment and replaces its details; returns the period\'s results', async () => {
    const { gateway } = newGateway();
    const draft = byPlan(await gateway.results.listPeriodResults(S, { periodId: T03 }), 'KH');
    const oldDetails = await gateway.results.listResultDetails(S, draft.id);
    await gateway.results.setAdjustment(S, admin, draft.id, 1.5);
    const results = await gateway.results.calculateResults(S, admin, T03);
    expect(results.every((r) => r.periodId === T03)).toBe(true);
    const again = byPlan(results, 'KH');
    expect(again).toMatchObject({ id: draft.id, adjustmentPct: 1.5, status: 'Draft' });
    expect(again.totalScore).toBeCloseTo((draft.totalScore as number) + 1.5, 10);
    const newDetails = await gateway.results.listResultDetails(S, draft.id);
    expect(withoutId(newDetails)).toEqual(withoutId(oldDetails));
    expect(newDetails.map((d) => d.id).some((id) => oldDetails.some((o) => o.id === id))).toBe(false);
  });

  it('leaves Final and Locked results unchanged (no error)', async () => {
    const { gateway } = newGateway();
    const before = await gateway.results.listPeriodResults(S, { periodId: T01 });
    expect(before.filter((r) => r.status === 'Locked').length).toBeGreaterThan(0);
    const after = await gateway.results.calculateResults(S, admin, T01);
    expect(after.filter((r) => r.status !== 'Draft')).toEqual(before.filter((r) => r.status !== 'Draft'));
  });

  it('needs result.finalize (an employee is refused, ERR-KPI-05)', async () => {
    const { gateway } = newGateway();
    const error = await rejection(gateway.results.calculateResults(S, SYNTRA.user(SYNTRA.personas.employee), T03));
    expect(error.code).toBe('ERR-KPI-05');
  });
});

describe('results.setAdjustment', () => {
  it('re-rates a Draft and refuses a Final one (ERR-KPI-04) or a non-number (ERR-KPI-06)', async () => {
    const { gateway } = newGateway();
    const t02 = await gateway.results.listPeriodResults(S, { periodId: T02 });
    const final = t02.find((r) => r.status === 'Final') as PeriodResult;
    expect((await rejection(gateway.results.setAdjustment(S, admin, final.id, 1))).code).toBe('ERR-KPI-04');
    const draft = byPlan(t02, 'E023');
    expect((await rejection(gateway.results.setAdjustment(S, admin, draft.id, Number.NaN))).detail).toBe('ADJUSTMENT_INVALID');
    const lowered = await gateway.results.setAdjustment(S, admin, draft.id, -10);
    expect(lowered.adjustmentPct).toBe(-10);
    expect(lowered.ratingLevelId).not.toBe(draft.ratingLevelId);
  });
});

describe('results.finalizeResults', () => {
  it('one not computable goal: nothing is written, nothing announced, every issue listed', async () => {
    const { gateway } = newGateway();
    // A stock-out count of −1 falls in no tier → NOT_COMPUTABLE (ERR-KPI-12).
    await gateway.actuals.recordActual(S, admin, { goalId: goalId('MH', '2'), periodId: T03, actualValue: -1, actualText: null, note: null });
    const before = await gateway.results.listPeriodResults(S, { periodId: T03 });
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void heard.push(e));
    const error = await rejection(gateway.results.finalizeResults(S, admin, T03));
    await flush();
    expect(error.code).toBe(error.issues[0].code);
    expect(error.issues.some((i) => i.code === 'ERR-KPI-12' && i.ref === goalId('MH', '2') && i.detail === 'NO_TIER')).toBe(true);
    expect(error.issues.some((i) => i.code === 'ERR-KPI-09')).toBe(true); // CSKH's CRM goals have no T03 actual
    expect(new Set(error.issues.map((i) => i.data?.resultId)).size).toBeGreaterThan(1);
    expect(await gateway.results.listPeriodResults(S, { periodId: T03 })).toEqual(before);
    expect(heard).toEqual([]);
  });

  it('finalises the listed Drafts: Final, rounded, finalizedAt = the clock; announces results.finalized', async () => {
    const { gateway } = newGateway();
    const draft = byPlan(await gateway.results.listPeriodResults(S, { periodId: T03 }), 'SYN');
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void heard.push(e));
    const [final] = await gateway.results.finalizeResults(S, admin, T03, [draft.id]);
    expect(final).toMatchObject({ id: draft.id, status: 'Final', totalScore: Math.round((draft.totalScore as number) * 100) / 100 });
    expect(final.finalizedAt).not.toBeNull();
    expect(final.finalizedAt as string <= gateway.clock.now()).toBe(true);
    expect(heard.find((e) => e.type === 'results.finalized')).toMatchObject({ periodId: T03, resultIds: [draft.id] });
  });

  it('refuses a listed result that is not Draft (04), of another period (06), unknown (02); no Draft at all (04)', async () => {
    const { gateway } = newGateway();
    const locked = (await gateway.results.listPeriodResults(S, { periodId: T01, status: 'Locked' }))[0];
    expect((await rejection(gateway.results.finalizeResults(S, admin, T01, [locked.id]))).code).toBe('ERR-KPI-04');
    expect((await rejection(gateway.results.finalizeResults(S, admin, T03, [locked.id]))).code).toBe('ERR-KPI-06');
    expect((await rejection(gateway.results.finalizeResults(S, admin, T03, ['no-such-result']))).code).toBe('ERR-KPI-02');
    expect((await rejection(gateway.results.finalizeResults(S, admin, periodId('T04')))).detail).toBe('NO_DRAFT');
  });
});

describe('results.lockResults', () => {
  it('locks the Final results, leaves the Drafts; with no Final result → ERR-KPI-04', async () => {
    const { gateway } = newGateway();
    expect((await rejection(gateway.results.lockResults(S, admin, T03))).code).toBe('ERR-KPI-04');
    const locked = await gateway.results.lockResults(S, admin, T02);
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((r) => r.status === 'Locked')).toBe(true);
    expect(byPlan(await gateway.results.listPeriodResults(S, { periodId: T02 }), 'E023').status).toBe('Draft');
    const period = (await gateway.goals.listPeriods(S, cycle)).find((p) => p.id === T03);
    expect(period?.isLocked).toBe(false); // the period's own lock is not touched
  });
});

describe('actuals.recordActual — the actual-entry rule', () => {
  it('refuses a locked period (04 PERIOD_LOCKED)', async () => {
    const { gateway } = newGateway();
    const error = await rejection(gateway.actuals.recordActual(S, admin, { goalId: goalId('E016', '1'), periodId: T01, actualValue: 1, actualText: null, note: null }));
    expect([error.code, error.detail]).toEqual(['ERR-KPI-04', 'PERIOD_LOCKED']);
  });

  it('refuses a period whose result is already Final (04 RESULT_FINAL)', async () => {
    const { gateway } = newGateway();
    const draft = byPlan(await gateway.results.listPeriodResults(S, { periodId: T03 }), 'SYN');
    await gateway.results.finalizeResults(S, admin, T03, [draft.id]);
    const error = await rejection(gateway.actuals.recordActual(S, admin, { goalId: goalId('SYN', '1'), periodId: T03, actualValue: 1, actualText: null, note: null }));
    expect([error.code, error.detail]).toEqual(['ERR-KPI-04', 'RESULT_FINAL']);
  });

  it('refuses a number on a TEXT goal (06 ACTUAL_TYPE_MISMATCH)', async () => {
    const { gateway } = newGateway();
    const textGoal = await gateway.goals.getGoal(S, goalId('E039', '5'));
    expect(textGoal.targetType).toBe('TEXT');
    const error = await rejection(gateway.actuals.recordActual(S, admin, { goalId: textGoal.id, periodId: T03, actualValue: 1, actualText: null, note: null }));
    expect([error.code, error.detail]).toEqual(['ERR-KPI-06', 'ACTUAL_TYPE_MISMATCH']);
  });
});

describe('scoring configuration guards (ERR-KPI-13 / 06)', () => {
  it('saveCalcMethod refuses a ratio without a cap', async () => {
    const { gateway } = newGateway();
    const method = (await gateway.library.listCalcMethods(S)).find((m) => m.methodType === 'RATIO_UP');
    const error = await rejection(gateway.library.saveCalcMethod(S, admin, { ...(method as object), capPct: null } as never, []));
    expect([error.code, error.detail]).toEqual(['ERR-KPI-13', 'CAP_REQUIRED']);
  });

  it('saveRatingScale refuses a gap between levels', async () => {
    const { gateway } = newGateway();
    const level = (code: string, minScore: number, maxScore: number) => ({ code, label: code, minScore, maxScore, sortOrder: minScore });
    const error = await rejection(gateway.results.saveRatingScale(S, admin, { name: 'Thang lỗi', status: 'Active' }, [level('D', 0, 50), level('C', 60, 100)]));
    expect([error.code, error.detail]).toEqual(['ERR-KPI-13', 'GAP_OR_OVERLAP']);
  });

  it('savePayoutRule refuses a level of another scale (06) and a scope mismatch (13)', async () => {
    const { gateway } = newGateway();
    const base = { ratingScaleId: SYNTRA.id('RatingScale', 'SAMPLE'), ratingLevelId: SYNTRA.id('RatingLevel', 'A'), appliesTo: 'All' as const, orgUnitId: null, positionId: null, payoutPct: 90, effectiveFrom: '2027-06-01' };
    const other = await rejection(gateway.results.savePayoutRule(S, admin, { ...base, ratingLevelId: SYNTRA.id('RatingLevel', '2026', 'D') }));
    expect([other.code, other.detail]).toEqual(['ERR-KPI-06', 'LEVEL_NOT_IN_SCALE']);
    const scope = await rejection(gateway.results.savePayoutRule(S, admin, { ...base, appliesTo: 'OrgUnit' }));
    expect([scope.code, scope.detail]).toEqual(['ERR-KPI-13', 'SCOPE_MISMATCH']);
    await expect(gateway.results.savePayoutRule(S, admin, base)).resolves.toMatchObject({ payoutPct: 90 });
  });
});

describe('actuals.rejectImport — only a batch still being checked (QA, Gate 1)', () => {
  it('rejects a Validating batch; refuses a Committed one (04), whose actuals are already written', async () => {
    const { gateway } = newGateway();
    const committed = await rejection(gateway.actuals.rejectImport(S, admin, SYNTRA.id('ImportBatch', 'T01')));
    expect(committed.code).toBe('ERR-KPI-04');
    expect((await gateway.actuals.getImportBatch(S, SYNTRA.id('ImportBatch', 'T01'))).status).toBe('Committed');
    await expect(gateway.actuals.rejectImport(S, admin, SYNTRA.id('ImportBatch', 'T03-crm'))).resolves.toMatchObject({ status: 'Rejected' });
  });
});
