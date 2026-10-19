import {
  AGGREGATION_LABEL,
  AGGREGATIONS,
  KPI_CATEGORY_TAG_LABEL,
  KPI_CATEGORY_TAGS,
  KPI_FREQUENCIES,
  KPI_FREQUENCY_LABEL,
  LIBRARY_STATUS_LABEL,
  LIBRARY_STATUSES,
  type BscPerspective,
  type CalcMethod,
  type CalcTier,
  type DataSource,
  type Goal,
  type Id,
  type JobPosition,
  type KpiDefinition,
  type KpiTemplate,
  type KpiTemplateItem,
  type MeasureUnit,
  type OrgUnit,
} from '@/data/types';
import { ruleIssue, type RuleIssue } from './errorCatalog';
import { GOAL_COUNT, isWeightComplete } from './goalPlanRules';

/**
 * The KPI library's write rules (track T2, WBS 4.2.1–4.2.4) — BR-KPI-74…76 in business-rules.md §3b.
 *
 * Pure functions over plain rows: the mock reads what a rule needs inside its transaction and throws
 * the issues with `toKpiError`; a Phase 5 RPC reads the same rows and calls the same functions. The
 * screens call them too, to show a reason BEFORE a save is refused.
 *
 * An issue's `ref` names the payload FIELD it is about (`code`, `status`, `tiers`…) or, for a
 * template item, the item's `kpiDefId` — so a sheet can mark the field inline. `detail` is a stable
 * machine code; the copy lives on the screen and in the catalogue, never here.
 *
 * Updates only re-check what they change: the seed predates these rules (three Active templates hold
 * Draft KPIs or miss 100%), and editing an unrelated field of such a row must still save.
 */

// ─── Codes (BR-KPI-74) ─────────────────────────────────────────────────────────────────────────

/** Trimmed and upper-cased — the form every library code is stored and compared in. */
export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/** `CODE_REQUIRED` when blank, `CODE_TAKEN` when another row of the same catalogue has it (any case). */
export function codeIssues(code: string, otherCodes: readonly string[]): RuleIssue[] {
  const normal = normaliseCode(code);
  if (normal === '') return [ruleIssue('ERR-KPI-06', 'code', 'CODE_REQUIRED')];
  if (otherCodes.some((c) => normaliseCode(c) === normal)) return [ruleIssue('ERR-KPI-06', 'code', 'CODE_TAKEN', { code: normal })];
  return [];
}

function nameIssues(name: string): RuleIssue[] {
  return name.trim() === '' ? [ruleIssue('ERR-KPI-06', 'name', 'NAME_REQUIRED')] : [];
}

/** The other rows' codes — what `codeIssues` compares against (a row never collides with itself). */
export function otherCodesOf(rows: readonly { id: Id; code: string }[], selfId: Id | undefined): string[] {
  return rows.filter((r) => r.id !== selfId).map((r) => r.code);
}

// ─── Perspectives (BR-KPI-75) ──────────────────────────────────────────────────────────────────

type PerspectiveInput = Pick<BscPerspective, 'code' | 'name' | 'sortOrder'>;

/** The four BSC perspectives are fixed: rename and reorder only — never create one or change its code. */
export function perspectiveIssues(next: PerspectiveInput, stored: BscPerspective | null): RuleIssue[] {
  if (stored === null) return [ruleIssue('ERR-KPI-06', 'code', 'PERSPECTIVE_FIXED')];
  const issues: RuleIssue[] = [];
  if (next.code !== stored.code) issues.push(ruleIssue('ERR-KPI-06', 'code', 'CODE_LOCKED'));
  issues.push(...nameIssues(next.name));
  if (!Number.isInteger(next.sortOrder) || next.sortOrder < 0) issues.push(ruleIssue('ERR-KPI-06', 'sortOrder', 'SORT_ORDER_INVALID'));
  return issues;
}

// ─── Measure units (BR-KPI-74, 76) ─────────────────────────────────────────────────────────────

type UnitInput = Pick<MeasureUnit, 'code' | 'name' | 'decimals'>;

