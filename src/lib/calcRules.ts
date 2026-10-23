/**
 * Achievement % per calculation method — BR-KPI-30…34, WBS 4.6.1.
 *
 * Pure functions: the screens, the hooks and the mock gateway all ask THIS module; nobody divides an
 * actual by a target anywhere else (CLAUDE.md, rule 5). A missing actual is "no achievement", never 0
 * (BR-KPI-32). An achievement that cannot be computed from the data is `NOT_COMPUTABLE` with a
 * reason — the weighted score treats it as missing too, so a broken goal can never move a score.
 */

import type { Aggregation, CalcMethod, CalcMethodType, CalcTier, CyclePeriod, Goal, GoalPeriodTarget, GoalTargetLevel, Id, TargetLevelCode, TargetType } from '@/data/types';
import { TARGET_LEVEL_CODES } from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';
import { foldDiacritics } from './utils';

// ─── Achievement ───────────────────────────────────────────────────────────────────────────────

export interface AchievementInput {
  targetType: TargetType;
  targetValue: number | null;
  targetText: string | null;
  actualValue: number | null;
  actualText: string | null;
  /** The method's tiers — read only by `TIERED`. */
  tiers: readonly CalcTier[];
  /** The goal's levels — read only by `LEVELS`. */
  levels: readonly GoalTargetLevel[];
}

export type NotComputableReason =
  | 'NO_TARGET'
  | 'TARGET_ZERO'
  | 'TARGET_NEGATIVE'
  | 'NEGATIVE_VALUE'
  | 'INVALID_VALUE'
  | 'TARGET_TYPE_MISMATCH'
  | 'NO_CAP'
  | 'NO_TIER'
  | 'NO_LEVELS'
  | 'NO_LEVEL_MATCH'
  | 'FORMULA_ERROR';

export type Achievement =
  /** `pct` is after the floor and the cap; `rawPct` is the method's own answer before them. */
  | { status: 'SCORED'; pct: number; rawPct: number }
  /** No actual recorded — no achievement, never 0 (BR-KPI-32). */
  | { status: 'NO_ACTUAL' }
  /** The data cannot give an answer (ERR-KPI-12); counted as missing, never as 0. */
  | { status: 'NOT_COMPUTABLE'; reason: NotComputableReason };

type Raw = { ok: true; raw: number } | { ok: false; reason: NotComputableReason };
const raw = (value: number): Raw => ({ ok: true, raw: value });
const notComputable = (reason: NotComputableReason): Raw => ({ ok: false, reason });

const isBlank = (text: string | null) => text === null || text.trim() === '';
const sameText = (a: string, b: string) => foldDiacritics(a.trim()) === foldDiacritics(b.trim());

function hasActual(input: AchievementInput): boolean {
  return input.targetType === 'TEXT' ? !isBlank(input.actualText) : input.actualValue !== null;
}

/**
 * BR-KPI-31 — the floor first, then the cap. With no floor configured the floor is **0**: a negative
 * achievement (a loss against a profit target) would otherwise pull the weighted score below a goal
 * that achieved nothing (`ASSUMPTION` recorded in BR-KPI-31).
 */
export function applyFloorCap(rawPct: number, floorPct: number | null, capPct: number | null): number {
  const floored = Math.max(rawPct, floorPct ?? 0);
  return capPct === null ? floored : Math.min(floored, capPct);
}

function numericActual(input: AchievementInput): Raw | number {
  if (input.targetType === 'TEXT') return notComputable('TARGET_TYPE_MISMATCH');
  const actual = input.actualValue as number;
  if (!Number.isFinite(actual)) return notComputable('INVALID_VALUE');
  return actual;
}

/** RATIO_UP — actual / target. Target 0 has no meaningful ratio: NOT_COMPUTABLE, not 0 and not 100. */
function ratioUp(input: AchievementInput): Raw {
  const actual = numericActual(input);
  if (typeof actual !== 'number') return actual;
  const target = input.targetValue;
  if (target === null) return notComputable('NO_TARGET');
  if (!Number.isFinite(target)) return notComputable('INVALID_VALUE');
  if (target === 0) return notComputable('TARGET_ZERO');
  if (target < 0) return notComputable('TARGET_NEGATIVE');
  return raw((actual / target) * 100);
}

