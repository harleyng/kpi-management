# React Query hooks — one file per domain

`src/hooks/queries/<domain>.ts` is the only layer that calls `getDataGateway()`. Components and
pages call these hooks; they never call the gateway, and never import an adapter.

```
components/pages → src/hooks/queries/<domain>.ts → getDataGateway() → mock | supabase adapter
```

## Conventions

- **Every query exports its key**, named `*Key`, built with `queryKey(tenantId, root, ...params)`
  from `keys.ts` — `[tenantId, root, ...params]`, the tenant FIRST (CLAUDE.md rule 7):
  ```ts
  export const goalPlansKey = (tenantId: string, filter: GoalPlanFilter) =>
    queryKey(tenantId, 'goalPlans', filter);

  export function useGoalPlans(filter: GoalPlanFilter) {
    const { tenantId } = useSession();
    return useQuery({
      queryKey: goalPlansKey(tenantId, filter),
      queryFn: () => getDataGateway().goals.listGoalPlans(tenantId, filter),
    });
  }
  ```
  `tenantId` in the key means switching tenant can never serve another tenant's cached rows, and
  `[tenantId, root]` invalidates every variant of a list. A new query uses an existing root or adds
  one to `KEY_ROOTS`, naming the entities it reads.
  **The one exception:** `session.ts` (`useTenants`, `useSessionDirectory(tenantId)`) runs inside the
  `SessionProvider`, before a session exists, so it takes the tenant explicitly. Nothing else does.
- **Reads** use `useQuery`; `staleTime` matches how fast the data really changes.
- **Writes** use `useMutation`, plus a `sonner` toast. Keys of entities the gateway announces are
  invalidated for you (below), so a mutation invalidates only what no event covers (rare) — two
  invalidations of the same key only cost a second refetch. On error, show the catalogue copy (`errorSpecOf(error)` from
  `src/lib/errorCatalog.ts`) — never a retyped string, never a silent no-op.
- **Writes pass `actorUserId`** (from `useSession()`) as the second argument. Never call
  `system.recordNotification` / `system.recordAudit` — those are T7's listeners, in `src/integrations/`.
- **Cross-track writes** (`forms.act` moves a form, a plan, other people's inboxes) cannot list every key
  they touch, so nobody does: `useGatewayEventInvalidation` (mounted once by `GatewayEventBridge` in
  `main.tsx`) turns every `entity.changed` of the session's tenant into "invalidate every root of
  `KEY_ROOTS` that reads this entity", once per microtask. No track maintains another track's keys.
- **`dev.resetSeed()` emits no events** — whoever calls it (the 1.4 dev toolbar, `useResetSeed`)
  invalidates or clears the whole cache.
- **Time** comes from `getDataGateway().clock.now()`, never `new Date()` — the dev toolbar moves it.
- **No arithmetic here.** A hook that needs a score, a roll-up or a "can submit" answer calls a pure
  function in `src/lib/*Rules.ts`.
- An empty answer and a pending one are different facts: a redirect or a destructive default waits
  for every query it reads (`common-pitfalls.md`).

New entity? Use the **`/add-entity`** skill — it walks type → contract → mock → fixture → hooks → test.
