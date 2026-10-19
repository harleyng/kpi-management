# Architecture — Syntra KPI

> Living document. Update it whenever an architectural pattern is established or changed.
> Referenced by: `cto`, `system-architect`, `workflow-expert`, `qa`, `ba-expert`.

---

## Overview

kpi-management is the **prototype** of Syntra KPI — a Balanced Scorecard KPI management system with
three tiers (Company → Department → Individual), cascade/link, a three-step evaluation and a live
dashboard. **There is no database yet**: all data goes through a `DataGateway` contract served by a
mock adapter (in-memory + localStorage, seeded fixtures). Authentication is simulated. The app is
**multi-tenant from day one**. UI copy is Vietnamese, written inline — there is no i18n library.

Source plan: `docs/plans/KPI_repo_plan.md`. The repository was bootstrapped from the OmniX Studio
scaffold (tooling, agent panel, workflow) on 2026-10-19; no OmniX business code was carried over.

---

## Stack

| Layer | Detail |
|---|---|
| Framework | React 18 + TypeScript (`strict: true`) + Vite 5 (`@vitejs/plugin-react-swc`) |
| UI | shadcn-ui + Tailwind CSS + Radix. White background, primary `#863EEA` (`--primary: 265 80% 58%`) |
| Server state | **React Query v5** over the `DataGateway`, in `src/hooks/queries/*` |
| Client state | **Zustand** (`src/lib/*Store.ts`) + `SessionContext` (simulated tenant and person; access = the union of their roles) |
| Forms | React Hook Form + Zod |
| Charts | Recharts (dashboard, Phase 3) |
| Excel | **exceljs** for every import/export (not the npm `xlsx` package — outdated) |
| Routing | React Router 6, every page `React.lazy` |
| Tests | Vitest + Testing Library (unit, a gate) · Playwright (`e2e/specs`) |
| Dev port | `8082` (`npm run dev`); Playwright's own server on `8182` |
| Package manager | **npm** (pinned via `packageManager`, Node ≥18) |
| Alias | `@/` → `src/` |
| Hosting | Vercel (SPA rewrite to `index.html`, `vercel.json`) |

---

## Directory structure

```
src/
├── App.tsx                 # Routes under one AppShell; every page React.lazy
├── main.tsx                # Providers: RouteErrorBoundary · QueryClient · Tooltip · Toaster · Router · Session
├── components/
│   ├── ui/                 # shadcn primitives — NEVER edited directly; wrap or compose instead
│   ├── layout/             # AppShell, AppSidebar, TopBar (+ "Dữ liệu giả lập" banner), SidebarAccount,
│   │                       #   RouteErrorBoundary, navConfig (5 groups by role)
│   └── shared/             # PageHeader, PlaceholderPanel, EmptyState, ErrorState(Card), ConfirmDialog,
│                           #   StatusBadge (+ per-set badges, statusTones), DataTable, FormField,
│                           #   EntityCombobox, KpiPicker, EmployeePicker, OrgUnitTree, Pagination,
│                           #   SearchInput, SectionTitle, CopyButton
├── contexts/
│   ├── useSession.ts       # session contract + hook (a file with NO JSX)
│   └── SessionContext.tsx  # the provider: tenants → directory → person → access profile (Phase 1.3)
├── data/
│   ├── types.ts            # domain types (47 P1 tables + D1–D8) + FIXED STATE SETS with label maps
│   └── fixtures/           # seed data — the CONTRACT between tracks (Phase 1.2)
├── hooks/
│   └── queries/            # React Query hooks per domain — the only callers of getDataGateway()
├── integrations/
│   ├── data/               # DataGateway: types.ts (contract), index.ts, mockGateway.ts + mock/ (Phase 1.2), supabaseGateway.ts (stub)
│   └── insight/            # InsightGateway: the simulated AI assistant (Phase 3)
├── lib/                    # *Rules.ts (pure, tested), *Store.ts (Zustand), errorCatalog, utils, pagination
├── pages/                  # one placeholder page per menu item (Phase 0)
└── test/                   # Vitest setup
```

`components/ui/` is vendored shadcn code — **do not hand-edit it**. If you need a new variant, wrap it
in `components/shared/`.

---

