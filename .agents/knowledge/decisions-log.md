# Decisions log — Syntra KPI

> **History, not current truth.** Newest first. Grep it for the reasoning behind a past decision; the
> rule files (`business-rules.md`, `architecture.md`, …) say what is true now. Add entries with
> `/log-decision`.

---

## 2026-10-19 — UI design judgement follows impeccable (Operate mode) + Anthropic frontend-design

**Decision.** The `ui-ux` agent works from `.agents/skills/ui-ux-designer/reference/` — condensed,
KPI-specific adaptations (Apache-2.0, attributed in `NOTICE.md`) of impeccable v4.6.0 (Operate mode,
craft floor, refuse list, critique /40, audit /20, polish triage, clarify) and Anthropic's frontend-design
(restraint, generated-UI defaults, plan-then-review, writing). Every P1 screen is an **Operate** surface:
precision and restraint, standard controls. frontend-design's "be distinctive, take aesthetic risk" applies
only to Persuade surfaces (none in P1). `/design-review critique|audit|polish|copy` runs the passes; a
track merges only with no open P0/P1 from its critique and audit. Impeccable's scripts and binary are
not vendored. **No ALL-CAPS labels and no eyebrow captions**; the shell was brought in line (sidebar
group captions, the tenant name in the top bar, `PlaceholderPanel`, the roles list).

**Why.** Generated UIs drift to the same defaults — card grids, hero metrics, uppercase eyebrows, dotted
meta strings — and on an HR tool those cost trust and scan speed. Uppercase Vietnamese also stacks
diacritics (QUẢN TRỊ KPI) and reads worse at small sizes. Writing the bar down once, with a scored
review, stops each track re-deciding it.

**Updated alongside.** `design-system.md` (Principles, typography, layout patterns), `ui-ux-designer`
SKILL.md, `.claude/agents/ui-ux.md`, `.claude/skills/design-review/`, `development.md` (design quality
passes), orchestrator routing, `CLAUDE.md` (expert panel), the prompt hook.

---

## 2026-10-19 — ERD deltas D1–D6 are PROPOSED, awaiting Phase 1.1

**Decision.** The six deltas from reading the CMC user guides (plan §4) are recorded as proposals, not
yet applied: D1 per-goal target levels L1/L2/L3 + a `LEVELS` method; D2 `Goal.visibility`; D3
`GoalAlignment.allocatedValue` with "not yet assigned" derived; D4 `Goal.kriType` (hidden until Q6);
D5 `FormLaunch` and `FORM_LAUNCH_RULE` moved from P2 to P1; D6 `formRules.canSubmit()` as a rule, not a
table. Phase 1.1 reviews each (system-architect + cto), applies it to `src/data/types.ts`, and logs the
outcome here one by one.

**Why.** With no database, a delta now costs an edit to `types.ts`; after Gate 1 it costs a fixture and
contract change across seven tracks. Deciding them in one review, before any track starts, is the cheap
moment — but they are product decisions too, so they are not taken silently during the bootstrap.

**Updated alongside.** `business-rules.md` §1 (BR-KPI-07, 08, 09), §2 (BR-KPI-18, 19), §5;
`src/data/types.ts` header (TODO list).

---

## 2026-10-19 — Competencies & 360 stay in P2

**Decision.** P1 is the KPI lifecycle only. Competency frameworks, 360 review, continuous performance,
probation/contract evaluation and calibration are P2; commercialisation is P3 (ERD groups G8–G12).

**Why.** The prototype exists to let HR rehearse one KPI period end to end. Each P2 module brings its own
form types and approval chains; adding them now would multiply the workflow surface before the core
process is settled.

**Updated alongside.** `CLAUDE.md` (cpo critical rules), `business-rules.md` §2 (BR-KPI-22).

---

## 2026-10-19 — Tests are a Phase 4 gate on this repo

**Decision.** `npm run test` joins typecheck, build and lint as a required Phase 4 gate and a CI step.
Every `src/lib/*Rules.ts` and every gateway method has a co-located test.

