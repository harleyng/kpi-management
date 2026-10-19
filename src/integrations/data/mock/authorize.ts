import type { GoalPlan, Id, UserAccount } from '@/data/types';
import { KpiError } from '@/lib/errorCatalog';
import { toZonedDate, type Clock } from '@/lib/isoDate';
import {
  buildAccessProfile,
  can,
  resourceOfOwner,
  resourceOfSubject,
  type AccessProfile,
  type PermissionCode,
  type PermissionResource,
} from '@/lib/permissionRules';
import type { Tx } from './store';

/**
 * The ONE authorization hook of the mock. The runtime calls it for every user write, before the
 * method body, with the method's declared `WriteAuth`:
 *
 * 1. the actor is an Active account OF THIS TENANT — another tenant's user, an unknown id and an
 *    Inactive account all answer ERR-KPI-05 with the same detail;
 * 2. `can(profile, permission, resource)` (`src/lib/permissionRules.ts`) for the declared code, on
 *    every resource the method's resolver names (an update names the stored owner AND the new one,
 *    so a row cannot be moved out of the actor's scope).
 *
 * `'workflow'` — BR-KPI-61: a permission is never a workflow decision. Acting on a form is decided
 * by `workflowRules` in the method body (entitlement, delegation, proxy); only step 1 applies here.
 * `'actor'` — the method body checks that the row is the actor's own (their notification).
 *
 * Reads are not filtered per user at Gate 1: they are tenant-scoped, screens gate with `can()`, and
 * row-level read filtering is the database's RLS (Phase 5).
 */

export type ResourceResolver<A extends unknown[]> = (
  tx: Tx,
  ...args: A
) => PermissionResource | null | undefined | readonly (PermissionResource | null | undefined)[];

export type WriteAuth<A extends unknown[] = never[]> =
  | { readonly permission: PermissionCode; readonly resource?: ResourceResolver<A> }
  | 'workflow'
  | 'actor';

/** Which Phase 2 track owns a method that stays deferred (or unguarded) after Gate 1. */
export type Track = 'T4' | 'T6';

export function authorizeActor(tx: Tx, actorUserId: Id): UserAccount {
  const account = typeof actorUserId === 'string' ? tx.find('UserAccount', actorUserId) : undefined;
  if (!account || account.status !== 'Active') {
    throw new KpiError('ERR-KPI-05', `user ${String(actorUserId)} cannot act in this tenant`);
  }
  return account;
}

const profiles = new WeakMap<Tx, AccessProfile>();

/** The tenant's zone and the transaction's time — what every time-aware rule takes. */
export function clockOf(tx: Tx): Clock {
  return { now: tx.now, tz: tx.globals.tenants.get(tx.tenantId)?.timezone ?? 'Asia/Ho_Chi_Minh' };
}

/**
 * The actor's access profile, built from this transaction's rows as of the tenant's "today" — once
 * per write, so a role change applies at once. Method bodies use it for workflow inputs that are
 * permissions (`form.proxy`, `form.cancel`, `delegation.manage`).
 */
export function profileOf(tx: Tx, account?: UserAccount): AccessProfile {
  const cached = profiles.get(tx);
  if (cached) return cached;
  const actor = account ?? authorizeActor(tx, tx.ctx.actorUserId as Id);
  const clock = clockOf(tx);
  const profile = buildAccessProfile({
    tenantId: tx.tenantId,
    account: actor,
    roles: tx.all('Role'),
    userRoles: tx.all('UserRole'),
    permissions: [...tx.globals.permissions.values()],
    rolePermissions: tx.all('RolePermission'),
    orgUnits: tx.all('OrgUnit'),
    assignments: tx.all('EmployeeAssignment'),
    employees: tx.all('Employee'),
    asOf: toZonedDate(clock.now, clock.tz),
  });
  profiles.set(tx, profile);
  return profile;
}

/** Whether the transaction's actor holds `code` on `resource` (no resource: under any scope). */
export function actorCan(tx: Tx, code: PermissionCode, resource?: PermissionResource | null): boolean {
  return can(profileOf(tx), code, resource);
}

export function authorizeWrite<A extends unknown[]>(tx: Tx, actorUserId: Id, name: string, auth: WriteAuth<A>, args: A): void {
  const account = authorizeActor(tx, actorUserId);
  if (auth === 'workflow' || auth === 'actor') return;
  const profile = profileOf(tx, account);
  const resolved = auth.resource ? auth.resource(tx, ...args) : undefined;
  const list: readonly (PermissionResource | null | undefined)[] = Array.isArray(resolved) ? resolved : [resolved as Resolved];
  const known = list.filter((r) => r !== undefined);
  // Nothing resolvable (no resolver, or unknown ids): holding the code is the check.
  const resources: readonly (PermissionResource | null | undefined)[] = known.length > 0 ? known : [undefined];
  for (const resource of resources) {
    if (!can(profile, auth.permission, resource)) {
      throw new KpiError('ERR-KPI-05', `${name}: user ${actorUserId} lacks ${auth.permission}${resource ? ` on ${resource.kind}` : ''}`);
    }
  }
}

// ─── Resource resolvers ──────────────────────────────────────────────────────────────────────────
//
// `undefined` = the id names no row of this tenant: only the code is checked here, and the method
// body or the integrity check answers for the id exactly as for any missing id (ERR-KPI-02 / 06) —
// so another tenant's id is still indistinguishable from a missing one. `null` = the row exists but
// its owner cannot be resolved → `can` denies.

type Resolved = PermissionResource | null | undefined;

export const planResource = (tx: Tx, plan: Pick<GoalPlan, 'ownerType' | 'ownerOrgUnitId' | 'ownerEmployeeId'>) =>
  resourceOfOwner(tx.tenantId, plan);

export function planIdResource(tx: Tx, goalPlanId: Id | null | undefined): Resolved {
  const plan = typeof goalPlanId === 'string' ? tx.find('GoalPlan', goalPlanId) : undefined;
  return plan ? planResource(tx, plan) : undefined;
}

export function goalResource(tx: Tx, goalId: Id | null | undefined): Resolved {
  const goal = typeof goalId === 'string' ? tx.find('Goal', goalId) : undefined;
  return goal ? planIdResource(tx, goal.goalPlanId) : undefined;
}

/** A form: its plan's owner when it has a plan, else its subject (permissionRules). */
export function formResource(tx: Tx, formId: Id): Resolved {
  const form = typeof formId === 'string' ? tx.find('FormInstance', formId) : undefined;
  if (!form) return undefined;
  return form.goalPlanId ? planIdResource(tx, form.goalPlanId) : resourceOfSubject(tx.tenantId, form.subjectEmployeeId);
}

/** A user as a resource: the employee behind the account; code-only for a non-employee account. */
export function userResource(tx: Tx, userId: Id | null): Resolved {
  const account = typeof userId === 'string' ? tx.find('UserAccount', userId) : undefined;
  return account?.employeeId ? resourceOfSubject(tx.tenantId, account.employeeId) : undefined;
}
