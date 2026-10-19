# Decisions log — Syntra KPI

> **History, not current truth.** Newest first. Grep it for the reasoning behind a past decision; the
> rule files (`business-rules.md`, `architecture.md`, …) say what is true now. Add entries with
> `/log-decision`.

---

## 2026-10-19 — Phase 1.5: the rule engines and their edge answers

**Decision.** `src/lib/` holds the rules as pure functions with tests: `calcRules`, `scoreRules`,
`goalPlanRules`, `alignmentRules`, `ratingRules`, `formRules`, `workflowRules`, plus `orgRules` (shared
org lookups and role-scope semantics, reused by 1.3's `permissionRules` and 1.2's mock) and `isoDate`
(tenant-zone dates; every time-aware rule takes a `Clock { now, tz }`). Edge answers approved by the
product owner:
- no floor means floor 0;
- RATIO_UP/RATIO_DOWN/FORMULA must have a cap;
- RATIO_UP with target 0 is not computable;
- RATIO_DOWN with actual 0 earns the cap;
- LEVELS interpolates, scores 0 below L1, and needs at least 2 levels;
- tiers and rating bands are `[min, max)`;
- the rating reads the rounded, adjusted score;
- a not-computable goal counts as missing, never 0, and blocks finalising;
- payout specificity is Position > nearest unit > All, and no rule gives null;
- a leaver is evaluated for any period they worked; their cascade returns to "chưa giao"; no proration
  (new `ASSUMPTION Q12`);
- LOCK is allowed only on registration;
- no self-approval;
- HR may proxy on a step nobody is assigned to.
`workflowRules.checkAction` is the only entry for a person's action: stale step → frozen → entitled →
table → `canSubmit` → move, returning the history row with both people. Errors ERR-KPI-07…13 and
`RuleIssue` / `toKpiError`.

**Why.**
- Each edge decides someone's pay. An uncapped ratio pushed a plan to A+.
- A dropped not-computable goal renormalised everyone's score upward.
- A partial score could reach payroll.
- Inferring the LEVELS direction from one level was undecidable.
- LOCK on an evaluation froze a form nothing could release.
- A caller-side `canSubmit` could be forgotten on one `act` path.
- The reviewers (hr-performance-expert, qa, workflow-expert, system-architect) required these
  corrections before approving.

**Frozen at merge** (a change costs every track): the signatures of `achievement`, `weightedScore`,
`canSubmit`, `checkAction` / `transition`, and the `RuleIssue` shape.

**Updated alongside.** `business-rules.md` BR-KPI-07, 12, 13, 21, 24 (new), 31–33, 35, 40–42, §6, §8
(Q12); `component-registry.md`; `new-flow.md` §7; the `WorkflowStep` comment in `types.ts`.

---

## 2026-10-19 — Phase 1.1: the DataGateway contract is fixed (gate passed with changes)

**Decision.** `src/integrations/data/types.ts` is the contract for Phase 1.2 and the seven tracks. Every
method takes `tenantId` first; every id in a write payload must resolve in that tenant (ERR-KPI-06);
user writes take `actorUserId` second; system writes (notification, audit) are made only by T7 listeners
and the audit entry is built from the event. One injected `clock` stamps everything (`dev.setNow` moves
it); `scheduler.runDue(tenantId)` is idempotent. Aggregate children are matched by id; aggregate saves
return `{ parent, children }`. Forms, notifications and the audit log are paginated. Every write emits
`entity.changed`. The stub mock rejects with `KpiError` until 1.2; React Query retries only ERR-KPI-01/03.

**Why.** The reviewers (system-architect, cto, workflow-expert) found silent wrong-number failures:
with two clocks, a launch fired on a simulated 1 Feb plus an `act` stamped with the real date would mark
the manager's step overdue and auto-forward it; replacing a workflow's steps regenerated their ids and
orphaned every open form's `currentStepId`; a cross-tenant `perspectiveId` was writable. Each is a
signature change, cheap now and a Large change after Gate 1.

**Updated alongside.** `architecture.md` (Data layer, ERD deviations), `business-rules.md` §5–§7,
`hooks/queries/README.md`, `errorCatalog.ts` (02–06, `isRetryable`).

---

## 2026-10-19 — GOAL_CHANGE keeps the plan Locked; the proposal lives in GoalChangeItem rows

**Decision.** An adjustment is a form started by hand (`forms.startForm`), at most one open per plan.
Its proposal is `GoalChangeItem` rows (ADD/MODIFY/CANCEL + reason + proposed fields). The plan stays
`Locked`; the final APPROVE applies the items: MODIFY creates a new Active goal with `replacesGoalId`
(old → Changed), CANCEL → Cancelled, ADD creates. "Đang điều chỉnh" is derived, not a status.

**Why.** Editing a locked plan in place would let the open evaluation read unapproved targets and lose
BR-KPI-15's Active → Changed history; a sixth "Adjusting" plan status would have to be honoured by every
screen that reads plan status.

**Updated alongside.** `business-rules.md` BR-KPI-15, §5; `architecture.md` D7; `new-flow.md` §3.

---

## 2026-10-19 — Overdue LOCK freezes the form; unlocking needs a new due date; overdue fires once per step entry

