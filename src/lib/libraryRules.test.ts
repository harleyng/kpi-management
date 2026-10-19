import { describe, expect, it } from 'vitest';
import type { Id, KpiDefinition, LibraryStatus } from '@/data/types';
import { calcMethod, goal, kpiDefinition, kpiTemplate, measureUnit, perspective, templateItem, tier } from '@/test/builders';
import {
  activeTemplatesContaining,
  calcMethodIssues,
  codeIssues,
  kpiDefinitionIssues,
  libraryExportRows,
  libraryUsage,
  measureUnitIssues,
  methodScoringChanged,
  normaliseCode,
  otherCodesOf,
  perspectiveIssues,
  templateAudience,
  templateExportRows,
  templateIssues,
  templateWeightTotal,
} from './libraryRules';

const details = (issues: readonly { detail: string | null }[]) => issues.map((i) => i.detail);

describe('codes (BR-KPI-70)', () => {
  it('trims and upper-cases', () => {
    expect(normaliseCode('  kpi-1 ')).toBe('KPI-1');
  });

  it.each([[''], ['   ']])('refuses a blank code %j', (code) => {
    expect(details(codeIssues(code, []))).toEqual(['CODE_REQUIRED']);
  });

  it('refuses a duplicate that differs only by case or spaces', () => {
    const [issue] = codeIssues(' kpi-1', ['KPI-1']);
    expect(issue).toMatchObject({ code: 'ERR-KPI-06', ref: 'code', detail: 'CODE_TAKEN', data: { code: 'KPI-1' } });
  });

  it('excludes the row itself from the comparison', () => {
    const rows = [{ id: 'a', code: 'KPI-1' }, { id: 'b', code: 'KPI-2' }];
    expect(otherCodesOf(rows, 'a')).toEqual(['KPI-2']);
    expect(codeIssues('KPI-1', otherCodesOf(rows, 'a'))).toEqual([]);
    expect(otherCodesOf(rows, undefined)).toEqual(['KPI-1', 'KPI-2']);
  });
});

describe('perspectiveIssues (BR-KPI-71)', () => {
  it('refuses creating a perspective — the four are fixed', () => {
    expect(details(perspectiveIssues({ code: 'FIN', name: 'X', sortOrder: 1 }, null))).toEqual(['PERSPECTIVE_FIXED']);
  });

  it('refuses a code change, a blank name and a bad order', () => {
    const stored = perspective();
    expect(details(perspectiveIssues({ code: 'CUS', name: ' ', sortOrder: -1 }, stored))).toEqual(['CODE_LOCKED', 'NAME_REQUIRED', 'SORT_ORDER_INVALID']);
  });

  it('accepts a rename and a reorder', () => {
    expect(perspectiveIssues({ code: 'FIN', name: 'Tài chính & đầu tư', sortOrder: 4 }, perspective())).toEqual([]);
  });
});

describe('measureUnitIssues (BR-KPI-70, 76)', () => {
  const stored = measureUnit();
  const ok = { code: 'PCT', name: '%', decimals: 1 };

  it('refuses a code change while the unit is in use (ERR-KPI-04)', () => {
    const [issue] = measureUnitIssues({ ...ok, code: 'PERCENT' }, stored, { otherCodes: [], inUse: true });
    expect(issue).toMatchObject({ code: 'ERR-KPI-04', ref: 'code', detail: 'UNIT_CODE_IN_USE' });
  });

  it('allows a code change when unused, and a case-only edit when used', () => {
    expect(measureUnitIssues({ ...ok, code: 'PERCENT' }, stored, { otherCodes: [], inUse: false })).toEqual([]);
    expect(measureUnitIssues({ ...ok, code: 'pct' }, stored, { otherCodes: [], inUse: true })).toEqual([]);
  });

  it('allows name and decimals changes while in use (display only)', () => {
    expect(measureUnitIssues({ code: 'PCT', name: 'phần trăm', decimals: 0 }, stored, { otherCodes: [], inUse: true })).toEqual([]);
  });

  it.each([[-1], [1.5], [7], [Number.NaN]])('refuses decimals %s', (decimals) => {
    expect(details(measureUnitIssues({ ...ok, decimals }, null, { otherCodes: [], inUse: false }))).toEqual(['DECIMALS_INVALID']);
  });

  it('refuses a duplicate code on create', () => {
    expect(details(measureUnitIssues({ ...ok, code: 'vnd' }, null, { otherCodes: ['VND'], inUse: false }))).toEqual(['CODE_TAKEN']);
  });
});

