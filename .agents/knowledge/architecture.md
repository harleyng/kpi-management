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
| UI | shadcn-ui + Tailwind CSS + Radix. Light grey canvas, white borderless cards, dark purple sidebar, primary `#863EEA` (`--primary: 265 80% 58%`) |
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
│   │                       #   RouteErrorBoundary, navConfig (5 groups by role, parents with sub-pages)
│   ├── org/                # T1 "Tổ chức": OrgStructureTab, EmployeesTab (+ EmployeeSheet, AssignmentDialog,
│   │                       #   ResignDialog, ImportActions), PositionsTab, TenantTab, UnitSheet
│   ├── access/             # T1 "Người dùng & quyền": AccountsTab, AccountSheet, RoleAssignments,
│   │                       #   PermissionMatrix, RolePermissionSheet, accessContext (rule inputs)
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
│   ├── queries/            # React Query hooks per domain — the only callers of getDataGateway()
│   └── useSearchParamState.ts  # one URL query parameter as state (replace, not push)
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

Every route lives in `src/App.tsx` under a single `<AppShell>`, inside the data router
(`createBrowserRouter`, `main.tsx` — needed for `useBlocker`). Each AREA is one `React.lazy` chunk: its
sub-pages share the module and pick their `section` by prop. Every `path` is absolute and the route's
first attribute (`navConfig.test.ts` parses them).

Navigation is defined in `src/components/layout/navConfig.ts` — the **5 groups of plan §7.1**. An item
is a destination (`NavLeaf`) or a **parent** (`NavParent`) whose sub-items are one area's sub-pages
(product owner, 2026-10-19: every former tab is its own sub-page). A destination names the
**permission** that shows it and opens its route (`null` = every signed-in user); a parent has none —
it shows, and its url opens, when any child does. Sub-items inherit their area's permission, except
"Quy trình duyệt" (`cycle.manage`). The sidebar shows `visibleNavGroups(NAV_GROUPS, access)`; the AppShell
**route guard** renders ERR-KPI-05 for a path `canOpenPath` refuses (longest destination prefix decides,
so a detail route has its list's permission) — both in `src/lib/permissionRules.ts`. AFTER the guard,
the shell replaces an old link — a parent's own url, a pre-split `?tab=`, or a record param that is now
a route segment — with `legacyRedirect` (`src/lib/navRules.ts`). `navConfig.test.ts` fails if a route
is neither a destination, under one, nor in `PUBLIC_PATHS` (`/`, `*`, `/forms/:formId`), if a
destination url nests inside another, or if a destination has no route. Under the default matrix the
menu is plan §7.1, except ADMIN, who holds every permission and sees all five groups.

**A list never shows a record's detail below, beside or in place of itself** (product owner,
2026-10-19). A record opens on its own route under its list's url; small create/edit forms are a
Sheet or Dialog; big editors are their own page and guard unsaved edits (`UnsavedChangesGuard`). A
detail page checks its record — unknown id, other tenant, or not allowed → ERR-KPI-02 — and a Goal
Plan page also checks the route kind with `planRouteAllows` (the gateway's `getGoalPlan` checks only
the tenant).

