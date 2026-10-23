import { beforeAll, describe, expect, it } from 'vitest';
import type { FormInstance, GoalPlan, Id, PersonFormAction, Tenant, UserAccount } from '@/data/types';
import type { DataGateway, FormActionInput } from '@/integrations/data/types';
import { SYNTRA } from '@/data/fixtures';
import { newGateway, rejection } from '@/integrations/data/mock/gateway.test-util';
import { KpiError } from './errorCatalog';
import { canSubmit } from './formRules';
import { actorDirectoryOf, formStanding, submitCheckInput, type FormStanding } from './formViewRules';
import { todayOf } from './isoDate';
import { buildAccessProfile, can, resourceOfSubject } from './permissionRules';
import type { SessionDirectory } from './sessionRules';

/**
 * PARITY — what the screens show (`formStanding`) against what the gateway does (`forms.act`,
 * `forms.listInbox`), on the frozen seed of BOTH tenants. If a rule moves in one place and not the
 * other, a button appears that the gateway refuses (or disappears while the gateway would accept),
 * and this fails — client and gateway can never disagree silently (T5 phase 2, workflow-expert).
 *
 * - inbox ⇔ `assignees` (as sets; HR proxy access is not an inbox, so PROXY is not in either);
 * - every action NOT shown is refused (one shared gateway — a refusal changes nothing);
 * - every action shown is accepted on a fresh gateway, one case per (type, step, mode, action) —
 *   SUBMIT / APPROVE accepted exactly when the screen's own content check (`submitCheckInput` +
 *   `canSubmit`) passes, and refused as CONTENT_INCOMPLETE otherwise.
 */

const ACTIONS: PersonFormAction[] = ['SUBMIT', 'APPROVE', 'RETURN', 'CANCEL'];

/**
 * The seed has no open form at a step whose actor has an ACTIVE delegation, so Syntra's sales head
 * (E006, the §8.2 "TP Sale") delegates evaluations to another head (E008, whose own delegation ended in March) for the test — on every
 * gateway the test acts on, so they all start from the same rows.
 */
async function prepare(gateway: DataGateway, tenant: Tenant): Promise<Id | null> {
  if (tenant.id !== SYNTRA.tenantId) return null;
  const created = await gateway.forms.saveDelegation(tenant.id, SYNTRA.user('E006'), {
    toUserId: SYNTRA.user('E008'),
    formType: 'KPI_EVAL',
    validFrom: '2027-04-01',
    validTo: '2027-04-30',
  });
  return created.id;
}

interface World {
  gateway: DataGateway;
  /** The delegation `prepare` created on this world's gateway (a fresh gateway creates its own). */
  preparedId: Id | null;
  tenant: Tenant;
  directory: SessionDirectory;
  allForms: FormInstance[];
  openForms: FormInstance[];
  plans: Map<Id, GoalPlan>;
  standingOf: (form: FormInstance, account: UserAccount) => FormStanding;
  candidatesFor: (form: FormInstance, s: FormStanding) => UserAccount[];
  contentOk: (form: FormInstance, s: FormStanding) => Promise<boolean>;
}