/** Most decimal places a unit may show — beyond that a figure is noise. */
export const MAX_UNIT_DECIMALS = 6;

/**
 * `inUse` = a library item, goal, KGI or pending proposal refers to the unit; then its code is
 * locked (exports and imports name it), while name and decimals — display only — stay editable.
 */
export function measureUnitIssues(
  next: UnitInput,
  stored: MeasureUnit | null,
  context: { otherCodes: readonly string[]; inUse: boolean },
): RuleIssue[] {
  const issues = [...codeIssues(next.code, context.otherCodes), ...nameIssues(next.name)];
  if (!Number.isInteger(next.decimals) || next.decimals < 0 || next.decimals > MAX_UNIT_DECIMALS) {
    issues.push(ruleIssue('ERR-KPI-06', 'decimals', 'DECIMALS_INVALID', { max: MAX_UNIT_DECIMALS }));
  }
  if (stored && context.inUse && normaliseCode(next.code) !== stored.code) issues.push(ruleIssue('ERR-KPI-04', 'code', 'UNIT_CODE_IN_USE'));
  return issues;
}

// ─── Calculation methods (BR-KPI-74, 76; BR-KPI-31 stays in calcRules.validateCalcMethod) ───────

type MethodInput = Pick<CalcMethod, 'code' | 'name' | 'methodType' | 'formulaExpr' | 'capPct' | 'floorPct'>;
type TierInput = Pick<CalcTier, 'fromValue' | 'toValue' | 'achievementPct'>;

const tierKey = (t: TierInput) => `${t.fromValue ?? '-∞'}|${t.toValue ?? '∞'}|${t.achievementPct}`;
const sameTiers = (a: readonly TierInput[], b: readonly TierInput[]) =>
  a.length === b.length && [...a.map(tierKey)].sort().join(';') === [...b.map(tierKey)].sort().join(';');

/** Whether a save would change how the method scores — type, cap, floor, formula or tiers (order ignored). */
export function methodScoringChanged(
  stored: MethodInput,
  storedTiers: readonly TierInput[],
  next: MethodInput,
  nextTiers: readonly TierInput[],
): boolean {
  return (
    stored.methodType !== next.methodType ||
    stored.capPct !== next.capPct ||
    stored.floorPct !== next.floorPct ||
    (stored.formulaExpr ?? null) !== (next.formulaExpr ?? null) ||
    !sameTiers(storedTiers, nextTiers)
  );
}

/**
 * What the library adds to `validateCalcMethod` (which the adapter runs too, between these and the
 * lock): code and name; fields a type does not read are refused rather than kept as dead data
 * (tiers only on TIERED, a formula only on FORMULA, no cap or floor on LEVELS — its ceiling is the
 * top level, BR-KPI-33); and `goalsUsing > 0` locks the scoring fields (BR-KPI-80), because a goal
 * reads its method LIVE (`Goal.calcMethodId`) — editing it would re-score every open period.
 * Returns `[...input issues, ...shape issues]` and, separately, the lock — the adapter puts the
 * lock LAST so a configuration problem is reported first.
 */
export function calcMethodIssues(
  next: MethodInput,
  nextTiers: readonly TierInput[],
  stored: CalcMethod | null,
  storedTiers: readonly TierInput[],
  context: { otherCodes: readonly string[]; goalsUsing: number },
): { issues: RuleIssue[]; lock: RuleIssue[] } {
  const issues = [...codeIssues(next.code, context.otherCodes), ...nameIssues(next.name)];
  if (next.methodType !== 'TIERED' && nextTiers.length > 0) issues.push(ruleIssue('ERR-KPI-13', 'tiers', 'TIERS_NOT_ALLOWED'));
  if (next.methodType !== 'FORMULA' && (next.formulaExpr ?? '').trim() !== '') issues.push(ruleIssue('ERR-KPI-13', 'formulaExpr', 'FORMULA_NOT_ALLOWED'));
  if (next.methodType === 'LEVELS' && (next.capPct !== null || next.floorPct !== null)) {
    issues.push(ruleIssue('ERR-KPI-13', next.capPct !== null ? 'capPct' : 'floorPct', 'LEVELS_NO_CAP'));
  }
  const lock =
    stored && context.goalsUsing > 0 && methodScoringChanged(stored, storedTiers, next, nextTiers)
      ? [ruleIssue('ERR-KPI-04', 'methodType', 'METHOD_IN_USE', { goals: context.goalsUsing })]
      : [];
  return { issues, lock };
}

