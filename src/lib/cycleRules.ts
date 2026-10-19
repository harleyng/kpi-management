/**
 * Performance cycles and their periods — what `saveCycle`, `savePeriods`, `setCycleStatus` and
 * `setPeriodLocked` refuse, and which forms a cycle accepts. Pure: no clock is read here.
 *
 * A cycle moves forward one status at a time: Planning → Active → Evaluating → Closed. It and its
 * periods are edited only while Planning; closing it locks every period; a Closed cycle accepts no
 * new form and no period lock change.
 */

import type { CyclePeriod, CycleStatus, FormType, PerformanceCycle, PeriodType } from '@/data/types';
import { ruleIssue, type ErrorCode, type RuleIssue } from './errorCatalog';
import type { Decision } from './goalPlanRules';
import { addDays, isIsoDate } from './isoDate';

/** The one way forward from each status; `null` = the end. */
export const CYCLE_NEXT: Readonly<Record<CycleStatus, CycleStatus | null>> = {
  Planning: 'Active',
  Active: 'Evaluating',
  Evaluating: 'Closed',
  Closed: null,
};

const allow: Decision = { ok: true };
const refuse = (code: ErrorCode): Decision => ({ ok: false, code });
const blank = (text: string | null | undefined) => text === null || text === undefined || text.trim() === '';

/** What `saveCycle` refuses (ERR-KPI-06, `ref` = the field): a name, real dates, start ≤ end. */
export function cycleIssues(c: Pick<PerformanceCycle, 'name' | 'startDate' | 'endDate'>): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (blank(c.name)) issues.push(ruleIssue('ERR-KPI-06', 'name', 'NAME_REQUIRED'));
  if (!isIsoDate(c.startDate) || !isIsoDate(c.endDate)) issues.push(ruleIssue('ERR-KPI-06', 'startDate', 'DATES_INVALID'));
  else if (c.endDate < c.startDate) issues.push(ruleIssue('ERR-KPI-06', 'endDate', 'DATES_INVALID'));
  return issues;
}

/** A period as `savePeriods` receives it (`id` absent for a new one). */
export type PeriodDraft = Pick<CyclePeriod, 'periodType' | 'label' | 'startDate' | 'endDate' | 'inputDeadline' | 'evalDeadline'> & { id?: string };

/**
 * What `savePeriods` refuses (ERR-KPI-06, `ref` = the period's id, or its label when new): a label;
 * real dates with start ≤ end; inside the cycle; deadlines (when set) not before the period's end;
 * no two periods of the same type overlapping (a month and its quarter may).
 */
export function periodIssues(cycle: Pick<PerformanceCycle, 'startDate' | 'endDate'>, periods: readonly PeriodDraft[]): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const refOf = (p: PeriodDraft) => p.id ?? p.label;
  const valid: PeriodDraft[] = [];
  for (const p of periods) {
    const bad = (detail: string) => issues.push(ruleIssue('ERR-KPI-06', refOf(p), detail));
    if (blank(p.label)) bad('LABEL_REQUIRED');
    if (!isIsoDate(p.startDate) || !isIsoDate(p.endDate) || p.endDate < p.startDate) {
      bad('PERIOD_DATES_INVALID');
      continue;
    }
    if (p.startDate < cycle.startDate || p.endDate > cycle.endDate) bad('PERIOD_OUTSIDE_CYCLE');
    for (const deadline of [p.inputDeadline, p.evalDeadline]) {
      if (deadline !== null && (!isIsoDate(deadline) || deadline < p.endDate)) {
        bad('DEADLINE_BEFORE_END');
        break;
      }
    }
    valid.push(p);
  }
  valid.forEach((a, i) => {
    for (const b of valid.slice(i + 1)) {
      if (a.periodType === b.periodType && a.startDate <= b.endDate && b.startDate <= a.endDate) {
        issues.push(ruleIssue('ERR-KPI-06', refOf(b), 'PERIOD_OVERLAP'));
      }
    }
  });
  return issues;
}

/** A cycle (its name, dates, periods) is edited only while Planning (ERR-KPI-04). */
export function canEditCycle(c: Pick<PerformanceCycle, 'status'>): Decision {
  return c.status === 'Planning' ? allow : refuse('ERR-KPI-04');
}

/**
 * What `setCycleStatus` refuses: anything but the next status (ERR-KPI-04, `STATUS_STEP_INVALID`);
 * activating a cycle without valid periods (ERR-KPI-06, `PERIODS_REQUIRED`, plus the periods' own
 * issues). Closing it locks every period (the caller writes that).
 */
export function statusChangeIssues(c: Pick<PerformanceCycle, 'status' | 'startDate' | 'endDate'>, to: CycleStatus, periods: readonly PeriodDraft[]): RuleIssue[] {
  if (CYCLE_NEXT[c.status] !== to) return [ruleIssue('ERR-KPI-04', null, 'STATUS_STEP_INVALID', { from: c.status, to })];
  if (to === 'Active') {
    if (periods.length === 0) return [ruleIssue('ERR-KPI-06', null, 'PERIODS_REQUIRED')];
    const own = periodIssues(c, periods);
    if (own.length) return [ruleIssue('ERR-KPI-06', null, 'PERIODS_REQUIRED'), ...own];
  }
  return [];
}