| Route | Page | Menu · permission (default holders; ADMIN holds all) | WBS / phase |
|---|---|---|---|
| `/` | → redirects to `/my/kpi` | — | — |
| `/my/kpi` | KPI của tôi — the own plan in `?cycle=`; goals open on the plan's goal pages | Của tôi · — (all) | 4.3.2–4.3.5 (T3), 4.4.2 (T4) |
| `/my/kpi/plans/:planId` · `…/goals/:goalId` (`new`; `?tab=info\|split\|link`) | One own Goal Plan · one goal | under KPI của tôi · record: owner is me | T3 |
| `/my/tasks/inbox` · `/forms` · `/delegations` | Việc cần xử lý › Chờ tôi xử lý · Phiếu của tôi · Ủy quyền | Của tôi · — (all) | 4.5.5 (T5) |
| `/my/results` | Kết quả của tôi — own results by cycle (BR-KPI-82) | Của tôi · — (all) | 4.6.4 (T6), 4.7.2 |
| `/team/kpi/members` (+ `/:planId`, `/:planId/goals/:goalId`) | KPI đội nhóm › KPI nhân viên — reports' plans | Đội nhóm · `team.view` (MANAGER) | 4.3.4 (T3) |
| `/team/kpi/unit` (+ `/:planId`, `/:planId/goals/:goalId`) | KPI đội nhóm › KPI bộ phận — the headed unit's plan, cascade | Đội nhóm · `team.view` | 4.3.4 (T3) |
| `/team/reviews` | Duyệt & đánh giá | Đội nhóm · `team.view` | 4.5.2–4.5.4 (T5) |
| `/dashboard/overview` · `/operations` | Dashboard › Tổng quan · Vận hành; `?cycle=&period=&unit=` | Điều hành · `dashboard.view` (BOD, MANAGER, HR) | 4.7.1–4.7.4 |
| `/admin/cycles/list` · `/list/:cycleId` (`?tab=periods\|plans`) · `/admin/cycles/periods` · `/admin/cycles/plans` · `/plans/:cycleId/:planId` (+ goals) | Chu kỳ › Kỳ đánh giá (cycle list · one cycle) · Đợt đánh giá (periods, `?cycle=`) · Goal Plan (plans, `?cycle=` · one plan) | Quản trị KPI · `cycle.manage` (HR, CNB) | 4.3.1, 4.3.6 (T3) |
| `/admin/library/definitions` · `/perspectives` · `/units` · `/calc-methods` | Thư viện KPI › Chỉ tiêu mẫu · Viễn cảnh BSC · Đơn vị đo · Phương pháp tính | Quản trị KPI · `library.manage` (HR, CNB) | 4.2.1–4.2.3, 4.2.5 (T2) |
| `/admin/templates` · `/:templateId` (`new`) | Bộ mẫu — list (`q`, `ad`) · editor page | Quản trị KPI · `library.manage` | 4.2.4 (T2) |
| `/admin/launches/runs` (+ `/new`) · `/rules` · `/forms` (`?launch=`) · `/workflows` (+ `/:workflowId`) | Khởi chạy phiếu › Đợt khởi chạy · Lịch tự động · Phiếu đã tạo · Quy trình duyệt | Quản trị KPI · `form.launch` (HR, CNB); Quy trình duyệt `cycle.manage` | D5, 4.5.1 (T5) |
| `/admin/actuals/entry` · `/import` (+ `/:batchId`) · `/sync` (+ `/:connectionId`) | Số liệu & import › Nhập tay · Nhập từ Excel · Đồng bộ API; `?cycle=&period=` | Quản trị KPI · `actual.import` (HR, CNB) | 4.4.2–4.4.6 (T4) |
| `/admin/results/period` · `/rating` · `/payroll` | Kết quả & lương › Kết quả theo kỳ · Xếp loại & quy đổi · Xuất file lương; `?cycle=&period=`; export needs `result.export` | Quản trị KPI · `result.finalize` (HR, CNB) | 4.6.1–4.6.4 (T6) |
| `/system/org/structure` (+ `/:unitId`) · `/employees` (`?emp=`) · `/positions` · `/company` | Tổ chức › Cơ cấu · Nhân sự · Chức danh · Công ty | Hệ thống · `org.manage` | 4.1.1–4.1.4, 4.1.7 (T1) |
| `/system/users/accounts` · `/roles` | Người dùng & quyền › Tài khoản · Vai trò & quyền | Hệ thống · `user.manage` | 4.1.5–4.1.6 (T1) |
| `/system/data-sources/catalogue` · `/connections` (+ `/:connectionId`) | Nguồn dữ liệu › Danh mục nguồn · Kết nối API | Hệ thống · `datasource.manage` | 4.4.1, 4.4.4–4.4.5 (T4) |
| `/system/notification-templates` | Mẫu thông báo | Hệ thống · `notification.manage` | 4.8.1–4.8.3 (T7) |
| `/system/audit-log` | Nhật ký | Hệ thống · `audit.view` | 4.8.4 (T7) |
| `/forms/:formId` | Phiếu (one form) | not a menu item — `PUBLIC_PATHS`; the page checks the record (`useFormDetail.mayView`) | 4.5.2–4.5.4 (T5) |
| `*` | Không tìm thấy trang | — | — |

The `e2e/specs/smoke.spec.ts` list mirrors this table — keep them in step.

