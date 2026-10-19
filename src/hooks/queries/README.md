# React Query hooks — one file per domain

`src/hooks/queries/<domain>.ts` is the only layer that calls `getDataGateway()`. Components and
pages call these hooks; they never call the gateway, and never import an adapter.

```
components/pages → src/hooks/queries/<domain>.ts → getDataGateway() → mock | supabase adapter
```

## Conventions

- **Every query exports its key**, named `*Key`, built from the tenant first:
  ```ts
  export const goalPlansKey = (tenantId: string, cycleId: string) =>
    ['goalPlans', tenantId, cycleId] as const;

  export function useGoalPlans(cycleId: string) {
    const { tenantId } = useSession();
    return useQuery({
      queryKey: goalPlansKey(tenantId, cycleId),
      queryFn: () => getDataGateway().goals.listPlans(tenantId, cycleId),
    });
  }
  ```
  `tenantId` in the key means switching tenant can never serve another tenant's cached rows.
- **Reads** use `useQuery`; `staleTime` matches how fast the data really changes.
- **Writes** use `useMutation` that calls `queryClient.invalidateQueries` on success for every key
  it changed, plus a `sonner` toast. On error, show the catalogue copy (`errorSpecOf(error)` from
  `src/lib/errorCatalog.ts`) — never a retyped string, never a silent no-op.
- **No arithmetic here.** A hook that needs a score, a roll-up or a "can submit" answer calls a pure
  function in `src/lib/*Rules.ts`.
- An empty answer and a pending one are different facts: a redirect or a destructive default waits
  for every query it reads (`common-pitfalls.md`).

New entity? Use the **`/add-entity`** skill — it walks type → contract → mock → fixture → hooks → test.
