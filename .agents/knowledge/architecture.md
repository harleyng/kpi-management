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
│   ├── data/               # DataGateway: types.ts (contract), index.ts, mockGateway.ts (stub until 1.2), supabaseGateway.ts (stub)
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
| `/my/results` | Kết quả của tôi | Của tôi · — (all) | 4.6.4 (T6), 4.7.2 (Phase 3) |
| `/team/kpi` | KPI đội nhóm | Đội nhóm · `team.view` (MANAGER) | 4.3.4 (T3) |
| `/team/reviews` | Duyệt & đánh giá | Đội nhóm · `team.view` (MANAGER) | 4.5.2–4.5.4 (T5) |
| `/dashboard` | Dashboard | Điều hành · `dashboard.view` (BOD, MANAGER, HR) | 4.7.1–4.7.4 (Phase 3) |
| `/admin/cycles` | Chu kỳ | Quản trị KPI · `cycle.manage` (HR, CNB) | 4.3.1, 4.3.6 (T3) |
| `/admin/library` | Thư viện KPI | Quản trị KPI · `library.manage` (HR, CNB) | 4.2.1–4.2.3, 4.2.5 (T2) |
| `/admin/templates` | Bộ mẫu | Quản trị KPI · `library.manage` (HR, CNB) | 4.2.4 (T2) |
| `/admin/launches` | Khởi chạy phiếu | Quản trị KPI · `form.launch` (HR, CNB) | D5, 4.5.1 (T5) |
| `/admin/actuals` | Số liệu & import | Quản trị KPI · `actual.import` (HR, CNB) | 4.4.2–4.4.6 (T4), 4.3.7 (T3) |
| `/admin/results` | Kết quả & lương | Quản trị KPI · `result.finalize` (HR, CNB) | 4.6.1–4.6.4 (T6) |
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
                                                              ├── mockGateway      (Phase 1.2; a stub that rejects until then)
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
  System writes (`system.recordNotification`, `system.recordAudit`) are made only by T7's listeners in
  `src/integrations/`, and the audit entry is built from the event.
- **One clock** — the adapter reads every "now" from `clock.now()`; screens read it too (deadline badges).
  The mock's dev toolbar moves it (`dev.setNow`). `scheduler.runDue(tenantId)` runs due launches,
  recurring rules, reminders and overdue steps as of that clock, idempotently.
- **Writes** — `Upsert<T, Managed>` omits `id`/`tenantId` and the columns the gateway owns (status
  transitions, timestamps, authors). Aggregates (method + tiers, template + items, workflow + steps,
  scale + levels) save together with `ChildInput` children **matched by id**, so references to a step
  or a rating level survive a save; they return `Aggregate<Parent, Child>`.
- **Lists** — filters are AND-ed; an omitted field does not filter, an empty id list matches nothing.
  Lists that grow without bound (`listForms`, `listNotifications`, `listAuditLog`) return `Page<T>`.
- **Events** — every successful write emits `entity.changed` (with before/after), plus domain events
  (`goalPlan.statusChanged`, `form.launched`, `form.stepActed` with `assigneeUserIds`, `form.dueSoon`,
  `form.overdue`, `actuals.recorded`, `results.finalized`, `payroll.exported`). T7 and the query-cache
  invalidation listen; listeners are idempotent by `event.id`, registered once at gateway construction,
  and a rejected listener is reported, never swallowed.
- **Imports** — the client parses Excel (exceljs) into typed rows; `actuals.stageImport` validates and
  stores rows + row errors on the `ImportBatch`; `commitImport` applies all rows or none.
- **Mock adapter** (Phase 1.2) — in-memory + localStorage partitioned per tenant, `dev.resetSeed()`,
  simulated latency, an error-injection switch. It **reuses** `src/lib/*Rules.ts`.
- **IDs** — strings (`crypto.randomUUID()` at runtime; literal UUIDs in fixtures). The ERD's `bigint`
  keys are for the future database.
- **Errors** — methods reject with `KpiError` (ERR-KPI-01…06 are the contract's generic codes); hooks
  surface the catalogue copy. React Query retries only `isRetryable` failures (01, 03).
- **Naming** — gateway methods use the short domain noun (`listPositions` for `JobPosition`,
  `listWorkflows` for `WorkflowTemplate`); the types keep the ERD names.

### AI assistant — `InsightGateway`

`src/integrations/insight/` — same pattern, one deterministic mock, every method takes `tenantId`
(Phase 3, WBS 4.7.4).

### Fixtures strategy

`src/data/fixtures/` (see its README) — two tenants (Syntra full, Demo Co minimal), Syntra's org from
the DATX sheets (3 blocks, ~8 departments, ~40 fictional employees, all 6 roles), the library from DATX
sheet "2. KPIs phòng ban", cycle 2027 (12 months + 4 quarters), Goal Plans and forms in every state,
three months of actuals (manual, Excel, "API"), a sample rating scale and payout table marked
`ASSUMPTION Q2`. **After Gate 1 the fixtures are frozen as the contract between tracks.**

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

Phase 0 bootstrap → **1.1** domain types + contract (sequential, **done 2026-10-19**) → **1.2** mock + seed · **1.3** session
+ permissions (**done 2026-10-19**) · **1.4** app shell + UI kit (**done 2026-10-19**) · **1.5** rule engines (parallel) → **Gate 1** (fixtures
frozen) → **Phase 2** tracks T1–T7 in parallel, each in its own git worktree, merged T1 → T2 → T7 → T3
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
