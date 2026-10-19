/**
 * Permission rules — `can(user, action, resource)` (plan §3.3).
 *
 * Pure functions with a co-located test, like every `src/lib/*Rules.ts`. No component checks a
 * role string itself; it asks this module (through `useSession().can`, Phase 1.3).
 *
 * TODO Phase 1.3:
 * - the permission catalogue (ERD `PERMISSION.code`, e.g. `goal.approve`, `result.view_all`);
 * - scope resolution over `SCOPE_TYPES` in `src/data/types.ts`: Self / DirectReports /
 *   OrgUnit (+ children when `includeChildren`) / Tenant, from `USER_ROLE`;
 * - `visibleNavGroups(roles)` — filtering `NAV_GROUPS` by `NavGroup.roles`;
 * - `permissionRules.test.ts` — the role × action × scope matrix (Phase 1.3 gate).
 */
export {};
