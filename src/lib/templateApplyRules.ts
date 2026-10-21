/**
 * Applying a KPI template ("bộ mẫu", WBS 4.2.4) to a Goal Plan — "Thêm từ bộ mẫu" (BR-KPI-77). Which
 * templates to offer for a plan, and which goals applying one would add. Pure; the screen previews
 * exactly what the hook then saves, one `saveGoal` per goal (the gateway re-checks each write).
 */

import type { Goal, Id, IsoDate, KpiDefinition, KpiTemplate, KpiTemplateItem } from '@/data/types';
import { goalDraftFromKpi } from './formViewRules';
import { totalWeight } from './goalPlanRules';

// ─── Which templates to offer ──────────────────────────────────────────────────────────────────

export interface TemplateSuggestionContext {
  /** The plan's position, for an Employee plan: the owner's primary position; `null` for a unit plan. */
  positionId: Id | null;
  /** The plan's unit and the units above it, nearest first (`orgRules.unitAncestry`). */
  unitIds: readonly Id[];
}

/**
 * The tenant's ACTIVE templates for a plan, split in two. `suggested`: a template for the plan's
 * position, then one for its unit or a unit above it (nearest first), then the general ones (no unit,
 * no position). `others`: every other Active template, by name — still allowed, a template is a
 * starting point, not a rule. Draft and Archived templates are never offered.
 */
export function templatesForPlan(templates: readonly KpiTemplate[], ctx: TemplateSuggestionContext): { suggested: KpiTemplate[]; others: KpiTemplate[] } {
  const active = templates.filter((t) => t.status === 'Active');
  const rank = (t: KpiTemplate): number | null => {
    if (t.positionId !== null) return t.positionId === ctx.positionId ? 0 : null;
    if (t.orgUnitId !== null) {
      const i = ctx.unitIds.indexOf(t.orgUnitId);
      return i < 0 ? null : 1 + i;
    }
    return 1 + ctx.unitIds.length; // general
  };
  const byName = (a: KpiTemplate, b: KpiTemplate) => a.name.localeCompare(b.name, 'vi');
  const ranked = active.map((t) => ({ t, r: rank(t) }));
  const suggested = ranked
    .filter((x) => x.r !== null)
    .sort((a, b) => (a.r as number) - (b.r as number) || byName(a.t, b.t))
    .map((x) => x.t);
  const others = ranked
    .filter((x) => x.r === null)
    .map((x) => x.t)
    .sort(byName);
  return { suggested, others };
}

// ─── What applying one adds ────────────────────────────────────────────────────────────────────

/** Why a template item is not added. */
export type TemplateSkipReason = 'ALREADY_IN_PLAN' | 'KPI_NOT_ACTIVE' | 'NO_DATA_SOURCE';

/** A goal the template adds — `saveGoal`'s payload. */
export type TemplateGoalInput = Omit<Goal, 'id' | 'tenantId' | 'status' | 'replacesGoalId'>;

export interface TemplateApplicationFields {
  goalPlanId: Id;
  /** The plan's owner — the employee, or the unit head of a unit plan. */
  ownerEmployeeId: Id | null;
  /** The cycle's dates, as a new goal of the goal editor gets. */
  startDate: IsoDate;
  dueDate: IsoDate;
  /** `goalPlanRules.nextSortOrder` of the plan: added goals follow, in the template's order. */
  firstSortOrder: number;
}

export interface TemplateApplication {
  /** One row per template item, in the template's order — what the preview lists. */
  rows: { item: Pick<KpiTemplateItem, 'id' | 'kpiDefId' | 'defaultWeight' | 'defaultTarget'>; kpi: KpiDefinition | null; skip: TemplateSkipReason | null }[];
  toAdd: TemplateGoalInput[];
  /** Σ weight of the plan's Active goals once the goals are added — compared to 100% on Gửi (BR-KPI-04). */
  weightAfter: number;
  /** Active goals once added — 5–8 on Gửi (BR-KPI-03). */
  countAfter: number;
  /** Added goals still to complete before Gửi: no default target, or a 0% weight (BR-KPI-05, 04). */
  withoutTarget: number;
  zeroWeight: number;
}

/**
 * The goals applying `items` would add to a plan whose goals are `existing` (BR-KPI-77). Each item
 * becomes a goal through `formViewRules.goalDraftFromKpi` (name, perspective, unit, method, formula
 * and definition from the library KPI; PUBLIC; numeric) with the item's default weight and target and
 * the KPI's default data source. Never replaces: an item is skipped when the plan already has an
 * Active goal of that KPI (`ALREADY_IN_PLAN`), its KPI is no longer Active (`KPI_NOT_ACTIVE`), or the KPI
 * names no default data source — a goal cannot be saved without one, BR-KPI-05 (`NO_DATA_SOURCE`). A
 * KPI listed twice adds once. Totals are only reported: weight ≠ 100% and a count outside 5–8 are
 * fixed afterwards on the plan, where "Gửi" checks them (BR-KPI-77, `ASSUMPTION Q26`).
 */
export function templateApplication(
  items: readonly Pick<KpiTemplateItem, 'id' | 'kpiDefId' | 'defaultWeight' | 'defaultTarget'>[],
  kpis: readonly KpiDefinition[],
  existing: readonly Pick<Goal, 'kpiDefId' | 'status' | 'weight'>[],
  fields: TemplateApplicationFields,
): TemplateApplication {
  const inPlan = new Set(existing.filter((g) => g.status === 'Active' && g.kpiDefId !== null).map((g) => g.kpiDefId as Id));
  const rows: TemplateApplication['rows'] = [];
  const toAdd: TemplateGoalInput[] = [];
  for (const item of items) {
    const kpi = kpis.find((k) => k.id === item.kpiDefId) ?? null;
    let skip: TemplateSkipReason | null = null;
    if (inPlan.has(item.kpiDefId)) skip = 'ALREADY_IN_PLAN';
    else if (!kpi || kpi.status !== 'Active') skip = 'KPI_NOT_ACTIVE';
    else if (kpi.defaultDataSourceId === null) skip = 'NO_DATA_SOURCE';
    rows.push({ item, kpi, skip });
    if (skip || !kpi || kpi.defaultDataSourceId === null) continue;
    inPlan.add(kpi.id);
    const { targetLevels: _levels, ...draft } = goalDraftFromKpi(kpi, {
      weight: item.defaultWeight,
      targetValue: item.defaultTarget,
      dataSourceId: kpi.defaultDataSourceId,
      startDate: fields.startDate,
      dueDate: fields.dueDate,
      ownerEmployeeId: fields.ownerEmployeeId,
    });
    toAdd.push({ ...draft, goalPlanId: fields.goalPlanId, sortOrder: fields.firstSortOrder + toAdd.length });
  }
  const active = existing.filter((g) => g.status === 'Active');
  return {
    rows,
    toAdd,
    weightAfter: totalWeight(active) + toAdd.reduce((sum, g) => sum + g.weight, 0),
    countAfter: active.length + toAdd.length,
    withoutTarget: toAdd.filter((g) => g.targetValue === null).length,
    zeroWeight: toAdd.filter((g) => !(g.weight > 0)).length,
  };
}
