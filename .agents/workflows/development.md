---
description: The four-phase development workflow for Syntra KPI. Follow it for every task that touches code.
---

# Development workflow (MANDATORY)

**IMPORTANT:** this applies to EVERY task that touches code. Do not jump straight to coding — start by
sizing the task, then analyse.

kpi-management: React 18 + TS (`strict`) + Vite + shadcn-ui. Data goes through the **`DataGateway`**
contract (`src/integrations/data/`, currently the `mock` adapter — no database) via **React Query**
hooks (`src/hooks/queries/*`), with **Zustand** for client state (`src/lib/*Store.ts`). **Multi-tenant
from day one**: every gateway method takes `tenantId`. **Authentication is simulated.** UI copy is
**Vietnamese, inline** (no i18n). Source plan: `docs/plans/KPI_repo_plan.md`.

---

## Works with any AI tool

This workflow says "delegate to expert X" (`cpo`, `ba-expert`, `hr-performance-expert`,
`workflow-expert`, `cto`, `ui-ux`, `system-architect`, `qa`). Every tool executes the **same intent** —
same knowledge, same structured assessment, same gates — only the mechanism differs:

| Tool | How to run "delegate to expert X" |
|---|---|
| **Claude Code** | Spawn the `.claude/agents/<x>` subagent (native delegation). `ui-ux` → persona `ui-ux-designer`, `qa` → persona `qa-qc` |
| **Codex / Gemini / other** | Read `.agents/skills/<persona>/SKILL.md`, adopt that perspective, and produce the same structured assessment yourself |

Personas live in `.agents/skills/`: `cpo`, `ba-expert`, `hr-performance-expert`, `workflow-expert`,
`cto`, `ui-ux-designer`, `system-architect`, `qa-qc`, `orchestrator`. The `orchestrator` persona owns
routing, conflict resolution and the synthesis format.

---

## Size the task FIRST

The size fixes which phases apply and who is involved. It mirrors the table in `CLAUDE.md`.

| Size | Examples | Required phases | Experts |
|---|---|---|---|
| **Trivial** | Typo, copy tweak, rename, lint fix | 3 → 4 | QA (phase 4) |
| **Small** | One bugfix, one field added to an existing form or table | 1 (self) → 3 → 4 | QA (phase 4) |
| **Flow / Spec** | Changing a business rule, a process step, a state set, or writing a new user story | 1 → 2 → 3 → 4 | Phase 1: **`cpo` + `ba-expert`**. Phase 2: the relevant domain expert. Phase 4: QA |
| **KPI Rules** | Touching `src/lib/*Rules.ts`, a calculation method, scoring, roll-up, rating, payout | 1 (self) → 2 → 3 → 4 | Phase 2: **`hr-performance-expert` + `qa`** (test design). Phase 4: QA |
| **Workflow** | Touching the form state machine, steps, actor rules, SLA / overdue, return, proxy, delegation, Goal Plan lock/unlock, launches | 1 (self) → 2 → 3 → 4 | Phase 2: **`workflow-expert` + `system-architect`**. Phase 4: QA |
| **Medium** | A new component, a feature change, a new block on a screen | all four | Phase 1: `cpo`. Phase 2: `cto` + `ui-ux`. Phase 4: QA |
| **Large** | A new module, a cross-cutting feature, a `DataGateway` contract or fixture change | all four | Phase 1: `cpo` + `ba-expert`. Phase 2: `cto` + `ui-ux` + `system-architect`. Phase 4: QA |

**Rules:**
- When in doubt, choose **Medium** — over-analysing beats missing something.
- **Flow / Spec** **requires** a documentation update — see "Changing a flow" below.
- **KPI Rules** and **Workflow** skip the product panel: brief self-analysis → the lane experts → QA. If
  the change also alters a screen, promote it to Medium/Large and keep the lane expert.
- **Fixtures and the contract are shared by every track** — after Gate 1, changing them is always Large.
- The user can override: "skip the analysis" / "just do it" → Trivial; "full analysis" → Medium/Large.
- **Phase 4 is always required**, at every size, and **tests are part of it**.

---

## Phase 1: Analysis

**Medium/Large:** delegate to `cpo` (plus `ba-expert` for Large and Flow/Spec work) **in parallel** at the start.
**Small:** brief self-analysis (use cases, impact) — no experts.
**KPI Rules / Workflow:** brief self-analysis — the lane experts convene in phase 2.
**Trivial:** go straight to phase 3.

1. **Delegate:**
   - **CPO** — what the problem is, which persona at which step of the period, MVP scope, P1 or later.
   - **BA Expert** — are the business rules right, are they traceable to `docs/source-map.md`, is the
     terminology consistent with `business-rules.md` §0, which documents must change alongside.
2. **Synthesise** using the conflict-resolution rules in `CLAUDE.md`.
3. **Then deepen it yourself:**
   - **Use cases** — the main flow, alternatives, **edge cases**, error states (map to `ERR-KPI-xx`).
   - **Impact** — which rules, hooks, routes, **state sets**, fixtures and contract methods are touched,
     and which **tracks** depend on them.
   - **Open questions** — which of plan §9 (Q1–Q10) apply, and the default used (`ASSUMPTION Qn`).
   - **Reuse check** — look for an existing rule, hook or component before adding one
     (`component-registry.md`).
   - **Data flow** — which gateway methods, which query keys, what invalidates.

**GATE — present the synthesised analysis and WAIT for confirmation. Do not code before it is confirmed.**

