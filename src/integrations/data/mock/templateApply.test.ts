import { describe, expect, it } from 'vitest';
import { SYNTRA } from '@/data/fixtures';
import type { GoalPlan, Id } from '@/data/types';
import { nextSortOrder } from '@/lib/goalPlanRules';
import { templateApplication } from '@/lib/templateApplyRules';
import type { DataGateway } from '../types';
import { newGateway, rejection } from './gateway.test-util';

/**
 * "Thêm từ bộ mẫu" on the mock (BR-KPI-77), exactly as the screen sends it: `templateApplication`
 * builds the goals, `useApplyTemplate` saves them one `saveGoal` at a time — each write passing the
 * plan's own edit guard (`canEditPlan`).
 */

const S = SYNTRA.tenantId;
const u = (code: string) => SYNTRA.user(code);
const emp = (code: string) => SYNTRA.employee(code);
const hr = u(SYNTRA.personas.hr);
const cycle2027 = SYNTRA.id('PerformanceCycle', '2027');
const cycle2028 = SYNTRA.id('PerformanceCycle', '2028');

async function apply(gw: DataGateway, actor: Id, plan: GoalPlan, templateName: RegExp, owner: Id | null, dates: { startDate: string; dueDate: string }) {
  const template = (await gw.library.listKpiTemplates(S)).find((t) => templateName.test(t.name) && t.status === 'Active');
  if (!template) throw new Error(`no Active template ${templateName}`);
  const items = (await gw.library.listKpiTemplateItems(S)).filter((i) => i.templateId === template.id);
  const kpis = await gw.library.listKpiDefinitions(S);
  const existing = await gw.goals.listGoals(S, { goalPlanIds: [plan.id] });
  const result = templateApplication(items, kpis, existing, { goalPlanId: plan.id, ownerEmployeeId: owner, ...dates, firstSortOrder: nextSortOrder(existing) });
  for (const goal of result.toAdd) await gw.goals.saveGoal(S, actor, goal);
  return { result, items };
}

describe('applying a KPI template to a Goal Plan (BR-KPI-77)', () => {
  it('HR fills a new Draft department plan from the department\'s template; applying it again adds nothing', async () => {
    const { gateway } = newGateway();
    const plan = await gateway.goals.createGoalPlan(S, hr, { cycleId: cycle2028, planType: 'KPI', ownerType: 'OrgUnit', ownerOrgUnitId: SYNTRA.unit('KDBH'), ownerEmployeeId: null });
    const dates = { startDate: '2028-01-01', dueDate: '2028-12-31' };
    const { result } = await apply(gateway, hr, plan, /Kinh doanh/, emp('E006'), dates);
    expect(result.toAdd.length).toBeGreaterThan(0);
    const goals = await gateway.goals.listGoals(S, { goalPlanIds: [plan.id] });
    expect(goals).toHaveLength(result.toAdd.length);
    expect(goals.every((g) => g.status === 'Active' && g.ownerEmployeeId === emp('E006') && g.dataSourceId !== null && g.startDate === '2028-01-01')).toBe(true);
    expect(goals.map((g) => g.sortOrder).sort((a, b) => a - b)).toEqual(result.toAdd.map((_, i) => i));

    const again = await apply(gateway, hr, plan, /Kinh doanh/, emp('E006'), dates);
    expect(again.result.toAdd).toEqual([]);
    expect(again.result.rows.every((r) => r.skip !== null)).toBe(true);
  });

  it('the manager applies it at registration step 1 of a new hire\'s plan; the employee cannot write before step 2', async () => {
    const { gateway } = newGateway();
    const plan = (await gateway.goals.listGoalPlans(S, { cycleId: cycle2027 })).find((p) => p.ownerEmployeeId === emp('E018')) as GoalPlan;
    expect(plan.status).toBe('Draft');
    const dates = { startDate: '2027-01-01', dueDate: '2027-12-31' };
    const template = (await gateway.library.listKpiTemplates(S)).find((t) => /Kinh doanh/.test(t.name) && t.status === 'Active');
    const items = (await gateway.library.listKpiTemplateItems(S)).filter((i) => i.templateId === template?.id);
    const kpis = await gateway.library.listKpiDefinitions(S);
    const draft = templateApplication(items, kpis, [], { goalPlanId: plan.id, ownerEmployeeId: emp('E018'), ...dates, firstSortOrder: 0 });
    expect((await rejection(gateway.goals.saveGoal(S, u('E018'), draft.toAdd[0]))).code).toBe('ERR-KPI-05');

    const { result } = await apply(gateway, u('E006'), plan, /Kinh doanh/, emp('E018'), dates);
    expect(await gateway.goals.listGoals(S, { goalPlanIds: [plan.id] })).toHaveLength(result.toAdd.length);
  });
});
