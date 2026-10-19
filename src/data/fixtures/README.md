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

## Identity and permissions (Phase 1.3 requirements)

The session and `can()` (`src/lib/permissionRules.ts`, business-rules.md §9) read these rows, so the seed
must provide them exactly:

- **PERMISSION** rows = `permissionRows()` — the global catalogue, ids `perm.<code>`, identical for every
  tenant. **ROLE_PERMISSION** rows = `defaultRolePermissionRows(tenantId, roles)` for each tenant. Six
  **ROLE** rows per tenant (one per `ROLE_CODES`), with per-tenant ids. Never hand-write these rows.
- **USER_ROLE**: every account with an `employeeId` holds **EMPLOYEE / Self** (BR-KPI-62) plus its persona's
  role with `DEFAULT_ROLE_SCOPE`: MANAGER = `OrgUnit`, `scopeOrgUnitId` = the unit they head,
  `includeChildren: true`; HR / CNB / BOD / ADMIN = `Tenant`.
- **Accounts**: one persona per role; at least one person with two non-EMPLOYEE roles; one `Inactive`
  account (its employee still `Official`); one system account (`employeeId: null`, ADMIN). **The first
  Active account of each tenant is the demo's starting persona** (the session falls back to it).
  `Employee.email` is set for every account holder.
- **Org**: exactly one root unit (`parentId: null`) per tenant; a manager whose unit has a child unit; one
  concurrent (`isPrimary: false`) assignment; one resigned employee with `leftOn` and a closed assignment;
  one dated move between units; one Inactive unit with a historical plan.
- **Demo Co** has its own full persona set, so tenant isolation is demonstrable on screen.
- Adding a permission code, or changing the default matrix, after Gate 1 is a **Large** change.