## Route table

Every route lives in `src/App.tsx` under a single `<AppShell>`, each page its own `React.lazy` chunk.
Navigation is defined in `src/components/layout/navConfig.ts` — **5 groups, 17 items** (plan §7.1).
Each item names the **permission** that shows it and opens its route (`null` = every signed-in user). The
sidebar shows `visibleNavGroups(NAV_GROUPS, access)` and the AppShell **route guard** renders ERR-KPI-05 for a
path `canOpenPath` refuses — both in `src/lib/permissionRules.ts` (Phase 1.3). `navConfig.test.ts` fails if a
route of `App.tsx` is neither a menu item nor in `PUBLIC_PATHS` (`/`, `*`). A detail page still checks its own
record with `useSession().can(code, resource)`. Under the default matrix the menu is plan §7.1, except ADMIN,
who holds every permission and sees all five groups.

| Route | Page | Menu group · permission (default holders; ADMIN holds all) | WBS / phase |
|---|---|---|---|
| `/` | → redirects to `/my/kpi` | — | — |
| `/my/kpi` | KPI của tôi | Của tôi · — (all) | 4.3.2–4.3.5 (T3), 4.4.2 (T4) |
| `/my/tasks` | Việc cần xử lý | Của tôi · — (all) | 4.5.5 (T5) |
| `/my/results` | Kết quả của tôi — **built (T6)**: own results by cycle, figures only once finalised (BR-KPI-46) | Của tôi · — (all) | 4.6.4 (T6), 4.7.2 (Phase 3) |
| `/team/kpi` | KPI đội nhóm | Đội nhóm · `team.view` (MANAGER) | 4.3.4 (T3) |
| `/team/reviews` | Duyệt & đánh giá | Đội nhóm · `team.view` (MANAGER) | 4.5.2–4.5.4 (T5) |
| `/dashboard` | Dashboard | Điều hành · `dashboard.view` (BOD, MANAGER, HR) | 4.7.1–4.7.4 (Phase 3) |
| `/admin/cycles` | Chu kỳ | Quản trị KPI · `cycle.manage` (HR, CNB) | 4.3.1, 4.3.6 (T3) |
| `/admin/library` | Thư viện KPI | Quản trị KPI · `library.manage` (HR, CNB) | 4.2.1–4.2.3, 4.2.5 (T2) |
| `/admin/templates` | Bộ mẫu | Quản trị KPI · `library.manage` (HR, CNB) | 4.2.4 (T2) |
| `/admin/launches` | Khởi chạy phiếu | Quản trị KPI · `form.launch` (HR, CNB) | D5, 4.5.1 (T5) |
| `/admin/actuals` | Số liệu & import | Quản trị KPI · `actual.import` (HR, CNB) | 4.4.2–4.4.6 (T4), 4.3.7 (T3) |
| `/admin/results` | Kết quả & lương — **built (T6)**: tabs Kết quả kỳ · Xếp loại & quy đổi · Xuất file lương (`?tab=&cycle=&period=`); export needs `result.export` (CNB) | Quản trị KPI · `result.finalize` (HR, CNB) | 4.6.1–4.6.4 (T6) |
| `/system/org` | Tổ chức | Hệ thống · `org.manage` | 4.1.1–4.1.4, 4.1.7 (T1) |
| `/system/users` | Người dùng & quyền | Hệ thống · `user.manage` | 4.1.5–4.1.6 (T1) |
| `/system/data-sources` | Nguồn dữ liệu | Hệ thống · `datasource.manage` | 4.4.1, 4.4.4–4.4.5 (T4) |
| `/system/notification-templates` | Mẫu thông báo | Hệ thống · `notification.manage` | 4.8.1–4.8.3 (T7) |
| `/system/audit-log` | Nhật ký | Hệ thống · `audit.view` | 4.8.4 (T7) |
| `*` | Không tìm thấy trang | — | — |

The `e2e/specs/smoke.spec.ts` list mirrors this table — keep them in step.

---

## Data layer — the `DataGateway`

```
components/pages → React Query hooks (src/hooks/queries/*) → getDataGateway()
                                                              ├── mockGateway      (Phase 1.2 — see "Mock adapter" below)
                                                              └── supabaseGateway  (Phase 5 — throws until then)
```