**Page chrome.** `PageHeader` sets the browser title. A sub-page's title is its menu title and its
area shows as the breadcrumb automatically; a detail page passes an explicit `breadcrumb` (explicit
`to`, never history-back), `title` = the record's name and `status` = its badge. `<main>` is the scroll
container: the shell resets its scroll and focuses the new page's `h1` on every route change.
Sibling sub-pages carry their parent's `carryParams` (`?cycle=&period=`) through the sidebar.

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
  `work` (G8 · monthly work, PEND-14 / D10) · `system` (G7) · `scheduler` · `events` · optional `dev` (mock only).
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
- **Notifications (T7)** — `src/integrations/data/notificationListener.ts`, adapter-agnostic: it reads
  through the contract after the commit (directory, delegations, steps, templates, periods, plans) and
  writes `system.recordNotification`, idempotent per (source key, recipient). Who is told what is
  `notificationRules` + `workflowRules` (BR-KPI-45…47). It ignores every event it does not handle —
  including its own `Notification` writes — so it cannot feed itself; a failure goes to the diagnostics
  and never touches the write that emitted. The mock registers it with `rt.bus.subscribeAll`
  (`MockGatewayOptions.notifications`, default on; the shared test gateway turns it OFF unless a test
  passes `notifications: true` and awaits `gateway.notificationsSettled()`); `dev.resetSeed` bumps a
  generation so work started on the old data writes nothing. A real backend runs it as a server-side
  outbox (Phase 5).
- **Imports** (T4, WBS 4.4.3 — the shared framework) — the import screen reads the `.xlsx` in the browser
  (`src/lib/excel.ts`, exceljs loaded lazily inside its functions — `excel.test.ts` fails on a static
  import) into a cell matrix, `importRules.parseSheet(spec, matrix)` turns it into typed rows (a file
  with header / size / cell errors is shown locally and never staged); `actuals.stageImport` uploads →
  validates through the type's handler (`mock/imports.ts`: `IMPORT_HANDLERS` — `Actual` wired; GoalPlan
  T3, OrgData T1, Library T2 throw `KpiDeferredError('actuals.stageImport:<Type>')` from inside the wired
  method) and stores rows + row errors on the `ImportBatch`; `commitImport` re-validates and applies all
  rows or none. A track adding its type writes: a spec + row validator in `src/lib/import<Thing>Rules.ts`,
  a handler in `mock/imports.ts`, and reuses `ImportUploadCard` / `ImportPreview` (`/add-import-template`).
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
| `audit.ts` | The audit trail: the runtime writes one `AuditLog` row per `entity.changed` IN the write's transaction (not for notifications), so a change and its audit entry are saved together or not at all; the row's id is the event's, so `system.recordAudit` of the same event is a no-op. The notification listener (T7) is registered in `createMockGateway` |
| `groups/*.ts` | One file per contract group — WHAT each method does, nothing else |
| `groups/orgTx.ts` (T1) | The org writes at TRANSACTION level — `saveOrgUnitTx`, `savePositionTx`, `saveEmployeeTx`, `saveAssignmentTx`, `saveAccountTx`, `saveUserRoleTx`, `deleteUserRoleTx`, `setRolePermissionsTx`. `org.save*` call them, and T4's `commitImport` calls them for an OrgData batch (employees → assignments → accounts) — a method cannot call another. Each: write the rows → `validateTransaction` (references, owners, unique, CHECKs: a foreign id is refused like a missing one BEFORE any rule reads it) → `orgAdminRules` / `accessAdminRules` on the written state vs the stored row → `throwIssues`. Behaviours: **B1** a new primary assignment from D ends the running one on D − 1 (`transferPlan`); **B2** a new account of an employee gets EMPLOYEE / Self (`accountPlan`); **B3** a recorded last working day ends the assignments running past it (`resignationPlan`); `setRolePermissions` writes the DIFF only; every access change passes `accessIssues` (BR-KPI-72) |
| `groups/library.ts` | (T2) each `library.save*` reads what `libraryRules` needs inside the tx (other codes, rows referencing a unit or method via `REVERSE_REFS`, Active templates holding a KPI), normalises codes, and throws the rule's issues — the lock on a used method is reported after `validateCalcMethod` |
| `imports.ts` (T4) | The batch-import framework's per-type handlers (`validate` at stage, `apply` at commit) and `actualImportContext(tx, cycleId)` — a lookup table, the decisions are `src/lib` rules |
| `actualWrites.ts` (T4) | `writeActualSnapshot` — THE way an actual is written (manual, Excel, API: new current snapshot, previous one retired) — and `writeImportEvidence` |
| `erpSaleSimulator.ts` (T4) | `simulatedErpReading` — the simulated ERP Sale's answer for (goal, month): deterministic data, not a calculation (BR-KPI-56) |
| `payrollWorkbook.ts` (T6) | Renders `payrollRules.buildPayrollSheet` as the `.xlsx` payroll file (sheets "Lương KPI", "Thông tin") — the ONLY importer of exceljs, dynamically, so it is an async chunk of its own |
| `groups/scheduler.ts` | `scheduler.runDue` — one system transaction: due launches → rule firings → overdue (snapshot of the forms at tick start) → reminders; returns the `SchedulerReport` |

