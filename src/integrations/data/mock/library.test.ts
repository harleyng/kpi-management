import { describe, expect, it } from 'vitest';
import { DEMO, SYNTRA } from '@/data/fixtures';
import type { DataGateway, DomainEvent } from '../types';
import { flush, newGateway, rejection } from './gateway.test-util';

/**
 * The library's write rules in the mock (track T2, BR-KPI-74…76): what each save refuses, what it
 * normalises, and that the seed — which predates the rules — still saves unchanged. The rules'
 * own edge cases are in `src/lib/libraryRules.test.ts`.
 */

const S = SYNTRA.tenantId;
const D = DEMO.tenantId;
const hr = SYNTRA.user(SYNTRA.personas.hr);
const demoHr = DEMO.user(DEMO.personas.hr);

async function library(gw: DataGateway, tenantId = S) {
  const [perspectives, units, methods, tiers, definitions, templates, items, sources] = await Promise.all([
    gw.library.listPerspectives(tenantId),
    gw.library.listMeasureUnits(tenantId),
    gw.library.listCalcMethods(tenantId),
    gw.library.listCalcTiers(tenantId),
    gw.library.listKpiDefinitions(tenantId),
    gw.library.listKpiTemplates(tenantId),
    gw.library.listKpiTemplateItems(tenantId),
    gw.actuals.listDataSources(tenantId),
  ]);
  const byCode = <T extends { code: string }>(rows: T[], code: string) => rows.find((r) => r.code === code) as T;
  return {
    perspectives, units, methods, tiers, definitions, templates, items, sources,
    unit: (code: string) => byCode(units, code),
    method: (code: string) => byCode(methods, code),
    kpi: (code: string) => byCode(definitions, code),
    itemsOf: (templateId: string) => items.filter((i) => i.templateId === templateId),
  };
}

const newKpi = (lib: Awaited<ReturnType<typeof library>>, code: string) => ({
  code,
  name: 'Chỉ tiêu mới',
  perspectiveId: lib.perspectives[0].id,
  unitId: lib.unit('PCT').id,
  calcMethodId: lib.method('CM-UP').id,
  defaultDataSourceId: lib.sources[0].id,
  definition: null,
  formulaText: null,
  frequency: 'Month' as const,
  aggregation: 'AVG' as const,
  categoryTag: null,
  status: 'Active' as const,
});

describe('the seed still saves unchanged', () => {
  it.each([
    ['Syntra', S, hr],
    ['Demo Co', D, demoHr],
  ])('every %s template (incl. those holding Draft KPIs or missing 100%%) and every definition', async (_name, tenantId, actor) => {
    const { gateway } = newGateway();
    const lib = await library(gateway, tenantId);
    for (const t of lib.templates) {
      const saved = await gateway.library.saveKpiTemplate(tenantId, actor, t, lib.itemsOf(t.id));
      expect(saved.children).toHaveLength(lib.itemsOf(t.id).length);
    }
    for (const d of lib.definitions) await gateway.library.saveKpiDefinition(tenantId, actor, d);
    for (const u of lib.units) await gateway.library.saveMeasureUnit(tenantId, actor, u);
    for (const p of lib.perspectives) await gateway.library.savePerspective(tenantId, actor, p);
    for (const m of lib.methods) await gateway.library.saveCalcMethod(tenantId, actor, m, lib.tiers.filter((t) => t.calcMethodId === m.id));
  });
});

