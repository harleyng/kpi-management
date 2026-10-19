/**
 * The `InsightGateway` contract — the simulated AI assistant (WBS 4.7.4, Phase 3).
 *
 * Same shape of boundary as `DataGateway`: screens never call a model directly, they go through
 * `getInsightGateway()`. The prototype ships a deterministic mock only; a real LLM adapter is out
 * of scope for P1 (plan §1).
 *
 * TODO Phase 3 — e.g. `summarisePeriod(tenantId, periodId)`, `explainScore(tenantId, resultId)`,
 * `suggestKpis(tenantId, orgUnitId)`. Every method takes `tenantId`, like the data gateway.
 */

export type InsightAdapterName = 'mock';

export interface InsightGateway {
  readonly adapter: InsightAdapterName;
}