`groups/results.ts` loads the rows with `tx.all`, calls `resultRules`' orchestrators
(`buildPeriodResults`, `applyAdjustment`, `finalizePeriodResults`, `lockPeriodResults`) and applies the
returned `ResultChanges`; the seed's `ResultScript` (`src/data/fixtures/results.ts`) runs the same
functions on its arrays, so a recalculated seeded Draft is identical to the seeded row. Configuration
guards: `saveCalcMethod` (`validateCalcMethod`), `saveRatingScale` (`validateRatingScale`),
`savePayoutRule` (`validatePayoutRule` + level in scale) — a reference that does not resolve is left to
the integrity check, so a foreign id still answers like a missing one.

`results.exportPayroll` (T6, BR-KPI-81) is the one method built on **`Runtime.preparedWrite`** — a user
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
  none — T4 wired `actuals.stageImport`, `commitImport` (4.4.3) and `runSync` (4.4.5), T6 wired
  `results.exportPayroll` (4.6.4), 2026-10-19. The import TYPES of T1/T2/T3 are deferred inside
  `stageImport`, not as methods.
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
- **T1 guards (after Gate 1)** — the org writes enforce `business-rules.md` §10 through `groups/orgTx.ts`
  (above) and `platform.saveTenant` enforces `orgAdminRules.tenantIssues` (valid zone, no self-suspend).
  No method, signature or fixture changed: the frozen surface and seed hash are untouched, and
  `fixtures/orgGuards.test.ts` pins that every seeded row stays editable. `integrity.assertReferencesResolve`
  is the commit check's reference half, exported.
- **T3 (after Gate 1)** — `assertPlanEditable` now calls `planAccessRules.planEditability` and
  `entitlementCtx` calls `workflowRules.entitlementContextOf`: the screens build the same decision from what
  they read (`planEditabilityFrom`), pinned by a parity test over every seeded plan
  (`mock/goals.test.ts`). `saveGoal` gained the allocation guard (`goalAllocationIssues`, ERR-KPI-11 / 06)
  — behaviour only, contract and seed unchanged. The cascade is two writes (child goal + alignment) with a
  compensating delete in `useCascadeGoal`; Phase 5 should make it one `cascadeGoal` transaction.
- **Naming** — gateway methods use the short domain noun (`listPositions` for `JobPosition`,
  `listWorkflows` for `WorkflowTemplate`); the types keep the ERD names.

### AI assistant — `InsightGateway`

`src/integrations/insight/` — the same boundary as the data gateway: `getInsightGateway()` (only
`src/hooks/queries/insight.ts` calls it), one deterministic mock, `tenantId` first on every method
(Phase 3, WBS 4.7.4, BR-KPI-89).

- **Snapshot in, sentences out.** `summarise / explain / ask(tenantId, snapshot, …)` receive a
  `DashboardSnapshot` (`src/lib/dashboardRules.ts`, plain JSON): the figures of the unit in focus and its
  visible children, already in the viewer's scope. The assistant reads nothing else, so it can never
  cite what the viewer may not see; it phrases snapshot fields through templates (`figureRefs` name
  them) and never computes. A snapshot of another tenant → ERR-KPI-06. A real model adapter (Phase 5+)
  would receive the same snapshot, serialised, as its only context.
- **Caching.** Keys are `[tenantId, 'insight', kind, snapshotDigest, nodeId]`; the `insight` KEY_ROOT
  depends on no entity — new numbers are a new digest, so an answer never outlives its figures.

### Dashboard data (Phase 3)

`src/hooks/queries/dashboard.ts` composes the hooks other screens use (same keys, one cache):
results of every period of the cycle (`useResultsOfPeriods`, one query per period), the cycle's plans,
units, employees (resigned included), assignments, rating levels; forms for the operations tab
(`useFormList`, all pages); goal lines on demand for the unit in focus (`useResultLines`: details +
`useGoalRows` for numbers + `useGoals` for names). `src/lib/dashboardRules.ts` turns them into the model
(`buildDashboard`, `operationsReport`, `dashboardSnapshot`); any failed read is an error with retry, never
zeros. No `DataGateway` method or fixture changed. The URL state (`?cycle=&period=&unit=`) lives in
`src/components/dashboard/useDashboardSelection.ts`.

### Fixtures strategy

