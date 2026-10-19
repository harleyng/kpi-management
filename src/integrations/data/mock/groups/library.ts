import type { CollectionName } from '@/data/fixtures/types';
import type { CalcTier, Id, KpiTemplateItem } from '@/data/types';
import { validateCalcMethod } from '@/lib/calcRules';
import { toKpiError, type RuleIssue } from '@/lib/errorCatalog';
import {
  activeTemplatesContaining,
  calcMethodIssues,
  kpiDefinitionIssues,
  measureUnitIssues,
  normaliseCode,
  otherCodesOf,
  perspectiveIssues,
  templateIssues,
} from '@/lib/libraryRules';
import { matchesSearch } from '@/lib/search';
import type { ChildInput, KpiDefinitionFilter, LibraryGateway } from '../../types';
import { eqOpt, saveChildren, upsert } from '../rows';
import type { Runtime } from '../runtime';
import { REVERSE_REFS, valuesAt } from '../schema';
import type { Row, Tx } from '../store';

/**
 * G2 · Thư viện KPI (T2). Every save runs `libraryRules` (BR-KPI-74…80) on what it is about to
 * write, inside the transaction, so a refusal rolls the whole save back. The checks that read OTHER
 * tables (codes of the catalogue, rows that use a unit or method, Active templates holding a KPI)
 * become an RPC or a trigger in Phase 5 — the rule functions stay the same.
 */

function throwIf(issues: readonly RuleIssue[]): void {
  if (issues.length > 0) throw toKpiError(issues);
}

/** How many rows of the tenant point at `id`, through any schema reference except `except`'s. */
function referencesTo(tx: Tx, target: CollectionName, id: Id, except: readonly CollectionName[] = []): number {
  let count = 0;
  for (const { from, spec } of REVERSE_REFS.get(target) ?? []) {
    if (except.includes(from)) continue;
    for (const row of tx.all(from) as unknown as Row[]) if (valuesAt(row, spec.path).includes(id)) count += 1;
  }
  return count;
}

/** `code` stored trimmed and upper-cased (BR-KPI-74); a missing code is left for `writableOf` to refuse. */
function withNormalCode<T extends object>(input: T): T {
  const code = (input as { code?: unknown }).code;
  return typeof code === 'string' ? { ...input, code: normaliseCode(code) } : input;
}

