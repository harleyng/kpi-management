/**
 * The `InsightGateway` contract — the AI assistant of the dashboard (WBS 4.7.4, BR-KPI-89).
 *
 * Same shape of boundary as `DataGateway`: screens never call a model directly, they go through
 * `getInsightGateway()` (from a query hook). The prototype ships a deterministic mock only; a real LLM
 * adapter is out of scope for P1 (plan §1).
 *
 * The assistant is given a `DashboardSnapshot` — the numbers the viewer's screen already shows, built
 * in their `dashboard.view` scope by `src/lib/dashboardRules.ts` — and nothing else. So:
 * - it can never cite what the viewer may not see (roadmap R10 "trong phạm vi quyền");
 * - it never computes: every figure in a sentence is a field of the snapshot, named in `figureRefs`;
 * - a real adapter would receive the same snapshot, serialised, as its only context.
 *
 * Every method takes `tenantId` first, like the data gateway, and rejects with `KpiError` ERR-KPI-06
 * when the snapshot belongs to another tenant (or a question is empty or too long).
 */

import type { Id } from '@/data/types';
import type { DashboardSnapshot } from '@/lib/dashboardRules';

export type InsightAdapterName = 'mock';

/** What a sentence set answers. `UNSUPPORTED` = a refusal that lists what can be asked. */
export type InsightIntent = 'SUMMARY' | 'EXPLAIN' | 'UNIT_SCORE' | 'BEST_WORST' | 'OVERDUE' | 'ATTENTION' | 'CHANGE' | 'UNSUPPORTED';

export interface InsightSentence {
  text: string;
  /** The snapshot fields the sentence quotes, e.g. `focus.score`, `children[<id>].deltaPoints`. */
  figureRefs: string[];
}

export interface Insight {
  intent: InsightIntent;
  sentences: InsightSentence[];
  adapter: InsightAdapterName;
  /** `true` for the mock — the screen labels the card "Giả lập". */
  simulated: boolean;
}

/** The longest question `ask` accepts. */
export const MAX_QUESTION_LENGTH = 300;

/** The questions the mock understands — offered as buttons, and listed in a refusal. */
export const SUGGESTED_QUESTIONS: readonly string[] = [
  'Điểm của đơn vị này kỳ này là bao nhiêu?',
  'Đơn vị nào cao nhất, thấp nhất?',
  'So với kỳ trước thay đổi thế nào?',
  'Chỉ tiêu nào cần chú ý?',
  'Có bao nhiêu phiếu quá hạn?',
];

export interface InsightGateway {
  readonly adapter: InsightAdapterName;
  /** A few sentences on the unit being looked at: score, change, best / worst child, attention, overdue. */
  summarise(tenantId: Id, snapshot: DashboardSnapshot): Promise<Insight>;
  /** Why `nodeId` (the focus or one of its children) stands where it does — the variance, from the snapshot. */
  explain(tenantId: Id, snapshot: DashboardSnapshot, nodeId: Id): Promise<Insight>;
  /** A question about the snapshot — one of ~5 intents, else a refusal listing `SUGGESTED_QUESTIONS`. */
  ask(tenantId: Id, snapshot: DashboardSnapshot, question: string): Promise<Insight>;
}
