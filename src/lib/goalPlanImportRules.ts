/**
 * Goal Plan bulk import (WBS 4.3.7, plan §5.2) — the PURE part T3 owns: the template's columns, the
 * per-row checks and what a commit would write. The upload, preview and all-or-none commit are T4's
 * shared batch framework (WBS 4.4.3); `actuals.stageImport` / `commitImport` call these for
 * `importType: 'GoalPlan'`. BR-KPI-26.
 *
 * The validator reads nothing but `ctx` — the caller builds it from TENANT-FILTERED reads, so an id
 * or code of another tenant simply does not resolve (BR-KPI-50).
 */

import type {
  BscPerspective,
  CalcMethod,
  DataSource,
  Employee,
  Goal,
  GoalPlan,
  GoalTargetLevel,
  Id,
  ImportRowError,
  IsoDate,
  KpiDefinition,
  MeasureUnit,
  PerformanceCycle,
  TargetLevelCode,
  UserAccount,
  GoalPlanImportRow,
} from '@/data/types';
import { TARGET_LEVEL_CODES } from '@/data/types';
import type { ErrorCode } from './errorCatalog';
import { levelsMissingIssue, validateTargetLevels } from './calcRules';
import { GOAL_COUNT, isWeightComplete } from './goalPlanRules';
import { isIsoDate } from './isoDate';
import { foldDiacritics } from './utils';

/** One column of the template, in order — `header` is what the Excel file shows (Vietnamese). */
export interface ImportColumn {
  key: string;
  header: string;
  required: boolean;
}

/** Plan §5.2 (HR guide pp. 61–63, one goal per row). L1–L3 are pairs of (mục tiêu, điểm). */
export const GOAL_PLAN_IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'login', header: 'Tên đăng nhập', required: true },
  { key: 'perspectiveCode', header: 'Loại chỉ tiêu (FIN/CUS/PRO/LNG)', required: true },
  { key: 'goalName', header: 'Tên chỉ tiêu', required: true },
  { key: 'kpiCode', header: 'Mã KPI thư viện', required: false },
  { key: 'unitCode', header: 'Đơn vị đo', required: false },
  { key: 'calcMethodCode', header: 'Phương pháp tính', required: false },
  { key: 'dataSourceCode', header: 'Nguồn số liệu', required: false },
  { key: 'visibility', header: 'Hiển thị (PUBLIC/PRIVATE)', required: false },
  { key: 'weight', header: 'Trọng số (%)', required: true },
  { key: 'description', header: 'Mô tả', required: false },
  { key: 'startDate', header: 'Ngày bắt đầu', required: false },
  { key: 'dueDate', header: 'Ngày kết thúc', required: false },
  { key: 'targetType', header: 'Kiểu mục tiêu (NUMERIC/TEXT)', required: false },
  { key: 'targetValue', header: 'Mục tiêu (số)', required: false },
  { key: 'targetText', header: 'Mục tiêu (chữ)', required: false },
  ...TARGET_LEVEL_CODES.flatMap((code) => [
    { key: `${code}.target`, header: `${code} – mục tiêu`, required: false },
    { key: `${code}.score`, header: `${code} – điểm (%)`, required: false },
  ]),
];

const header = (key: string) => GOAL_PLAN_IMPORT_COLUMNS.find((c) => c.key === key)?.header ?? null;

