import { mockInsightGateway } from './mockInsightGateway';
import type { InsightGateway } from './types';

export type { InsightGateway } from './types';

/** The one entry point to the AI assistant. There is only the mock adapter in P1. */
export function getInsightGateway(): InsightGateway {
  return mockInsightGateway;
}