describe('calcMethodIssues (BR-KPI-76) and methodScoringChanged', () => {
  const stored = calcMethod({ code: 'CM-UP', capPct: 120, floorPct: 0 });
  const used = { otherCodes: [], goalsUsing: 12 };
  const unused = { otherCodes: [], goalsUsing: 0 };

  it.each([
    ['methodType', { methodType: 'RATIO_DOWN' as const }],
    ['capPct', { capPct: 150 }],
    ['floorPct', { floorPct: 10 }],
    ['formulaExpr', { methodType: 'FORMULA' as const, formulaExpr: 'actual / target * 100' }],
  ])('locks %s while goals use the method', (_field, change) => {
    const { lock } = calcMethodIssues({ ...stored, ...change }, [], stored, [], used);
    expect(lock).toEqual([expect.objectContaining({ code: 'ERR-KPI-04', detail: 'METHOD_IN_USE', data: { goals: 12 } })]);
  });

  it('locks a tier change while in use', () => {
    const tiered = calcMethod({ methodType: 'TIERED', capPct: null });
    const tiers = [tier({ fromValue: 0, toValue: 1, achievementPct: 100 }), tier({ fromValue: 1, toValue: null, achievementPct: 0 })];
    const edited = [tiers[0], { ...tiers[1], achievementPct: 10 }];
    expect(calcMethodIssues(tiered, edited, tiered, tiers, used).lock).toHaveLength(1);
  });

  it('a name / description / code change passes the lock; so do identical tiers in another order', () => {
    expect(calcMethodIssues({ ...stored, name: 'Đổi tên', code: 'CM-UP2' }, [], stored, [], used)).toEqual({ issues: [], lock: [] });
    const a = tier({ fromValue: 0, toValue: 1, achievementPct: 100 });
    const b = tier({ fromValue: 1, toValue: null, achievementPct: 0 });
    const tiered = calcMethod({ methodType: 'TIERED', capPct: null });
    expect(methodScoringChanged(tiered, [a, b], tiered, [b, a])).toBe(false);
    expect(calcMethodIssues(tiered, [b, a], tiered, [a, b], used).lock).toEqual([]);
  });

  it('nothing is locked on an unused method or a new one', () => {
    expect(calcMethodIssues({ ...stored, capPct: 200 }, [], stored, [], unused).lock).toEqual([]);
    expect(calcMethodIssues({ ...stored, capPct: 200 }, [], null, [], used).lock).toEqual([]);
  });

  it('refuses tiers on a non-TIERED method and a formula on a non-FORMULA one (ERR-KPI-13)', () => {
    const { issues } = calcMethodIssues({ ...stored, formulaExpr: 'actual' }, [tier()], null, [], unused);
    expect(issues.map((i) => [i.code, i.detail])).toEqual([
      ['ERR-KPI-13', 'TIERS_NOT_ALLOWED'],
      ['ERR-KPI-13', 'FORMULA_NOT_ALLOWED'],
    ]);
  });

  it('LEVELS carries no cap and no floor — its ceiling is the top level (BR-KPI-33)', () => {
    const levels = calcMethod({ methodType: 'LEVELS', capPct: null, floorPct: null });
    expect(calcMethodIssues(levels, [], null, [], unused).issues).toEqual([]);
    expect(details(calcMethodIssues({ ...levels, capPct: 120 }, [], null, [], unused).issues)).toEqual(['LEVELS_NO_CAP']);
    expect(details(calcMethodIssues({ ...levels, floorPct: 0 }, [], null, [], unused).issues)).toEqual(['LEVELS_NO_CAP']);
  });

  it('refuses a blank code or name and a duplicate code', () => {
    const { issues } = calcMethodIssues({ ...stored, code: 'cm-down', name: '' }, [], null, [], { otherCodes: ['CM-DOWN'], goalsUsing: 0 });
    expect(details(issues)).toEqual(['CODE_TAKEN', 'NAME_REQUIRED']);
  });
});