// ─── KPI definitions (BR-KPI-74, 71, 72, 74, 75) ───────────────────────────────────────────────

type DefinitionInput = Pick<
  KpiDefinition,
  'code' | 'name' | 'perspectiveId' | 'unitId' | 'calcMethodId' | 'defaultDataSourceId' | 'frequency' | 'aggregation' | 'categoryTag' | 'status'
>;

/**
 * - code / name / perspective / unit / method / frequency / aggregation required (BR-KPI-74, 71);
 * - Active needs a default data source (BR-KPI-76, `ASSUMPTION Q25`);
 * - a standard item (`isSystem`) keeps its code (BR-KPI-79, `ASSUMPTION Q28`);
 * - leaving Active while an ACTIVE template holds it is refused, naming the templates (BR-KPI-78,
 *   `ASSUMPTION Q27`). Goals do not read the definition when they score, so archiving one that
 *   goals or API mappings use is allowed.
 */
export function kpiDefinitionIssues(
  next: DefinitionInput,
  stored: KpiDefinition | null,
  context: { otherCodes: readonly string[]; activeTemplatesContaining: readonly string[] },
): RuleIssue[] {
  const issues = [...codeIssues(next.code, context.otherCodes), ...nameIssues(next.name)];
  if (stored?.isSystem && normaliseCode(next.code) !== stored.code) issues.push(ruleIssue('ERR-KPI-06', 'code', 'SYSTEM_CODE_LOCKED'));
  if (!next.perspectiveId) issues.push(ruleIssue('ERR-KPI-06', 'perspectiveId', 'PERSPECTIVE_REQUIRED'));
  if (!next.unitId) issues.push(ruleIssue('ERR-KPI-06', 'unitId', 'UNIT_REQUIRED'));
  if (!next.calcMethodId) issues.push(ruleIssue('ERR-KPI-06', 'calcMethodId', 'METHOD_REQUIRED'));
  if (!KPI_FREQUENCIES.includes(next.frequency)) issues.push(ruleIssue('ERR-KPI-06', 'frequency', 'FREQUENCY_INVALID'));
  if (!AGGREGATIONS.includes(next.aggregation)) issues.push(ruleIssue('ERR-KPI-06', 'aggregation', 'AGGREGATION_INVALID'));
  if (next.categoryTag !== null && !KPI_CATEGORY_TAGS.includes(next.categoryTag)) issues.push(ruleIssue('ERR-KPI-06', 'categoryTag', 'CATEGORY_INVALID'));
  if (!LIBRARY_STATUSES.includes(next.status)) issues.push(ruleIssue('ERR-KPI-06', 'status', 'STATUS_INVALID'));
  if (next.status === 'Active' && !next.defaultDataSourceId) issues.push(ruleIssue('ERR-KPI-06', 'defaultDataSourceId', 'DATA_SOURCE_REQUIRED'));
  if (stored?.status === 'Active' && next.status !== 'Active' && context.activeTemplatesContaining.length > 0) {
    issues.push(ruleIssue('ERR-KPI-04', 'status', 'IN_ACTIVE_TEMPLATE', { templates: context.activeTemplatesContaining.join(', ') }));
  }
  return issues;
}

/** Names of the ACTIVE templates (other than `exceptTemplateId`) that hold `kpiDefId`. */
export function activeTemplatesContaining(
  kpiDefId: Id,
  templates: readonly Pick<KpiTemplate, 'id' | 'name' | 'status'>[],
  items: readonly Pick<KpiTemplateItem, 'templateId' | 'kpiDefId'>[],
): string[] {
  const holding = new Set(items.filter((i) => i.kpiDefId === kpiDefId).map((i) => i.templateId));
  return templates.filter((t) => t.status === 'Active' && holding.has(t.id)).map((t) => t.name);
}