/**
 * RATIO_DOWN — target / actual (DATX "% mục tiêu / thực tế"). Actual 0 is the best possible result:
 * it earns the CAP (every RATIO_DOWN method must have one — `validateCalcMethod`); actual 0 against a
 * target of 0 is exactly on target, 100. Target 0 with any actual above it is 0.
 */
function ratioDown(input: AchievementInput, capPct: number | null): Raw {
  const actual = numericActual(input);
  if (typeof actual !== 'number') return actual;
  const target = input.targetValue;
  if (target === null) return notComputable('NO_TARGET');
  if (!Number.isFinite(target)) return notComputable('INVALID_VALUE');
  if (target < 0 || actual < 0) return notComputable('NEGATIVE_VALUE');
  if (actual === 0) {
    if (target === 0) return raw(100);
    return capPct === null ? notComputable('NO_CAP') : raw(capPct);
  }
  return raw((target / actual) * 100);
}

/** TIERED — the tier whose `[fromValue, toValue)` holds the actual (`null` = open). A gap is NOT_COMPUTABLE. */
function tiered(input: AchievementInput): Raw {
  const actual = numericActual(input);
  if (typeof actual !== 'number') return actual;
  const match = sortTiers(input.tiers).find(
    (t) => (t.fromValue === null || actual >= t.fromValue) && (t.toValue === null || actual < t.toValue),
  );
  return match ? raw(match.achievementPct) : notComputable('NO_TIER');
}

/** BINARY — Đạt / Không đạt: 100 or 0. TEXT compares ignoring case and tone marks; NUMERIC is actual ≥ target. */
function binary(input: AchievementInput): Raw {
  if (input.targetType === 'TEXT') {
    if (isBlank(input.targetText)) return notComputable('NO_TARGET');
    return raw(sameText(input.actualText as string, input.targetText as string) ? 100 : 0);
  }
  const actual = numericActual(input);
  if (typeof actual !== 'number') return actual;
  if (input.targetValue === null) return notComputable('NO_TARGET');
  return raw(actual >= input.targetValue ? 100 : 0);
}

function formula(input: AchievementInput, expr: string | null): Raw {
  const actual = numericActual(input);
  if (typeof actual !== 'number') return actual;
  if (expr === null) return notComputable('FORMULA_ERROR');
  const vars: FormulaVars = { actual, target: input.targetValue };
  const value = evaluateFormula(expr, vars);
  return value === null ? notComputable('FORMULA_ERROR') : raw(value);
}

const levelOrder = (code: TargetLevelCode) => TARGET_LEVEL_CODES.indexOf(code);
const byLevel = (a: GoalTargetLevel, b: GoalTargetLevel) => levelOrder(a.levelCode) - levelOrder(b.levelCode);

/**
 * LEVELS (D1, BR-KPI-33) — `ASSUMPTION Q1`: linear between levels, the top level's score above it,
 * and **0 below the lowest level** (not reaching L1 earns nothing — a deliberate cliff when L1 scores
 * more than 0). Needs ≥ 2 levels in strictly increasing score with strictly monotonic targets
 * (`validateTargetLevels`), which makes the direction unambiguous: if L3's target is below L1's,
 * lower is better. A TEXT result that matches no level is NOT_COMPUTABLE, so a typo never scores 0.
 */
function levels(input: AchievementInput): Raw {
  const ordered = [...input.levels].sort(byLevel);
  if (ordered.length < 2) return notComputable('NO_LEVELS');

  if (input.targetType === 'TEXT') {
    const match = ordered.find((l) => l.targetText !== null && sameText(input.actualText as string, l.targetText));
    return match ? raw(match.scorePct) : notComputable('NO_LEVEL_MATCH');
  }

  const actual = numericActual(input);
  if (typeof actual !== 'number') return actual;
  if (ordered.some((l) => l.targetValue === null || !Number.isFinite(l.targetValue))) return notComputable('NO_LEVELS');
  const up = (ordered[ordered.length - 1].targetValue as number) > (ordered[0].targetValue as number);
  // Measure "progress" on one axis: for lower-is-better levels, negate every value.
  const at = (value: number) => (up ? value : -value);
  const points = ordered.map((l) => ({ x: at(l.targetValue as number), score: l.scorePct }));
  for (let i = 1; i < points.length; i++) {
    if (!(points[i].x > points[i - 1].x && points[i].score > points[i - 1].score)) return notComputable('NO_LEVELS');
  }

  const x = at(actual);
  if (x < points[0].x) return raw(0);
  const top = points[points.length - 1];
  if (x >= top.x) return raw(top.score);
  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i];
    const hi = points[i + 1];
    if (x >= lo.x && x < hi.x) return raw(lo.score + ((x - lo.x) / (hi.x - lo.x)) * (hi.score - lo.score));
  }
  return notComputable('NO_LEVELS');
}