describe('library.saveKpiDefinition', () => {
  it('stores the code trimmed and upper-cased, as a tenant (non-standard) item, and announces it', async () => {
    const { gateway } = newGateway();
    const lib = await library(gateway);
    const heard: DomainEvent[] = [];
    gateway.events.subscribe(S, (e) => void heard.push(e));
    const saved = await gateway.library.saveKpiDefinition(S, hr, { ...newKpi(lib, '  kpi-moi '), isSystem: true } as never);
    await flush();
    expect(saved).toMatchObject({ code: 'KPI-MOI', isSystem: false });
    expect(heard).toContainEqual(expect.objectContaining({ type: 'entity.changed', entityName: 'KpiDefinition', entityId: saved.id, action: 'CREATE' }));
  });

  it('refuses a code another item has in any case (ERR-KPI-06 CODE_TAKEN)', async () => {
    const { gateway } = newGateway();
    const lib = await library(gateway);
    const error = await rejection(gateway.library.saveKpiDefinition(S, hr, newKpi(lib, 'kpi-doanh-thu')));
    expect([error.code, error.issues[0].detail]).toEqual(['ERR-KPI-06', 'CODE_TAKEN']);
  });

  it('a standard item keeps its code, but its name and definition can change (BR-KPI-79)', async () => {
    const { gateway } = newGateway();
    const revenue = (await library(gateway)).kpi('KPI-DOANH-THU');
    expect(revenue.isSystem).toBe(true);
    const error = await rejection(gateway.library.saveKpiDefinition(S, hr, { ...revenue, code: 'KPI-DT' }));
    expect([error.code, error.issues[0].detail]).toEqual(['ERR-KPI-06', 'SYSTEM_CODE_LOCKED']);
    const renamed = await gateway.library.saveKpiDefinition(S, hr, { ...revenue, name: 'Doanh thu thuần', definition: 'Mới' });
    expect(renamed).toMatchObject({ code: 'KPI-DOANH-THU', name: 'Doanh thu thuần', isSystem: true });
  });

  it('an Active item needs a default data source; a Draft does not (BR-KPI-76)', async () => {
    const { gateway } = newGateway();
    const lib = await library(gateway);
    const error = await rejection(gateway.library.saveKpiDefinition(S, hr, { ...newKpi(lib, 'KPI-X'), defaultDataSourceId: null }));
    expect([error.code, error.issues[0].ref]).toEqual(['ERR-KPI-06', 'defaultDataSourceId']);
    await gateway.library.saveKpiDefinition(S, hr, { ...newKpi(lib, 'KPI-X'), defaultDataSourceId: null, status: 'Draft' });
  });

  it('refuses archiving an item an Active template holds, naming the templates (ERR-KPI-04); archives once the template is not Active', async () => {
    const { gateway } = newGateway();
    const lib = await library(gateway);
    const revenue = lib.kpi('KPI-DOANH-THU');
    const holding = lib.templates.filter((t) => t.status === 'Active' && lib.itemsOf(t.id).some((i) => i.kpiDefId === revenue.id));
    expect(holding.length).toBeGreaterThan(0);
    const error = await rejection(gateway.library.saveKpiDefinition(S, hr, { ...revenue, status: 'Archived' }));
    expect(error.code).toBe('ERR-KPI-04');
    expect(error.issues[0]).toMatchObject({ detail: 'IN_ACTIVE_TEMPLATE', data: { templates: holding.map((t) => t.name).join(', ') } });

    for (const t of holding) await gateway.library.saveKpiTemplate(S, hr, { ...t, status: 'Draft' }, lib.itemsOf(t.id));
    // Goals using it keep working: they hold their own perspective / unit / method ids.
    const goalsBefore = await gateway.goals.listGoals(S, { kpiDefId: revenue.id });
    expect(goalsBefore.length).toBeGreaterThan(0);
    expect((await gateway.library.saveKpiDefinition(S, hr, { ...revenue, status: 'Archived' })).status).toBe('Archived');
    expect(await gateway.goals.listGoals(S, { kpiDefId: revenue.id })).toEqual(goalsBefore);
  });
});

describe('library.savePerspective (BR-KPI-75)', () => {
  it('renames and reorders, but never creates a perspective or changes its code', async () => {
    const { gateway } = newGateway();
    const [fin] = (await library(gateway)).perspectives;
    expect((await gateway.library.savePerspective(S, hr, { ...fin, name: 'Tài chính & đầu tư', sortOrder: 9 })).name).toBe('Tài chính & đầu tư');
    const created = await rejection(gateway.library.savePerspective(S, hr, { code: 'FIN', name: 'Thứ năm', sortOrder: 5 }));
    expect([created.code, created.issues[0].detail]).toEqual(['ERR-KPI-06', 'PERSPECTIVE_FIXED']);
    const recoded = await rejection(gateway.library.savePerspective(S, hr, { ...fin, code: 'CUS' }));
    expect(recoded.issues[0].detail).toBe('CODE_LOCKED');
  });
});

