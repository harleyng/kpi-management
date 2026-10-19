import { useMemo } from 'react';
import { useSession } from '@/contexts/useSession';
import type { CyclePeriod, Employee, Id, PerformanceCycle, UserAccount, WorkflowStep } from '@/data/types';
import { useWorkflowSteps } from '@/hooks/queries/forms';
import { useAllPeriods, useCycles } from '@/hooks/queries/goals';
import { useSessionDirectory } from '@/hooks/queries/session';
import { actorDirectoryOf } from '@/lib/formViewRules';
import { combineQueries, type QueryState } from '@/lib/queryState';
import type { ActorDirectory } from '@/lib/workflowRules';
import type { SessionDirectory } from '@/lib/sessionRules';

export interface FormLookups {
  /** Every lookup below, combined — a list waits for it before naming anything. */
  query: QueryState;
  ready: boolean;
  steps: WorkflowStep[];
  directory: SessionDirectory | undefined;
  actorDirectory: ActorDirectory | undefined;
  employee: (id: Id | null) => Employee | null;
  employeeName: (id: Id | null) => string;
  account: (id: Id | null) => UserAccount | null;
  /** A user's display name (account name, else their employee's), "—" when unknown. */
  userName: (id: Id | null) => string;
  period: (id: Id | null) => CyclePeriod | null;
  cycle: (id: Id | null) => PerformanceCycle | null;
}

/**
 * The names, periods and steps every forms screen shows. People come from the session's directory
 * (already loaded and cached by `SessionProvider` — no second query), so the actor rules and the
 * names read the same rows (R3, T5 phase 2).
 */
export function useFormLookups(): FormLookups {
  const { tenantId } = useSession();
  const directoryQuery = useSessionDirectory(tenantId);
  const steps = useWorkflowSteps();
  const periods = useAllPeriods();
  const cycles = useCycles();

  const directory = directoryQuery.data;
  const lookups = useMemo(() => {
    const employees = new Map((directory?.employees ?? []).map((e) => [e.id, e]));
    const accounts = new Map((directory?.accounts ?? []).map((a) => [a.id, a]));
    const periodById = new Map((periods.data ?? []).map((p) => [p.id, p]));
    const cycleById = new Map((cycles.data ?? []).map((c) => [c.id, c]));
    const employee = (id: Id | null) => (id ? (employees.get(id) ?? null) : null);
    const account = (id: Id | null) => (id ? (accounts.get(id) ?? null) : null);
    return {
      steps: steps.data ?? [],
      directory,
      actorDirectory: directory ? actorDirectoryOf(directory) : undefined,
      employee,
      employeeName: (id: Id | null) => employee(id)?.fullName ?? '—',
      account,
      userName: (id: Id | null) => {
        const a = account(id);
        if (!a) return '—';
        return a.displayName || employee(a.employeeId)?.fullName || a.login;
      },
      period: (id: Id | null) => (id ? (periodById.get(id) ?? null) : null),
      cycle: (id: Id | null) => (id ? (cycleById.get(id) ?? null) : null),
    };
  }, [directory, steps.data, periods.data, cycles.data]);

  return {
    ...lookups,
    query: combineQueries([directoryQuery, steps, periods.query, cycles]),
    ready: directory !== undefined && steps.data !== undefined && periods.data !== undefined && cycles.data !== undefined,
  };
}