/** BR-KPI-30 — the achievement of one goal for one period under `method`. */
/** The methods that must carry a cap (BR-KPI-31) — checked at save AND at compute time. */
export const CAP_REQUIRED_METHODS: readonly CalcMethodType[] = ['RATIO_UP', 'RATIO_DOWN', 'FORMULA'];

export function achievement(method: CalcMethod, input: AchievementInput): Achievement {
  if (!hasActual(input)) return { status: 'NO_ACTUAL' };
  // An uncapped ratio that slipped past `validateCalcMethod` (a seed row, an import) must not score 100 000%.
  if (method.capPct === null && CAP_REQUIRED_METHODS.includes(method.methodType)) return { status: 'NOT_COMPUTABLE', reason: 'NO_CAP' };

  let result: Raw;
  switch (method.methodType) {
    case 'RATIO_UP':
      result = ratioUp(input);
      break;
    case 'RATIO_DOWN':
      result = ratioDown(input, method.capPct);
      break;
    case 'TIERED':
      result = tiered(input);
      break;
    case 'BINARY':
      result = binary(input);
      break;
    case 'FORMULA':
      result = formula(input, method.formulaExpr);
      break;
    case 'LEVELS':
      result = levels(input);
      break;
  }

  if (!result.ok) return { status: 'NOT_COMPUTABLE', reason: result.reason };
  if (!Number.isFinite(result.raw)) return { status: 'NOT_COMPUTABLE', reason: 'INVALID_VALUE' };
  return { status: 'SCORED', pct: applyFloorCap(result.raw, method.floorPct, method.capPct), rawPct: result.raw };
}

/** The scored %, or `null` for both "no actual" and "not computable". */
export function achievementPct(method: CalcMethod, input: AchievementInput): number | null {
  const result = achievement(method, input);
  return result.status === 'SCORED' ? result.pct : null;
}

/** What `targetForPeriod` needs to derive a month's target from a longer period's split (ASSUMPTION Q67). */
export interface SplitContext {
  /** The cycle's periods (months, quarters, halves…); other cycles' rows are ignored. */
  periods: readonly Pick<CyclePeriod, 'id' | 'cycleId' | 'periodType' | 'startDate' | 'endDate'>[];
  /** The KPI's aggregation; `null` for a goal outside the library. */
  aggregation: Aggregation | null;
}

/** Calendar months covered by a period, from its dates ("2027-01-01".."2027-03-31" → 3). */
function calendarMonths(p: Pick<CyclePeriod, 'startDate' | 'endDate'>): number {
  const [sy, sm] = p.startDate.split('-').map(Number);
  const [ey, em] = p.endDate.split('-').map(Number);
  return (ey * 12 + em) - (sy * 12 + sm) + 1;
}

/**
 * A Month's target derived from the split of the Quarter (then Half, then Year) of its cycle that holds
 * it — `ASSUMPTION Q67`: SUM → that split ÷ the calendar months it covers (a 3,75 tỷ quarter gives 1,25
 * tỷ a month, not the 15 tỷ year); AVG / LAST (a ratio, a stock) → the split itself; no aggregation (a
 * goal outside the library) → `null`: how to share the quarter out is unknown, so the month is not
 * computable rather than wrong.
 * A goal that IS split but not for this month nor any period holding it (`SPLIT_INCOMPLETE`): SUM / no
 * aggregation → `null` (a split goal never scores a month against the annual target); AVG / LAST →
 * `undefined`. A goal with no split at all → `undefined` (its target holds for every period, BR-KPI-11).
 * `undefined` = nothing to derive from (the caller falls back to the goal's target).
 */