- **Contract** — `src/integrations/data/types.ts`, fixed in Phase 1.1 (reviewed by system-architect,
  cto and workflow-expert). Groups: `clock` · `platform` (tenants) · `org` (G1) · `library` (G2) ·
  `goals` (G3) · `actuals` (G4) · `forms` (G5 + D5 launches + GOAL_CHANGE items) · `results` (G6) ·
  `system` (G7) · `scheduler` · `events` · optional `dev` (mock only).
- **Selection** — `getDataGateway()` in `index.ts` reads `VITE_DATA_ADAPTER` (build-time): unset/`mock` →
  mock, `supabase` → the stub (throws "not implemented"), anything else → throws. Tested in
  `index.test.ts`.
- **Tenant boundary** — every method takes `tenantId` first and filters by it; an id from another tenant
  answers ERR-KPI-02 like a missing one; every id inside a write payload must resolve in the tenant
  (else ERR-KPI-06). With no RLS, this is the isolation; the tenant-isolation tests (reads AND writes)
  become the RLS integration tests in Phase 5. Only `platform.*` is not tenant-filtered.
- **Actor** — every user write takes `actorUserId` second; "who did it" never comes from the payload.
  When a write acts for someone else (proxy, delegation, an EDIT made with that standing),
  `Tx.onBehalfOfUserId` makes its events and audit rows name both people. System writes
  (`system.recordNotification`, `system.recordAudit`, `scheduler.runDue`) have no actor; the first two
  are made only by T7's listeners in `src/integrations/`, and the audit entry is built from the event.
