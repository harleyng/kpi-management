import type { CalcTier, Id, KpiTemplateItem } from '@/data/types';
import { matchesSearch } from '@/lib/search';
import type { ChildInput, KpiDefinitionFilter, LibraryGateway } from '../../types';
import { eqOpt, saveChildren, upsert } from '../rows';
import type { Runtime } from '../runtime';

export function libraryGroup(rt: Runtime): LibraryGateway {
  return {
    listPerspectives: rt.read('library.listPerspectives', (tx) => tx.all('BscPerspective').sort((a, b) => a.sortOrder - b.sortOrder)),
    savePerspective: rt.write('library.savePerspective', (tx, input: Parameters<LibraryGateway['savePerspective']>[2]) =>
      upsert(tx, 'BscPerspective', input, { create: () => ({}) }),
    ),

    listMeasureUnits: rt.read('library.listMeasureUnits', (tx) => tx.all('MeasureUnit')),
    saveMeasureUnit: rt.write('library.saveMeasureUnit', (tx, input: Parameters<LibraryGateway['saveMeasureUnit']>[2]) =>
      upsert(tx, 'MeasureUnit', input, { create: () => ({}) }),
    ),

    listCalcMethods: rt.read('library.listCalcMethods', (tx) => tx.all('CalcMethod')),
    listCalcTiers: rt.read('library.listCalcTiers', (tx, calcMethodId?: Id) =>
      tx.all('CalcTier').filter((t) => eqOpt(calcMethodId, t.calcMethodId)),
    ),
    saveCalcMethod: rt.write(
      'library.saveCalcMethod',
      (tx, input: Parameters<LibraryGateway['saveCalcMethod']>[2], tiers: readonly ChildInput<CalcTier, 'calcMethodId'>[]) => {
        const parent = upsert(tx, 'CalcMethod', input, { create: () => ({}) });
        return { parent, children: saveChildren(tx, 'CalcTier', 'calcMethodId', parent.id, tiers) };
      },
    ),

    listKpiDefinitions: rt.read('library.listKpiDefinitions', (tx, filter: KpiDefinitionFilter = {}) =>
      tx
        .all('KpiDefinition')
        .filter(
          (k) =>
            eqOpt(filter.status, k.status) &&
            eqOpt(filter.perspectiveId, k.perspectiveId) &&
            (filter.search === undefined || matchesSearch(filter.search, [k.code, k.name])),
        ),
    ),
    getKpiDefinition: rt.read('library.getKpiDefinition', (tx, kpiDefId: Id) => tx.get('KpiDefinition', kpiDefId)),
    saveKpiDefinition: rt.write('library.saveKpiDefinition', (tx, input: Parameters<LibraryGateway['saveKpiDefinition']>[2]) =>
      // `isSystem` is the seed's: a tenant-created item is never a standard one.
      upsert(tx, 'KpiDefinition', input, { create: () => ({ isSystem: false }) }),
    ),

    listKpiTemplates: rt.read('library.listKpiTemplates', (tx) => tx.all('KpiTemplate')),
    listKpiTemplateItems: rt.read('library.listKpiTemplateItems', (tx, templateId?: Id) =>
      tx.all('KpiTemplateItem').filter((i) => eqOpt(templateId, i.templateId)),
    ),
    saveKpiTemplate: rt.write(
      'library.saveKpiTemplate',
      (tx, input: Parameters<LibraryGateway['saveKpiTemplate']>[2], items: readonly ChildInput<KpiTemplateItem, 'templateId'>[]) => {
        const parent = upsert(tx, 'KpiTemplate', input, { create: () => ({}) });
        return { parent, children: saveChildren(tx, 'KpiTemplateItem', 'templateId', parent.id, items) };
      },
    ),
  };
}