export function monthTargetFromSplit(
  goal: Pick<Goal, 'id'>,
  periodTargets: readonly GoalPeriodTarget[],
  monthId: Id,
  split: SplitContext,
): number | null | undefined {
  const month = split.periods.find((p) => p.id === monthId);
  if (!month || month.periodType !== 'Month') return undefined;
  for (const type of ['Quarter', 'Half', 'Year'] as const) {
    const holder = split.periods.find((p) => p.periodType === type && p.cycleId === month.cycleId && p.startDate <= month.startDate && p.endDate >= month.endDate);
    const target = holder ? periodTargets.find((t) => t.goalId === goal.id && t.periodId === holder.id) : undefined;
    if (!holder || !target) continue;
    if (split.aggregation === null) return null;
    if (split.aggregation !== 'SUM') return target.targetValue;
    const months = calendarMonths(holder);
    return months > 0 ? target.targetValue / months : null;
  }
  // Split, but not for this month nor its quarter / half / year: a SUM month is not computable.
  const inCycle = new Set(split.periods.filter((p) => p.cycleId === month.cycleId).map((p) => p.id));
  const isSplit = periodTargets.some((t) => t.goalId === goal.id && inCycle.has(t.periodId));
  if (isSplit && (split.aggregation === 'SUM' || split.aggregation === null)) return null;
  return undefined;
}

/**
 * The target that applies to a period (BR-KPI-11): its own `GoalPeriodTarget` when split; else, with
 * `split` and for a Month, the target derived from a split Quarter / Half (`monthTargetFromSplit`,
 * ASSUMPTION Q67 — possibly `null`, not computable); else the goal's own target. Without `split`, the
 * old answer (own split or the goal's target).
 */
export function targetForPeriod(goal: Goal, periodTargets: readonly GoalPeriodTarget[], periodId: Id, split?: SplitContext): number | null {
  const own = periodTargets.find((t) => t.goalId === goal.id && t.periodId === periodId);
  if (own) return own.targetValue;
  const derived = split ? monthTargetFromSplit(goal, periodTargets, periodId, split) : undefined;
  return derived !== undefined ? derived : goal.targetValue;
}

/** Builds the input for `achievement` from a goal, the period's current actual and the method's children. */
export function goalAchievementInput(
  goal: Goal,
  actual: { actualValue: number | null; actualText: string | null } | null,
  ctx: { periodId: Id; periodTargets: readonly GoalPeriodTarget[]; tiers: readonly CalcTier[]; levels: readonly GoalTargetLevel[]; split?: SplitContext },
): AchievementInput {
  return {
    targetType: goal.targetType,
    targetValue: targetForPeriod(goal, ctx.periodTargets, ctx.periodId, ctx.split),
    targetText: goal.targetText,
    actualValue: actual?.actualValue ?? null,
    actualText: actual?.actualText ?? null,
    tiers: ctx.tiers.filter((t) => t.calcMethodId === goal.calcMethodId),
    levels: ctx.levels.filter((l) => l.goalId === goal.id),
  };
}

// ─── Configuration checks (ERR-KPI-13) ─────────────────────────────────────────────────────────

function sortTiers(tiers: readonly CalcTier[]): CalcTier[] {
  return [...tiers].sort((a, b) => (a.fromValue ?? -Infinity) - (b.fromValue ?? -Infinity));
}

const configIssue = (ref: Id, detail: string) => ruleIssue('ERR-KPI-13', ref, detail);

/**
 * What `saveCalcMethod` must refuse. A cap is REQUIRED on RATIO_UP, RATIO_DOWN and FORMULA: without
 * one, target 1 and actual 1000 is 100 000% and carries the whole plan to the top rating.
 */
