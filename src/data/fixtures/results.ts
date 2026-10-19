import type { Id, IsoDateTime } from '@/data/types';
import {
  applyAdjustment,
  buildPeriodResults,
  currentLinesOf,
  finalizeCheck,
  finalizePeriodResults,
  lockPeriodResults,
  type ResultChanges,
  type ResultIds,
  type ResultOutcome,
} from '@/lib/resultRules';
import type { IdFn, SeedRows } from './shared';

/**
 * The seed's results are PRODUCED, never typed in: a scripted run of the same `resultRules`
 * orchestrators the mock's `results.*` methods call (README "No derived value is stored"). Each step
 * applies the rule's changes to the tenant's rows exactly as a transaction would; a refusal is a
 * broken seed and throws.
 */
export class ResultScript {
  private readonly ids: ResultIds;

  constructor(
    private readonly s: SeedRows,
    id: IdFn,
  ) {
    this.ids = { result: (periodId, planId) => id('PeriodResult', periodId, planId), detail: (resultId, goalId) => id('ResultDetail', resultId, goalId) };
  }

  private run(outcome: ResultOutcome, step: string): void {
    if (!outcome.ok) throw new Error(`seed: ${step} refused: ${outcome.issues.map((i) => `${i.code} ${i.detail ?? ''}`).join(', ')}`);
    applyResultChanges(this.s, outcome.changes);
  }

  /** `calculateResults(periodId)`. */
  calculate(periodId: Id): void {
    this.run(buildPeriodResults(this.s.rows, periodId, this.ids), `calculate ${periodId}`);
  }

  /** `setAdjustment` on the period's result of `goalPlanId`. */
  adjust(periodId: Id, goalPlanId: Id, adjustmentPct: number): void {
    this.run(applyAdjustment(this.s.rows, this.resultOf(periodId, goalPlanId).id, adjustmentPct), `adjust ${goalPlanId}`);
  }

  /**
   * `finalizeResults(periodId, ids)` over every Draft of the period that passes `finalizeCheck`,
   * bar `hold` (plans kept Draft on purpose). Returns the plans left Draft because they cannot be
   * finalised (weights, an unscored or not computable goal).
   */
  finalizeAll(periodId: Id, now: IsoDateTime, hold: readonly Id[] = []): Id[] {
    const ready: Id[] = [];
    const blocked: Id[] = [];
    for (const result of this.s.rows.PeriodResult.filter((r) => r.periodId === periodId && r.status === 'Draft')) {
      if (hold.includes(result.goalPlanId)) continue;
      const lines = currentLinesOf(this.s.rows, result);
      if (lines !== null && finalizeCheck(lines, result.id).length === 0) ready.push(result.id);
      else blocked.push(result.goalPlanId);
    }
    if (ready.length > 0) this.run(finalizePeriodResults(this.s.rows, periodId, ready, now, this.ids), `finalize ${periodId}`);
    return blocked;
  }

  /** `lockResults(periodId)`. */
  lock(periodId: Id): void {
    this.run(lockPeriodResults(this.s.rows, periodId), `lock ${periodId}`);
  }

  resultOf(periodId: Id, goalPlanId: Id) {
    const result = this.s.rows.PeriodResult.find((r) => r.periodId === periodId && r.goalPlanId === goalPlanId);
    if (!result) throw new Error(`seed: no result for plan ${goalPlanId} in period ${periodId}`);
    return result;
  }
}

/** A rule's changes applied to the seed's arrays — the same effect `results.*` has on a transaction. */
export function applyResultChanges(s: SeedRows, changes: ResultChanges): void {
  const removed = new Set(changes.removedDetailIds);
  const details = s.rows.ResultDetail;
  for (let i = details.length - 1; i >= 0; i--) if (removed.has(details[i].id)) details.splice(i, 1);
  for (const { row, created } of changes.results) {
    const { tenantId: _tenantId, ...fields } = row;
    if (created) s.add('PeriodResult', fields);
    else {
      const index = s.rows.PeriodResult.findIndex((r) => r.id === row.id);
      s.rows.PeriodResult[index] = row;
    }
  }
  for (const detail of changes.addedDetails) {
    const { tenantId: _tenantId, ...fields } = detail;
    s.add('ResultDetail', fields);
  }
}
