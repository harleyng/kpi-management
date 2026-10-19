/**
 * The actuals import (WBS 4.4.3, plan §5.3 as corrected by the source check) — BR-KPI-53.
 *
 * CMC exports the goal list, HR fills the result and imports it back keyed by the assigned goal's id
 * (HR guide pp. 77–80). Syntra keeps that key and adds three things of its own (product decision,
 * Phase 1 of T4): `Tên đăng nhập` + `Mã KPI` as a fallback key for a file not made from the export;
 * `Kỳ`, because actuals here are per month; `Ghi chú` and `Link bằng chứng`.
 */

import type {
  ActualImportRow,
  CyclePeriod,
  Employee,
  Goal,
  GoalActual,
  GoalPeriodTarget,
  GoalPlan,
  Id,
  ImportRowError,
  IsoDate,
  KpiDefinition,
  MeasureUnit,
  PeriodResult,
  UserAccount,
} from '@/data/types';
import { actualIssues, currentActual, isEvidenceUrl, isResultFinalised, PLAN_STATUSES_TAKING_ACTUALS, VALUE_ISSUES } from './actualRules';
import { targetForPeriod } from './calcRules';
import type { IssueDetail } from './errorCatalog';
import { DEFAULT_MAX_ROWS, importError, type ImportColumn, type ImportTemplateSpec, type ParsedCell } from './importRules';

/** The columns, in template order. Headers are what the file says; `id` is what the code reads. */
export const ACTUAL_COLUMNS = {
  goalId: { id: 'goalId', header: 'Mã chỉ tiêu được giao', kind: 'text', required: false, width: 38, hint: 'Mã do hệ thống cấp, có sẵn trong tệp mẫu. Bỏ trống thì phải có Tên đăng nhập và Mã KPI.' },
  login: { id: 'login', header: 'Tên đăng nhập', kind: 'text', required: false, width: 16, hint: 'Tên đăng nhập của người được giao chỉ tiêu. Dùng cùng Mã KPI khi không có mã chỉ tiêu được giao.' },
  employee: { id: 'employee', header: 'Nhân viên', kind: 'info', required: false, width: 24, hint: 'Chỉ để tham khảo, không đọc khi tải lên.' },
  kpiCode: { id: 'kpiCode', header: 'Mã KPI', kind: 'text', required: false, width: 18, hint: 'Mã chỉ tiêu trong thư viện KPI.' },
  goalName: { id: 'goalName', header: 'Tên chỉ tiêu', kind: 'info', required: false, width: 36, hint: 'Chỉ để tham khảo, không đọc khi tải lên.' },
  unit: { id: 'unit', header: 'Đơn vị đo', kind: 'info', required: false, width: 10, hint: 'Chỉ để tham khảo. Chỉ tiêu % ghi 85 cho 85%.' },
  period: { id: 'period', header: 'Kỳ', kind: 'text', required: true, width: 8, hint: 'Nhãn kỳ tháng trong chu kỳ của lô, ví dụ T03.' },
  target: { id: 'target', header: 'Mục tiêu kỳ', kind: 'info', required: false, width: 14, hint: 'Chỉ để tham khảo, không đọc khi tải lên.' },
  actualValue: { id: 'actualValue', header: 'Giá trị thực tế', kind: 'number', required: false, width: 16, hint: 'Chỉ tiêu dạng số: một số (được phép âm). Bỏ trống nếu là chỉ tiêu dạng chữ.' },
  actualText: { id: 'actualText', header: 'Giá trị dạng chữ', kind: 'text', required: false, width: 16, hint: 'Chỉ tiêu dạng chữ: ví dụ Đạt hoặc Không đạt. Bỏ trống nếu là chỉ tiêu dạng số.' },
  note: { id: 'note', header: 'Ghi chú', kind: 'text', required: false, width: 24, hint: 'Không bắt buộc.' },
  evidenceUrl: { id: 'evidenceUrl', header: 'Link bằng chứng', kind: 'text', required: false, width: 32, hint: 'Không bắt buộc. Một đường dẫn http:// hoặc https://.' },
} as const satisfies Record<string, ImportColumn>;

