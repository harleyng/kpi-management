# Syntra KPI — `kpi-management`

Prototype of **Syntra KPI**, a KPI management system built on the Balanced Scorecard: three tiers
(Company → Department → Individual), cascade/link, a three-step evaluation (self + evidence → manager →
HR/C&B), results that feed ratings, pay and a live dashboard. Multi-tenant from day one.

> ⚠️ **Prototype.** Data and sign-in are simulated and live in the browser (the "Dữ liệu giả lập" banner
> says so on every screen). Do not enter real personnel data.

- **Plan:** [`docs/plans/KPI_repo_plan.md`](docs/plans/KPI_repo_plan.md) — scope, phases, tracks, WBS, open questions
- **ERD:** [`docs/erd/kpi_erd.mermaid`](docs/erd/kpi_erd.mermaid) — 67 tables (47 in P1)
- **Processes:** [`docs/flows/current-flow.md`](docs/flows/current-flow.md) (today) · [`docs/flows/new-flow.md`](docs/flows/new-flow.md) (on the system)
- **Sources:** [`docs/source-map.md`](docs/source-map.md)
- **Guide for AI agents and contributors:** [`CLAUDE.md`](CLAUDE.md) (also `AGENTS.md`, `GEMINI.md`)

## Status

**Phase 0 — bootstrap.** The app shell runs, every menu item opens a placeholder naming the WBS work
package that will fill it. Next: Phase 1.1 (domain types for the 47 P1 tables + the `DataGateway`
contract + ERD deltas D1–D6).

## Run it

Requires Node ≥ 18 and npm.

```bash
npm install
npm run dev            # http://localhost:8082
```

No environment file is needed: the data adapter defaults to `mock`. To override, copy `.env.example`
to `.env.local`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 8082 |
| `npm run typecheck` | `tsc --noEmit` (the build does not type-check) |
| `npm run test` | Vitest unit tests — **a gate** |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | ESLint, 0 errors |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` / `test:e2e:smoke` | Playwright (own dev server on 8182); run `npm run e2e:install` once |
| `npm run guides:sync` / `guides:check` | Regenerate / verify `AGENTS.md` and `GEMINI.md` from `CLAUDE.md` |
| `npm run analyze` | Bundle-size report at `dist/bundle-analysis.html` |

The Phase 4 gate, run before every push and by CI:

```bash
npm run typecheck && npm run test && npm run build && npm run lint
```

## Deployment

- **Repository:** https://github.com/harleyng/kpi-management (private)
- **Production:** https://syntra-kpi.vercel.app (Vercel project `kpi-management`, team
  *harleyng's projects*)
- **A push to `main` is a production deploy** — Vercel is connected to the GitHub repository. Every
  other branch gets its own preview deployment.
- Vercel environment (Production and Preview): `VITE_DATA_ADAPTER=mock`.
- **Deployment Protection is on** (Vercel Authentication for **all** deployments, production included):
  only members of the Vercel team can open the URLs; anyone else is sent to the Vercel login. Ask before
  making a link public.
- CI (GitHub Actions, `.github/workflows/ci.yml`) runs the Phase 4 gate on every push to `main`.
