# Seed fixtures — the contract between tracks

`src/data/fixtures/*.ts` hold the seed data the mock gateway loads with `resetSeed()` (Phase 1.2).

## Why fixtures are a contract

The seven Phase 2 tracks (T1–T7, `docs/plans/KPI_repo_plan.md` §6.3) run **in parallel** because
they all read the same seed — no track waits for another track's screens. After **Gate 1** the
fixtures are frozen: a track that needs a fixture or the `DataGateway` contract changed is doing a
**Large** change. It goes through `system-architect`, and every other track is told before merge.

## Conventions

- One file per ERD group (`org.ts`, `library.ts`, `goals.ts`, `actuals.ts`, `forms.ts`,
  `results.ts`, `system.ts`) plus `index.ts` that assembles one `SeedData` per tenant.
- **Every row carries `tenantId`.** Two tenants: `Syntra` (full data) and `Demo Co` (minimal, used
  only by the tenant-isolation tests).
- IDs are stable, readable-in-tests UUIDs (generate once, paste as literals) — never
  `crypto.randomUUID()` at module load, or two reloads give two different seeds.
- Types come from `src/data/types.ts` (`import type` only). Statuses use the fixed sets there.
- **No real personal data.** Names are fictional; nothing is copied from the DATX "TH KQ" sheet.
- Every state of every state set appears at least once (plan §6.4): Goal Plans in every status,
  forms at every step including an overdue one and a finalised one, three months of actuals with
  manual, Excel and "API" rows.
- Values that depend on an open question are marked `// ASSUMPTION Qn` (plan §9).
- Fixtures must satisfy the contract's own invariants (`src/integrations/data/types.ts` header): every
  id a row points at exists **in the same tenant**; derived values (total weight, "chưa giao") are never
  seeded; a form's `currentStepId` belongs to its workflow; an auto-locked form has `overdueHandledAt`;
  delegations are revoked, not missing; at least one GOAL_CHANGE form with `GoalChangeItem`s, one
  delegation and one staged import batch with row errors exist for Syntra.