export function validateCalcMethod(method: CalcMethod, tiers: readonly CalcTier[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const { capPct, floorPct } = method;
  if (floorPct !== null && floorPct < 0) issues.push(configIssue(method.id, 'FLOOR_NEGATIVE'));
  if (capPct !== null && capPct <= 0) issues.push(configIssue(method.id, 'CAP_NOT_POSITIVE'));
  if (capPct !== null && floorPct !== null && floorPct > capPct) issues.push(configIssue(method.id, 'FLOOR_ABOVE_CAP'));
  if (capPct === null && CAP_REQUIRED_METHODS.includes(method.methodType)) {
    issues.push(configIssue(method.id, 'CAP_REQUIRED'));
  }

  if (method.methodType === 'FORMULA') {
    const parsed = method.formulaExpr === null ? null : parseFormula(method.formulaExpr);
    if (!parsed?.ok) issues.push(configIssue(method.id, 'FORMULA_INVALID'));
  }

  if (method.methodType === 'TIERED') {
    if (tiers.length === 0) issues.push(configIssue(method.id, 'TIERS_REQUIRED'));
    const sorted = sortTiers(tiers);
    sorted.forEach((t, i) => {
      if (t.fromValue !== null && t.toValue !== null && !(t.fromValue < t.toValue)) issues.push(configIssue(t.id, 'TIER_EMPTY'));
      if (!Number.isFinite(t.achievementPct) || t.achievementPct < 0) issues.push(configIssue(t.id, 'TIER_PCT_INVALID'));
      const prev = sorted[i - 1];
      if (prev && (prev.toValue ?? Infinity) > (t.fromValue ?? -Infinity)) issues.push(configIssue(t.id, 'TIERS_OVERLAP'));
    });
  }
  return issues;
}

/** What `setTargetLevels` must refuse (D1). An empty list is fine — the goal simply has no levels. */
/** A goal under a LEVELS method needs at least two levels, else it is never computable (ERR-KPI-13 `LEVELS_MISSING`). */
export function levelsMissingIssue(methodType: CalcMethodType | undefined, levelCount: number, ref: string | null): RuleIssue | null {
  return methodType === 'LEVELS' && levelCount < 2 ? ruleIssue('ERR-KPI-13', ref, 'LEVELS_MISSING') : null;
}

export function validateTargetLevels(targetType: TargetType, goalLevels: readonly GoalTargetLevel[]): RuleIssue[] {
  if (goalLevels.length === 0) return [];
  const issues: RuleIssue[] = [];
  const ordered = [...goalLevels].sort(byLevel);
  const ref = ordered[0].goalId;
  if (ordered.length < 2) issues.push(configIssue(ref, 'LEVELS_MIN_TWO'));
  if (new Set(ordered.map((l) => l.levelCode)).size !== ordered.length) issues.push(configIssue(ref, 'LEVEL_DUPLICATE'));

  ordered.forEach((l, i) => {
    if (!Number.isFinite(l.scorePct) || l.scorePct < 0) issues.push(configIssue(l.id, 'LEVEL_SCORE_INVALID'));
    if (i > 0 && !(l.scorePct > ordered[i - 1].scorePct)) issues.push(configIssue(l.id, 'LEVEL_SCORES_ORDER'));
    if (targetType === 'NUMERIC' && (l.targetValue === null || !Number.isFinite(l.targetValue))) {
      issues.push(configIssue(l.id, 'LEVEL_TARGET_MISSING'));
    }
    if (targetType === 'TEXT' && isBlank(l.targetText)) issues.push(configIssue(l.id, 'LEVEL_TARGET_MISSING'));
  });

  if (targetType === 'NUMERIC') {
    const values = ordered.map((l) => l.targetValue);
    if (values.every((v): v is number => v !== null)) {
      const up = values.every((v, i) => i === 0 || v > values[i - 1]);
      const down = values.every((v, i) => i === 0 || v < values[i - 1]);
      if (!up && !down) issues.push(configIssue(ref, 'LEVEL_TARGETS_ORDER'));
    }
  } else {
    const texts = ordered.filter((l) => !isBlank(l.targetText)).map((l) => foldDiacritics((l.targetText as string).trim()));
    if (new Set(texts).size !== texts.length) issues.push(configIssue(ref, 'LEVEL_TEXT_DUPLICATE'));
  }
  return issues;
}

// ─── FORMULA: a small, safe expression language (never `eval`) ────────────────────────────────

/** The variables a formula may read. `target` is `null` when the goal has none. */
export interface FormulaVars {
  actual: number;
  target: number | null;
}

type Node =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: 'actual' | 'target' }
  | { kind: 'neg'; arg: Node }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/'; left: Node; right: Node }
  | { kind: 'call'; fn: 'min' | 'max'; args: Node[] };

const MAX_FORMULA_LENGTH = 500;
const MAX_DEPTH = 40;

