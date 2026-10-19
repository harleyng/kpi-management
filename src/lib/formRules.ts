/**
 * What a form needs before it may move on — `canSubmit` (D6, BR-KPI-18) — and the evaluation form's
 * own arithmetic. The step's configuration (`evaluationColumn`, `requiresComment`) decides what is
 * required, never a hard-coded step number.
 */

import type { CalcMethod, EvaluationColumn, EvaluationItem, Goal, GoalChangeItem, Kgi, WorkflowStep } from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';
import { changeItemIssues, ownerStepNo, planAfterChanges, submitIssues, weightIssue } from './goalPlanRules';
import { weightedScore, type WeightedScore } from './scoreRules';

/** The two fields of an evaluation item one column owns. */
export const COLUMN_FIELDS = {
  SELF: { pct: 'selfAchievementPct', comment: 'selfComment' },
  MANAGER: { pct: 'managerAchievementPct', comment: 'managerComment' },
  FINAL: { pct: 'finalAchievementPct', comment: 'finalComment' },
} as const satisfies Record<EvaluationColumn, { pct: keyof EvaluationItem; comment: keyof EvaluationItem }>;

export const columnPct = (item: EvaluationItem, column: EvaluationColumn): number | null => item[COLUMN_FIELDS[column].pct];
export const columnComment = (item: EvaluationItem, column: EvaluationColumn): string | null => item[COLUMN_FIELDS[column].comment];

export type CanSubmitInput =
  | { formType: 'KPI_EVAL'; step: WorkflowStep; items: readonly EvaluationItem[]; goals: readonly Goal[] }
  | { formType: 'GOAL_SETTING'; stepNo: number; steps: readonly WorkflowStep[]; goals: readonly Goal[]; kgis: readonly Kgi[] }
  | { formType: 'GOAL_CHANGE'; goals: readonly Goal[]; changeItems: readonly GoalChangeItem[]; kgis: readonly Kgi[] };

export type CanSubmitResult = { ok: true } | { ok: false; issues: RuleIssue[] };

const result = (issues: RuleIssue[]): CanSubmitResult => (issues.length ? { ok: false, issues } : { ok: true });
const blank = (text: string | null) => text === null || text.trim() === '';

/**
 * Whether SUBMIT / APPROVE may go ahead (RETURN and CANCEL never need it):
 * - KPI_EVAL — the goals on the form weigh 100% (ERR-KPI-07), and every item has the step's column
 *   (ERR-KPI-09, `ref` = item) and, when the step requires one, a comment.
 * - GOAL_SETTING — from the owner's step on, the plan passes `submitIssues` (100%, 5–8 goals, every
 *   goal measurable). Before it (the manager cascading at step 1) the plan is still being built.
 * - GOAL_CHANGE — the proposal is well-formed and the plan AFTER it still passes `submitIssues`.
 */
export function canSubmit(input: CanSubmitInput): CanSubmitResult {
  switch (input.formType) {
    case 'KPI_EVAL': {
      const issues: RuleIssue[] = [];
      const goalIds = new Set(input.items.map((i) => i.goalId));
      const weight = weightIssue(input.goals.filter((g) => goalIds.has(g.id)));
      if (weight) issues.push(weight);
      const column = input.step.evaluationColumn;
      if (column) {
        for (const item of input.items) {
          const pct = columnPct(item, column);
          if (pct === null || !Number.isFinite(pct)) issues.push(ruleIssue('ERR-KPI-09', item.id, 'SCORE_MISSING', { column }));
          else if (input.step.requiresComment && blank(columnComment(item, column))) {
            issues.push(ruleIssue('ERR-KPI-09', item.id, 'COMMENT_MISSING', { column }));
          }
        }
      }
      return result(issues);
    }
    case 'GOAL_SETTING':
      if (input.stepNo < ownerStepNo(input.steps)) return { ok: true };
      return result(submitIssues(input.goals, input.kgis).blocking);
    case 'GOAL_CHANGE': {
      if (input.changeItems.length === 0) return result([ruleIssue('ERR-KPI-06', null, 'NO_CHANGES')]);
      const itemIssues = changeItemIssues(input.goals, input.changeItems);
      if (itemIssues.length) return result(itemIssues);
      return result(submitIssues(planAfterChanges([...input.goals], input.changeItems), input.kgis).blocking);
    }
  }
}

/**
 * A % typed into an evaluation column: a finite number from 0 up to the goal's method cap (when it
 * has one). `null` clears the cell and is always accepted while saving a draft.
 */
export function validateScoreInput(pct: number | null, method: Pick<CalcMethod, 'capPct'> | null): RuleIssue | null {
  if (pct === null) return null;
  const cap = method?.capPct ?? null;
  if (!Number.isFinite(pct) || pct < 0 || (cap !== null && pct > cap)) {
    return ruleIssue('ERR-KPI-06', null, 'SCORE_OUT_OF_RANGE', cap === null ? { min: 0 } : { min: 0, max: cap });
  }
  return null;
}

/**
 * The evaluation form's footer total for one column (plan §5.5) — the same arithmetic as the result.
 * An item whose goal is not in `goals` counts as missing (never silently dropped).
 */
export function evaluationTotal(items: readonly EvaluationItem[], goals: readonly Goal[], column: EvaluationColumn): WeightedScore {
  const byId = new Map(goals.map((g) => [g.id, g]));
  return weightedScore(
    items.flatMap((item) => {
      const goal = byId.get(item.goalId);
      return goal
        ? [{ goalId: goal.id, weight: goal.weight, status: goal.status, achievementPct: columnPct(item, column) }]
        : [{ goalId: item.goalId, weight: 0, status: 'Active' as const, achievementPct: null }];
    }),
  );
}
