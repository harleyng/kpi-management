import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/contexts/useSession';
import { getDataGateway } from '@/integrations/data';
import type { AssignmentFilter, EmployeeFilter } from '@/integrations/data/types';
import { queryKey } from './keys';

/**
 * G1 · Tổ chức — reads the shared pickers need (Phase 1.4). Track T1 adds the writes beside them.
 *
 * Keys are `[tenantId, root, ...params]` (CLAUDE.md rule 7), so switching tenant can never serve
 * another tenant's cached rows and `[tenantId, root]` invalidates every variant of a list.
 * The org changes rarely during a session, hence the long `staleTime`.
 */

const ORG_STALE_MS = 5 * 60 * 1000;

export const orgUnitsKey = (tenantId: string) => queryKey(tenantId, 'orgUnits');

export function useOrgUnits() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: orgUnitsKey(tenantId),
    queryFn: () => getDataGateway().org.listOrgUnits(tenantId),
    staleTime: ORG_STALE_MS,
  });
}

/**
 * `filter` goes into the key as-is. Do not pass a picker's live search text here: every keystroke
 * would be a new key and a pending flash — pickers filter the loaded list on the client.
 */
export const employeesKey = (tenantId: string, filter: EmployeeFilter = {}) =>
  queryKey(tenantId, 'employees', filter);

export function useEmployees(filter: EmployeeFilter = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: employeesKey(tenantId, filter),
    queryFn: () => getDataGateway().org.listEmployees(tenantId, filter),
    staleTime: ORG_STALE_MS,
  });
}

/** Added by T6 (unit / position names on the result screens). */
export const positionsKey = (tenantId: string) => queryKey(tenantId, 'positions');

export function usePositions() {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: positionsKey(tenantId),
    queryFn: () => getDataGateway().org.listPositions(tenantId),
    staleTime: ORG_STALE_MS,
  });
}

/** Added by T6 — every assignment of the tenant (where someone sat at a period's end). */
export const assignmentsKey = (tenantId: string, filter: AssignmentFilter = {}) => queryKey(tenantId, 'assignments', filter);

export function useAssignments(filter: AssignmentFilter = {}) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: assignmentsKey(tenantId, filter),
    queryFn: () => getDataGateway().org.listAssignments(tenantId, filter),
    staleTime: ORG_STALE_MS,
  });
}