describe('kpiDefinitionIssues (BR-KPI-70…75)', () => {
  const ctx = { otherCodes: [] as string[], activeTemplatesContaining: [] as string[] };

  it('accepts a complete Active definition', () => {
    expect(kpiDefinitionIssues(kpiDefinition(), null, ctx)).toEqual([]);
  });

  it('requires code, name, perspective, unit and method — each names its field', () => {
    const issues = kpiDefinitionIssues(kpiDefinition({ code: ' ', name: '', perspectiveId: '', unitId: '', calcMethodId: '' }), null, ctx);
    expect(issues.map((i) => i.ref)).toEqual(['code', 'name', 'perspectiveId', 'unitId', 'calcMethodId']);
  });

  it('refuses a frequency, aggregation, tag or status outside the fixed sets', () => {
    const bad = kpiDefinition({ frequency: 'Day' as never, aggregation: 'MAX' as never, categoryTag: 'X' as never, status: 'Live' as never });
    expect(details(kpiDefinitionIssues(bad, null, ctx))).toEqual(['FREQUENCY_INVALID', 'AGGREGATION_INVALID', 'CATEGORY_INVALID', 'STATUS_INVALID']);
  });

  it('Active needs a default data source; Draft does not (BR-KPI-72, Q19)', () => {
    expect(details(kpiDefinitionIssues(kpiDefinition({ defaultDataSourceId: null }), null, ctx))).toEqual(['DATA_SOURCE_REQUIRED']);
    expect(kpiDefinitionIssues(kpiDefinition({ defaultDataSourceId: null, status: 'Draft' }), null, ctx)).toEqual([]);
  });

  it('a standard item keeps its code but can be edited otherwise (BR-KPI-75, Q22)', () => {
    const stored = kpiDefinition({ isSystem: true });
    expect(details(kpiDefinitionIssues({ ...stored, code: 'KPI-NEW' }, stored, ctx))).toEqual(['SYSTEM_CODE_LOCKED']);
    expect(kpiDefinitionIssues({ ...stored, code: ' kpi-1 ', name: 'Doanh thu thuần', status: 'Archived' }, stored, ctx)).toEqual([]);
  });

  it.each<LibraryStatus>(['Archived', 'Draft'])('refuses leaving Active for %s while an Active template holds it (ERR-KPI-04)', (status) => {
    const stored = kpiDefinition();
    const [issue] = kpiDefinitionIssues({ ...stored, status }, stored, { ...ctx, activeTemplatesContaining: ['Bộ KPI Marketing', 'Bộ KPI Kinh doanh'] });
    expect(issue).toMatchObject({ code: 'ERR-KPI-04', ref: 'status', detail: 'IN_ACTIVE_TEMPLATE', data: { templates: 'Bộ KPI Marketing, Bộ KPI Kinh doanh' } });
  });

  it('editing a non-status field of a Draft KPI inside an Active template still saves (the seed\'s HCNS case)', () => {
    const stored = kpiDefinition({ status: 'Draft', defaultDataSourceId: null });
    expect(kpiDefinitionIssues({ ...stored, name: 'Đổi tên' }, stored, { ...ctx, activeTemplatesContaining: ['Bộ KPI HCNS'] })).toEqual([]);
  });

  it('Draft → Active and Archived → Active pass', () => {
    expect(kpiDefinitionIssues(kpiDefinition(), kpiDefinition({ status: 'Draft' }), ctx)).toEqual([]);
    expect(kpiDefinitionIssues(kpiDefinition(), kpiDefinition({ status: 'Archived' }), ctx)).toEqual([]);
  });
});

describe('activeTemplatesContaining', () => {
  it('names only the Active templates holding the KPI', () => {
    const templates = [kpiTemplate({ id: 't1', name: 'A' }), kpiTemplate({ id: 't2', name: 'B', status: 'Draft' }), kpiTemplate({ id: 't3', name: 'C' })];
    const items = [templateItem({ templateId: 't1' }), templateItem({ templateId: 't2' }), templateItem({ templateId: 't3', kpiDefId: 'other' })];
    expect(activeTemplatesContaining('kd1', templates, items)).toEqual(['A']);
  });
});

