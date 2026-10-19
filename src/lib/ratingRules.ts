/**
 * Score → rating level → payout % — BR-KPI-41, 42. The scale and the payout table are data (seeded as
 * the sample A+/A/B/C/D, `ASSUMPTION Q2`); only how they are read lives here.
 */

import type { Id, IsoDate, PayoutRule, RatingLevel } from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';

const byMin = (a: RatingLevel, b: RatingLevel) => a.minScore - b.minScore;

/**
 * What `saveRatingScale` must refuse (ERR-KPI-13): the levels, sorted by `minScore`, must start at 0
 * and be contiguous — each `maxScore` is the next level's `minScore` — so every score has one level.
 */
export function validateRatingScale(levels: readonly RatingLevel[]): RuleIssue[] {
  if (levels.length === 0) return [ruleIssue('ERR-KPI-13', null, 'LEVELS_REQUIRED')];
  const issues: RuleIssue[] = [];
  const sorted = [...levels].sort(byMin);
  if (sorted[0].minScore !== 0) issues.push(ruleIssue('ERR-KPI-13', sorted[0].id, 'LOWEST_NOT_ZERO'));
  if (new Set(levels.map((l) => l.code)).size !== levels.length) issues.push(ruleIssue('ERR-KPI-13', null, 'CODE_DUPLICATE'));
  sorted.forEach((level, i) => {
    if (!(level.minScore < level.maxScore)) issues.push(ruleIssue('ERR-KPI-13', level.id, 'LEVEL_EMPTY'));
    const prev = sorted[i - 1];
    if (prev && prev.maxScore !== level.minScore) issues.push(ruleIssue('ERR-KPI-13', level.id, 'GAP_OR_OVERLAP'));
  });
  return issues;
}

/**
 * The level whose `[minScore, maxScore)` holds the score; the TOP level also takes anything at or above
 * its max. Pass the ROUNDED score (`scoreRules.ratedScore`) so the rating matches the number shown —
 * 89.995 shows as 90.00 and rates as the level starting at 90.
 */
export function ratingFor(score: number | null, levels: readonly RatingLevel[]): RatingLevel | null {
  if (score === null || !Number.isFinite(score) || levels.length === 0) return null;
  const sorted = [...levels].sort(byMin);
  const match = sorted.find((l) => score >= l.minScore && score < l.maxScore);
  if (match) return match;
  const top = sorted[sorted.length - 1];
  return score >= top.minScore ? top : null;
}

/** A payout rule names exactly the scope its `appliesTo` says (ERR-KPI-13). */
export function validatePayoutRule(rule: PayoutRule): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const scopeOk =
    rule.appliesTo === 'All'
      ? rule.orgUnitId === null && rule.positionId === null
      : rule.appliesTo === 'OrgUnit'
        ? rule.orgUnitId !== null && rule.positionId === null
        : rule.positionId !== null && rule.orgUnitId === null;
  if (!scopeOk) issues.push(ruleIssue('ERR-KPI-13', rule.id, 'SCOPE_MISMATCH'));
  if (!Number.isFinite(rule.payoutPct) || rule.payoutPct < 0) issues.push(ruleIssue('ERR-KPI-13', rule.id, 'PAYOUT_INVALID'));
  return issues;
}

/** Who the payout is for: their unit chain (own unit first — `orgRules.unitAncestry`) and position. */
export interface PayoutSubject {
  unitAncestry: readonly Id[];
  positionId: Id | null;
}

/**
 * BR-KPI-42 — the payout % for a rating level, from the rules in force on `asOf` for that scale and
 * level. The most specific rule wins: Position, then the NEAREST OrgUnit in the chain, then All; among
 * equals the latest `effectiveFrom`. No rule → `null` ("chưa có quy tắc"), never 0%.
 */
export function payoutPctFor(
  rating: Pick<RatingLevel, 'id' | 'ratingScaleId'>,
  rules: readonly PayoutRule[],
  subject: PayoutSubject,
  asOf: IsoDate,
): number | null {
  const rank = (rule: PayoutRule): number | null => {
    if (rule.appliesTo === 'Position') return rule.positionId === subject.positionId ? 0 : null;
    if (rule.appliesTo === 'OrgUnit') {
      const distance = subject.unitAncestry.indexOf(rule.orgUnitId as Id);
      return distance === -1 ? null : 1 + distance;
    }
    return Number.MAX_SAFE_INTEGER;
  };
  let best: { rank: number; rule: PayoutRule } | null = null;
  for (const rule of rules) {
    if (rule.ratingScaleId !== rating.ratingScaleId || rule.ratingLevelId !== rating.id) continue;
    if (rule.effectiveFrom > asOf || validatePayoutRule(rule).length > 0) continue;
    const r = rank(rule);
    if (r === null) continue;
    if (!best || r < best.rank || (r === best.rank && rule.effectiveFrom > best.rule.effectiveFrom)) best = { rank: r, rule };
  }
  return best ? best.rule.payoutPct : null;
}