const text = (v: ParsedCell) => (v === null ? null : String(v));

export const ACTUAL_IMPORT_SPEC: ImportTemplateSpec<'Actual'> = {
  importType: 'Actual',
  sheetName: 'So lieu thuc te',
  fileName: 'mau-import-so-thuc-te',
  columns: Object.values(ACTUAL_COLUMNS),
  maxRows: DEFAULT_MAX_ROWS,
  toRow: (cells, rowNo): ActualImportRow => ({
    rowNo,
    goalId: text(cells.goalId),
    login: text(cells.login),
    kpiCode: text(cells.kpiCode),
    periodLabel: text(cells.period) ?? '',
    actualValue: typeof cells.actualValue === 'number' ? cells.actualValue : null,
    actualText: text(cells.actualText),
    note: text(cells.note),
    evidenceUrl: text(cells.evidenceUrl),
  }),
};

// ─── Resolving and validating rows ───────────────────────────────────────────────────────────────

/** What the rows are checked against — every list already limited to the batch's tenant. */
export interface ActualImportContext {
  /** The batch's cycle: period labels and goals resolve in it. */
  cycleId: Id;
  goals: readonly Pick<Goal, 'id' | 'goalPlanId' | 'kpiDefId' | 'ownerEmployeeId' | 'status' | 'targetType'>[];
  plans: readonly Pick<GoalPlan, 'id' | 'cycleId' | 'status'>[];
  periods: readonly Pick<CyclePeriod, 'id' | 'cycleId' | 'label' | 'isLocked' | 'startDate' | 'periodType'>[];
  users: readonly Pick<UserAccount, 'login' | 'employeeId'>[];
  kpiDefinitions: readonly Pick<KpiDefinition, 'id' | 'code'>[];
  results: readonly Pick<PeriodResult, 'goalPlanId' | 'periodId' | 'status'>[];
  /** Today in the tenant's zone. */
  asOf: IsoDate;
}

/** A row that passed: what the commit writes. */
export interface ResolvedActualRow {
  rowNo: number;
  goalId: Id;
  periodId: Id;
  actualValue: number | null;
  actualText: string | null;
  note: string | null;
  evidenceUrl: string | null;
}

const C = ACTUAL_COLUMNS;
const norm = (s: string) => s.trim().toLowerCase();

/** The column an `actualIssues` detail is about, so the preview marks the right cell. */
function columnOf(detail: string | null, targetType: Goal['targetType']): string | null {
  if (detail !== null && VALUE_ISSUES.includes(detail as IssueDetail)) return targetType === 'TEXT' ? C.actualText.header : C.actualValue.header;
  if (detail === 'PLAN_NOT_APPROVED' || detail === 'GOAL_NOT_ACTIVE') return C.goalId.header;
  return C.period.header;
}

export interface RowResolution {
  goalId: Id | null;
  periodId: Id | null;
  errors: ImportRowError[];
}

/**
 * Which goal and period a row names — never guessed:
 * - `Mã chỉ tiêu được giao` unknown in the tenant (another tenant's id answers the same) →
 *   GOAL_NOT_FOUND; a goal of another cycle → GOAL_NOT_IN_CYCLE;
 * - `Tên đăng nhập` + `Mã KPI`: an unknown login → USER_NOT_FOUND, an unknown code → KPI_NOT_FOUND;
 *   the person's Active goals with that KPI in the cycle: none → GOAL_NOT_FOUND (or GOAL_NOT_ACTIVE when
 *   only a Changed / Cancelled one exists), two or more → GOAL_AMBIGUOUS; only one of the two given
 *   (and no goal id) → GOAL_KEY_REQUIRED;
 * - both keys resolving to different goals → GOAL_KEY_CONFLICT;
 * - `Kỳ` not a period label of the batch's cycle → PERIOD_NOT_FOUND.
 */