describe('templateIssues (BR-KPI-73, 74)', () => {
  const defs = (entries: [Id, LibraryStatus][]) => new Map<Id, Pick<KpiDefinition, 'status'>>(entries.map(([id, status]) => [id, { status }]));
  const five = ['a', 'b', 'c', 'd', 'e'];
  const allActive = defs([...five, 'f', 'g', 'h', 'i'].map((id) => [id, 'Active']));
  const itemsOf = (weights: number[]) => weights.map((w, i) => templateItem({ kpiDefId: [...five, 'f', 'g', 'h', 'i'][i], defaultWeight: w }));
  const none = new Set<Id>();

  it.each([[[30, 25, 20, 15, 10]], [[30, 25, 20, 15, 9.99]], [[30, 25, 20, 15, 10.01]]])('no warning at a total within ±0.01 (%j)', (weights) => {
    expect(templateIssues(kpiTemplate(), itemsOf(weights), allActive, none)).toEqual({ errors: [], warnings: [] });
  });

  it('warns (never refuses) when the total misses 100%', () => {
    const { errors, warnings } = templateIssues(kpiTemplate(), itemsOf([30, 25, 20, 15, 9.98]), allActive, none);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([expect.objectContaining({ code: 'ERR-KPI-07', detail: 'WEIGHT_TOTAL' })]);
    expect(warnings[0].data?.totalWeight).toBeCloseTo(99.98, 10);
  });

  it.each([
    [4, true],
    [5, false],
    [8, false],
    [9, true],
  ])('%i items → count warning: %s', (count, warns) => {
    const weights = Array.from({ length: count }, () => 100 / count);
    const { warnings } = templateIssues(kpiTemplate(), itemsOf(weights), allActive, none);
    expect(details(warnings).includes('ITEM_COUNT')).toBe(warns);
  });

  it('an empty template warns on count and total, without crashing', () => {
    const { errors, warnings } = templateIssues(kpiTemplate({ status: 'Draft' }), [], allActive, none);
    expect(errors).toEqual([]);
    expect(details(warnings)).toEqual(['WEIGHT_TOTAL', 'ITEM_COUNT']);
    expect(templateWeightTotal([])).toBe(0);
  });

  it('a NEW Draft/Archived item is refused; a stored one is only a warning (BR-KPI-74)', () => {
    const map = defs([['a', 'Active'], ['b', 'Active'], ['c', 'Active'], ['d', 'Draft'], ['e', 'Archived']]);
    const items = itemsOf([20, 20, 20, 20, 20]);
    const fresh = templateIssues(kpiTemplate(), items, map, new Set(['a', 'b', 'c']));
    expect(fresh.errors.map((i) => [i.ref, i.detail, i.data?.status])).toEqual([
      ['d', 'KPI_NOT_ACTIVE', 'Draft'],
      ['e', 'KPI_NOT_ACTIVE', 'Archived'],
    ]);
    const stored = templateIssues(kpiTemplate(), items, map, new Set(five));
    expect(stored.errors).toEqual([]);
    expect(stored.warnings.map((i) => [i.ref, i.detail])).toEqual([
      ['d', 'INACTIVE_KPI'],
      ['e', 'INACTIVE_KPI'],
    ]);
  });

  it('refuses a duplicate KPI, a negative or non-finite weight, a non-finite target, a blank name, unit AND position', () => {
    const items = [
      templateItem({ kpiDefId: 'a', defaultWeight: 50 }),
      templateItem({ kpiDefId: 'a', defaultWeight: 50 }),
      templateItem({ kpiDefId: 'b', defaultWeight: -5 }),
      templateItem({ kpiDefId: 'c', defaultWeight: Number.NaN, defaultTarget: Number.POSITIVE_INFINITY }),
    ];
    const { errors } = templateIssues(kpiTemplate({ name: ' ', orgUnitId: 'u1', positionId: 'p1' }), items, allActive, none);
    expect(errors.map((i) => [i.ref, i.detail])).toEqual([
      ['name', 'NAME_REQUIRED'],
      ['appliesTo', 'UNIT_AND_POSITION'],
      ['a', 'DUPLICATE_KPI'],
      ['b', 'WEIGHT_INVALID'],
      ['c', 'WEIGHT_INVALID'],
      ['c', 'TARGET_INVALID'],
    ]);
  });

  it('an unknown KPI id is left to the reference check', () => {
    expect(templateIssues(kpiTemplate(), itemsOf([20, 20, 20, 20, 20]), new Map(), none).errors).toEqual([]);
  });

  it('a template for a unit, a position or everyone', () => {
    expect(templateAudience(kpiTemplate({ orgUnitId: 'u1' }))).toBe('OrgUnit');
    expect(templateAudience(kpiTemplate({ positionId: 'p1' }))).toBe('Position');
    expect(templateAudience(kpiTemplate())).toBe('General');
  });
});

