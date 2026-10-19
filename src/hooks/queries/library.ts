import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import type { CalcTier, KpiTemplateItem } from '@/data/types';
import { getDataGateway } from '@/integrations/data';
import type { ChildInput, KpiDefinitionFilter, LibraryGateway } from '@/integrations/data/types';
import { queryKey, type KeyRoot } from './keys';

/**
 * G2 · Thư viện KPI (track T2). Keys are `[tenantId, root, ...params]` (CLAUDE.md rule 7). The library
 * changes rarely during a session, hence the long `staleTime`.
 *
 * Writes return the gateway's promise and let it reject: the screen awaits `mutateAsync`, keeps its
 * editor open on a refusal, marks the fields named by `KpiError.issues`, and toasts the catalogue
 * copy. On success the written root is invalidated (the gateway's `entity.changed` events refresh
 * the other screens that read the same entities, `useGatewayEventInvalidation`).
 */

const LIBRARY_STALE_MS = 5 * 60 * 1000;

export const kpiDefinitionsKey = (tenantId: string, filter: KpiDefinitionFilter = {}) =>
  queryKey(tenantId, 'kpiDefinitions', filter);

export function useKpiDefinitions(filter: KpiDefinitionFilter = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: kpiDefinitionsKey(tenantId, filter),
    queryFn: () => getDataGateway().library.listKpiDefinitions(tenantId, filter),
    staleTime: LIBRARY_STALE_MS,
  });
}

export const perspectivesKey = (tenantId: string) => queryKey(tenantId, 'perspectives');

export function usePerspectives() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: perspectivesKey(tenantId),
    queryFn: () => getDataGateway().library.listPerspectives(tenantId),
    staleTime: LIBRARY_STALE_MS,
  });
}

export const measureUnitsKey = (tenantId: string) => queryKey(tenantId, 'measureUnits');

export function useMeasureUnits() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: measureUnitsKey(tenantId),
    queryFn: () => getDataGateway().library.listMeasureUnits(tenantId),
    staleTime: LIBRARY_STALE_MS,
  });
}

/** Methods with their tiers' root — the evaluation form reads a goal's method cap (`validateScoreInput`). */
export const calcMethodsKey = (tenantId: string) => queryKey(tenantId, 'calcMethods');

export function useCalcMethods() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: calcMethodsKey(tenantId),
    queryFn: () => getDataGateway().library.listCalcMethods(tenantId),
    staleTime: LIBRARY_STALE_MS,
  });
}

/** Every method's tiers in one read (a handful of rows); screens pick a method's own. */
export const calcTiersKey = (tenantId: string) => queryKey(tenantId, 'calcMethods', 'tiers');

export function useCalcTiers() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: calcTiersKey(tenantId),
    queryFn: () => getDataGateway().library.listCalcTiers(tenantId),
    staleTime: LIBRARY_STALE_MS,
  });
}

export const kpiTemplatesKey = (tenantId: string) => queryKey(tenantId, 'kpiTemplates');

export function useKpiTemplates() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: kpiTemplatesKey(tenantId),
    queryFn: () => getDataGateway().library.listKpiTemplates(tenantId),
    staleTime: LIBRARY_STALE_MS,
  });
}

/** Every template's items in one read — the list shows each template's count and warning. */
export const kpiTemplateItemsKey = (tenantId: string) => queryKey(tenantId, 'kpiTemplates', 'items');

export function useKpiTemplateItems() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: kpiTemplateItemsKey(tenantId),
    queryFn: () => getDataGateway().library.listKpiTemplateItems(tenantId),
    staleTime: LIBRARY_STALE_MS,
  });
}


/**
 * Every goal of the tenant (any status, any cycle) — only for `libraryRules.libraryUsage`, the
 * "đang dùng cho N mục tiêu" counts that explain a lock before a save is refused. Advisory: the
 * gateway's refusal is the authority. Root `goals`, so any goal write refreshes it.
 */
export const libraryGoalUsageKey = (tenantId: string) => queryKey(tenantId, 'goals', 'libraryUsage');

export function useLibraryGoalUsage() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: libraryGoalUsageKey(tenantId),
    queryFn: () => getDataGateway().goals.listGoals(tenantId),
    staleTime: LIBRARY_STALE_MS,
  });
}

// ─── Writes ────────────────────────────────────────────────────────────────────────────────────

/** A library write: `save(tenantId, actorUserId, input)`, then the root it wrote is refreshed. */
function useLibraryWrite<I, R>(root: KeyRoot, save: (tenantId: string, actorUserId: string, input: I) => Promise<R>) {
  const { tenantId, user } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: I) => save(tenantId, user.id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, root) }),
  });
}

const library = (): LibraryGateway => getDataGateway().library;

export function useSavePerspective() {
  return useLibraryWrite('perspectives', (t, a, input: Parameters<LibraryGateway['savePerspective']>[2]) => library().savePerspective(t, a, input));
}

export function useSaveMeasureUnit() {
  return useLibraryWrite('measureUnits', (t, a, input: Parameters<LibraryGateway['saveMeasureUnit']>[2]) => library().saveMeasureUnit(t, a, input));
}

export interface SaveCalcMethodInput {
  method: Parameters<LibraryGateway['saveCalcMethod']>[2];
  tiers: readonly ChildInput<CalcTier, 'calcMethodId'>[];
}

export function useSaveCalcMethod() {
  return useLibraryWrite('calcMethods', (t, a, input: SaveCalcMethodInput) => library().saveCalcMethod(t, a, input.method, input.tiers));
}

export function useSaveKpiDefinition() {
  return useLibraryWrite('kpiDefinitions', (t, a, input: Parameters<LibraryGateway['saveKpiDefinition']>[2]) => library().saveKpiDefinition(t, a, input));
}

export interface SaveKpiTemplateInput {
  template: Parameters<LibraryGateway['saveKpiTemplate']>[2];
  items: readonly ChildInput<KpiTemplateItem, 'templateId'>[];
}

export function useSaveKpiTemplate() {
  return useLibraryWrite('kpiTemplates', (t, a, input: SaveKpiTemplateInput) => library().saveKpiTemplate(t, a, input.template, input.items));
}