/** The world as the screens see it. `existing` re-reads a gateway a test has already moved on. */
async function loadWorld(tenantIndex: number, existing?: DataGateway): Promise<World> {
  const gateway = existing ?? newGateway().gateway;
  const tenant = (await gateway.platform.listTenants())[tenantIndex];
  const t = tenant.id;
  const preparedId = existing ? null : await prepare(gateway, tenant);
  const { org, forms, goals, work } = gateway;
  const [accounts, employees, roles, permissions, rolePermissions, userRoles, orgUnits, assignments] = await Promise.all([
    org.listUserAccounts(t),
    org.listEmployees(t, { includeResigned: true }),
    org.listRoles(t),
    org.listPermissions(t),
    org.listRolePermissions(t),
    org.listUserRoles(t),
    org.listOrgUnits(t),
    org.listAssignments(t),
  ]);
  const directory: SessionDirectory = { tenantId: t, accounts, employees, roles, permissions, rolePermissions, userRoles, orgUnits, assignments };
  const all: FormInstance[] = [];
  for (let cursor: string | undefined, page; (page = await forms.listForms(t, {}, { limit: 500, cursor })); ) {
    all.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  const [steps, delegations, planRows] = await Promise.all([forms.listWorkflowSteps(t), forms.listDelegations(t), goals.listGoalPlans(t)]);
  const plans = new Map(planRows.map((p) => [p.id, p]));
  const actorDir = actorDirectoryOf(directory);
  const clock = { now: gateway.clock.now(), tz: tenant.timezone };
  const profiles = new Map(
    accounts.map((account) => [account.id, buildAccessProfile({ ...directory, tenantId: t, account, asOf: todayOf(clock) })]),
  );

  const standingOf = (form: FormInstance, account: UserAccount) => {
    const profile = profiles.get(account.id)!;
    const subject = resourceOfSubject(t, form.subjectEmployeeId);
    return formStanding({
      form,
      steps,
      plan: form.goalPlanId ? (plans.get(form.goalPlanId) ?? null) : null,
      directory: actorDir,
      delegations,
      userId: account.id,
      mayProxy: can(profile, 'form.proxy', subject),
      mayCancel: can(profile, 'form.cancel', subject),
      clock,
    });
  };

  // Everyone whose answer could differ: the subject, the assignees, the delegates and delegators,
  // everyone with a proxy or cancel right, and an ordinary outsider.
  const active = accounts.filter((a) => a.status === 'Active');
  const privileged = active.filter((a) => {
    const p = profiles.get(a.id)!;
    return can(p, 'form.proxy', { kind: 'Tenant', tenantId: t }) || can(p, 'form.cancel', { kind: 'Tenant', tenantId: t });
  });
  const candidatesFor = (form: FormInstance, s: FormStanding) => {
    const ids = new Set<Id>([...s.assignees, ...s.stepActors, ...privileged.map((a) => a.id)]);
    for (const d of delegations) {
      ids.add(d.fromUserId);
      ids.add(d.toUserId);
    }
    const subject = active.find((a) => a.employeeId === form.subjectEmployeeId);
    if (subject) ids.add(subject.id);
    const outsider = active.find((a) => !ids.has(a.id));
    if (outsider) ids.add(outsider.id);
    return active.filter((a) => ids.has(a.id));
  };

  const contentOk = async (form: FormInstance, s: FormStanding) => {
    const [goalRows, kgis, items, changeItems, workTasks, periods, workReview, workReviewItems, workScoring] = await Promise.all([
      form.goalPlanId ? goals.listGoals(t, { goalPlanIds: [form.goalPlanId] }) : Promise.resolve([]),
      form.goalPlanId ? goals.listKgis(t, form.goalPlanId) : Promise.resolve([]),
      form.formType === 'KPI_EVAL' ? forms.listEvaluationItems(t, form.id) : Promise.resolve([]),
      form.formType === 'GOAL_CHANGE' ? forms.listGoalChangeItems(t, form.id) : Promise.resolve([]),
      form.workPlanId ? work.listWorkTasks(t, form.workPlanId) : Promise.resolve([]),
      form.formType === 'WORK_PLAN' ? goals.listCycles(t).then((cs) => Promise.all(cs.map((c) => goals.listPeriods(t, c.id)))).then((ps) => ps.flat()) : Promise.resolve([]),
      form.formType === 'WORK_REVIEW' ? work.getWorkReview(t, form.id) : Promise.resolve(null),
      form.formType === 'WORK_REVIEW' ? work.listWorkReviewItems(t, form.id) : Promise.resolve([]),
      work.getWorkScoringConfig(t),
    ]);
    return canSubmit(submitCheckInput(form, s.step!, s.steps, { goals: goalRows, kgis, items, changeItems, workTasks, periods, workReviews: workReview ? [workReview] : [], workReviewItems, workScoring: workScoring ?? undefined })).ok;
  };

  return { gateway, preparedId, tenant, directory, allForms: all, openForms: all.filter((f) => f.status === 'Open' || f.status === 'InProgress'), plans, standingOf, candidatesFor, contentOk };
}

const actionInput = (form: FormInstance, account: UserAccount, s: FormStanding, action: PersonFormAction): FormActionInput => {
  // CANCEL is always the user themself; a step action carries the standing the screen would send.
  const as = action === 'CANCEL' || s.standing === null ? { onBehalfOfUserId: null, delegationId: null } : s.standing;
  return { formId: form.id, expectedStepId: form.currentStepId!, action, comment: 'Lý do kiểm thử', onBehalfOfUserId: as.onBehalfOfUserId, delegationId: as.delegationId };
};

describe.each([
  ['Syntra', 0],
  ['Demo Co', 1],
])('formStanding ⇔ the mock gateway on the seed — %s', (_name, tenantIndex) => {
  let world: World;
  beforeAll(async () => {
    world = await loadWorld(tenantIndex);
  });

  it('a closed form offers nobody anything', () => {
    const closed = world.allForms.filter((f) => f.status === 'Completed' || f.status === 'Cancelled');
    expect(closed.length).toBeGreaterThan(0);
    for (const form of closed) {
      for (const account of world.directory.accounts) expect(world.standingOf(form, account).actions).toEqual([]);
    }
  });

  it('"Việc cần xử lý" holds exactly the forms whose assignees include the user', async () => {
    const { gateway, tenant, directory, openForms, standingOf } = world;
    const someone = directory.accounts[0];
    const assignees = new Map(openForms.map((f) => [f.id, new Set(standingOf(f, someone).assignees)]));
    for (const account of directory.accounts.filter((a) => a.status === 'Active')) {
      const inbox = new Set((await gateway.forms.listInbox(tenant.id, account.id)).map((f) => f.id));
      const expected = new Set(openForms.filter((f) => assignees.get(f.id)!.has(account.id)).map((f) => f.id));
      expect([...inbox].sort(), account.login).toEqual([...expected].sort());
    }
  });

  it('every action the screen does NOT show is refused by forms.act', async () => {
    const { gateway, tenant, openForms, standingOf, candidatesFor } = world;
    let checked = 0;
    for (const form of openForms) {
      const anyone = standingOf(form, world.directory.accounts[0]);
      for (const account of candidatesFor(form, anyone)) {
        const s = standingOf(form, account);
        for (const action of ACTIONS.filter((a) => !s.actions.includes(a))) {
          const error = await rejection(gateway.forms.act(tenant.id, account.id, actionInput(form, account, s, action)));
          expect(['ERR-KPI-04', 'ERR-KPI-05'], `${account.login} ${action} on ${form.id} (${s.readOnlyReason})`).toContain(error.code);
          checked++;
        }
      }
    }
    // Demo Co's seed holds closed forms only (seed README) — nothing to act on there.
    if (world.openForms.length > 0) expect(checked).toBeGreaterThan(0);
  }, 60_000); // walks every open form of the seed, like the case below

  it('every action the screen shows is accepted (one case per type, step, mode and action)', async () => {
    const { tenant, openForms, standingOf, candidatesFor, contentOk } = world;
    const seen = new Set<string>();
    let accepted = 0;
    for (const form of openForms) {
      const anyone = standingOf(form, world.directory.accounts[0]);
      for (const account of candidatesFor(form, anyone)) {
        const s = standingOf(form, account);
        for (const action of s.actions) {
          const key = `${form.formType}:${s.step?.stepNo}:${action === 'CANCEL' ? 'ADMIN' : s.mode}:${action}:${s.frozen}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const fresh = newGateway().gateway;
          const freshId = await prepare(fresh, tenant);
          const input = actionInput(form, account, s, action);
          if (input.delegationId !== null && input.delegationId === world.preparedId) input.delegationId = freshId;
          const call = fresh.forms.act(tenant.id, account.id, input);
          const content = action === 'SUBMIT' || action === 'APPROVE' ? await contentOk(form, s) : true;
          if (content) {
            await expect(call, `${account.login} ${action} on ${form.id} as ${s.mode}`).resolves.toMatchObject({ id: form.id });
            accepted++;
          } else {
            const error = await rejection(call);
            expect(error).toBeInstanceOf(KpiError);
            expect(error.detail, `${account.login} ${action} on ${form.id}`).toBe('CONTENT_INCOMPLETE');
          }
        }
      }
    }
    if (tenantIndex === 0) {
      expect(world.openForms.length).toBeGreaterThan(0);
      // The seed holds actors, delegates, HR proxies and cancellers: each mode must have been exercised.
      const modes = new Set([...seen].map((k) => k.split(':')[2]));
      expect([...modes].sort()).toEqual(['ACTOR', 'ADMIN', 'DELEGATE', 'PROXY']);
      expect(accepted).toBeGreaterThan(0);
    }
  }, 60_000);
});

/**
 * Plan §8.1's workflow cases, end to end on the gateway — the screen's answer before and after the
 * clock or the scheduler moves the form (QA, T5 phase 4).
 */
describe('formStanding follows the gateway through time — Syntra', () => {
  const T = SYNTRA.tenantId;
  const openEvalOf = (w: World, code: string) =>
    w.openForms.find((f) => f.formType === 'KPI_EVAL' && f.subjectEmployeeId === SYNTRA.employee(code))!;
  const account = (w: World, code: string) => w.directory.accounts.find((a) => a.id === SYNTRA.user(code))!;

  it('HR returns a form from the LAST step to the step before, and the screen follows', async () => {
    const w = await loadWorld(0);
    const form = openEvalOf(w, 'E038'); // T03, at the HR step (seed)
    const hr = account(w, 'E035');
    const before = w.standingOf(form, hr);
    expect(before.step?.stepNo).toBe(before.steps.length);
    expect(before.actions).toContain('RETURN');
    const moved = await w.gateway.forms.act(T, hr.id, actionInput(form, hr, before, 'RETURN'));
    expect(moved.currentStepId).toBe(before.returnTarget!.id);
    const after = (await loadWorld(0, w.gateway)).standingOf(moved, hr);
    expect(after.step?.stepNo).toBe(before.steps.length - 1);
    expect(after.actions).not.toContain('APPROVE');
  });

  it('an overdue self-assessment is auto-forwarded by the scheduler; the old step is refused as stale', async () => {
    const w = await loadWorld(0);
    const form = openEvalOf(w, 'E017'); // T03, Open at the SELF step, deadline 07/04 (seed)
    const subject = account(w, 'E017');
    const before = w.standingOf(form, subject);
    expect(before.actions).toContain('SUBMIT');
    w.gateway.dev!.setNow('2027-04-08T03:00:00.000Z'); // 8 Apr 10:00 — the day after the deadline
    expect((await loadWorld(0, w.gateway)).standingOf(form, subject).overdue).toBe(true);
    const report = await w.gateway.scheduler.runDue(T);
    expect(report.overdueHandled.map((o) => o.formId)).toContain(form.id);

    const later = await loadWorld(0, w.gateway);
    const moved = later.allForms.find((f) => f.id === form.id)!;
    expect(moved.currentStepId).not.toBe(form.currentStepId);
    const after = later.standingOf(moved, subject);
    expect(after.readOnlyReason).toBe('OWN_REVIEW');
    expect(after.actions).toEqual([]);
    const stale = await rejection(w.gateway.forms.act(T, subject.id, actionInput(form, subject, before, 'SUBMIT')));
    expect(stale.code).toBe('ERR-KPI-04');
  });

  it('a delegation stops granting once the clock passes its end date — screen and gateway together', async () => {
    const w = await loadWorld(0); // `prepare`: E006 → E008, KPI_EVAL, 01/04–30/04
    const form = openEvalOf(w, 'E015'); // T03, at E006's manager step (seed)
    const delegate = account(w, 'E008');
    const during = w.standingOf(form, delegate);
    expect(during.mode).toBe('DELEGATE');

    w.gateway.dev!.setNow('2027-05-01T03:00:00.000Z'); // 1 May — the day after validTo
    const after = (await loadWorld(0, w.gateway)).standingOf(form, delegate);
    expect(after.actions).toEqual([]);
    expect(after.readOnlyReason).toBe('NOT_YOUR_STEP');
    const refused = await rejection(w.gateway.forms.act(T, delegate.id, actionInput(form, delegate, during, 'RETURN')));
    expect(refused.code).toBe('ERR-KPI-05');
  });
});