describe('library.saveMeasureUnit (BR-KPI-74, 76)', () => {
  it('a unit in use keeps its code (ERR-KPI-04); its name and decimals can change', async () => {
    const { gateway } = newGateway();
    const pct = (await library(gateway)).unit('PCT');
    const error = await rejection(gateway.library.saveMeasureUnit(S, hr, { ...pct, code: 'PERCENT' }));
    expect([error.code, error.issues[0].detail]).toEqual(['ERR-KPI-04', 'UNIT_CODE_IN_USE']);
    expect(await gateway.library.saveMeasureUnit(S, hr, { ...pct, name: 'phần trăm', decimals: 2 })).toMatchObject({ code: 'PCT', decimals: 2 });
  });

  it('an unused unit is created with a normal code and can be recoded; the same code may exist in another tenant', async () => {
    const { gateway } = newGateway();
    const created = await gateway.library.saveMeasureUnit(S, hr, { code: ' kg ', name: 'ki-lô-gam', decimals: 1 });
    expect(created.code).toBe('KG');
    expect((await gateway.library.saveMeasureUnit(S, hr, { ...created, code: 'KILO' })).code).toBe('KILO');
    expect((await gateway.library.saveMeasureUnit(D, demoHr, { code: 'KILO', name: 'ki-lô-gam', decimals: 1 })).tenantId).toBe(D);
    const dup = await rejection(gateway.library.saveMeasureUnit(S, hr, { code: 'kilo', name: 'trùng', decimals: 0 }));
    expect(dup.issues[0].detail).toBe('CODE_TAKEN');
  });
});

describe('library.saveCalcMethod (BR-KPI-80)', () => {
  it('a method goals use keeps its scoring fields (ERR-KPI-04) but can be renamed', async () => {
    const { gateway } = newGateway();
    const lib = await library(gateway);
    const up = lib.method('CM-UP');
    const goals = (await gateway.goals.listGoals(S)).filter((g) => g.calcMethodId === up.id).length;
    const error = await rejection(gateway.library.saveCalcMethod(S, hr, { ...up, capPct: 150 }, []));
    expect(error.code).toBe('ERR-KPI-04');
    expect(error.issues[0]).toMatchObject({ detail: 'METHOD_IN_USE' });
    expect(error.issues[0].data?.goals).toBeGreaterThanOrEqual(goals);
    expect((await gateway.library.saveCalcMethod(S, hr, { ...up, name: 'Tăng (trần 120%)' }, [])).parent.name).toBe('Tăng (trần 120%)');
  });

  it('a used TIERED method keeps its tiers, even resent in another order with fresh ids', async () => {
    const { gateway } = newGateway();
    const lib = await library(gateway);
    const stockout = lib.method('CM-STOCKOUT');
    const tiers = lib.tiers.filter((t) => t.calcMethodId === stockout.id).map(({ fromValue, toValue, achievementPct }) => ({ fromValue, toValue, achievementPct }));
    await gateway.library.saveCalcMethod(S, hr, stockout, [...tiers].reverse());
    const changed = tiers.map((t, i) => (i === 1 ? { ...t, achievementPct: 60 } : t));
    expect((await rejection(gateway.library.saveCalcMethod(S, hr, stockout, changed))).code).toBe('ERR-KPI-04');
  });

  it('a new method is free to change; tiers only on TIERED, no cap on LEVELS (ERR-KPI-13)', async () => {
    const { gateway } = newGateway();
    const base = { code: 'cm-new', name: 'Bậc mới', methodType: 'TIERED' as const, formulaExpr: null, capPct: null, floorPct: null, description: null };
    const created = await gateway.library.saveCalcMethod(S, hr, base, [
      { fromValue: 0, toValue: 50, achievementPct: 50 },
      { fromValue: 50, toValue: null, achievementPct: 100 },
    ]);
    expect(created.parent.code).toBe('CM-NEW');
    const switched = await gateway.library.saveCalcMethod(S, hr, { ...created.parent, methodType: 'RATIO_UP', capPct: 120 }, []);
    expect(switched.children).toEqual([]);
    expect(await gateway.library.listCalcTiers(S, created.parent.id)).toEqual([]);

    const tiersOnRatio = await rejection(gateway.library.saveCalcMethod(S, hr, switched.parent, [{ fromValue: 0, toValue: null, achievementPct: 100 }]));
    expect([tiersOnRatio.code, tiersOnRatio.issues[0].detail]).toEqual(['ERR-KPI-13', 'TIERS_NOT_ALLOWED']);
    const levels = await rejection(gateway.library.saveCalcMethod(S, hr, { ...base, code: 'CM-LV2', methodType: 'LEVELS', capPct: 120 }, []));
    expect(levels.issues[0].detail).toBe('LEVELS_NO_CAP');
  });

  it('reports an invalid configuration before the in-use lock', async () => {
    const { gateway } = newGateway();
    const up = (await library(gateway)).method('CM-UP');
    const error = await rejection(gateway.library.saveCalcMethod(S, hr, { ...up, capPct: null }, []));
    expect(error.issues.map((i) => i.code)).toEqual(['ERR-KPI-13', 'ERR-KPI-04']);
  });
});

