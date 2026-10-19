# React Query hooks — one file per domain

`src/hooks/queries/<domain>.ts` is the only layer that calls `getDataGateway()`. Components and
pages call these hooks; they never call the gateway, and never import an adapter.

```
components/pages → src/hooks/queries/<domain>.ts → getDataGateway() → mock | supabase adapter
```

## Conventions

- **Every query exports its key**, named `*Key`, built from the tenant first:
  ```ts
  export const goalPlansKey = (tenantId: string, filter: GoalPlanFilter) =>
    ['goalPlans', tenantId, filter] as const;

  export function useGoalPlans(filter: GoalPlanFilter) {
    const { tenantId } = useSession();
    return useQuery({
      queryKey: goalPlansKey(tenantId, filter),
      queryFn: () => getDataGateway().goals.listGoalPlans(tenantId, filter),
    });
  }
  ```
  `tenantId` in the key means switching tenant can never serve another tenant's cached rows.
  **The one exception:** `session.ts` (`useTenants`, `useSessionDirectory(tenantId)`) runs inside the
  `SessionProvider`, before a session exists, so it takes the tenant explicitly. Nothing else does.
- **Reads** use `useQuery`; `staleTime` matches how fast the data really changes.
- **Writes** use `useMutation` that calls `queryClient.invalidateQueries` on success for every key
  it changed, plus a `sonner` toast. On error, show the catalogue copy (`errorSpecOf(error)` from
  `src/lib/errorCatalog.ts`) — never a retyped string, never a silent no-op.
- **Writes pass `actorUserId`** (from `useSession()`) as the second argument. Never call
  `system.recordNotification` / `system.recordAudit` — those are T7's listeners, in `src/integrations/`.
- **Cross-track writes** (`forms.act` moves a form, a plan, other people's inboxes) cannot list every key
  they touch. TODO Phase 1.2: `keys.ts` with every key root, and one `useGatewayEventInvalidation` that
  maps `DomainEvent`s (`entity.changed.entityName`) to key roots — so no track hand-maintains another
  track's keys.
- **Time** comes from `getDataGateway().clock.now()`, never `new Date()` — the dev toolbar moves it.
- **No arithmetic here.** A hook that needs a score, a roll-up or a "can submit" answer calls a pure
  function in `src/lib/*Rules.ts`.
- An empty answer and a pending one are different facts: a redirect or a destructive default waits
  for every query it reads (`common-pitfalls.md`).

New entity? Use the **`/add-entity`** skill — it walks type → contract → mock → fixture → hooks → test.