function tokenize(expr: string): string[] | null {
  const tokens: string[] = [];
  const pattern = /\s*(\d+(?:\.\d+)?|[A-Za-z_]+|[-+*/(),])/y;
  let index = 0;
  while (index < expr.length) {
    if (/^\s+$/.test(expr.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(expr);
    if (!match) return null;
    tokens.push(match[1]);
    index = pattern.lastIndex;
  }
  return tokens;
}

/**
 * Parses `expr` — numbers, `actual`, `target`, `+ - * /`, unary minus, parentheses, `min(…)`,
 * `max(…)`. Anything else (property access, other names, exponents, deep nesting) is refused.
 */
export function parseFormula(expr: string): { ok: true; ast: Node } | { ok: false; error: string } {
  if (expr.length > MAX_FORMULA_LENGTH) return { ok: false, error: 'TOO_LONG' };
  const tokens = tokenize(expr);
  if (tokens === null) return { ok: false, error: 'UNEXPECTED_CHARACTER' };
  if (tokens.length === 0) return { ok: false, error: 'EMPTY' };
  let pos = 0;
  const peek = () => tokens[pos];
  const fail = (error: string): never => {
    throw new FormulaSyntaxError(error);
  };

  const expression = (depth: number): Node => {
    if (depth > MAX_DEPTH) fail('TOO_DEEP');
    let node = term(depth);
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos++] as '+' | '-';
      node = { kind: 'bin', op, left: node, right: term(depth) };
    }
    return node;
  };
  const term = (depth: number): Node => {
    let node = unary(depth);
    while (peek() === '*' || peek() === '/') {
      const op = tokens[pos++] as '*' | '/';
      node = { kind: 'bin', op, left: node, right: unary(depth) };
    }
    return node;
  };
  const unary = (depth: number): Node => {
    if (depth > MAX_DEPTH) fail('TOO_DEEP');
    if (peek() === '-') {
      pos++;
      return { kind: 'neg', arg: unary(depth + 1) };
    }
    return primary(depth);
  };
  const primary = (depth: number): Node => {
    const token = tokens[pos++];
    if (token === undefined) return fail('UNEXPECTED_END');
    if (/^\d/.test(token)) return { kind: 'num', value: Number(token) };
    if (token === '(') {
      const inner = expression(depth + 1);
      if (tokens[pos++] !== ')') fail('MISSING_PAREN');
      return inner;
    }
    if (token === 'actual' || token === 'target') return { kind: 'var', name: token };
    if (token === 'min' || token === 'max') {
      if (tokens[pos++] !== '(') fail('MISSING_PAREN');
      const args: Node[] = [expression(depth + 1)];
      while (peek() === ',') {
        pos++;
        args.push(expression(depth + 1));
      }
      if (tokens[pos++] !== ')') fail('MISSING_PAREN');
      return { kind: 'call', fn: token, args };
    }
    return fail('UNKNOWN_NAME');
  };

  try {
    const ast = expression(0);
    if (pos !== tokens.length) return { ok: false, error: 'TRAILING_INPUT' };
    return { ok: true, ast };
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return { ok: false, error: error.message };
    throw error;
  }
}

class FormulaSyntaxError extends Error {}

function evaluateNode(node: Node, vars: FormulaVars): number | null {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'var':
      return node.name === 'actual' ? vars.actual : vars.target;
    case 'neg': {
      const value = evaluateNode(node.arg, vars);
      return value === null ? null : -value;
    }
    case 'bin': {
      const left = evaluateNode(node.left, vars);
      const right = evaluateNode(node.right, vars);
      if (left === null || right === null) return null;
      if (node.op === '/' && right === 0) return null;
      const value = node.op === '+' ? left + right : node.op === '-' ? left - right : node.op === '*' ? left * right : left / right;
      return Number.isFinite(value) ? value : null;
    }
    case 'call': {
      const values = node.args.map((arg) => evaluateNode(arg, vars));
      if (values.some((v) => v === null)) return null;
      return node.fn === 'min' ? Math.min(...(values as number[])) : Math.max(...(values as number[]));
    }
  }
}

/** The formula's value, or `null` when it does not parse, divides by zero, or reads a missing target. */
export function evaluateFormula(expr: string, vars: FormulaVars): number | null {
  const parsed = parseFormula(expr);
  return parsed.ok ? evaluateNode(parsed.ast, vars) : null;
}