export function resolveActualRow(row: ActualImportRow, ctx: Pick<ActualImportContext, 'cycleId' | 'goals' | 'plans' | 'periods' | 'users' | 'kpiDefinitions'>): RowResolution {
  const errors: ImportRowError[] = [];
  const err = (column: string | null, detail: IssueDetail) => errors.push(importError(row.rowNo, column, detail));
  const planCycle = new Map(ctx.plans.map((p) => [p.id, p.cycleId]));
  const inCycle = (g: { goalPlanId: Id }) => planCycle.get(g.goalPlanId) === ctx.cycleId;

  let byId: Id | null = null;
  if (row.goalId !== null) {
    const wanted = row.goalId.trim();
    const goal = ctx.goals.find((g) => g.id === wanted);
    if (!goal) err(C.goalId.header, 'GOAL_NOT_FOUND');
    else if (!inCycle(goal)) err(C.goalId.header, 'GOAL_NOT_IN_CYCLE');
    else byId = goal.id;
  }

  let byKey: Id | null = null;
  const hasLogin = row.login !== null;
  const hasKpi = row.kpiCode !== null;
  if (hasLogin || hasKpi) {
    if (hasLogin !== hasKpi) {
      if (row.goalId === null) err(hasLogin ? C.kpiCode.header : C.login.header, 'GOAL_KEY_REQUIRED');
    } else {
      const user = ctx.users.find((u) => norm(u.login) === norm(row.login as string));
      const def = ctx.kpiDefinitions.find((k) => norm(k.code) === norm(row.kpiCode as string));
      if (!user || user.employeeId === null) err(C.login.header, 'USER_NOT_FOUND');
      if (!def) err(C.kpiCode.header, 'KPI_NOT_FOUND');
      if (user?.employeeId && def) {
        const candidates = ctx.goals.filter((g) => g.ownerEmployeeId === user.employeeId && g.kpiDefId === def.id && inCycle(g));
        const active = candidates.filter((g) => g.status === 'Active');
        if (active.length === 1) byKey = active[0].id;
        else if (active.length > 1) err(C.kpiCode.header, 'GOAL_AMBIGUOUS');
        else err(C.kpiCode.header, candidates.length > 0 ? 'GOAL_NOT_ACTIVE' : 'GOAL_NOT_FOUND');
      }
    }
  } else if (row.goalId === null) {
    err(C.goalId.header, 'GOAL_KEY_REQUIRED');
  }
  if (byId !== null && byKey !== null && byId !== byKey) err(C.goalId.header, 'GOAL_KEY_CONFLICT');

  const label = row.periodLabel.trim().toUpperCase();
  const period = ctx.periods.find((p) => p.cycleId === ctx.cycleId && p.label.toUpperCase() === label);
  if (!period) err(C.period.header, 'PERIOD_NOT_FOUND');

  const goalId = errors.some((e) => e.column !== C.period.header) ? null : (byId ?? byKey);
  return { goalId, periodId: period?.id ?? null, errors };
}

/**
 * Validates every row of an actuals batch (BR-KPI-53): `resolveActualRow`, then the very rule
 * `recordActual` applies (`actualIssues`, each issue on the cell it is about), the evidence link
 * (EVIDENCE_URL_INVALID), and — across the file — two rows naming the same goal and period
 * (DUPLICATE_ROW on every one of them). A row with no goal still reports a blank value
 * (ACTUAL_REQUIRED): every problem of a row is listed, not just the first.
 */