export function libraryGroup(rt: Runtime): LibraryGateway {
  return {
    listPerspectives: rt.read('library.listPerspectives', (tx) => tx.all('BscPerspective').sort((a, b) => a.sortOrder - b.sortOrder)),
    savePerspective: rt.write('library.savePerspective', { permission: 'library.manage' }, (tx, input: Parameters<LibraryGateway['savePerspective']>[2]) => {
      // BR-KPI-75: the four BSC perspectives are fixed — rename and reorder only.
      const stored = input.id === undefined ? null : tx.get('BscPerspective', input.id);
      const saved = upsert(tx, 'BscPerspective', input, { create: () => ({}) });
      throwIf(perspectiveIssues(saved, stored));
      return saved;
    }),

    listMeasureUnits: rt.read('library.listMeasureUnits', (tx) => tx.all('MeasureUnit')),
    saveMeasureUnit: rt.write('library.saveMeasureUnit', { permission: 'library.manage' }, (tx, input: Parameters<LibraryGateway['saveMeasureUnit']>[2]) => {
      const stored = input.id === undefined ? null : tx.get('MeasureUnit', input.id);
      const saved = upsert(tx, 'MeasureUnit', withNormalCode(input), { create: () => ({}) });
      // BR-KPI-80: a unit used anywhere (library item, goal, KGI, pending proposal) keeps its code.
      const inUse = stored !== null && referencesTo(tx, 'MeasureUnit', stored.id) > 0;
      throwIf(measureUnitIssues(saved, stored, { otherCodes: otherCodesOf(tx.all('MeasureUnit'), saved.id), inUse }));
      return saved;
    }),

    listCalcMethods: rt.read('library.listCalcMethods', (tx) => tx.all('CalcMethod')),
    listCalcTiers: rt.read('library.listCalcTiers', (tx, calcMethodId?: Id) =>
      tx.all('CalcTier').filter((t) => eqOpt(calcMethodId, t.calcMethodId)),
    ),
    saveCalcMethod: rt.write(
      'library.saveCalcMethod', { permission: 'library.manage' },
      (tx, input: Parameters<LibraryGateway['saveCalcMethod']>[2], tiers: readonly ChildInput<CalcTier, 'calcMethodId'>[]) => {
        const stored = input.id === undefined ? null : tx.get('CalcMethod', input.id);
        const storedTiers = stored === null ? [] : tx.all('CalcTier').filter((t) => t.calcMethodId === stored.id);
        // A goal reads its method LIVE (`Goal.calcMethodId`): every goal of any status or cycle, and
        // every pending proposal, counts — the library's own rows do not (BR-KPI-80).
        const goalsUsing = stored === null ? 0 : referencesTo(tx, 'CalcMethod', stored.id, ['KpiDefinition', 'CalcTier']);
        const parent = upsert(tx, 'CalcMethod', withNormalCode(input), { create: () => ({}) });
        const children = saveChildren(tx, 'CalcTier', 'calcMethodId', parent.id, tiers);
        const { issues, lock } = calcMethodIssues(parent, children, stored, storedTiers, {
          otherCodes: otherCodesOf(tx.all('CalcMethod'), parent.id),
          goalsUsing,
        });
        // Input first, then BR-KPI-31 (a ratio / formula needs a cap, floor ≤ cap, tiers without gaps or
        // overlaps — ERR-KPI-13), and the in-use lock (ERR-KPI-04) last.
        throwIf([...issues, ...validateCalcMethod(parent, children), ...lock]);
        return { parent, children };
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
    saveKpiDefinition: rt.write('library.saveKpiDefinition', { permission: 'library.manage' }, (tx, input: Parameters<LibraryGateway['saveKpiDefinition']>[2]) => {
      const stored = input.id === undefined ? null : tx.get('KpiDefinition', input.id);
      // `isSystem` is the seed's: a tenant-created item is never a standard one.
      const saved = upsert(tx, 'KpiDefinition', withNormalCode(input), { create: () => ({ isSystem: false }) });
      throwIf(
        kpiDefinitionIssues(saved, stored, {
          otherCodes: otherCodesOf(tx.all('KpiDefinition'), saved.id),
          activeTemplatesContaining: activeTemplatesContaining(saved.id, tx.all('KpiTemplate'), tx.all('KpiTemplateItem')),
        }),
      );
      return saved;
    }),

    listKpiTemplates: rt.read('library.listKpiTemplates', (tx) => tx.all('KpiTemplate')),
    listKpiTemplateItems: rt.read('library.listKpiTemplateItems', (tx, templateId?: Id) =>
      tx.all('KpiTemplateItem').filter((i) => eqOpt(templateId, i.templateId)),
    ),
    saveKpiTemplate: rt.write(
      'library.saveKpiTemplate', { permission: 'library.manage' },
      (tx, input: Parameters<LibraryGateway['saveKpiTemplate']>[2], items: readonly ChildInput<KpiTemplateItem, 'templateId'>[]) => {
        const storedKpiIds = new Set(
          input.id === undefined ? [] : tx.all('KpiTemplateItem').filter((i) => i.templateId === input.id).map((i) => i.kpiDefId),
        );
        const parent = upsert(tx, 'KpiTemplate', input, { create: () => ({}) });
        const children = saveChildren(tx, 'KpiTemplateItem', 'templateId', parent.id, items);
        // BR-KPI-77/74: only the errors refuse; weight total and item count are the screen's warnings (Q26).
        const definitions = new Map(tx.all('KpiDefinition').map((d) => [d.id, d]));
        throwIf(templateIssues(parent, children, definitions, storedKpiIds).errors);
        return { parent, children };
      },
    ),
  };
}
