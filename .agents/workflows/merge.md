---
description: Pre-push checklist for changes going to main — Syntra KPI.
---

# Before pushing to main

Work is committed and pushed to `main` — no pull request. The repository owner is **@harleyng**.

- Repository: https://github.com/harleyng/kpi-management (private)
- Production: https://kpi-management-theta.vercel.app (Deployment Protection on — team members only)

**A push to `main` is a production deploy** — Vercel is connected to the repository, so the gate below
is the last thing standing between a commit and the production URL. Other branches get preview
deployments.

## 1. Technical gates (required)

```bash
npm run typecheck && npm run test && npm run build && npm run lint
```

All four green. CI (`.github/workflows/ci.yml`) runs exactly this plus `npm run guides:check`.

If the change touches:

| Area | Also run |
|---|---|
| `CLAUDE.md` | `npm run guides:check` |
| A route or a clickable flow | `npm run test:e2e:smoke` |
| The full lifecycle (Phase 4) | `npm run test:e2e` |

## 2. Content gates

- [ ] **Tenant isolation** — every gateway method takes `tenantId` and filters by it; every new read has
      an isolation test; query keys start with the tenant.
- [ ] **Gateway only** — nothing imports `mockGateway` / `supabaseGateway` directly; only
      `src/hooks/queries/*` calls `getDataGateway()`.
- [ ] **Calculations** — every score, %, roll-up, rating, payout or "can submit" lives in
      `src/lib/*Rules.ts` as a pure, tested function, not in JSX.
- [ ] **State sets** — no status label exists outside `src/data/types.ts`.
- [ ] **Error copy** — pulled from `errorCatalog.ts`, not retyped; no failure is silent.
- [ ] **Navigation** — uses `useNavigate()`, never `asChild` + `<Link>`.
- [ ] **Copy** — UI strings in Vietnamese; no i18n library added.
- [ ] **No stray `console.log`** (deliberate `console.error` / `console.warn` are fine).
- [ ] **No secrets and no real personnel data committed** — `.env*` is gitignored; source documents
      (PDF/DOCX/XLSX/PPTX) stay outside the repository.

## 3. Documentation gates

- [ ] Does the change **alter a process or a rule**? If so:
  - [ ] `.agents/knowledge/business-rules.md` updated
  - [ ] `docs/flows/new-flow.md` has the decision
  - [ ] `.agents/knowledge/decisions-log.md` has a new entry (`/log-decision`)
- [ ] Does it change **fixtures or the contract** after Gate 1? → Large: system-architect reviewed, other
      tracks told.
- [ ] Does it add a **pattern** or a **reusable component**? → `component-registry.md`
- [ ] Did it fix a **non-obvious bug**? → `common-pitfalls.md`
- [ ] Does it add a **route**? → the route table in `architecture.md` and the smoke spec list

## 4. Commit message

Say **what changed** and **why**, not just which files, in a conventional-commit title:
`type(scope): description`. If a rule changed, quote the BR code (e.g. `BR-KPI-04`) in the body.

## 5. Merging a track (Phase 2)

Tracks merge in the order **T1 → T2 → T7 → T3 → T4 → T5 → T6**. Before merging a track's worktree
branch: rebase on `main`, run the full gate, then merge and push. Remove the worktree afterwards
(`git worktree remove ../kpi-<track>`).

## 6. After pushing

- Confirm CI is green: `gh run list --limit 1` (or `gh run watch`).
- Confirm the Vercel production deployment finished and the app opens with the **"Dữ liệu giả lập"**
  banner visible.
