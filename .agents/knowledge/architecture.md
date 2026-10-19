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
| Client state | **Zustand** (`src/lib/*Store.ts`) + `SessionContext` (simulated tenant, user, role) |
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
│   └── shared/             # PageHeader, PlaceholderPanel, EmptyState, ErrorStateCard, ConfirmDialog,
│                           #   StatusBadge, Pagination, SearchInput, SectionTitle, CopyButton
├── contexts/
│   ├── useSession.ts       # session contract + hook (a file with NO JSX)
│   └── SessionContext.tsx  # the provider (Phase 0 placeholder; real switcher in 1.3)
├── data/
│   ├── types.ts            # domain types + FIXED STATE SETS (Phase 1.1 fills the 47 P1 tables)
│   └── fixtures/           # seed data — the CONTRACT between tracks (Phase 1.2)
├── hooks/
│   └── queries/            # React Query hooks per domain — the only callers of getDataGateway()
├── integrations/
│   ├── data/               # DataGateway: types.ts (contract), index.ts, mockGateway.ts, supabaseGateway.ts (stub)
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
Menu filtering by role arrives in Phase 1.3 (`permissionRules`); in Phase 0 every group is shown.

| Route | Page | Menu group · roles | WBS / phase |
|---|---|---|---|
| `/` | → redirects to `/my/kpi` | — | — |
| `/my/kpi` | KPI của tôi | Của tôi · all | 4.3.2–4.3.5 (T3), 4.4.2 (T4) |
| `/my/tasks` | Việc cần xử lý | Của tôi · all | 4.5.5 (T5) |
| `/my/results` | Kết quả của tôi | Của tôi · all | 4.6.4 (T6), 4.7.2 (Phase 3) |
| `/team/kpi` | KPI đội nhóm | Đội nhóm · MANAGER | 4.3.4 (T3) |
| `/team/reviews` | Duyệt & đánh giá | Đội nhóm · MANAGER | 4.5.2–4.5.4 (T5) |
| `/dashboard` | Dashboard | Điều hành · BOD, MANAGER, HR | 4.7.1–4.7.4 (Phase 3) |
| `/admin/cycles` | Chu kỳ | Quản trị KPI · HR, CNB | 4.3.1, 4.3.6 (T3) |
| `/admin/library` | Thư viện KPI | Quản trị KPI · HR, CNB | 4.2.1–4.2.3, 4.2.5 (T2) |
| `/admin/templates` | Bộ mẫu | Quản trị KPI · HR, CNB | 4.2.4 (T2) |
| `/admin/launches` | Khởi chạy phiếu | Quản trị KPI · HR, CNB | D5, 4.5.1 (T5) |
| `/admin/actuals` | Số liệu & import | Quản trị KPI · HR, CNB | 4.4.2–4.4.6 (T4), 4.3.7 (T3) |
| `/admin/results` | Kết quả & lương | Quản trị KPI · HR, CNB | 4.6.1–4.6.4 (T6) |
| `/system/org` | Tổ chức | Hệ thống · ADMIN | 4.1.1–4.1.4, 4.1.7 (T1) |
| `/system/users` | Người dùng & quyền | Hệ thống · ADMIN | 4.1.5–4.1.6 (T1) |
| `/system/data-sources` | Nguồn dữ liệu | Hệ thống · ADMIN | 4.4.1, 4.4.4–4.4.5 (T4) |
| `/system/notification-templates` | Mẫu thông báo | Hệ thống · ADMIN | 4.8.1–4.8.3 (T7) |
| `/system/audit-log` | Nhật ký | Hệ thống · ADMIN | 4.8.4 (T7) |
| `*` | Không tìm thấy trang | — | — |

The `e2e/specs/smoke.spec.ts` list mirrors this table — keep them in step.

---

## Data layer — the `DataGateway`

```
components/pages → React Query hooks (src/hooks/queries/*) → getDataGateway()
                                                              ├── mockGateway      (now)
                                                              └── supabaseGateway  (Phase 5 — throws until then)
```

- **Contract** — `src/integrations/data/types.ts`. One group of async methods per ERD group (Phase 1.1).
- **Selection** — `getDataGateway()` in `index.ts` reads `VITE_DATA_ADAPTER` (build-time): unset/`mock` →
  mock, `supabase` → the stub (throws "not implemented"), anything else → throws. Tested in
  `index.test.ts`.
- **Tenant boundary** — every method takes `tenantId` first and filters by it. With no RLS, this is the
  isolation; the tenant-isolation tests become the RLS integration tests in Phase 5.
- **Mock adapter** (Phase 1.2) — in-memory + localStorage partitioned per tenant, `resetSeed()`,
  simulated latency, an error-injection switch for testing failure UI. It **reuses** `src/lib/*Rules.ts`.
- **Events** — writes other tracks react to (launch, step change, lock) emit on a gateway event bus; T7
  (notifications, audit log) only listens.
- **IDs** — strings (`crypto.randomUUID()` at runtime; literal UUIDs in fixtures). The ERD's `bigint`
  keys are for the future database.
- **Errors** — methods throw `KpiError` (`src/lib/errorCatalog.ts`); hooks surface the catalogue copy.

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
this copy in sync. Proposed deltas D1–D6 (plan §4) are applied to `src/data/types.ts` in Phase 1.1 and
logged in `decisions-log.md`.

---

## Phases (plan §6)

Phase 0 bootstrap → **1.1** domain types + contract (sequential) → **1.2** mock + seed · **1.3** session
+ permissions · **1.4** app shell + UI kit · **1.5** rule engines (parallel) → **Gate 1** (fixtures
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
