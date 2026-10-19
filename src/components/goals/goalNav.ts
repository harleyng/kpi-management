import type { Goal } from '@/data/types';
import type { PlanWorkspaceData } from '@/hooks/queries/goals';
import { EDIT_REASON_COPY } from './goalCopy';

/*
 * How a Goal Plan page and its goal pages refer to each other (URLs, the state carried back) and the
 * one wording of "why this goal is view-only" both of them show.
 */

/** A goal page's facet tabs (`?tab=`); `info` is the default. */
export type GoalTab = 'info' | 'split' | 'link';

/** The goal page of a plan: `${basePath}/goals/<id>` (`?tab=` when not the default), or `/goals/new`. */
export const goalPageUrl = (basePath: string, goalId: string | 'new', tab: GoalTab = 'info') =>
  `${basePath}/goals/${encodeURIComponent(goalId)}${tab === 'info' ? '' : `?tab=${tab}`}`;

/** Where a goal page sends the person back to: the plan, with the goal's row to bring into view. */
export interface PlanReturnState {
  focusId?: string;
}

/** Why a goal is view-only: Changed / Cancelled goals carry no edits. */
export const inactiveGoalReason = (goal: Pick<Goal, 'status'>) => (goal.status !== 'Active' ? 'Chỉ tiêu đã thay đổi hoặc đã hủy — chỉ còn để xem.' : null);

/** Why the plan cannot be changed by this person now (`planEditability`), or `null` when it can. */
export const planNotEditableReason = (data: PlanWorkspaceData) =>
  data.editability.decision.ok ? null : (EDIT_REASON_COPY[data.editability.reason] ?? 'Bạn không sửa được Goal Plan lúc này.');
