import {
  ROLE_CODES,
  ROLE_LABEL,
  type CalcMethod,
  type DataSource,
  type FormType,
  type Goal,
  type GoalPlan,
  type Id,
  type KpiDefinition,
  type RatingLevel,
  type Role,
  type RoleCode,
  type WorkflowStep,
} from '@/data/types';
import { defaultRolePermissionRows } from '@/lib/permissionRules';
import { DEFAULT_WORK_SCORING } from '@/lib/workRules';
import {
  CALC_METHODS,
  DATA_SOURCES,
  KPIS,
  NOTIFICATION_TEXTS,
  PERSPECTIVES,
  RATING_LEVELS,
  TEMPLATES,
  UNITS,
  WORKFLOWS,
  type KpiSpec,
} from './catalog';
import type { idsFor } from './ids';
import { emptyCollections, type CollectionData, type CollectionName, type RowOf } from './types';

/** Collects one tenant's rows. */
export class SeedRows {
  readonly rows: CollectionData = emptyCollections();

  constructor(readonly tenantId: Id) {}

  add<C extends CollectionName>(c: C, row: Omit<RowOf<C>, 'tenantId'>): RowOf<C> {
    const full = { ...row, tenantId: this.tenantId } as RowOf<C>;
    (this.rows[c] as RowOf<C>[]).push(full);
    return full;
  }
}

export type IdFn = ReturnType<typeof idsFor>;

// ─── Roles (Phase 1.3: six per tenant, permissions from the default matrix) ────────────────────

export function addRoles(s: SeedRows, id: IdFn): Record<RoleCode, Role> {
  const roles = Object.fromEntries(
    ROLE_CODES.map((code) => [code, s.add('Role', { id: id('Role', code), code, name: ROLE_LABEL[code] })]),
  ) as Record<RoleCode, Role>;
  for (const row of defaultRolePermissionRows(s.tenantId, Object.values(roles))) s.add('RolePermission', row);
  return roles;
}

// ─── Library ───────────────────────────────────────────────────────────────────────────────────

export interface Library {
  perspectiveId(code: string): Id;
  unitId(code: string): Id;
  method(code: string): CalcMethod;
  source(code: string): DataSource;
  kpi(code: string): KpiDefinition;
  spec(code: string): KpiSpec;
}