// ─── Templates (BR-KPI-77, 74) ─────────────────────────────────────────────────────────────────

type TemplateInput = Pick<KpiTemplate, 'name' | 'orgUnitId' | 'positionId' | 'status'>;
type ItemInput = Pick<KpiTemplateItem, 'kpiDefId' | 'defaultWeight' | 'defaultTarget'>;

export interface TemplateCheck {
  /** Refused on save (ERR-KPI-06). */
  errors: RuleIssue[];
  /**
   * Shown, never refused (`ASSUMPTION Q26`): weight total off 100% (ERR-KPI-07 data `totalWeight`),
   * item count outside 5–8 (ERR-KPI-08 data `count`), a stored item whose KPI is no longer Active
   * (ref = kpiDefId, data `status`). The PLAN made from the template is still gated (BR-KPI-03/04).
   */
  warnings: RuleIssue[];
}

/** Σ default weights — the template footer's figure. */
export function templateWeightTotal(items: readonly Pick<ItemInput, 'defaultWeight'>[]): number {
  return items.reduce((sum, i) => sum + (Number.isFinite(i.defaultWeight) ? i.defaultWeight : 0), 0);
}

/**
 * `storedItemKpiIds` = the KPIs the template already held: only a NEW item must point at an Active
 * KPI (BR-KPI-78); an old one that has since been archived is a warning, so saving a seed template
 * unchanged always succeeds. A KPI id that does not resolve is left to the reference check.
 */
export function templateIssues(
  template: TemplateInput,
  items: readonly ItemInput[],
  definitions: ReadonlyMap<Id, Pick<KpiDefinition, 'status'>>,
  storedItemKpiIds: ReadonlySet<Id>,
): TemplateCheck {
  const errors: RuleIssue[] = [...nameIssues(template.name)];
  const warnings: RuleIssue[] = [];
  if (template.orgUnitId !== null && template.positionId !== null) errors.push(ruleIssue('ERR-KPI-06', 'appliesTo', 'UNIT_AND_POSITION'));
  if (!LIBRARY_STATUSES.includes(template.status)) errors.push(ruleIssue('ERR-KPI-06', 'status', 'STATUS_INVALID'));

  const seen = new Set<Id>();
  for (const item of items) {
    if (seen.has(item.kpiDefId)) errors.push(ruleIssue('ERR-KPI-06', item.kpiDefId, 'DUPLICATE_KPI'));
    seen.add(item.kpiDefId);
    if (!Number.isFinite(item.defaultWeight) || item.defaultWeight < 0) errors.push(ruleIssue('ERR-KPI-06', item.kpiDefId, 'WEIGHT_INVALID'));
    if (item.defaultTarget !== null && !Number.isFinite(item.defaultTarget)) errors.push(ruleIssue('ERR-KPI-06', item.kpiDefId, 'TARGET_INVALID'));
    const status = definitions.get(item.kpiDefId)?.status;
    if (status === undefined || status === 'Active') continue;
    if (storedItemKpiIds.has(item.kpiDefId)) warnings.push(ruleIssue('ERR-KPI-06', item.kpiDefId, 'INACTIVE_KPI', { status }));
    else errors.push(ruleIssue('ERR-KPI-06', item.kpiDefId, 'KPI_NOT_ACTIVE', { status }));
  }

  const totalWeight = templateWeightTotal(items);
  if (!isWeightComplete(totalWeight)) warnings.push(ruleIssue('ERR-KPI-07', null, 'WEIGHT_TOTAL', { totalWeight }));
  if (items.length < GOAL_COUNT.min || items.length > GOAL_COUNT.max) {
    warnings.push(ruleIssue('ERR-KPI-08', null, 'ITEM_COUNT', { count: items.length, min: GOAL_COUNT.min, max: GOAL_COUNT.max }));
  }
  return { errors, warnings };
}