/** Locking or unlocking a period's actuals — not once the cycle is Closed (ERR-KPI-04). */
export function canLockPeriod(c: Pick<PerformanceCycle, 'status'>): Decision {
  return c.status === 'Closed' ? refuse('ERR-KPI-04') : allow;
}

/**
 * Which forms a cycle accepts (launches and forms started by hand), ERR-KPI-04 otherwise:
 * registration while Planning or Active; evaluation while Active or Evaluating; an adjustment
 * at any time before the cycle is Closed.
 */
export function cycleAllowsLaunch(c: Pick<PerformanceCycle, 'status'>, formType: FormType): Decision {
  const allowed: Readonly<Record<FormType, readonly CycleStatus[]>> = {
    GOAL_SETTING: ['Planning', 'Active'],
    KPI_EVAL: ['Active', 'Evaluating'],
    GOAL_CHANGE: ['Planning', 'Active', 'Evaluating'],
  };
  return allowed[formType].includes(c.status) ? allow : refuse('ERR-KPI-04');
}

// ─── Period generation (WBS 4.3.1) ────────────────────────────────────────────────────────────

/** What "Tạo kỳ tự động" makes by default: the months and their quarters, deadlines as the seed's. */
export const PERIOD_GENERATION_DEFAULTS = {
  types: ['Month', 'Quarter'] as readonly PeriodType[],
  /** Actuals are due this many days after a month ends (seed: T01 → 02-05). */
  inputDeadlineDays: 5,
  /** The evaluation is due this many days after a month ends (seed: T01 → 02-13). */
  evalDeadlineDays: 13,
} as const;

export interface GeneratePeriodsOptions {
  types?: readonly PeriodType[];
  inputDeadlineDays?: number;
  evalDeadlineDays?: number;
}

/** A generated cycle may span at most this many whole months, so month labels never repeat. */
export const MAX_GENERATED_MONTHS = 12;

const MONTHS_PER: Readonly<Record<Exclude<PeriodType, 'Month'>, number>> = { Quarter: 3, Half: 6, Year: 12 };
const LABEL_PREFIX: Readonly<Record<Exclude<PeriodType, 'Month'>, string>> = { Quarter: 'Q', Half: 'H', Year: 'Y' };