export function validateActualRows(rows: readonly ActualImportRow[], ctx: ActualImportContext): { errors: ImportRowError[]; resolved: ResolvedActualRow[] } {
  const errors: ImportRowError[] = [];
  const candidates: ResolvedActualRow[] = [];
  const goalById = new Map(ctx.goals.map((g) => [g.id, g]));
  const planById = new Map(ctx.plans.map((p) => [p.id, p]));
  const periodById = new Map(ctx.periods.map((p) => [p.id, p]));

  for (const row of rows) {
    const resolution = resolveActualRow(row, ctx);
    const rowErrors = [...resolution.errors];
    const actual = { actualValue: row.actualValue, actualText: row.actualText };
    const goal = resolution.goalId ? goalById.get(resolution.goalId) : undefined;
    const period = resolution.periodId ? periodById.get(resolution.periodId) : undefined;
    const plan = goal ? planById.get(goal.goalPlanId) : undefined;
    if (goal && plan && period) {
      for (const issue of actualIssues({
        actual,
        goal,
        planStatus: plan.status,
        goalCycleId: plan.cycleId,
        period,
        resultsFinalised: isResultFinalised(ctx.results, plan.id, period.id),
        asOf: ctx.asOf,
      })) {
        rowErrors.push({ rowNo: row.rowNo, column: columnOf(issue.detail, goal.targetType), code: issue.code, detail: issue.detail });
      }
    } else if (row.actualValue === null && (row.actualText === null || row.actualText.trim() === '')) {
      rowErrors.push(importError(row.rowNo, C.actualValue.header, 'ACTUAL_REQUIRED'));
    }
    if (row.evidenceUrl !== null && !isEvidenceUrl(row.evidenceUrl)) rowErrors.push(importError(row.rowNo, C.evidenceUrl.header, 'EVIDENCE_URL_INVALID'));

    errors.push(...rowErrors);
    if (resolution.goalId && resolution.periodId) {
      candidates.push({
        rowNo: row.rowNo,
        goalId: resolution.goalId,
        periodId: resolution.periodId,
        actualValue: row.actualValue,
        actualText: row.actualText === null || row.actualText.trim() === '' ? null : row.actualText.trim(),
        note: row.note,
        evidenceUrl: row.evidenceUrl === null ? null : row.evidenceUrl.trim(),
      });
    }
  }

  const count = new Map<string, number>();
  for (const r of candidates) count.set(`${r.goalId}|${r.periodId}`, (count.get(`${r.goalId}|${r.periodId}`) ?? 0) + 1);
  for (const r of candidates) if ((count.get(`${r.goalId}|${r.periodId}`) ?? 0) > 1) errors.push(importError(r.rowNo, null, 'DUPLICATE_ROW'));

  const bad = new Set(errors.map((e) => e.rowNo));
  errors.sort((a, b) => a.rowNo - b.rowNo);
  return { errors, resolved: candidates.filter((r) => !bad.has(r.rowNo)) };
}

// ─── Preview warnings (shown, never stored, never blocking) ──────────────────────────────────────

export interface ActualImportWarning {
  rowNo: number;
  detail: Extract<IssueDetail, 'OVERWRITES_ACTUAL' | 'PERCENT_SUSPECT'>;
  /** OVERWRITES_ACTUAL: the value that stops being current. */
  previous: Pick<GoalActual, 'actualValue' | 'actualText' | 'sourceType'> | null;
}

/**
 * What HR should look at before committing (hr-performance-expert review):
 * - OVERWRITES_ACTUAL — the goal already has a current actual for the period; the import replaces it
 *   (latest wins for a deliberate import, BR-KPI-56), history keeps the old one;
 * - PERCENT_SUSPECT — a % goal whose period target is above 1 got a value in (0, 1]: probably an Excel
 *   "85%" cell read as 0.85. The value is never rescaled.
 */