- **Authorization** (Gate 1, `mock/authorize.ts`) — every user write declares its auth when it is
  registered: `rt.write(name, auth, body)`, `auth` = `{ permission, resource? }` | `'workflow'` |
  `'actor'`. The one hook checks the actor is an Active account of the tenant, builds their access
  profile (`permissionRules.buildAccessProfile`, as of the tenant's today, once per write) and calls
  `can()` on every resource the resolver names (an update names the stored owner and the new one).
  `'workflow'` = BR-KPI-61: `act` and the form editors are decided by `workflowRules` in the body; only
  "Active account of the tenant" is checked. `'actor'` = the row is the actor's own
  (`markNotificationRead`). An id that names no row of the tenant resolves to "code only", so the
  integrity check still answers a foreign id exactly like a missing one. `platform.saveTenant` needs
  `org.manage` in the actor's home tenant. Refusal = ERR-KPI-05. Writes with no dedicated code:
  `saveWorkflow` → `cycle.manage`; `saveLaunchRule` / `createLaunch` / `cancelLaunch` → `form.launch`;
  calculate / adjust / finalize / lock results → `result.finalize`; `saveTenant` → `org.manage`.
  **Reads are not filtered per user** at Gate 1: they are tenant-scoped, screens gate with `can()`, and
  row-level read filtering is RLS in Phase 5 — tracks must not add ad-hoc read filters.
- **One clock** — the adapter reads every "now" from `clock.now()`; screens read it too (deadline badges).
  The "Công cụ demo" toolbar (`DevToolbar`, `component-registry.md`) moves it (`dev.setNow`), sets the
  latency and the failure injection, runs the scheduler and reseeds. `scheduler.runDue(tenantId)` runs
  due launches, recurring rules, overdue steps and reminders as of that clock, idempotently.
- **Writes** — `Upsert<T, Managed>` omits `id`/`tenantId` and the columns the gateway owns (status
  transitions, timestamps, authors). Aggregates (method + tiers, template + items, workflow + steps,
  scale + levels) save together with `ChildInput` children **matched by id**, so references to a step
  or a rating level survive a save; they return `Aggregate<Parent, Child>`.
- **Lists** — filters are AND-ed; an omitted field does not filter, an empty id list matches nothing.
  Lists that grow without bound (`listForms`, `listNotifications`, `listAuditLog`) return `Page<T>`.
- **Events** — every successful write emits `entity.changed` (with before/after), plus domain events
  (`goalPlan.statusChanged`, `form.launched`, `form.stepActed` with `assigneeUserIds`, `form.dueSoon`,
  `form.overdue`, `actuals.recorded`, `results.finalized`, `payroll.exported`). `form.dueSoon` carries
  `reminderKey` (= `workflowRules.reminderKey(form)`), which T7 uses as the notification's
  `sourceEventId` (the scheduler does not dedupe reminders, BR-KPI-13). T7 and the query-cache
  invalidation listen; listeners are idempotent by `event.id`, registered once at gateway construction,
  and a rejected listener is reported, never swallowed.
- **Imports** — the client parses Excel (exceljs) into typed rows; `actuals.stageImport` validates and
  stores rows + row errors on the `ImportBatch`; `commitImport` applies all rows or none.
- **IDs** — strings (`crypto.randomUUID()` at runtime; deterministic UUID-shaped `seedId(...)` in
  fixtures; `perm.<code>` for the global permission catalogue). The ERD's `bigint` keys are for the
  future database.
- **Errors** — methods reject with `KpiError` (ERR-KPI-01…06 are the contract's generic codes); hooks
  surface the catalogue copy. React Query retries only `isRetryable` failures (01, 03) — never a
  `KpiDeferredError` (a method waiting for its track, below).
- **Query keys** — `[tenantId, root, ...params]` via `queryKey()` in `src/hooks/queries/keys.ts`. Each
  root of `KEY_ROOTS` names the entities it reads; `useGatewayEventInvalidation` (mounted once by
  `GatewayEventBridge` inside `SessionProvider`) invalidates every root an `entity.changed` touches,
  batched per microtask. `dev.resetSeed()` emits nothing — its caller clears the cache.

### Mock adapter (Phase 1.2)

`src/integrations/data/mock/` — `mockGateway.ts` exports `createMockGateway({ storage: localStorage })`.

| File | Responsibility |
|---|---|
| `runtime.ts` | The per-call wrapper every method runs through: latency (150 ms; 0 under Vitest) → failure injection (`dev.setFailureMode`, glob on `group.method`; reads 01, writes 03) → copy the input → tenant check (unknown tenant 02) → authorize → transaction → integrity → save → swap in → emit → copy the output. Write bodies are synchronous, so two writes never interleave. The registry: every method's kind, every write's declared `auth`, `deferred` (rejects `KpiDeferredError`), `pendingGuards`, `trackOwned` (which Phase 2 track owns what is still deferred / unguarded) |
| `store.ts` | Per-tenant tables (`Map` per collection; `RolePermission` keyed `roleId\|permissionId`; `Tenant` and `Permission` global). Rows are deep-frozen. `Tx` copies a collection on its first write and swaps it in only on commit |
| `schema.ts` | The table definitions a database would have: writable columns (a payload's other keys are ignored — `tenantId`, status, authors come from the gateway), foreign keys with kind (`owner` immutable · `reference` · `hierarchy` acyclic) and delete policy (`restrict` · `cascade` · `setNull`), nested paths (`recipientFilter.orgUnitIds[]`, `proposed.kpiDefId`), polymorphic ids (`Notification.refId`), unique indexes (per tenant, partial ones), CHECK-like row and collection checks |
| `integrity.ts` | Enforces the schema at COMMIT: a reference outside the tenant answers ERR-KPI-06 worded exactly like a missing id; owner / immutable column changed → 06; unique / check → 06; removal of a referenced row → 04 (cascades and set-null applied by `removeRow`) |
| `persistence.ts` | localStorage `kpi.meta` (seed version), `kpi.clock`, `kpi.global.*`, `kpi.t.<tenant>.<Collection>`. A save writes every touched key AND the clock or none of them (previous strings restored; ERR-KPI-03) — nothing after the save can fail. A stored row of another tenant, or a missing key, fails the load (01). A different `SEED_VERSION` reseeds. `MemoryStorage` for tests |
| `clock.ts` | Starts at `SEED_NOW`, flows with real time while the app runs, strictly increasing; `setNow(null)` → `SEED_NOW`; saved in every commit's batch, so a reload continues from the simulated time (time spent closed does not count); a corrupt saved clock is reported |
| `bus.ts` | Per-tenant subscribers + system listeners; events only after commit; a listener's throw / rejection goes to `onDiagnostic` (console.error), never fails the write |
| `authorize.ts` | The ONE authorization hook (`authorizeWrite`), run for every user write before its body with the write's declared `WriteAuth`: the actor is an Active account of the tenant (else 05), then `can()` on every resource the resolver names (else 05) — see "Authorization" above. Also the resource resolvers (`planIdResource`, `goalResource`, `formResource`, `userResource`: `undefined` = no such row → code only; `null` = owner unresolvable → deny), `profileOf` / `actorCan` (the actor's profile, cached per transaction, for workflow inputs that are permissions: `form.proxy`, `form.cancel`, `delegation.manage`) and `clockOf` |
| `workflowContext.ts` | The workflow methods' shared plumbing: `throwRefusal` / `throwIssues` / `throwDecision` (a rule's answer → `KpiError`), `refOrInvalid` (a payload id → ERR-KPI-06 worded like the integrity check), `directoryOf`, `entitlementCtx`, `assigneesFor`, `assertMayEdit` (EDIT standing + `editRefusal`), `assertPlanEditable` (`canEditPlan` with its context from the rows), `setPlanStatus` (the one plan-status write: LOCK / UNLOCK audit + `goalPlan.statusChanged`), `fireLaunch` (recipients → Draft plans → forms → evaluation items with actual snapshots → Launched → `form.launched`). Decides nothing |
| `audit.ts` | The audit trail: the runtime writes one `AuditLog` row per `entity.changed` IN the write's transaction (not for notifications), so a change and its audit entry are saved together or not at all; the row's id is the event's, so `system.recordAudit` of the same event is a no-op. Notification rendering (T7) registers its system listener in `createMockGateway` |
| `groups/*.ts` | One file per contract group — WHAT each method does, nothing else |
| `payrollWorkbook.ts` (T6) | Renders `payrollRules.buildPayrollSheet` as the `.xlsx` payroll file (sheets "Lương KPI", "Thông tin") — the ONLY importer of exceljs, dynamically, so it is an async chunk of its own |
| `groups/scheduler.ts` | `scheduler.runDue` — one system transaction: due launches → rule firings → overdue (snapshot of the forms at tick start) → reminders; returns the `SchedulerReport` |

`groups/results.ts` loads the rows with `tx.all`, calls `resultRules`' orchestrators
(`buildPeriodResults`, `applyAdjustment`, `finalizePeriodResults`, `lockPeriodResults`) and applies the
returned `ResultChanges`; the seed's `ResultScript` (`src/data/fixtures/results.ts`) runs the same
functions on its arrays, so a recalculated seeded Draft is identical to the seeded row. Configuration
guards: `saveCalcMethod` (`validateCalcMethod`), `saveRatingScale` (`validateRatingScale`),
`savePayoutRule` (`validatePayoutRule` + level in scale) — a reference that does not resolve is left to
the integrity check, so a foreign id still answers like a missing one.

`results.exportPayroll` (T6, BR-KPI-45) is the one method built on **`Runtime.preparedWrite`** — a user
write with async work between reading and committing: authorize → `prepare` on an uncommitted
transaction (`buildPayrollSheet`) → `await produce` outside any transaction (render the workbook) → a
fresh transaction that authorizes again and re-runs `prepare`; if the answer changed meanwhile (ignoring
its clock reading) → ERR-KPI-04 `CHANGED_DURING_WRITE`, else `apply` (FileObject + PayrollExport +
`payroll.exported`) and commit; `afterCommit` keeps the bytes in `rt.blobs` (memory only). Latency and
failure injection run once; the registration, `auth` and events are `write`'s.

**Track-owned deferrals (after Gate 1).** Every Phase 1 rule is wired: no method is deferred and no guard
is pending, bar a Phase 2 track's own work package (`registry.trackOwned`, pinned by the Gate 1 test in
`src/integrations/data/mock/runtime.test.ts`; adding to it is a Large change):
- *Deferred* (rejects `KpiDeferredError` until the track wires it; its `auth` is already declared) —
  T4: `actuals.stageImport`, `commitImport` (4.4.3), `runSync` (4.4.5). (T6's `results.exportPayroll`
  was wired by T6, 2026-10-19.)