const pad2 = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The periods of a cycle (BR-KPI-25), ready for `savePeriods`:
 * - **Month** — one per calendar month, labelled `T01…T12` by the calendar month; input / evaluation
 *   deadlines = the month's end + `inputDeadlineDays` / `evalDeadlineDays` (5 and 13 by default).
 * - **Quarter / Half / Year** — consecutive groups of 3 / 6 / 12 months counted from the cycle start
 *   (`ASSUMPTION Q20`: Q1 = the cycle's first three months, January–March only for a calendar
 *   cycle), labelled `Q1…`, `H1…`, `Y`; only whole groups — a remainder makes no partial period; no
 *   deadlines (the seed's convention).
 * Refused (ERR-KPI-06): the cycle's own issues; a cycle that is not whole months (starts on day 1, ends
 * on a month's last day) — `CYCLE_NOT_WHOLE_MONTHS`; longer than 12 months, where `T01` would repeat
 * — `CYCLE_TOO_LONG`; deadline offsets that are not whole days ≥ 0 — `DEADLINE_DAYS_INVALID`.
 * The output always passes `periodIssues`.
 */
export function generatePeriods(
  cycle: Pick<PerformanceCycle, 'name' | 'startDate' | 'endDate'>,
  options: GeneratePeriodsOptions = {},
): { ok: true; periods: PeriodDraft[] } | { ok: false; issues: RuleIssue[] } {
  const types = options.types ?? PERIOD_GENERATION_DEFAULTS.types;
  const inputDays = options.inputDeadlineDays ?? PERIOD_GENERATION_DEFAULTS.inputDeadlineDays;
  const evalDays = options.evalDeadlineDays ?? PERIOD_GENERATION_DEFAULTS.evalDeadlineDays;

  const own = cycleIssues(cycle);
  if (own.length) return { ok: false, issues: own };
  const issues: RuleIssue[] = [];
  if (![inputDays, evalDays].every((d) => Number.isInteger(d) && d >= 0)) issues.push(ruleIssue('ERR-KPI-06', null, 'DEADLINE_DAYS_INVALID'));

  const [sy, sm, sd] = cycle.startDate.split('-').map(Number);
  const [ey, em, ed] = cycle.endDate.split('-').map(Number);
  if (sd !== 1 || ed !== lastDayOf(ey, em)) issues.push(ruleIssue('ERR-KPI-06', null, 'CYCLE_NOT_WHOLE_MONTHS'));
  const monthCount = (ey - sy) * 12 + (em - sm) + 1;
  if (monthCount > MAX_GENERATED_MONTHS) issues.push(ruleIssue('ERR-KPI-06', null, 'CYCLE_TOO_LONG', { months: monthCount, max: MAX_GENERATED_MONTHS }));
  if (issues.length) return { ok: false, issues };

  const months = Array.from({ length: monthCount }, (_, i) => {
    const year = sy + Math.floor((sm - 1 + i) / 12);
    const month = ((sm - 1 + i) % 12) + 1;
    return { year, month, start: `${year}-${pad2(month)}-01`, end: `${year}-${pad2(month)}-${pad2(lastDayOf(year, month))}` };
  });

  const periods: PeriodDraft[] = [];
  if (types.includes('Month')) {
    for (const m of months) {
      periods.push({
        periodType: 'Month',
        label: `T${pad2(m.month)}`,
        startDate: m.start,
        endDate: m.end,
        inputDeadline: addDays(m.end, inputDays),
        evalDeadline: addDays(m.end, evalDays),
      });
    }
  }
  for (const type of ['Quarter', 'Half', 'Year'] as const) {
    if (!types.includes(type)) continue;
    const size = MONTHS_PER[type];
    for (let g = 0; (g + 1) * size <= months.length; g++) {
      periods.push({
        periodType: type,
        label: type === 'Year' ? LABEL_PREFIX.Year : `${LABEL_PREFIX[type]}${g + 1}`,
        startDate: months[g * size].start,
        endDate: months[(g + 1) * size - 1].end,
        inputDeadline: null,
        evalDeadline: null,
      });
    }
  }
  return { ok: true, periods };
}

/** What applying a generated set would do, for the preview ("Xem trước"). Labels are `type:label`. */
export interface PeriodMergeSummary {
  added: PeriodDraft[];
  /** Same (type, label), but dates or deadlines differ — the generated values win. */
  updated: PeriodDraft[];
  unchanged: PeriodDraft[];
  /** Stored periods the generation does not produce — kept as they are. */
  kept: CyclePeriod[];
}

const periodKey = (p: Pick<CyclePeriod, 'periodType' | 'label'>) => `${p.periodType}:${p.label}`;
const sameShape = (a: PeriodDraft, b: PeriodDraft) =>
  a.startDate === b.startDate && a.endDate === b.endDate && a.inputDeadline === b.inputDeadline && a.evalDeadline === b.evalDeadline;

/**
 * Merges a generated set into the cycle's stored periods for `savePeriods`, which matches children by
 * id: a generated period with the same (type, label) as a stored one KEEPS its id and lock, so
 * regenerating never breaks the actuals, targets and forms that point at it; stored periods the
 * generation does not produce are kept untouched. Removing a period is a separate, explicit act.
 */
export function mergeGeneratedPeriods(
  existing: readonly CyclePeriod[],
  generated: readonly PeriodDraft[],
): { inputs: (PeriodDraft & { isLocked: boolean })[]; summary: PeriodMergeSummary } {
  const byKey = new Map(existing.map((p) => [periodKey(p), p]));
  const summary: PeriodMergeSummary = { added: [], updated: [], unchanged: [], kept: [] };
  const inputs: (PeriodDraft & { isLocked: boolean })[] = [];
  const used = new Set<string>();
  for (const draft of generated) {
    const stored = byKey.get(periodKey(draft));
    if (stored) {
      used.add(stored.id);
      inputs.push({ ...draft, id: stored.id, isLocked: stored.isLocked });
      (sameShape(stored, draft) ? summary.unchanged : summary.updated).push({ ...draft, id: stored.id });
    } else {
      inputs.push({ ...draft, isLocked: false });
      summary.added.push(draft);
    }
  }
  for (const stored of existing) {
    if (used.has(stored.id)) continue;
    inputs.push(periodInput(stored));
    summary.kept.push(stored);
  }
  return { inputs, summary };
}

/** A stored period as a `savePeriods` child (to re-send the list with one field changed). */
export function periodInput(p: CyclePeriod): PeriodDraft & { id: string; isLocked: boolean } {
  return {
    id: p.id,
    periodType: p.periodType,
    label: p.label,
    startDate: p.startDate,
    endDate: p.endDate,
    inputDeadline: p.inputDeadline,
    evalDeadline: p.evalDeadline,
    isLocked: p.isLocked,
  };
}

/** The status a cycle moves to next, or `null` once Closed — what the "next step" button offers. */
export function nextCycleStatus(c: Pick<PerformanceCycle, 'status'>): CycleStatus | null {
  return CYCLE_NEXT[c.status];
}

/**
 * The cycle a screen opens on when none is chosen: the Active one (the latest if several), else the
 * one Evaluating, else Planning, else the latest Closed — "the cycle people are working in now".
 * `preferredId` wins when it names a cycle of the list (a `?cycle=` in the URL).
 */
export function defaultCycleId(cycles: readonly Pick<PerformanceCycle, 'id' | 'status' | 'startDate'>[], preferredId: string | null = null): string | null {
  if (preferredId && cycles.some((c) => c.id === preferredId)) return preferredId;
  for (const status of ['Active', 'Evaluating', 'Planning', 'Closed'] as const) {
    const candidates = cycles.filter((c) => c.status === status).sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
    if (candidates[0]) return candidates[0].id;
  }
  return null;
}