describe('library.saveKpiTemplate (BR-KPI-77, 74)', () => {
  it('refuses ADDING a Draft or Archived KPI; keeps a stored one', async () => {
    const { gateway } = newGateway();
    const lib = await library(gateway);
    const hcns = lib.templates.find((t) => lib.itemsOf(t.id).some((i) => lib.definitions.find((d) => d.id === i.kpiDefId)?.status === 'Draft'));
    expect(hcns).toBeDefined();
    const draftKpi = lib.definitions.find((d) => d.status === 'Draft') as (typeof lib.definitions)[number];
    const other = lib.templates.find((t) => t.id !== hcns?.id && !lib.itemsOf(t.id).some((i) => i.kpiDefId === draftKpi.id)) as (typeof lib.templates)[number];
    const items = [...lib.itemsOf(other.id), { kpiDefId: draftKpi.id, defaultWeight: 0, defaultTarget: null }];
    const error = await rejection(gateway.library.saveKpiTemplate(S, hr, other, items));
    expect(error.issues[0]).toMatchObject({ code: 'ERR-KPI-06', ref: draftKpi.id, detail: 'KPI_NOT_ACTIVE' });
  });

  it('saves a total off 100% and an off count — those are warnings, not refusals (Q26)', async () => {
    const { gateway } = newGateway();
    const lib = await library(gateway);
    const active = lib.definitions.filter((d) => d.status === 'Active').slice(0, 3);
    const saved = await gateway.library.saveKpiTemplate(
      S, hr,
      { name: 'Bộ thử', orgUnitId: null, positionId: null, status: 'Active' },
      active.map((d) => ({ kpiDefId: d.id, defaultWeight: 20, defaultTarget: null })),
    );
    expect(saved.children).toHaveLength(3);
  });

  it('refuses a duplicate KPI and a negative weight', async () => {
    const { gateway } = newGateway();
    const lib = await library(gateway);
    const kpi = lib.kpi('KPI-DOANH-THU');
    const tpl = { name: 'Bộ lỗi', orgUnitId: null, positionId: null, status: 'Draft' as const };
    const dup = await rejection(gateway.library.saveKpiTemplate(S, hr, tpl, [
      { kpiDefId: kpi.id, defaultWeight: 50, defaultTarget: null },
      { kpiDefId: kpi.id, defaultWeight: 50, defaultTarget: null },
    ]));
    expect(dup.issues[0].detail).toBe('DUPLICATE_KPI');
    const negative = await rejection(gateway.library.saveKpiTemplate(S, hr, tpl, [{ kpiDefId: kpi.id, defaultWeight: -1, defaultTarget: null }]));
    expect(negative.issues[0].detail).toBe('WEIGHT_INVALID');
  });
});