---

## Phase 2: Solution design

After the analysis is confirmed (KPI Rules / Workflow work starts here):

1. **Propose the approach** — list the files to create or modify, and why.
2. **Component design** — reusable, single-responsibility; keep pages thin by extracting components.
   `components/ui/` is shadcn — **never edited directly**.
3. **Data changes** — new entity or method? Use **`/add-entity`**. Every method takes `tenantId`.
4. **Where the rule goes** — every calculation or "is this allowed?" decision is a **pure function** in
   `src/lib/*Rules.ts`, never in JSX, a hook or the mock. New calculation method? **`/add-calc-method`**.
   New form type or process? **`/add-workflow`**. New Excel import? **`/add-import-template`**.
5. **List the test cases up front**, drawn from the phase-1 use cases and plan §8.1 — rules, gateway
   behaviour, and tenant isolation.
6. **Delegate the design review in parallel:**
   - **Medium:** `cto` (layering, silent failures) + `ui-ux` (composition, consistency, accessibility).
   - **KPI Rules:** `hr-performance-expert` (method, edge cases, assumptions) + `qa` (test design).
   - **Workflow:** `workflow-expert` (transitions, actors, time) + `system-architect` (contract, fixtures).
   - **Large:** `cto` + `ui-ux` + `system-architect` (+ the lane expert if rules or workflow are touched).

**GATE — present the design and WAIT for approval before implementing.**

---

## Phase 3: Implementation

1. Follow the patterns in `CLAUDE.md` and `.agents/knowledge/architecture.md`.
2. **Data through `getDataGateway()`, only from `src/hooks/queries/*`** — read with `useQuery` and an
   exported `*Key` that starts with `tenantId`; write with `useMutation` + `invalidateQueries`. Never
   import an adapter.
3. **Calculations only in `src/lib/*Rules.ts`**; the mock gateway reuses them.
4. **Never `asChild` on `<Button>` with `<Link>`** — use `useNavigate()`.
5. **Statuses come from the fixed sets** in `src/data/types.ts`. Never invent a label.
6. **Error copy comes from `errorCatalog.ts`** — never retype a string; every failure reaches the user.
7. **Tests alongside the code** for `src/lib/**` and `src/integrations/**` — co-located `*.test.ts`,
   written with the code. Components and pages are not required.
8. **UI copy in Vietnamese, inline**; code and comments in English.

---

## Phase 4: Verification (via QA)

Once implemented, delegate to `qa`. Run:

```bash
npm run typecheck   # 1. Type check — vite build does NOT do this
npm run test        # 2. Unit tests — a GATE on this repo
npm run build       # 3. Production build
npm run lint        # 4. Linter — 0 errors
```

**All four must be green before the task counts as done.**

- If you edited `CLAUDE.md`, also run `npm run guides:check` (or `guides:sync`).
- If you changed a clickable flow or a route, run `npm run test:e2e:smoke`.

---

## Changing a flow (the Flow / Spec size) — documentation is mandatory

A process change is **not finished** when only the code changes.

1. **The proposal** goes into `docs/flows/new-flow.md` — the mermaid diagram, the differences table, and
   the open questions.
2. **Once settled:**
   - Update `.agents/knowledge/business-rules.md` — the current rules.
   - Update `docs/flows/current-flow.md` only if our understanding of today's process changed.
   - Add the settled decision to `docs/flows/new-flow.md`.
   - Run `/log-decision` → add an entry to `decisions-log.md`.
3. **Check these places in the code:**
   - Screens and routes → `src/App.tsx`, `navConfig.ts`, plus the route table in `architecture.md`
   - Rules → `src/lib/*Rules.ts` (with tests)
   - State sets → `src/data/types.ts`
   - Fixtures → `src/data/fixtures/` (after Gate 1: Large)
   - Error copy → `src/lib/errorCatalog.ts`

The **`/update-flow`** skill walks this checklist in one pass.

---

## Parallel tracks (Phase 2 of the plan)

Seven tracks T1–T7 run in parallel, each in its **own git worktree**:

```bash
git worktree add ../kpi-t3 -b track/t3
```

They depend only on the frozen fixtures and contract (plan §6.3). Merge into `main` in the order
**T1 → T2 → T7 → T3 → T4 → T5 → T6**, each merge passing the full Phase 4 gate. A track that needs a
fixture or contract change stops, raises it as a Large change with `system-architect`, and tells the
other tracks before merging.

---

## After the task: log the decision

**After any task** that introduces a pattern, fixes a non-obvious bug, or makes an architectural or
business decision — run **`/log-decision`**: add a terse dated entry to
`.agents/knowledge/decisions-log.md` AND update the relevant current-truth file (`architecture.md`,
`business-rules.md`, `common-pitfalls.md`, `design-system.md`, or `component-registry.md`).

---

## Testing conventions

| Aspect | Convention |
|---|---|
| Runner | Vitest (`npm run test`, `npm run test:watch`) — **a gate** |
| Location | **Co-located**: `src/lib/foo.ts` → `src/lib/foo.test.ts` |
| Must have tests | `src/lib/**` (every rule, edge cases from plan §8.1) + `src/integrations/**` (gateway behaviour, tenant isolation) |
| Not required | `src/components/**`, `src/pages/**`, `src/components/ui/**` |
| E2E | Playwright in `e2e/specs` — outside the Vitest glob, so the two runners never collide |

Push logic into pure functions so it can be tested without React.