/** Everything the rows resolve against — all of ONE tenant, read by the caller. */
export interface GoalPlanImportContext {
  cycle: Pick<PerformanceCycle, 'id' | 'startDate' | 'endDate' | 'status'>;
  /** Plans of the batch's cycle. */
  plans: readonly Pick<GoalPlan, 'id' | 'cycleId' | 'ownerType' | 'ownerEmployeeId' | 'status'>[];
  /** Goals of those plans (duplicates, the weight total). */
  goals: readonly Pick<Goal, 'goalPlanId' | 'name' | 'kpiDefId' | 'weight' | 'status'>[];
  accounts: readonly Pick<UserAccount, 'login' | 'employeeId' | 'status'>[];
  employees: readonly Pick<Employee, 'id' | 'employmentStatus' | 'leftOn'>[];
  perspectives: readonly Pick<BscPerspective, 'id' | 'code'>[];
  units: readonly Pick<MeasureUnit, 'id' | 'code'>[];
  methods: readonly Pick<CalcMethod, 'id' | 'code' | 'methodType'>[];
  dataSources: readonly Pick<DataSource, 'id' | 'code'>[];
  kpis: readonly Pick<KpiDefinition, 'id' | 'code' | 'name' | 'perspectiveId' | 'unitId' | 'calcMethodId' | 'defaultDataSourceId' | 'definition' | 'formulaText' | 'status'>[];
  today: IsoDate;
}

/** What committing one valid row writes: the goal (no id) and its levels. */
export interface ImportedGoal {
  rowNo: number;
  goal: Omit<Goal, 'id' | 'tenantId' | 'goalPlanId' | 'status' | 'replacesGoalId' | 'sortOrder'>;
  levels: Omit<GoalTargetLevel, 'id' | 'tenantId' | 'goalId'>[];
}

/**
 * The hand-off to T4's `commitImport` (system-architect, T3 design): per employee, the plan to add to
 * (`planId: null` = create it as Draft in the batch's cycle — the commit needs `goalplan.import`, which
 * HR holds) and the goals in file order. Import the TYPE; never redeclare it.
 */
export interface GoalPlanImportDraft {
  employeeId: Id;
  planId: Id | null;
  goals: ImportedGoal[];
}

const NUMERIC_ONLY = ['RATIO_UP', 'RATIO_DOWN', 'TIERED', 'FORMULA'] as const;
const norm = (s: string | null | undefined) => foldDiacritics((s ?? '').trim()).toLowerCase();
const byCode = <T extends { code: string }>(list: readonly T[], code: string | null) => (code ? list.find((x) => norm(x.code) === norm(code)) : undefined);

interface Resolved {
  row: GoalPlanImportRow;
  employeeId: Id;
  plan: GoalPlanImportContext['plans'][number] | undefined;
  imported: ImportedGoal;
}

/**
 * Per-row problems and per-plan warnings (BR-KPI-26). A row error stops the whole batch (T4 commits
 * all or none); a warning never does — the plan is completed afterwards and HR locks it.
 * Row errors (ERR-KPI-06 unless noted), `column` = the template header:
 * - login → an Active account of an employee still employed; perspective code known;
 * - a `kpiCode` that does not resolve; without one, unit / method / data source are required; every
 *   code given resolves; weight > 0; dates real, start ≤ due, inside the cycle (blank → cycle dates);
 * - the target matches its type; a TEXT target under a numeric-only method → `TARGET_TYPE_MISMATCH`;
 *   levels valid (`validateTargetLevels`, ERR-KPI-13; a LEVELS method needs ≥ 2);
 * - the same (login, goal name) or (login, library KPI) twice in the file or already in the plan →
 *   `DUPLICATE`; the employee's plan in the cycle is Locked → ERR-KPI-04 `PLAN_LOCKED`; the cycle is
 *   Closed → 04 `CYCLE_CLOSED`.
 * Warnings per plan (`rowNo` = its first row): Σ weight of its Active goals + the imported ones ≠
 * 100 ± 0.01 (ERR-KPI-07); a goal count outside 5–8 (ERR-KPI-08).
 */