**Decision.** An overdue LOCK records `AUTO_LOCK` (no actor) and leaves the form at its step, frozen.
`unlockGoalPlan` takes a reason and a `newDueDate` and re-enters the step. `FormInstance.overdueHandledAt`
makes REMIND/LOCK/AUTO_FORWARD fire once per entry into a step. EDIT is a step permission, never a
recorded action (BR-KPI-23). RETURN goes to `returnToStepNo` (default: previous step). Delegations are
revoked, never deleted. Step deadline = min(entered + SLA, form due date).

**Why.** Without a new due date the next scheduler tick re-locked a plan HR had just unlocked; without
a once-per-entry marker REMIND fired on every tick; deleting a delegation left past actions pointing at
nothing.

**Updated alongside.** `business-rules.md` BR-KPI-13, 21, 23, §5.

---

## 2026-10-19 — D7: fields the P1 screens need that the ERD lacks; D8: English enum codes

**Decision.** D7 adds the columns listed in `architecture.md` (ERD deviations) — e.g. `Goal.targetType`
(HR guide p. 23), `Goal.rollUpFromChildren` (Q8), `Employee.leftOn` (left mid-period), `Notification`
stores its rendered text — plus `GoalChangeItem`, Goal Plan `Returned`, step actions `CANCEL`/`AUTO_LOCK`,
overdue `LOCK`, notification `STEP_ASSIGNED`; `KPI_ALERT` waits for Phase 3. `GOAL_PLAN.total_weight`
is not stored. D8: the ERD's Vietnamese enum values become English codes; Vietnamese lives only in the
`*_LABEL` maps. `Notification` is typed `KpiNotification` (the DOM has a global `Notification`).

**Why.** Each D7 field is read by a P1 screen or rule (plan §5) and would otherwise become a fixture
change after Gate 1. Codes like `PhongBan` mixed two languages in code and made the label the key.

**Updated alongside.** `architecture.md` (ERD deviations), `business-rules.md` §5.

---

## 2026-10-19 — D6 applied: `canSubmit` is a rule driven by the step's configuration

**Decision.** No table. `WorkflowStep.evaluationColumn` (SELF/MANAGER/FINAL) and `requiresComment` tell
`formRules.canSubmit()` (Phase 1.5) which column — and comment — every item needs before SUBMIT/APPROVE;
`EvaluationItem.finalComment` exists so a FINAL step can require one.

**Why.** Hard-coding "self step = self column" in the rule would break the first time HR configures a
workflow differently; a FINAL step requiring a comment had no column to hold it.

**Updated alongside.** `business-rules.md` BR-KPI-18, §5.

---

## 2026-10-19 — D5 applied: `FormLaunch` + `FormLaunchRule` in P1

**Decision.** `FormLaunch` (timing NOW/SCHEDULED/RECURRING, period, `dueDays`, recipients ALL or a
`RecipientFilter`) creates many forms; recipients resolve when it fires; subjects with a non-cancelled
form of the same type and period/cycle are skipped. `FormLaunchRule` (trigger `PERIOD_END` +
`offsetDays`) fires once per (rule, period). A registration launch creates missing Draft Employee plans.

**Why.** The monthly evaluation must launch itself (HR guide pp. 89–93); resolving recipients at
scheduling time would miss people hired between scheduling and the launch.

**Updated alongside.** `business-rules.md` BR-KPI-19, §5.

---

## 2026-10-19 — D4 applied: `Goal.kriType` stored and hidden

**Decision.** `KRI_TYPES = KRItc | KRIpt`, nullable on `Goal`, beside (not instead of) the BSC
perspective; no screen shows it until Q6 is answered.

**Why.** HR guide p. 22 pairs KRItc only with Tài chính and KRIpt with all four perspectives — a second
axis, not a replacement — but nobody at Syntra has confirmed what it means.

**Updated alongside.** `business-rules.md` BR-KPI-06, §5.

---

## 2026-10-19 — D3 applied: allocation on the alignment, "Tự giao" on the goal, "chưa giao" derived

**Decision.** `GoalAlignment.allocatedValue` (CASCADE) and `Goal.selfAssignedValue` ("Tự giao") are
stored; "chưa giao" = target − Σ allocated − self-assigned is derived by `alignmentRules`; "tự thực hiện"
is not tracked in P1 (new `ASSUMPTION Q11`).

**Why.** HR guide p. 24 has the manager enter a self-kept share separately from what is handed down;
storing "chưa giao" would let it disagree with the allocations.

**Updated alongside.** `business-rules.md` BR-KPI-07, §8 (Q11).

---

## 2026-10-19 — D1, D2 applied: per-goal target levels and goal visibility

**Decision.** D1: `GoalTargetLevel` (L1/L2/L3, numeric or text target, `scorePct`) per assigned goal,
plus the `LEVELS` calc method; interpolation stays `ASSUMPTION Q1`. D2: `Goal.visibility` PUBLIC/PRIVATE.

**Why.** The levels are set when a goal is assigned (HR guide pp. 23, 28) — putting them on the shared
calc method would force one threshold set on every goal using it.

**Updated alongside.** `business-rules.md` BR-KPI-08, 09, 30, §5.

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