// ─── Usage (advisory counts for the screens; the adapter's refusal is the authority) ───────────

export interface LibraryUsage {
  goalsByMethod: ReadonlyMap<Id, number>;
  goalsByKpi: ReadonlyMap<Id, number>;
  /** Goals and library items using each unit. */
  usesByUnit: ReadonlyMap<Id, number>;
}

function bump(map: Map<Id, number>, id: Id | null): void {
  if (id !== null) map.set(id, (map.get(id) ?? 0) + 1);
}

/** Every goal counts, whatever its status or cycle — a closed cycle's goals still read their method. */
export function libraryUsage(
  goals: readonly Pick<Goal, 'calcMethodId' | 'kpiDefId' | 'unitId'>[],
  definitions: readonly Pick<KpiDefinition, 'unitId'>[],
): LibraryUsage {
  const goalsByMethod = new Map<Id, number>();
  const goalsByKpi = new Map<Id, number>();
  const usesByUnit = new Map<Id, number>();
  for (const g of goals) {
    bump(goalsByMethod, g.calcMethodId);
    bump(goalsByKpi, g.kpiDefId);
    bump(usesByUnit, g.unitId);
  }
  for (const d of definitions) bump(usesByUnit, d.unitId);
  return { goalsByMethod, goalsByKpi, usesByUnit };
}

// ─── Export (WBS 4.2.5) — rows in the column order the Library import will read (T4) ───────────

export interface ExportColumn<K extends string> {
  key: K;
  header: string;
  /** Character width hint for the sheet. */
  width: number;
}

export const LIBRARY_EXPORT_COLUMNS = [
  { key: 'code', header: 'Mã chỉ tiêu', width: 18 },
  { key: 'name', header: 'Tên chỉ tiêu', width: 40 },
  { key: 'perspectiveCode', header: 'Mã viễn cảnh', width: 12 },
  { key: 'unitCode', header: 'Mã đơn vị đo', width: 12 },
  { key: 'calcMethodCode', header: 'Mã phương pháp tính', width: 18 },
  { key: 'definition', header: 'Định nghĩa', width: 40 },
  { key: 'formulaText', header: 'Công thức (diễn giải)', width: 40 },
  { key: 'frequency', header: 'Tần suất', width: 10 },
  { key: 'aggregation', header: 'Cách tổng hợp', width: 14 },
  { key: 'categoryTag', header: 'Nhóm phân loại', width: 14 },
  { key: 'dataSourceCode', header: 'Mã nguồn dữ liệu', width: 16 },
  { key: 'status', header: 'Trạng thái', width: 14 },
  { key: 'standard', header: 'Chuẩn', width: 8 },
] as const satisfies readonly ExportColumn<string>[];

export type LibraryExportRow = Record<(typeof LIBRARY_EXPORT_COLUMNS)[number]['key'], string | null>;

export interface LibraryCatalogues {
  perspectives: readonly Pick<BscPerspective, 'id' | 'code'>[];
  units: readonly Pick<MeasureUnit, 'id' | 'code'>[];
  methods: readonly Pick<CalcMethod, 'id' | 'code'>[];
  dataSources: readonly Pick<DataSource, 'id' | 'code'>[];
}

const codeById = (rows: readonly { id: Id; code: string }[]) => new Map(rows.map((r) => [r.id, r.code]));