export function goalPlanImportIssues(
  rows: readonly GoalPlanImportRow[],
  ctx: GoalPlanImportContext,
): { errors: ImportRowError[]; warnings: ImportRowError[]; resolved: Resolved[] } {
  const errors: ImportRowError[] = [];
  const resolved: Resolved[] = [];
  const seen = new Set<string>();
  const err = (rowNo: number, key: string | null, code: ErrorCode, detail: string) => errors.push({ rowNo, column: key ? header(key) : null, code, detail });

  for (const row of rows) {
    const before = errors.length;
    const r = row.rowNo;
    if (ctx.cycle.status === 'Closed') err(r, null, 'ERR-KPI-04', 'CYCLE_CLOSED');

    const account = ctx.accounts.find((a) => norm(a.login) === norm(row.login) && a.status === 'Active' && a.employeeId !== null);
    const employee = account ? ctx.employees.find((e) => e.id === account.employeeId) : undefined;
    const employed = employee && employee.employmentStatus !== 'Resigned' && (employee.leftOn === null || employee.leftOn >= ctx.today);
    if (!employee || !employed) err(r, 'login', 'ERR-KPI-06', 'LOGIN_UNKNOWN');

    const perspective = byCode(ctx.perspectives, row.perspectiveCode);
    if (!perspective) err(r, 'perspectiveCode', 'ERR-KPI-06', 'PERSPECTIVE_UNKNOWN');
    if (!row.goalName || row.goalName.trim() === '') err(r, 'goalName', 'ERR-KPI-06', 'NAME_REQUIRED');

    const kpi = row.kpiCode ? byCode(ctx.kpis, row.kpiCode) : undefined;
    if (row.kpiCode && (!kpi || kpi.status !== 'Active')) err(r, 'kpiCode', 'ERR-KPI-06', 'KPI_UNKNOWN');
    const pick = <T extends { id: Id; code: string }>(list: readonly T[], code: string | null, fallbackId: Id | null | undefined, key: string): T | undefined => {
      if (code) {
        const found = byCode(list, code);
        if (!found) err(r, key, 'ERR-KPI-06', 'CODE_UNKNOWN');
        return found;
      }
      const fallback = fallbackId ? list.find((x) => x.id === fallbackId) : undefined;
      if (!fallback) err(r, key, 'ERR-KPI-06', 'REQUIRED_WITHOUT_KPI');
      return fallback;
    };
    const unit = pick(ctx.units, row.unitCode, kpi?.unitId, 'unitCode');
    const method = pick(ctx.methods, row.calcMethodCode, kpi?.calcMethodId, 'calcMethodCode');
    const source = pick(ctx.dataSources, row.dataSourceCode, kpi?.defaultDataSourceId, 'dataSourceCode');

    if (row.weight === null || !Number.isFinite(row.weight) || row.weight <= 0) err(r, 'weight', 'ERR-KPI-06', 'WEIGHT_INVALID');
    const startDate = row.startDate ?? ctx.cycle.startDate;
    const dueDate = row.dueDate ?? ctx.cycle.endDate;
    if (!isIsoDate(startDate) || !isIsoDate(dueDate) || dueDate < startDate) err(r, 'dueDate', 'ERR-KPI-06', 'DATES_INVALID');
    else if (startDate < ctx.cycle.startDate || dueDate > ctx.cycle.endDate) err(r, 'dueDate', 'ERR-KPI-06', 'DATES_OUTSIDE_CYCLE');

    const targetType = row.targetType ?? 'NUMERIC';
    if (targetType === 'NUMERIC' ? row.targetValue === null || !Number.isFinite(row.targetValue) : !row.targetText || row.targetText.trim() === '') {
      err(r, targetType === 'NUMERIC' ? 'targetValue' : 'targetText', 'ERR-KPI-06', 'TARGET_REQUIRED');
    }
    if (method && targetType === 'TEXT' && (NUMERIC_ONLY as readonly string[]).includes(method.methodType)) err(r, 'calcMethodCode', 'ERR-KPI-06', 'TARGET_TYPE_MISMATCH');

    const levels = TARGET_LEVEL_CODES.flatMap((code, i): ImportedGoal['levels'] => {
      const cell = row.levels[i];
      return cell ? [{ levelCode: code as TargetLevelCode, targetValue: cell.targetValue, targetText: cell.targetText, scorePct: cell.scorePct ?? Number.NaN }] : [];
    });
    const levelIssues = validateTargetLevels(targetType, levels.map((l) => ({ ...l, id: l.levelCode, tenantId: '', goalId: '' })));
    if (levelIssues.length) err(r, 'L1.target', 'ERR-KPI-13', levelIssues[0].detail ?? 'LEVELS_INVALID');
    if (levelsMissingIssue(method?.methodType, levels.length, null)) err(r, 'L1.target', 'ERR-KPI-13', 'LEVELS_MISSING');

    const plan = employee ? ctx.plans.find((p) => p.cycleId === ctx.cycle.id && p.ownerType === 'Employee' && p.ownerEmployeeId === employee.id) : undefined;
    if (plan?.status === 'Locked') err(r, 'login', 'ERR-KPI-04', 'PLAN_LOCKED');
    if (employee && row.goalName) {
      const keys = [`n:${employee.id}:${norm(row.goalName)}`, ...(kpi ? [`k:${employee.id}:${kpi.id}`] : [])];
      const existing = plan
        ? ctx.goals.some((g) => g.goalPlanId === plan.id && g.status === 'Active' && (norm(g.name) === norm(row.goalName) || (kpi !== undefined && g.kpiDefId === kpi.id)))
        : false;
      if (existing || keys.some((k) => seen.has(k))) err(r, 'goalName', 'ERR-KPI-06', 'DUPLICATE');
      keys.forEach((k) => seen.add(k));
    }

    if (errors.length === before && employee && perspective && unit && method && source) {
      resolved.push({
        row,
        employeeId: employee.id,
        plan,
        imported: {
          rowNo: r,
          goal: {
            kgiId: null,
            kpiDefId: kpi?.id ?? null,
            name: row.goalName.trim(),
            description: row.description?.trim() || kpi?.definition || null,
            formulaText: kpi?.formulaText ?? null,
            perspectiveId: perspective.id,
            kriType: null,
            visibility: row.visibility ?? 'PUBLIC',
            unitId: unit.id,
            calcMethodId: method.id,
            dataSourceId: source.id,
            weight: row.weight as number,
            targetType,
            targetValue: targetType === 'NUMERIC' ? row.targetValue : null,
            targetText: targetType === 'TEXT' ? (row.targetText as string).trim() : null,
            selfAssignedValue: null,
            rollUpFromChildren: false,
            startDate,
            dueDate,
            ownerEmployeeId: employee.id,
          },
          levels,
        },
      });
    }
  }

  const warnings: ImportRowError[] = [];
  for (const [employeeId, list] of groupBy(resolved, (x) => x.employeeId)) {
    const plan = list[0].plan;
    const existing = plan ? ctx.goals.filter((g) => g.goalPlanId === plan.id && g.status === 'Active') : [];
    const total = existing.reduce((s, g) => s + g.weight, 0) + list.reduce((s, x) => s + x.imported.goal.weight, 0);
    const count = existing.length + list.length;
    const rowNo = list[0].row.rowNo;
    if (!isWeightComplete(total)) warnings.push({ rowNo, column: null, code: 'ERR-KPI-07', detail: `WEIGHT_TOTAL:${employeeId}:${Math.round(total * 100) / 100}` });
    if (count < GOAL_COUNT.min || count > GOAL_COUNT.max) warnings.push({ rowNo, column: null, code: 'ERR-KPI-08', detail: `GOAL_COUNT:${employeeId}:${count}` });
  }
  return { errors, warnings, resolved };
}

/** What a commit writes for a batch with NO row errors — `[]` otherwise (all or none). */
export function goalPlanImportDrafts(rows: readonly GoalPlanImportRow[], ctx: GoalPlanImportContext): GoalPlanImportDraft[] {
  const { errors, resolved } = goalPlanImportIssues(rows, ctx);
  if (errors.length) return [];
  return [...groupBy(resolved, (x) => x.employeeId)].map(([employeeId, list]) => ({
    employeeId,
    planId: list[0].plan?.id ?? null,
    goals: list.map((x) => x.imported),
  }));
}

function groupBy<T>(list: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const x of list) map.set(key(x), [...(map.get(key(x)) ?? []), x]);
  return map;
}