**Why.** OmniX Studio ran tests on demand. Here `src/lib` computes achievement, scores, ratings and pay;
an untested rounding or division-by-zero rule produces a wrong salary for every employee in the period,
and nothing on screen would look broken.

**Updated alongside.** `CLAUDE.md` (Phase 4 gate), `.agents/workflows/development.md`, `merge.md`,
`.github/workflows/ci.yml`, `architecture.md` (testing conventions).

---

## 2026-10-19 — No i18n: Vietnamese UI copy inline

**Decision.** UI strings are Vietnamese, written directly in JSX. No `src/i18n`, no `useT()`, no i18n
dependency. Code, comments and repository documentation are English. Error copy still lives in one
place, `src/lib/errorCatalog.ts`.

**Why.** The users are Vietnamese HR, managers and staff, and the prototype's job is settling the
process. OmniX's two-dictionary setup doubled every copy change; here it would buy nothing. Centralising
error messages keeps the one benefit that matters — the same failure reads the same everywhere.

**Updated alongside.** `CLAUDE.md` (rule 8), `architecture.md` (overview).

---

## 2026-10-19 — A simulated gateway before any database

**Decision.** All data goes through a `DataGateway` contract with a mock adapter (in-memory +
localStorage, seeded fixtures). `supabaseGateway` is a stub that throws until Phase 5. No Supabase
client, no `supabase/` folder, no migrations, no `db:*` scripts.

**Why.** The ERD (67 tables) is still moving (D1–D6, Q1–Q10). A database now would turn every process
change into a migration, and the shared seed is what lets seven tracks build in parallel. Following
OmniX's `StreamingGateway` pattern keeps the switch to a real database to one adapter.

**Consequence.** With no RLS, the `tenantId` parameter on every gateway method is the tenant boundary,
guarded by tenant-isolation tests.

**Updated alongside.** `architecture.md` (data layer), `CLAUDE.md` (rules 3, 4).

---

## 2026-10-19 — Multi-tenant from day one

**Decision.** Every business entity carries `tenantId`; every gateway method takes it and filters by it;
query keys start with it; the seed has two tenants (Syntra and Demo Co).

**Why.** Syntra runs several member companies and the plan has a P3 commercialisation stage.
Retro-fitting tenancy later means touching every type, method, key and fixture — and the first missed
spot is a data leak between companies.

**Updated alongside.** `business-rules.md` §7 (BR-KPI-50), `architecture.md` (data layer).

---

## 2026-10-19 — Balanced Scorecard, not OKR

**Decision.** The goal model is the Balanced Scorecard: four perspectives, KGI → CSF → KPI, weighted
KPIs scored against targets and rolled into ratings and pay. OKR concepts (objectives with aspirational,
unweighted key results) are not modelled.

**Why.** Every source Syntra handed over — the meeting minutes, CMC PMGM, the DATX workbook and slides —
is BSC with weights summing to 100% and pay attached to the score. OKR's "70% is success" scoring would
contradict the payout rules.

**Updated alongside.** `business-rules.md` §0, §1.

---

## 2026-10-19 — Bootstrapped from the OmniX Studio scaffold

**Decision.** The repository takes OmniX Studio's organisation — tooling, `CLAUDE.md` structure, the
eight-agent panel and orchestrator, skills, hooks, the knowledge-base split, the four-phase workflow and
CI — and none of its business content (livestream, ads, video, credits, AffiliX, i18n, Supabase).
`streaming-expert` became `workflow-expert`, `commerce-expert` became `hr-performance-expert`, and
`add-store` + `migration` became `add-entity`.

**Why.** The OmniX workflow already proved itself on a prototype of the same kind and with the same owner;
re-deriving it would cost weeks. Copying the business code would plant terms that do not exist here.

**Updated alongside.** `architecture.md` (overview), `common-pitfalls.md` (inherited stack entries).