export function addLibrary(
  s: SeedRows,
  id: IdFn,
  options: { unitIdOf: (unitCode: string) => Id | null; kpiCodes?: ReadonlySet<string>; templateCodes?: ReadonlySet<string> },
): Library {
  for (const p of PERSPECTIVES) s.add('BscPerspective', { id: id('BscPerspective', p.code), ...p });
  for (const u of UNITS) s.add('MeasureUnit', { id: id('MeasureUnit', u.code), ...u });

  const methods = new Map<string, CalcMethod>();
  for (const m of CALC_METHODS) {
    const row = s.add('CalcMethod', {
      id: id('CalcMethod', m.code),
      code: m.code,
      name: m.name,
      methodType: m.methodType,
      formulaExpr: null,
      capPct: m.capPct,
      floorPct: m.floorPct,
      description: m.description,
    });
    methods.set(m.code, row);
    (m.tiers ?? []).forEach(([fromValue, toValue, achievementPct], i) =>
      s.add('CalcTier', { id: id('CalcTier', m.code, i), calcMethodId: row.id, fromValue, toValue, achievementPct }),
    );
  }

  const sources = new Map<string, DataSource>();
  for (const d of DATA_SOURCES) {
    sources.set(
      d.code,
      s.add('DataSource', {
        id: id('DataSource', d.code),
        code: d.code,
        name: d.name,
        sourceType: d.sourceType,
        ownerOrgUnitId: d.ownerUnit ? options.unitIdOf(d.ownerUnit) : null,
      }),
    );
  }

  const kpis = new Map<string, KpiDefinition>();
  const specs = new Map<string, KpiSpec>();
  for (const k of KPIS) {
    if (options.kpiCodes && !options.kpiCodes.has(k.code)) continue;
    specs.set(k.code, k);
    kpis.set(
      k.code,
      s.add('KpiDefinition', {
        id: id('KpiDefinition', k.code),
        code: k.code,
        name: k.name,
        perspectiveId: id('BscPerspective', k.perspective),
        unitId: id('MeasureUnit', k.unit),
        calcMethodId: id('CalcMethod', k.method),
        defaultDataSourceId: id('DataSource', k.source),
        definition: k.definition,
        formulaText: k.formula,
        frequency: 'Month',
        aggregation: k.aggregation,
        isSystem: true,
        categoryTag: k.tag,
        status: k.status ?? 'Active',
      }),
    );
  }

  for (const t of TEMPLATES) {
    if (options.templateCodes && !options.templateCodes.has(t.code)) continue;
    const template = s.add('KpiTemplate', {
      id: id('KpiTemplate', t.code),
      name: t.name,
      orgUnitId: t.unit ? options.unitIdOf(t.unit) : null,
      positionId: null,
      status: 'Active',
    });
    for (const [kpiCode, defaultWeight, defaultTarget] of t.items) {
      if (!kpis.has(kpiCode)) continue;
      s.add('KpiTemplateItem', { id: id('KpiTemplateItem', t.code, kpiCode), templateId: template.id, kpiDefId: id('KpiDefinition', kpiCode), defaultWeight, defaultTarget });
    }
  }

  const need = <T>(map: Map<string, T>, code: string, what: string): T => {
    const v = map.get(code);
    if (!v) throw new Error(`seed: unknown ${what} ${code}`);
    return v;
  };
  return {
    perspectiveId: (code) => id('BscPerspective', code),
    unitId: (code) => id('MeasureUnit', code),
    method: (code) => need(methods, code, 'calc method'),
    source: (code) => need(sources, code, 'data source'),
    kpi: (code) => need(kpis, code, 'KPI'),
    spec: (code) => need(specs, code, 'KPI'),
  };
}

// ─── Monthly work scoring (PEND-14, ASSUMPTION Q62: CMC's 70 / 30 / 80 on a 0–100 scale) ──────

export function addWorkScoring(s: SeedRows, id: IdFn): void {
  s.add('WorkScoringConfig', { id: id('WorkScoringConfig'), ...DEFAULT_WORK_SCORING });
}

// ─── Workflows ─────────────────────────────────────────────────────────────────────────────────

export interface Workflows {
  id(type: FormType): Id;
  /** Step `n` (1-based) of the default workflow of `type`. */
  step(type: FormType, n: number): WorkflowStep;
}

export function addWorkflows(s: SeedRows, id: IdFn): Workflows {
  const steps = new Map<FormType, WorkflowStep[]>();
  for (const w of WORKFLOWS) {
    const workflowId = id('WorkflowTemplate', w.key);
    s.add('WorkflowTemplate', { id: workflowId, formType: w.key, name: w.name, isDefault: true });
    steps.set(
      w.key,
      w.steps.map((step, i) =>
        s.add('WorkflowStep', {
          id: id('WorkflowStep', w.key, i + 1),
          workflowId,
          stepNo: i + 1,
          name: step.name,
          actorRule: step.actorRule,
          actorRoleId: null,
          allowedActions: step.allowedActions,
          returnToStepNo: null,
          slaDays: step.slaDays,
          onOverdue: step.onOverdue,
          remindDaysBefore: step.remindDaysBefore,
          evaluationColumn: step.evaluationColumn,
          requiresComment: step.requiresComment,
        }),
      ),
    );
  }
  return {
    id: (type) => id('WorkflowTemplate', type),
    step: (type, n) => {
      const step = steps.get(type)?.[n - 1];
      if (!step) throw new Error(`seed: no step ${n} in ${type}`);
      return step;
    },
  };
}