/** Library items by code. References as CODES (they survive a move to another tenant); sets as their Vietnamese labels. */
export function libraryExportRows(definitions: readonly KpiDefinition[], catalogues: LibraryCatalogues): LibraryExportRow[] {
  const perspective = codeById(catalogues.perspectives);
  const unit = codeById(catalogues.units);
  const method = codeById(catalogues.methods);
  const source = codeById(catalogues.dataSources);
  return [...definitions]
    .sort((a, b) => a.code.localeCompare(b.code, 'vi'))
    .map((d) => ({
      code: d.code,
      name: d.name,
      perspectiveCode: perspective.get(d.perspectiveId) ?? null,
      unitCode: unit.get(d.unitId) ?? null,
      calcMethodCode: method.get(d.calcMethodId) ?? null,
      definition: d.definition,
      formulaText: d.formulaText,
      frequency: KPI_FREQUENCY_LABEL[d.frequency],
      aggregation: AGGREGATION_LABEL[d.aggregation],
      categoryTag: d.categoryTag === null ? null : KPI_CATEGORY_TAG_LABEL[d.categoryTag],
      dataSourceCode: d.defaultDataSourceId === null ? null : (source.get(d.defaultDataSourceId) ?? null),
      status: LIBRARY_STATUS_LABEL[d.status],
      standard: d.isSystem ? 'Có' : null,
    }));
}

export const TEMPLATE_EXPORT_COLUMNS = [
  { key: 'templateName', header: 'Tên bộ mẫu', width: 32 },
  { key: 'appliesTo', header: 'Áp dụng cho', width: 12 },
  { key: 'appliesToCode', header: 'Mã đơn vị / chức danh', width: 20 },
  { key: 'templateStatus', header: 'Trạng thái bộ mẫu', width: 16 },
  { key: 'kpiCode', header: 'Mã chỉ tiêu', width: 18 },
  { key: 'kpiName', header: 'Tên chỉ tiêu', width: 40 },
  { key: 'defaultWeight', header: 'Trọng số mặc định (%)', width: 12 },
  { key: 'defaultTarget', header: 'Mục tiêu mặc định', width: 14 },
] as const satisfies readonly ExportColumn<string>[];

export type TemplateExportRow = Record<(typeof TEMPLATE_EXPORT_COLUMNS)[number]['key'], string | number | null>;

/** Who a template is for — a unit, a position, or everyone (`ASSUMPTION Q26`'s companion: the ERD allows neither). */
export type TemplateAudience = 'OrgUnit' | 'Position' | 'General';
export const TEMPLATE_AUDIENCE_LABEL: Readonly<Record<TemplateAudience, string>> = {
  OrgUnit: 'Đơn vị',
  Position: 'Chức danh',
  General: 'Chung',
};

export function templateAudience(template: Pick<KpiTemplate, 'orgUnitId' | 'positionId'>): TemplateAudience {
  if (template.orgUnitId !== null) return 'OrgUnit';
  if (template.positionId !== null) return 'Position';
  return 'General';
}

/** One row per template item (a template without items still gets one row, so it is not lost). */
export function templateExportRows(
  templates: readonly KpiTemplate[],
  items: readonly KpiTemplateItem[],
  context: {
    definitions: readonly Pick<KpiDefinition, 'id' | 'code' | 'name'>[];
    orgUnits: readonly Pick<OrgUnit, 'id' | 'code'>[];
    positions: readonly Pick<JobPosition, 'id' | 'code'>[];
  },
): TemplateExportRow[] {
  const defs = new Map(context.definitions.map((d) => [d.id, d]));
  const units = codeById(context.orgUnits);
  const positions = codeById(context.positions);
  return [...templates]
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    .flatMap((t): TemplateExportRow[] => {
      const audience = templateAudience(t);
      const base = {
        templateName: t.name,
        appliesTo: TEMPLATE_AUDIENCE_LABEL[audience],
        appliesToCode:
          audience === 'OrgUnit' ? (units.get(t.orgUnitId as Id) ?? null) : audience === 'Position' ? (positions.get(t.positionId as Id) ?? null) : null,
        templateStatus: LIBRARY_STATUS_LABEL[t.status],
      };
      const own = items.filter((i) => i.templateId === t.id);
      if (own.length === 0) return [{ ...base, kpiCode: null, kpiName: null, defaultWeight: null, defaultTarget: null }];
      return own.map((i) => ({
        ...base,
        kpiCode: defs.get(i.kpiDefId)?.code ?? null,
        kpiName: defs.get(i.kpiDefId)?.name ?? null,
        defaultWeight: i.defaultWeight,
        defaultTarget: i.defaultTarget,
      }));
    });
}