`src/data/fixtures/` (its README tells the whole story, date by date) — two tenants: **Syntra**
(3 divisions, the 8 DATX departments + Kinh doanh, 42 fictional people, all 6 roles; the library from
DATX "2. KPIs phòng ban" cleaned per `ASSUMPTION Q14`; cycles 2026 Closed · 2027 Active · 2028 Planning;
Goal Plans in every status; three months of actuals from all three sources; forms at every step with a
history that replays; launches, delegations, notifications, audit; results T01 Locked · T02 Final
(+ Drafts) · T03 Draft, produced by `resultRules` (`syntra/results.ts`, run last)) and **Demo Co** (small, but a row in every collection, reusing Syntra's codes). The seed's "now"
is **2027-04-06 09:00 +07**; the scheduler last ran 2027-04-01 09:00. Ids come from `seedId`.

**Frozen at Gate 1 (2026-10-19)** as the contract between tracks: `src/data/fixtures/freeze.test.ts` pins
the seed hash, the gateway surface (`group.method:kind[:permission]`) and the entity count (55);
`SEED_VERSION` is `2027-04-06.A1.B1.A2` (bumped from `G1` by Plan A's A1, 2026-10-23: evaluation items and their
results; then by Plan B 8.1: the `work` group, six monthly-work entities, the Kinh doanh monthly-work pilot; then
by Plan A's A2: `startStepNo`, `autoApprove`, HR's RETURN at registration step 4). A
failing freeze test is a **Large** change: system-architect
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
| D9 | `EVALUATION_ITEM.actual_value/actual_text` (the actual on the form), `actual_entered_by`, `submitted_actual_value/submitted_actual_text`, `target_snapshot` (the period's target); `GOAL_ACTUAL.source_type` adds `FORM` — `DATA_SOURCE.source_type` does not (`ACTUAL_SOURCE_TYPES` vs `SOURCE_TYPES`; the ERD shares one `source_type`) | 22/10 meeting, PEND-06/07/08 (A1, 2026-10-23) |
| D10 | `FORM_LAUNCH.start_step_no` (nullable; null = step 1) and `WORKFLOW_STEP.auto_approve`; `FORM_STEP_ACTION.action` adds the system value `AUTO_APPROVE` (actor null) | 22/10 meeting, PEND-01/02 (A2, 2026-10-23) |
| D10 | Monthly work (PEND-14, Plan B 8.1), group G8, not in the ERD: `WORK_PLAN` (employee, Month period, status ⊂ Goal Plan set without Approved, approved_at/by; unique per employee and period) · `WORK_TASK` (plan, sort_order, name, product, description, unit_text, weight, start/due date, progress_pct, progress_status, note, visibility = Goal visibility set, linked_goal_id, created_by, cancelled_at/by, cancel_reason) · `WORK_REVIEW` (form 1–1, plan, KLcv + comment per SELF / MANAGER / FINAL column, Hsnv + reason in MANAGER / FINAL) · `WORK_REVIEW_ITEM` (form, task, score + comment per column) · `WORK_RESULT` (employee, period, plan, form, kqcv, klcv, hsht, hsnv, hsnv_reason, final_score, recorded_at — a snapshot, no status: no row = "tạm tính") · `WORK_SCORING_CONFIG` (one per tenant). `FORM_INSTANCE.work_plan_id` (set exactly on WORK_PLAN / WORK_REVIEW). Form types `WORK_PLAN`, `WORK_REVIEW`. Cross-row checks in `schema.ts`: a review's plan is its form's, an item's task is in its form's plan, a result's plan and form match its employee and period | CMC PMGM HR pp. 13, 25–26; NV pp. 67–73; QL pp. 120–136; `KPI_monthly_work_plan.md` D-W2 |

## Phases (plan §6)

Phase 0 bootstrap → **1.1** domain types + contract (sequential, **done 2026-10-19**) → **1.2** mock + seed (**done 2026-10-19**, rules wired at Gate 1) · **1.3** session
+ permissions (**done 2026-10-19**) · **1.4** app shell + UI kit (**done 2026-10-19**) · **1.5** rule engines (**done 2026-10-19**) →
**Gate 1 passed 2026-10-19** (fixtures frozen) → **Phase 2** tracks T1–T7 in parallel (all seven built and merged 2026-10-19), each in its own git worktree, merged T1 → T2 → T7 → T3
→ T4 → T5 → T6 (all merged 2026-10-19) → **Phase 3** dashboard & AI (built 2026-10-19) → **Phase 4** E2E & UAT → **Phase 5** database preparation.

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