- *Pending guard* — none. (`actuals.rejectImport` was wired at Gate 1 QA: only a Validating batch,
  `actualRules.canRejectImport`; T4's import framework builds the rest of the batch lifecycle.)

Wired at Gate 1 — workflow lane: `setCycleStatus`, `lockGoalPlan`, `unlockGoalPlan`, `createLaunch`,
`cancelLaunch`, `startForm`, `listInbox`, `saveEvaluationItems`, `act`, `scheduler.runDue` (now
`rt.system`, no actor); guards on `saveCycle`, `savePeriods` (and `setPeriodLocked`), `saveKgi`,
`deleteKgi`, `saveGoal`, `deleteGoal`, `setTargetLevels`, `setPeriodTargets`, `saveAlignment`,
`deleteAlignment`, `saveWorkflow`, `saveLaunchRule`, `saveGoalChangeItems`, `saveDelegation`,
`revokeDelegation`. Scoring lane: `calculateResults`, `setAdjustment`, `finalizeResults`, `lockResults`;
guards on `recordActual`, `saveCalcMethod`, `saveRatingScale`, `savePayoutRule`. Foundation: the
permission check of every write (above).
- **Naming** — gateway methods use the short domain noun (`listPositions` for `JobPosition`,
  `listWorkflows` for `WorkflowTemplate`); the types keep the ERD names.

### AI assistant — `InsightGateway`

`src/integrations/insight/` — same pattern, one deterministic mock, every method takes `tenantId`
(Phase 3, WBS 4.7.4).

### Fixtures strategy

`src/data/fixtures/` (its README tells the whole story, date by date) — two tenants: **Syntra**
(3 divisions, the 8 DATX departments + Kinh doanh, 42 fictional people, all 6 roles; the library from
DATX "2. KPIs phòng ban" cleaned per `ASSUMPTION Q14`; cycles 2026 Closed · 2027 Active · 2028 Planning;
Goal Plans in every status; three months of actuals from all three sources; forms at every step with a
history that replays; launches, delegations, notifications, audit; results T01 Locked · T02 Final
(+ Drafts) · T03 Draft, produced by `resultRules` (`syntra/results.ts`, run last)) and **Demo Co** (small, but a row in every collection, reusing Syntra's codes). The seed's "now"
is **2027-04-06 09:00 +07**; the scheduler last ran 2027-04-01 09:00. Ids come from `seedId`.

**Frozen at Gate 1 (2026-10-19)** as the contract between tracks: `src/data/fixtures/freeze.test.ts` pins
the seed hash, the gateway surface (`group.method:kind[:permission]`) and the entity count (49);
`SEED_VERSION` is `2027-04-06.G1`. A failing freeze test is a **Large** change: system-architect
reviews it, every track is told, `SEED_VERSION` is bumped, `FROZEN` updated, `/log-decision`. The seed
still leaves to the tracks only the states T1 `Tenant:Suspended`, T3 `Cycle:Evaluating`, T4
`Sync run:Running` (`STATE_EXEMPTIONS`) and the empty `PayrollExport` (`EMPTY_UNTIL_WIRED`: T6 wired the
export without seeding one).

---

## ERD

`docs/erd/kpi_erd.mermaid` — 67 tables across P1–P3 (47 in P1, groups G1–G7). It is the same file the
visual editor at `/Users/m116gb/Downloads/Tool/erd_editor.html` opens; edit it there or as text, and keep
this copy in sync. The ERD file itself is **not** edited for the deviations below — this table is the
delta Phase 5 applies when it writes the SQL schema.

### ERD deviations (decided in Phase 1.1, `src/data/types.ts`)

| # | Deviation | Why |
|---|---|---|
| — | Every business row carries `tenantId`, also child tables the ERD draws without it (KGI, GOAL, CALC_TIER…); only `PERMISSION` has none | ERD convention "every table has tenant_id"; the mock filters on it |
| — | `GOAL_PLAN.total_weight` not stored | Derived (`goalPlanRules`); a stored total drifts |
| — | No generic `created_at`/`updated_at` on rows | The audit log holds history; timestamps exist where the domain reads them |
| D1 | New `GOAL_TARGET_LEVEL` (goalId, L1/L2/L3, targetValue/targetText, scorePct); `LEVELS` calc method | HR guide pp. 23, 28, 63 |
| D2 | `GOAL.visibility` PUBLIC/PRIVATE | HR guide pp. 21–22 |
| D3 | `GOAL_ALIGNMENT.allocated_value`; `GOAL.self_assigned_value` ("Tự giao"); "chưa giao" derived | HR guide p. 24 |
| D4 | `GOAL.kri_type` KRItc/KRIpt — stored, hidden (Q6) | HR guide p. 22 |
| D5 | New `FORM_LAUNCH`; `FORM_LAUNCH_RULE` moved P2 → P1 (+ name, period_type, due_days, recipients); `FORM_INSTANCE.launch_id` | HR guide pp. 89–93 |
| D6 | `WORKFLOW_STEP.evaluation_column`, `requires_comment` feed `formRules.canSubmit()` — a rule, no table | Manager guide p. 26 |
| D7 | Columns the P1 screens or the review needed: `EMPLOYEE.left_on`; `USER_ACCOUNT.display_name`; `CALC_METHOD.name`; `KPI_DEFINITION.category_tag` (Q5); `KGI.target_value/unit_id` (Q9); `GOAL.description/formula_text/target_type/roll_up_from_children (Q8)/replaces_goal_id/sort_order`; `SYNC_RUN.period_id`; `IMPORT_BATCH.cycle_id/rows/errors` (json); `GOAL_ACTUAL.note`; `WORKFLOW_STEP.name/return_to_step_no/remind_days_before`; `FORM_INSTANCE.form_type/current_step_entered_at/overdue_handled_at`; `FORM_STEP_ACTION.delegation_id`; `EVALUATION_ITEM.actual_text_snapshot/final_comment`; `DELEGATION.revoked_at`; `NOTIFICATION.event_code/subject/body/created_at/read_at`; `AUDIT_LOG.on_behalf_of_user_id/reason`. New table `GOAL_CHANGE_ITEM`. New enum values: Goal Plan `Returned`, step actions `CANCEL`/`AUTO_LOCK`, overdue `LOCK`, notification `STEP_ASSIGNED`; `KPI_ALERT` deferred to Phase 3 | Plan §5 screens; Phase 1.1 reviews |
| D8 | ERD Vietnamese enum values become English codes with Vietnamese label maps (Khoi → Division, Thử việc → Probation, GĐ → Director…) | Code is English; the screen reads only the label maps |

## Phases (plan §6)

Phase 0 bootstrap → **1.1** domain types + contract (sequential, **done 2026-10-19**) → **1.2** mock + seed (**done 2026-10-19**, rules wired at Gate 1) · **1.3** session
+ permissions (**done 2026-10-19**) · **1.4** app shell + UI kit (**done 2026-10-19**) · **1.5** rule engines (**done 2026-10-19**) →
**Gate 1 passed 2026-10-19** (fixtures frozen) → **Phase 2** tracks T1–T7 in parallel, each in its own git worktree, merged T1 → T2 → T7 → T3
→ T4 → T5 → T6 → **Phase 3** dashboard & AI → **Phase 4** E2E & UAT → **Phase 5** database preparation.

---

## Testing conventions

| Aspect | Convention |
|---|---|
| Runner | Vitest (`npm run test`, `npm run test:watch`) — **a Phase 4 gate and a CI step** |
| Location | **Co-located**: `src/lib/foo.ts` → `src/lib/foo.test.ts` |
| Must have tests | `src/lib/**` (every rule), `src/integrations/**` (gateway behaviour + tenant isolation) |
| Not required | `src/components/**`, `src/pages/**`, `src/components/ui/**` |
| E2E | Playwright in `e2e/specs` — outside the Vitest glob; `@smoke` tag for the menu walk; the main lifecycle scenario (plan §8.2) in Phase 4 |

Push logic into pure functions so it can be tested without React.

---

## CI and deployment

- `.github/workflows/ci.yml` on push/PR to `main`: `npm ci` → typecheck → test → build → lint →
  guides:check.
- Vercel builds `npm run build` → `dist`, with `VITE_DATA_ADAPTER=mock` for Production and Preview. See
  `README.md` for the URLs and the "push to `main` = production deploy" rule.
