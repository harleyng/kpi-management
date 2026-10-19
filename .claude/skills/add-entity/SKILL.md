---
name: add-entity
description: Add a domain entity to Syntra KPI end to end — type and state set in src/data/types.ts, methods on the DataGateway contract (always with tenantId), the mock implementation, fixtures, React Query hooks with *Key and invalidation, and a tenant-isolation test. Replaces OmniX's add-store + migration (there is no database yet). Trigger phrases: "add an entity", "new table", "new field", "store X", "add to the gateway".
---

# /add-entity — add a domain entity through every layer

There is no database: the `DataGateway` contract plus the mock adapter IS the data model until Phase 5.
Walk the six steps in order; skipping one is how a tenant leak or a stale screen gets in.

First, find the entity in `docs/erd/kpi_erd.mermaid` and note its ERD name and group (G1–G7). If it is
not in the ERD, or deviates from it, that is a decision — run `/log-decision` and note the deviation in
`architecture.md` (like D1–D6).

## 1. Type and state set — `src/data/types.ts`

- An `interface` named after the ERD table in PascalCase (`GOAL_PLAN` → `GoalPlan`), `id: string`,
  **`tenantId: string`** on every business entity, camelCase fields.
- A status column becomes a state set: `export const GOAL_PLAN_STATUSES = [...] as const;`, its type,
  and a Vietnamese `*_LABEL` map. Add the set to `business-rules.md` §5.
- No derived values stored on the type (totals, "chưa giao", scores before finalisation) — those are
  `src/lib/*Rules.ts` functions.

## 2. Contract — `src/integrations/data/types.ts`

Add methods to the right domain group. **Every method takes `tenantId` first** and returns domain types:

```ts
goals: {
  listPlans(tenantId: string, cycleId: string): Promise<GoalPlan[]>;
  savePlan(tenantId: string, plan: GoalPlanInput): Promise<GoalPlan>;
};
```

Writes that other tracks react to (launch, submit, approve, lock) also emit an event on the gateway's
event bus for T7.

## 3. Mock — `src/integrations/data/mockGateway.ts`

- Read and write only the tenant's partition; never scan across tenants.
- Reuse `src/lib/*Rules.ts` for any decision (can submit, next step, score) — never copy the logic.
- Honour the simulated latency and the error-injection switch.

## 4. Fixtures — `src/data/fixtures/`

Rows for Syntra (every state present at least once) and the minimum for Demo Co. Stable literal IDs, no
real personal data, `// ASSUMPTION Qn` where a value depends on an open question.

⚠️ After Gate 1 fixtures are the contract between tracks: a change is **Large** (system-architect, and
tell the other tracks).

## 5. Hooks — `src/hooks/queries/<domain>.ts`

- `export const thingsKey = (tenantId: string, …) => ['things', tenantId, …] as const;`
- Reads: `useQuery` with that key, `tenantId` from `useSession()`.
- Writes: `useMutation`, `invalidateQueries` for every key it changed, `toast` on success, catalogue
  copy (`errorSpecOf(error)`) on failure.

## 6. Tests

- **Tenant isolation**: every new read, called with Demo Co's `tenantId`, returns none of Syntra's rows.
- The mock's behaviour for each method (create → list returns it; update persists).
- Any new rule function in `src/lib/` gets its own `*.test.ts`.

## Always

- Add new hooks/components to `.agents/knowledge/component-registry.md`.
- Update `architecture.md` (data layer section) if the contract grew a new group.
- Phase 4: `npm run typecheck && npm run test && npm run build && npm run lint`.