describe('a refused library save changes nothing', () => {
  it('a locked method keeps its tiers; a refused template keeps its items', async () => {
    const { gateway } = newGateway();
    const lib = await library(gateway);
    const stockout = lib.method('CM-STOCKOUT');
    const before = await gateway.library.listCalcTiers(S, stockout.id);
    await rejection(gateway.library.saveCalcMethod(S, hr, { ...stockout, name: 'Đổi tên' }, [{ fromValue: 0, toValue: null, achievementPct: 100 }]));
    expect(await gateway.library.listCalcTiers(S, stockout.id)).toEqual(before);
    expect((await gateway.library.listCalcMethods(S)).find((m) => m.id === stockout.id)?.name).toBe(stockout.name);

    const tpl = lib.templates[0];
    const items = lib.itemsOf(tpl.id);
    await rejection(gateway.library.saveKpiTemplate(S, hr, { ...tpl, name: 'Đổi tên' }, [...items, { kpiDefId: items[0].kpiDefId, defaultWeight: 1, defaultTarget: null }]));
    expect(await gateway.library.listKpiTemplateItems(S, tpl.id)).toEqual(items);
    expect((await gateway.library.listKpiTemplates(S)).find((t) => t.id === tpl.id)?.name).toBe(tpl.name);
  });
});

describe('tenant isolation of the library writes', () => {
  it('updating another tenant\'s row answers ERR-KPI-02 for each save', async () => {
    const { gateway } = newGateway();
    const syntra = await library(gateway);
    const tpl = syntra.templates[0];
    const calls = [
      gateway.library.savePerspective(D, demoHr, syntra.perspectives[0]),
      gateway.library.saveMeasureUnit(D, demoHr, syntra.units[0]),
      gateway.library.saveCalcMethod(D, demoHr, syntra.method('CM-UP'), []),
      gateway.library.saveKpiDefinition(D, demoHr, syntra.definitions[0]),
      gateway.library.saveKpiTemplate(D, demoHr, tpl, []),
    ];
    for (const call of calls) expect((await rejection(call)).code).toBe('ERR-KPI-02');
  });

  it('a payload naming another tenant\'s KPI, perspective, unit or method answers ERR-KPI-06', async () => {
    const { gateway } = newGateway();
    const syntra = await library(gateway);
    const demo = await library(gateway, D);
    const foreignItem = gateway.library.saveKpiTemplate(D, demoHr, { name: 'Bộ', orgUnitId: null, positionId: null, status: 'Draft' }, [
      { kpiDefId: syntra.kpi('KPI-DOANH-THU').id, defaultWeight: 100, defaultTarget: null },
    ]);
    expect((await rejection(foreignItem)).code).toBe('ERR-KPI-06');
    const base = { ...newKpi(demo, 'KPI-CO-LAP') };
    for (const patch of [
      { perspectiveId: syntra.perspectives[0].id },
      { unitId: syntra.unit('PCT').id },
      { calcMethodId: syntra.method('CM-UP').id },
      { defaultDataSourceId: syntra.sources[0].id },
    ]) {
      expect((await rejection(gateway.library.saveKpiDefinition(D, demoHr, { ...base, ...patch }))).code).toBe('ERR-KPI-06');
    }
  });

  it('a code taken in Syntra is free in Demo Co, and Syntra\'s goals never lock Demo Co\'s method', async () => {
    const { gateway } = newGateway();
    const demo = await library(gateway, D);
    // Demo Co reuses Syntra's KPI codes (fixtures README): a new code unique to Demo Co saves…
    const created = await gateway.library.saveKpiDefinition(D, demoHr, newKpi(demo, 'KPI-CHI-SYNTRA-KHONG-CO'));
    expect(created.tenantId).toBe(D);
    // …and Demo Co's CM-DOWN, which no Demo goal uses, is free to change although Syntra's twin is used.
    const demoGoals = await gateway.goals.listGoals(D);
    const down = demo.method('CM-DOWN');
    expect(demoGoals.some((g) => g.calcMethodId === down.id)).toBe(false);
    const syntraDown = (await library(gateway)).method('CM-DOWN');
    expect((await rejection(gateway.library.saveCalcMethod(S, hr, { ...syntraDown, capPct: 150 }, []))).code).toBe('ERR-KPI-04');
    expect((await gateway.library.saveCalcMethod(D, demoHr, { ...down, capPct: 150 }, [])).parent.capPct).toBe(150);
  });
});
