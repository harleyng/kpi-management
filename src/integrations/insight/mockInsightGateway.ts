import type { InsightGateway } from './types';

/**
 * Deterministic AI stand-in. TODO Phase 3: answers computed from the seed through
 * `src/lib/*Rules.ts`, phrased as templates — same input, same answer, so a demo is repeatable.
 *
 * ⚠️ Never import this file outside `src/integrations/insight/`. Use `getInsightGateway()`.
 */
export const mockInsightGateway: InsightGateway = {
  adapter: 'mock',
};