describe('libraryUsage', () => {
  it('counts every goal (any status) per method, KPI and unit; units also count library items', () => {
    const usage = libraryUsage(
      [goal({ calcMethodId: 'm1', kpiDefId: 'k1', unitId: 'u1' }), goal({ calcMethodId: 'm1', kpiDefId: null, unitId: 'u2', status: 'Cancelled' })],
      [kpiDefinition({ unitId: 'u1' }), kpiDefinition({ unitId: 'u3' })],
    );
    expect(usage.goalsByMethod.get('m1')).toBe(2);
    expect(usage.goalsByKpi.get('k1')).toBe(1);
    expect([usage.usesByUnit.get('u1'), usage.usesByUnit.get('u2'), usage.usesByUnit.get('u3'), usage.usesByUnit.get('u4')]).toEqual([2, 1, 1, undefined]);
  });
});

describe('export rows (WBS 4.2.5)', () => {
  const catalogues = {
    perspectives: [perspective()],
    units: [measureUnit()],
    methods: [calcMethod()],
    dataSources: [{ id: 'ds1', code: 'ERP_SALE' }],
  };

  it('writes references as codes and sets as their Vietnamese labels, sorted by code', () => {
    const rows = libraryExportRows(
      [kpiDefinition({ id: 'k2', code: 'KPI-2', isSystem: true, categoryTag: 'COST', status: 'Draft' }), kpiDefinition({ defaultDataSourceId: null })],
      catalogues,
    );
    expect(rows.map((r) => r.code)).toEqual(['KPI-1', 'KPI-2']);
    expect(rows[0]).toMatchObject({ perspectiveCode: 'FIN', unitCode: 'PCT', calcMethodCode: 'CM', dataSourceCode: null, frequency: 'Tháng', aggregation: 'Cộng dồn', status: 'Đang áp dụng', standard: null, categoryTag: null });
    expect(rows[1]).toMatchObject({ dataSourceCode: 'ERP_SALE', categoryTag: 'Chi phí', status: 'Nháp', standard: 'Có' });
  });

  it('one row per template item; an empty template keeps one row', () => {
    const rows = templateExportRows(
      [kpiTemplate({ id: 't1', name: 'B', orgUnitId: 'u1' }), kpiTemplate({ id: 't2', name: 'A', status: 'Draft' })],
      [templateItem({ templateId: 't1', kpiDefId: 'kd1', defaultWeight: 60, defaultTarget: 5 }), templateItem({ templateId: 't1', kpiDefId: 'gone', defaultWeight: 40 })],
      { definitions: [kpiDefinition()], orgUnits: [{ id: 'u1', code: 'KD' }], positions: [] },
    );
    expect(rows).toEqual([
      { templateName: 'A', appliesTo: 'Chung', appliesToCode: null, templateStatus: 'Nháp', kpiCode: null, kpiName: null, defaultWeight: null, defaultTarget: null },
      { templateName: 'B', appliesTo: 'Đơn vị', appliesToCode: 'KD', templateStatus: 'Đang áp dụng', kpiCode: 'KPI-1', kpiName: 'Doanh thu', defaultWeight: 60, defaultTarget: 5 },
      { templateName: 'B', appliesTo: 'Đơn vị', appliesToCode: 'KD', templateStatus: 'Đang áp dụng', kpiCode: null, kpiName: null, defaultWeight: 40, defaultTarget: null },
    ]);
  });
});
