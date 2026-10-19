import type { RoleCode } from '@/data/types';

/**
 * Which navigation groups a session sees (plan §7.1). Pure, tested, and the only place the menu's
 * role check lives — the sidebar never compares role strings itself.
 *
 * Kept apart from `permissionRules.ts` (Phase 1.3, `can(user, action, resource)`): showing a menu
 * group is a coarse, role-only decision, while `can()` resolves scopes over data. Hiding a group
 * does NOT protect its routes — that guard is `can()`'s job.
 */

/** The slice of a nav group this rule reads — `NavGroup` in `navConfig.ts` satisfies it. */
export interface RoleGatedGroup {
  /** `'ALL'` = every signed-in user. */
  roles: readonly RoleCode[] | 'ALL';
}

/** Groups the roles may see, in their declared order. A user with several roles sees the union. */
export function visibleNavGroups<G extends RoleGatedGroup>(groups: readonly G[], roles: readonly RoleCode[]): G[] {
  return groups.filter((group) => group.roles === 'ALL' || group.roles.some((role) => roles.includes(role)));
}
