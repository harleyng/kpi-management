import type { Id, RatingLevel } from '@/data/types';
import type { ChildInput, PeriodResultFilter, ResultsGateway } from '../../types';
import { removeRow } from '../integrity';
import { eqOpt, inList, saveChildren, upsert } from '../rows';
import type { Runtime } from '../runtime';

const SCORING = 'Phase 1.5 calcRules + scoreRules + ratingRules';

export function resultsGroup(rt: Runtime): ResultsGateway {
  return {
    listRatingScales: rt.read('results.listRatingScales', (tx) => tx.all('RatingScale')),
    listRatingLevels: rt.read('results.listRatingLevels', (tx, ratingScaleId?: Id) =>
      tx
        .all('RatingLevel')
        .filter((l) => eqOpt(ratingScaleId, l.ratingScaleId))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    ),
    saveRatingScale: rt.write(
      'results.saveRatingScale', { permission: 'rating.config' },
      (tx, input: Parameters<ResultsGateway['saveRatingScale']>[2], levels: readonly ChildInput<RatingLevel, 'ratingScaleId'>[]) => {
        const parent = upsert(tx, 'RatingScale', input, { create: () => ({}) });
        return { parent, children: saveChildren(tx, 'RatingLevel', 'ratingScaleId', parent.id, levels) };
      },
    ),

    listPayoutRules: rt.read('results.listPayoutRules', (tx, ratingScaleId?: Id) =>
      tx.all('PayoutRule').filter((r) => eqOpt(ratingScaleId, r.ratingScaleId)),
    ),
    savePayoutRule: rt.write('results.savePayoutRule', { permission: 'rating.config' }, (tx, input: Parameters<ResultsGateway['savePayoutRule']>[2]) =>
      upsert(tx, 'PayoutRule', input, { create: () => ({}) }),
    ),
    deletePayoutRule: rt.write('results.deletePayoutRule', { permission: 'rating.config' }, (tx, payoutRuleId: Id) => {
      removeRow(tx, 'PayoutRule', payoutRuleId);
    }),

    listPeriodResults: rt.read('results.listPeriodResults', (tx, filter: PeriodResultFilter = {}) =>
      tx
        .all('PeriodResult')
        .filter(
          (r) =>
            eqOpt(filter.periodId, r.periodId) &&
            inList(filter.goalPlanIds, r.goalPlanId) &&
            eqOpt(filter.ownerType, r.ownerType) &&
            eqOpt(filter.status, r.status),
        ),
    ),
    listResultDetails: rt.read('results.listResultDetails', (tx, resultId: Id) => {
      tx.get('PeriodResult', resultId);
      return tx.all('ResultDetail').filter((d) => d.resultId === resultId);
    }),
    calculateResults: rt.deferred('results.calculateResults', 'write', SCORING),
    setAdjustment: rt.deferred('results.setAdjustment', 'write', `${SCORING} (re-score with the adjustment)`),
    finalizeResults: rt.deferred('results.finalizeResults', 'write', `${SCORING} (Draft → Final, rounding once)`),
    lockResults: rt.deferred('results.lockResults', 'write', `${SCORING} (Final → Locked)`),

    listPayrollExports: rt.read('results.listPayrollExports', (tx, periodId?: Id) =>
      tx
        .all('PayrollExport')
        .filter((e) => eqOpt(periodId, e.periodId))
        .sort((a, b) => (a.exportedAt < b.exportedAt ? 1 : -1)),
    ),
    exportPayroll: rt.deferred('results.exportPayroll', 'write', 'T6 4.6.4 (the payroll export file)', {
      track: 'T6',
      auth: { permission: 'result.export' },
    }),
  };
}