export function actualImportWarnings(
  rows: readonly ResolvedActualRow[],
  ctx: {
    goals: readonly Goal[];
    actuals: readonly GoalActual[];
    periodTargets: readonly GoalPeriodTarget[];
    units: readonly Pick<MeasureUnit, 'id' | 'code'>[];
  },
): ActualImportWarning[] {
  const goalById = new Map(ctx.goals.map((g) => [g.id, g]));
  const percentUnits = new Set(ctx.units.filter((u) => u.code === 'PCT').map((u) => u.id));
  const warnings: ActualImportWarning[] = [];
  for (const row of rows) {
    const previous = currentActual(ctx.actuals, row.goalId, row.periodId);
    if (previous) warnings.push({ rowNo: row.rowNo, detail: 'OVERWRITES_ACTUAL', previous });
    const goal = goalById.get(row.goalId);
    if (goal && percentUnits.has(goal.unitId) && row.actualValue !== null && row.actualValue > 0 && row.actualValue <= 1) {
      const target = targetForPeriod(goal, ctx.periodTargets, row.periodId);
      if (target !== null && target > 1) warnings.push({ rowNo: row.rowNo, detail: 'PERCENT_SUSPECT', previous: null });
    }
  }
  return warnings;
}

// ─── The pre-filled template ─────────────────────────────────────────────────────────────────────

/**
 * The template rows for one month: every Active goal of an Approved / Locked plan of the cycle (CMC's
 * "export the goal list, fill it, import it back", HR guide pp. 79–80), keyed by goal id, with the
 * person, KPI, unit and period target filled in for reference and the value columns left blank.
 * `includeGoal` narrows it (e.g. to goals fed by an Excel source). Ordered by owner, then goal order.
 */
export function actualTemplateRows(input: {
  period: Pick<CyclePeriod, 'id' | 'cycleId' | 'label'>;
  goals: readonly Goal[];
  plans: readonly Pick<GoalPlan, 'id' | 'cycleId' | 'status' | 'ownerType' | 'ownerEmployeeId' | 'ownerOrgUnitId'>[];
  employees: readonly Pick<Employee, 'id' | 'fullName' | 'employeeCode'>[];
  users: readonly Pick<UserAccount, 'login' | 'employeeId' | 'status'>[];
  kpiDefinitions: readonly Pick<KpiDefinition, 'id' | 'code'>[];
  units: readonly Pick<MeasureUnit, 'id' | 'name'>[];
  periodTargets: readonly GoalPeriodTarget[];
  ownerName: (plan: Pick<GoalPlan, 'ownerType' | 'ownerEmployeeId' | 'ownerOrgUnitId'>) => string;
  includeGoal?: (goal: Goal) => boolean;
}): Record<keyof typeof ACTUAL_COLUMNS, string | number | null>[] {
  const planById = new Map(input.plans.map((p) => [p.id, p]));
  const loginOf = new Map(input.users.filter((u) => u.employeeId !== null && u.status === 'Active').map((u) => [u.employeeId as Id, u.login]));
  const codeOf = new Map(input.kpiDefinitions.map((k) => [k.id, k.code]));
  const unitOf = new Map(input.units.map((u) => [u.id, u.name]));
  const rows = input.goals
    .filter((g) => {
      const plan = planById.get(g.goalPlanId);
      return g.status === 'Active' && plan !== undefined && plan.cycleId === input.period.cycleId && PLAN_STATUSES_TAKING_ACTUALS.includes(plan.status) && (input.includeGoal?.(g) ?? true);
    })
    .map((g) => {
      const plan = planById.get(g.goalPlanId) as GoalPlan;
      const owner = input.ownerName(plan);
      return {
        sortKey: `${owner}\u0000${String(g.sortOrder).padStart(4, '0')}`,
        row: {
          goalId: g.id,
          login: g.ownerEmployeeId ? (loginOf.get(g.ownerEmployeeId) ?? null) : null,
          employee: owner,
          kpiCode: g.kpiDefId ? (codeOf.get(g.kpiDefId) ?? null) : null,
          goalName: g.name,
          unit: unitOf.get(g.unitId) ?? null,
          period: input.period.label,
          target: g.targetType === 'TEXT' ? g.targetText : targetForPeriod(g, input.periodTargets, input.period.id),
          actualValue: null,
          actualText: null,
          note: null,
          evidenceUrl: null,
        },
      };
    });
  return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'vi')).map((r) => r.row);
}
