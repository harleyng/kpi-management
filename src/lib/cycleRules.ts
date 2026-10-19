/**
 * Performance cycles and their periods — what `saveCycle`, `savePeriods`, `setCycleStatus` and
 * `setPeriodLocked` refuse, and which forms a cycle accepts. Pure: no clock is read here.
 *
 * A cycle moves forward one status at a time: Planning → Active → Evaluating → Closed. It and its
 * periods are edited only while Planning; closing it locks every period; a Closed cycle accepts no
 * new form and no period lock change.
 */

import type { CyclePeriod, CycleStatus, FormType, PerformanceCycle } from '@/data/types';
import { ruleIssue, type ErrorCode, type RuleIssue } from './errorCatalog';
import type { Decision } from './goalPlanRules';
import { isIsoDate } from './isoDate';

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