// ─── Rating scale and payout (ASSUMPTION Q2) ───────────────────────────────────────────────────

export function addRating(s: SeedRows, id: IdFn, effectiveFrom: string): { scaleId: Id; level(code: string): RatingLevel } {
  const scaleId = id('RatingScale', 'SAMPLE');
  s.add('RatingScale', { id: scaleId, name: 'Thang mẫu A+/A/B/C/D (giả định Q2)', status: 'Active' });
  const levels = new Map<string, RatingLevel>();
  RATING_LEVELS.forEach((l, i) => {
    levels.set(
      l.code,
      s.add('RatingLevel', { id: id('RatingLevel', l.code), ratingScaleId: scaleId, code: l.code, label: l.label, minScore: l.min, maxScore: l.max, sortOrder: i + 1 }),
    );
    s.add('PayoutRule', {
      id: id('PayoutRule', 'ALL', l.code),
      ratingScaleId: scaleId,
      ratingLevelId: id('RatingLevel', l.code),
      appliesTo: 'All',
      orgUnitId: null,
      positionId: null,
      payoutPct: l.payout,
      effectiveFrom,
    });
  });
  return {
    scaleId,
    level: (code) => {
      const level = levels.get(code);
      if (!level) throw new Error(`seed: unknown rating level ${code}`);
      return level;
    },
  };
}

export function addNotificationTemplates(s: SeedRows, id: IdFn): (event: string, channel?: string) => Id {
  for (const t of NOTIFICATION_TEXTS) {
    s.add('NotificationTemplate', { id: id('NotificationTemplate', t.event, t.channel), eventCode: t.event, channel: t.channel, language: 'vi', subject: t.subject, body: t.body });
  }
  return (event, channel = 'InApp') => id('NotificationTemplate', event, channel);
}

// ─── Goals ─────────────────────────────────────────────────────────────────────────────────────

export interface GoalOptions {
  weight: number;
  target: number | null;
  targetText?: string | null;
  kgiId?: Id | null;
  ownerEmployeeId: Id | null;
  /** Override the library's method (LEVELS is set per assigned goal, D1). */
  method?: string;
  selfAssignedValue?: number | null;
  visibility?: Goal['visibility'];
  status?: Goal['status'];
  replacesGoalId?: Id | null;
  startDate: string;
  dueDate: string;
}

/** A goal picked from the library: name, description, perspective, unit, method and source inherited. */
export function goalFromKpi(lib: Library, plan: GoalPlan, goalId: Id, kpiCode: string, sortOrder: number, o: GoalOptions): Omit<Goal, 'tenantId'> {
  const spec = lib.spec(kpiCode);
  const kpi = lib.kpi(kpiCode);
  const textual = spec.targetType === 'TEXT';
  return {
    id: goalId,
    goalPlanId: plan.id,
    kgiId: o.kgiId ?? null,
    kpiDefId: kpi.id,
    name: kpi.name,
    description: kpi.definition,
    formulaText: kpi.formulaText,
    perspectiveId: kpi.perspectiveId,
    kriType: null, // D4: hidden until Q6
    visibility: o.visibility ?? 'PUBLIC',
    unitId: kpi.unitId,
    calcMethodId: o.method ? lib.method(o.method).id : kpi.calcMethodId,
    dataSourceId: kpi.defaultDataSourceId as Id,
    weight: o.weight,
    targetType: textual ? 'TEXT' : 'NUMERIC',
    targetValue: textual ? null : o.target,
    targetText: textual ? (o.targetText ?? 'Đạt') : null,
    selfAssignedValue: o.selfAssignedValue ?? null,
    rollUpFromChildren: false,
    startDate: o.startDate,
    dueDate: o.dueDate,
    ownerEmployeeId: o.ownerEmployeeId,
    status: o.status ?? 'Active',
    replacesGoalId: o.replacesGoalId ?? null,
    sortOrder,
  };
}
