import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

/**
 * Shared status badges. The status → tone mapping lives in EXACTLY this one file, so "Đã duyệt"
 * never renders green on one screen and grey on another (design-system.md, "Status → tone").
 *
 * Colour is never the only signal: a badge always carries its label.
 *
 * TODO Phase 1.4 — one badge per state set declared in `src/data/types.ts` (Phase 1.1), each with
 * a `Record<Status, Tone>` map beside it: `GoalPlanStatusBadge`, `FormStatusBadge`,
 * `CycleStatusBadge`, `PeriodResultStatusBadge`. Their tones are fixed in design-system.md.
 */

export type Tone = 'muted' | 'info' | 'positive' | 'warning' | 'negative';

/**
 * The primitive the per-set badges are built from. Prefer a per-set badge on a screen — choosing a
 * tone at the call site is how the mapping drifts.
 */
export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <Badge variant={tone}>{children}</Badge>;
}
