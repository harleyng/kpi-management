# Business rules — Syntra KPI

> Living document — **the authoritative current rules**. Referenced by every agent.
> Rule codes are `BR-KPI-xx`. Every rule names its source (see `docs/source-map.md` for the files and
> page numbers). A value that depends on an open question (plan §9) is marked **`ASSUMPTION Qn`** and
> uses the plan's default until the question is answered.
>
> Status on 2026-10-19 (Phase 1.5 done): the **state sets are declared** in `src/data/types.ts`, the
> data contract in `src/integrations/data/types.ts`, and the rules below are **implemented** as pure
> functions in `src/lib/*Rules.ts` (calc, score, goalPlan, alignment, rating, form, workflow, org)
> with co-located tests. A rule names the function that enforces it.
> Phase 1.3 (2026-10-19) implemented §9 — roles, permissions and data scope — in
> `src/lib/permissionRules.ts`.
> **Gate 1 passed 2026-10-19**: the mock gateway calls these rules on every method (bar the Phase 2
> tracks' own work packages, `architecture.md`) and enforces `can()` on every write. Gate 1 added
> `src/lib/cycleRules.ts` (cycles and periods), `src/lib/resultRules.ts` (the period-result pipeline
> shared by the mock and the seed) and `src/lib/actualRules.ts` (the actual-entry rule, reused by T4's
> import).
> **Track T3 (2026-10-19)** added `src/lib/planAccessRules.ts` (who may edit / send a plan, who sees a
> PRIVATE goal — shared by the gateway guard and the screens), `goalPlanImportRules.ts` (BR-KPI-26), period
> generation (`cycleRules.generatePeriods`), the period split (`goalPlanRules.evenSplit` /
> `periodTargetIssues`) and the cascade rules (`alignmentRules.goalAllocationIssues` / `cascadedGoalDraft`).

---

## 0. Glossary and source priority

**Source priority.** Syntra's decisions (NoteX minutes, the plan, the product owner) > the plan's
defaults for open questions > CMC PMGM user guides and SF4C as a reference implementation > DATX as an
example of today's practice. A CMC feature Syntra has not confirmed is **not in P1**.

| Term | Meaning |
|---|---|
| **BSC** | Balanced Scorecard — four perspectives: Tài chính · Khách hàng · Quy trình nội bộ · Học hỏi & phát triển |
| **KGI** | Key Goal Indicator — one of the 3–5 key goals of a Goal Plan (DATX: "Mục tiêu chung (3-5) - KGI") |
| **CSF** | Critical success factor — the bridge KGI → CSF → KPI (DATX slides) |
| **KPI / chỉ tiêu** | One measurable goal in a Goal Plan, with weight, target, calculation method and data source |
| **KPI definition** | A reusable item in the KPI library, which a goal may be created from |
| **Goal Plan** | One owner's set of goals for one cycle; owner = company, org unit or employee |
| **Cascade** | A manager hands part of their own goal down to a report (parent → child, with an allocated value) |
| **Link** | An employee ties a goal they added to a manager's goal (contribution) |
| **Định mức L1/L2/L3** | Per-goal target levels, each with a score (D1) |
| **Chu kỳ / kỳ** | Cycle (e.g. "KPI 2027") / a period inside it (T01…T12, Q1…Q4) |
| **Phiếu (form)** | One workflow instance (registration, adjustment or evaluation) for one subject and period |
| **Đợt khởi chạy** | One launch that creates many forms, now, on a date or on a schedule (D5) |
| **Proxy / ủy quyền** | Acting on someone else's step (HR as proxy) / a dated delegation of one's own step |
| **Vai trò (role)** | EMPLOYEE · MANAGER · HR · CNB · BOD · ADMIN — a bundle of permissions, assigned to an account with a scope |
| **Quyền (permission)** | One capability, `module.action` (`goalplan.lock`, `form.launch`) — §9. Never "who approves this step": that is the step's **actor** (người xử lý bước) |
| **Phạm vi dữ liệu (scope)** | Whose data a role's permissions reach: Self · DirectReports · OrgUnit (+ children) · Tenant |

---

## 1. Structure — tiers, Goal Plans, goals

- **BR-KPI-01** — Goals exist on **three tiers**: Company → Department (org unit) → Individual. Each
  Goal Plan has exactly one owner of one tier. *Source: NoteX minutes; ERD `GOAL_PLAN.owner_type`.*
- **BR-KPI-02** — A Goal Plan holds **3–5 KGI**. A KGI may carry a numeric target but is **not scored**
  (`ASSUMPTION Q9`). *Source: DATX department sheets; DATX slides pp. 21–22.*
- **BR-KPI-03** — A Goal Plan holds **5–8 KPIs**. *Source: plan §6.2 (1.5 `goalPlanRules`), NoteX minutes.*
- **BR-KPI-04** — A Goal Plan can be submitted only when its goals' weights sum to **100%**, compared with
  a tolerance of ±0.01 (a sum of 99.99% or 100.01% from rounding counts as 100%). *Source: HR guide
  p. 22; Manager guide p. 26; email template ("if the total weight is less than 100%").*
- **BR-KPI-05** — **Every KPI has a data source** ("KPI phải đo được"). A goal without one cannot be
  saved: the column is required and must resolve in the tenant (the integrity check, ERR-KPI-06), and the
  goal editor requires it. Other fields (weight > 0, a target, dates in order) are checked on **Gửi**
  (`submitIssues`), so a draft can be saved while it is being built (T3). *Source: NoteX minutes §2.3; ERD
  `GOAL.data_source_id` (required).*
- **BR-KPI-06** — Every KPI belongs to exactly one **BSC perspective**. DATX's "Hiệu quả / Khối lượng /
  Chi phí" classification is a secondary tag only (`ASSUMPTION Q5`). The KRI type (KRItc / KRIpt) is
  hidden until its meaning is confirmed (`ASSUMPTION Q6`, D4). *Source: HR guide p. 22; DATX sheet
  "2. KPIs phòng ban".*
- **BR-KPI-07** — Goals are joined by **cascade** (parent goal allocated down, `allocatedValue`) or
  **link** (child contributes to a parent, `contributionPct`). A goal can never be its own ancestor (no
  cycles, A → B → A refused). For a cascaded goal the manager sees four buckets (D3): **assigned to
  employees** = Σ `allocatedValue` (derived); **self-assigned / tự giao** = the parent's
  `selfAssignedValue` (stored); **not yet assigned** = parent target − assigned − self-assigned (derived,
  never stored); **self-performed / tự thực hiện** is not tracked in P1 (`ASSUMPTION Q11`). Allocating
  more than the parent target is refused (ERR-KPI-11; ERR-KPI-10 for a cycle). When the owner of a cascaded
child goal **leaves**, from the day after their last working day their allocation counts as **not
assigned** again, so the manager can re-cascade it (`alignmentRules.allocationBuckets`).
**Re-saving a parent** (`saveGoal`, T3): lowering its target, raising "tự giao" or turning it into a TEXT
goal must not over-allocate it — ERR-KPI-11 / 06 (`goalAllocationIssues`); checked only when the target, its
type or "tự giao" changes, so a rename never trips over an older over-allocation. **Cascading** creates the
child goal in the report's plan (`cascadedGoalDraft`: same KPI, target = the allocation, dates clipped to the
cycle and the owner's employment; the method copied only when share-safe — RATIO_UP / RATIO_DOWN / BINARY —
else the manager picks one; levels, split, weight and KGI not copied) and then the CASCADE alignment; it is
possible only while the manager may edit the report's plan (their registration form at a step with EDIT for
the manager — BR-KPI-12 step 1 or 3). A **link**'s `contributionPct` (0, 100] is informational only
(`ASSUMPTION Q19`).
*Source: HR guide p. 24; email template steps 1–2.*
- **BR-KPI-08** — A goal is **public or private** (visibility, D2). A PRIVATE goal is seen only by its
  owner (the goal's, or the plan's — the unit head for a unit plan), anyone in that owner's manager chain
  today, and holders of a Tenant scope over plans (HR, C&B, BOD, Admin) (`planAccessRules.canSeeGoal`,
  product owner, T3). **Enforced on screens only** — the hooks filter in one place (`useGoals`); the gateway
  still returns the row until Phase 5's RLS. Totals and allocation buckets still count private goals; a
  screen says how many were hidden. *Source: HR guide pp. 21–22.*
- **BR-KPI-09** — A goal may carry **target levels L1/L2/L3** (`GoalTargetLevel`), set per assigned goal
  (not per method). Each level has a numeric or text target (per the goal's `targetType`) and the score
  earned for reaching it, e.g. L1 → 0%, L2 → 100% ("Nguyên tắc đánh giá") (D1). *Source: HR guide
  pp. 23, 28; import columns P–T p. 63.*
- **BR-KPI-10** — A goal's target is either **numeric** or **text** (Đạt / Không đạt). *Source: HR guide p. 23.*
- **BR-KPI-11** — A goal's target may be **allocated by period** (monthly/quarterly targets). "Chia đều"
  follows the KPI's aggregation (`goalPlanRules.evenSplit`, `ASSUMPTION Q15`): SUM → equal shares at 4
  decimals, the remainder on the last period; AVG / LAST → the target in every period. A split that does not
  fit is a **warning, never a block** (product owner, T3): `SPLIT_MISMATCH` (SUM Σ / AVG mean / LAST last
  period by date ≠ target, tolerance relative 1e-6, 0.005 absolute below 1), `SPLIT_INCOMPLETE` (some periods
  of the type missing — that quarter / year then falls back to the FULL target), `SPLIT_MIXED_TYPES`,
  `SPLIT_NO_AGGREGATION` (a typed-in KPI: the split applies to its months only). It shows on the goal row and
  the plan's readiness strip, because quarters and the year are built from the month splits
  (`resultRules`). *Source: DATX column "Phân bổ mục tiêu theo tháng"; ERD `GOAL_PERIOD_TARGET`.*

## 2. Processes (P1)

The three P1 form types: **GOAL_SETTING** (registration), **GOAL_CHANGE** (adjustment), **KPI_EVAL**
(evaluation). Diagrams: `docs/flows/new-flow.md`.

- **BR-KPI-12** — **Registration runs in four steps**: (1) the direct manager cascades some of their own
  goals to the employee; (2) the employee adds new goals and links them to the manager's goals, until
  the weights reach 100%; (3) the direct manager approves, edits or returns the plan to the employee;
  (4) HR records the final Goal Plan (and locks it). *Source: email template "Email khởi chạy"; SF4C
  PMGM.03.* The plan's status follows its form (`goalPlanRules.planStatusOnEnterStep`): up to the
  owner's (SELF) step **Draft** (**Returned** when sent back), after it **Submitted**, at the last step
  **Approved** when a reviewer already approved, and **Locked** on the final APPROVE; cancelling the
  form puts it back to Draft. 100% / 5–8 goals is required only from the owner's step on — the
  manager's step-1 SUBMIT hands an unfinished plan to the employee (`formRules.canSubmit`).
- **BR-KPI-13** — When a step's deadline passes, the step's **overdue behaviour** applies, and it is
  configured per step: **lock** the Goal Plan (registration: "the goal plan will be locked and can not be
  editable after running out of time"), **auto-forward** to the next actor (evaluation: an employee who
  has not self-assessed in time → the form goes to the direct manager), or **remind**. The step's
  deadline = min(entered + `slaDays`, the form's due date), in the tenant's time zone. The behaviour
  applies **once per entry into the step** (`overdueHandledAt`) and is recorded as an `AUTO_FORWARD` or
  `AUTO_LOCK` action with no actor. An auto-locked form stays at its step, frozen; HR unlocking the plan
  must give a **new due date**, and the step starts again from the unlock (`workflowRules.onUnlock`). A
  step may also send a reminder `remindDaysBefore` its deadline, once per step entry (`reminderKey` is
  the notification's `sourceEventId`). **LOCK is allowed only on registration steps** — a GOAL_CHANGE
  plan is already locked and an evaluation has no plan, so the form could never be released; AUTO_FORWARD
  never on the last step (`validateWorkflow`; a misconfigured one falls back to REMIND). REMIND records
  no action. The deadline day itself is on time. One move per form per scheduler tick. A form is also
  **frozen** while HR has its registration plan locked by hand. The clock-driven jobs run as one
  **scheduler tick** (`scheduler.runDue(tenantId)`, a system write with no actor): due SCHEDULED
  launches → recurring rule firings → overdue steps (on the forms as the tick found them) → reminders.
  **Reminders are not deduplicated by the scheduler**: every tick inside the window re-emits
  `form.dueSoon` with the same `reminderKey`; the notification listener (T7) writes one notification
  per (reminderKey, recipient). AUTO_LOCK audits the plan's lock as `LOCK` with reason `AUTO_LOCK` and
  no user. *Source: email template "Email nhắc Deadline"; SF4C PMGM.09.*
- **BR-KPI-14** — HR can **lock and unlock** a Goal Plan; every lock/unlock is kept in its history. A
  locked plan cannot be edited except through the adjustment process. Lock and unlock are audited as
  `LOCK` / `UNLOCK` (unlock with its reason). Cancelling a registration whose plan HR had locked puts the
  plan back to Draft and is audited as `UNLOCK` with the cancel reason. Unlocking returns the plan to
  where its open registration form stands (`statusAfterUnlock`), or Approved when registration had
  finished; the open form re-enters its step with the new due date. *Source: HR guide pp. 47–49; SF4C
  PMGM.03, PMGM.06.*
- **BR-KPI-15** — **Adjustment** (GOAL_CHANGE) changes an approved, locked Goal Plan through its own
  approval chain. It is started by hand (`forms.startForm`), at most one open per plan. The proposal is a
  list of `GoalChangeItem`s (ADD / MODIFY / CANCEL, each with a reason); the plan **stays Locked** and
  untouched until the final approval, then: MODIFY creates a new Active goal that `replacesGoalId` the old
  one (→ Changed), CANCEL marks the goal Cancelled, ADD creates a goal. "Đang điều chỉnh" is derived from
  the open form, never a plan status. `forms.startForm` refuses (`workflowRules.canStartForm`): an
  evaluation (`NOT_STARTABLE`, 06); no plan, a period, a subject other than the plan's owner (the unit
  head for a unit plan), a due date in the past (06); a plan that is not Locked (`PLAN_NOT_LOCKED`, 04);
  a second open adjustment (`CHANGE_ALREADY_OPEN`, 04); a cycle that does not accept the form (04). A
  draft proposal (`saveGoalChangeItems`) may still lack its reasons — `changeItemIssues(..., { draft:
  true })`; the submit requires them. *Source: SF4C PMGM.06–07; Manager guide.*
- **BR-KPI-16** — **Evaluation runs in three steps**: (1) the employee self-assesses each goal (% and
  explanation) with evidence; (2) the direct manager scores each goal (% and comment); (3) HR/C&B records
  the final % per goal. *Source: NoteX minutes §2.3; Manager guide pp. 98–109; SF4C PMGM.12.*
- **BR-KPI-17** — On the evaluation form the **actual value comes from the actuals data (T4) and is
  read-only**; the form shows target/levels, actual, self %, manager %, final %, evidence, and the
  computed total score. *Source: plan §5.5.*
- **BR-KPI-18** — A form can be **submitted** only when the weights sum to 100% (BR-KPI-04) and every
  item that requires a score or comment at that step has one (`formRules.canSubmit`, D6). *Source:
  Manager guide p. 26.*
- **BR-KPI-19** — Forms are created by a **launch**: form type and workflow template; timing — now, on a
  date, or recurring (e.g. day 1 of each month); the evaluation period; a due date rule (e.g. 7 days
  after launch); recipients — everyone, or a filter (units ± children, positions, job levels, employment
  status, named people). One launch creates many forms; recipients are resolved when it fires, and a
  subject who already has a non-cancelled form of the same type for the same period (or cycle, for
  registration) is skipped. A registration launch creates the subject's Draft Employee plan when there is
  none; Company and OrgUnit plans are registered by a form started by hand for the unit head. The
  recurring launch (`FORM_LAUNCH_RULE`, trigger `PERIOD_END` + `offsetDays` ≥ 0) moves from P2 into P1
  because the monthly evaluation must launch itself, and fires once per (rule, period) (D5). Starting a
  unit plan's registration by hand needs a Company / OrgUnit plan that is not Locked and has no open
  registration; its subject is the unit head. A launch is NOW (fires at once, `scheduledAt` = now) or
  SCHEDULED (strictly in the future, fires at the first tick after); RECURRING comes only from a rule
  (`launchTimingIssues`). Only a Scheduled launch can be cancelled (`canCancelLaunch`, 04). A recurring
  rule launches the **evaluation only**, whole days ≥ 0 (`validateLaunchRule`). Rules fire for periods
  of **Active or Evaluating** cycles (product owner, Gate 1: the last month ends after the cycle moved
  to Evaluating). An evaluation form's items snapshot the **current** actual of (goal, period) at the
  moment the launch fires (BR-KPI-17). *Source: HR guide pp. 89–93.*
- **BR-KPI-20** — Every step defines its **actor rule** (SELF / DIRECT_MANAGER / MANAGER_L2 / HR / CNB /
  ROLE), its allowed actions (SUBMIT / APPROVE / EDIT / RETURN) and its SLA in days. The direct manager
  is resolved from the reporting line at the time of the action. *Source: ERD `WORKFLOW_STEP`; HR guide
  pp. 150–155.* Being a step's actor is never a permission (BR-KPI-61).
- **BR-KPI-21** — An action taken **as proxy or under delegation** records both the person who acted
  and the person acted for (and the delegation used). A delegation is valid only for its form type,
  between `validFrom` and `validTo`, and until it is revoked; it stops granting the right the moment it
  expires. Delegations are revoked, never deleted. Validity is checked against the gateway clock, in
  the tenant's time zone, and the delegator must still be the step's actor. HR may act as proxy on a
  step **nobody is assigned to** (a top manager, an unfilled role) so no form gets stuck. **Nobody acts
  on a review step of their own form** — the subject is never an actor, delegate or proxy of a non-SELF
  step (HR's own evaluation goes to another HR user) (`workflowRules.entitlement`). `saveDelegation`
  refuses (`delegationIssues`, ERR-KPI-06): delegating to oneself (`SELF_DELEGATION`); to anyone but an
  Active account of the tenant; dates not real or backwards; a `validTo` already past; a **chain** — the
  delegate already delegates, or the delegator is someone's delegate, for the same form type over
  overlapping dates (`DELEGATION_CHAIN`); an overlapping duplicate of the same pair and form type. A
  revoked delegation is not edited (04). **Who may revoke** (`canRevokeDelegation`): the delegator, or
  someone holding `delegation.manage` with a **Tenant** scope (HR, C&B, BOD, ADMIN under the default
  matrix) — a manager whose unit covers the delegator is not enough (05); revoking twice is 04.
  *Source: ERD `FORM_STEP_ACTION`, `DELEGATION`; plan §8.1; Phase 1.5 workflow review.*
- **BR-KPI-23** — On a form, **EDIT is a permission, not an action**: it lets the step's actor change the
  subject's plan or scores; those edits are audited, and the form does not move. Only SUBMIT, APPROVE,
  RETURN and CANCEL are recorded by a person; RETURN goes to the step's `returnToStepNo` (default the
  previous step). CANCEL is HR/ADMIN only, with a reason; cancelling a registration form puts its plan
  back to Draft. An action names the step the screen showed — if the form has moved on, it is refused
  (ERR-KPI-04). CANCEL and acting as proxy are the `form.cancel` / `form.proxy` permissions (§9). An EDIT
  that names nobody else (`saveEvaluationItems`, `saveGoalChangeItems`, `saveGoal`… — their contracts
  carry no `onBehalfOfUserId`) is made with the actor's **standing** (`editStanding`): as a step actor;
  else as the valid delegate of a step actor; else, with `form.proxy`, on behalf of the first step
  actor. The audit rows of the edit name both people. `editRefusal` distinguishes the state (closed
  form, step without EDIT, frozen → 04) from the person (not entitled → 05). "Lưu nháp" writes only the
  current step's column (another column → 04); the actual snapshots are never writable (04); a % above
  the goal's method cap is 06. *Source: Phase 1.1 workflow review; ERD `WORKFLOW_STEP.allowed_actions`.*
- **BR-KPI-24** — **Someone who leaves mid-period** is evaluated for every period they worked at least
  one day of (left on 15 Jan → January's evaluation still launches on 1 Feb); their own SELF step has no
  actor, so its overdue behaviour carries the form on to the manager, and their lines are read as of
  their last working day. Registration launches reach only people employed on the launch day. Payout is
  **not prorated** (`ASSUMPTION Q13`; `orgRules.employedFraction` is ready if it is). *Source: plan
  §8.1; Phase 1.5 review.*
- **BR-KPI-25** — A **performance cycle** moves forward one status at a time: **Planning → Active →
  Evaluating → Closed** (`cycleRules.CYCLE_NEXT`; anything else ERR-KPI-04). The cycle and its periods
  are edited **only while Planning** (`canEditCycle`, ERR-KPI-04). Activating needs at least one valid
  period (ERR-KPI-06 `PERIODS_REQUIRED`). A period lies inside its cycle, starts on or before it ends,
  its input / evaluation deadlines (when set) are not before its end, and two periods of the **same
  type** never overlap (a month and its quarter may) (`periodIssues`, ERR-KPI-06). **Closing a cycle
  locks every period**; a Closed cycle's period locks no longer change (`canLockPeriod`) and its plans
  are no longer editable (`canEditPlan.cycleClosed`). Which forms a cycle accepts (`cycleAllowsLaunch`,
  ERR-KPI-04): registration while Planning or Active; evaluation while Active or Evaluating; an
  adjustment at any time before Closed. *Source: Phase 1.5 workflow design (Gate 1); ERD
  `PERFORMANCE_CYCLE`.*
- **BR-KPI-26** — **Goal Plan import** (WBS 4.3.7, plan §5.2; `goalPlanImportRules`, the screen comes with
  T4's batch framework). One goal per row; the batch's cycle holds the plans. Row errors stop the batch (all
  or none): login → an Active account of an employee still employed; perspective code known; a library code
  that resolves (else unit, method and data source are required — given codes must resolve); weight > 0;
  dates real, ordered, inside the cycle (blank → the cycle's); the target matches its type and a TEXT target
  never sits under a numeric-only method; valid levels (ERR-KPI-13, LEVELS needs ≥ 2); no duplicate (person +
  goal name, or person + library KPI) in the file or the plan; a Locked plan or a Closed cycle → ERR-KPI-04.
  Per plan, weight ≠ 100 ± 0.01 (07) and a count outside 5–8 (08) are **warnings** — HR completes and then
  locks the plan. A person with no plan in the cycle gets a Draft one at commit (`goalplan.import`). No KGI,
  "tự giao" or period split by import in P1.
- **BR-KPI-27** — **Periods are generated** (`cycleRules.generatePeriods`) for a cycle of whole months, at
  most 12: months `T01…T12` by calendar month with input / evaluation deadlines = the month's end + 5 / + 13
  days (editable offsets); quarters / halves / the year counted from the cycle start (`ASSUMPTION Q20`), whole
  groups only, no deadlines. Regenerating keeps the id and lock of a period with the same type and label
  (`mergeGeneratedPeriods`).
- **BR-KPI-28** — **Who may change a plan now and send it** is one decision shared by the gateway and the
  screens (`planAccessRules.planEditability` / `submitAvailability`): `goalplan.edit` over the owner, then
  `canEditPlan` with the open registration form's EDIT standing; "Gửi" is a dry run of `checkAction` (step
  allows SUBMIT, the person is entitled, content passes `canSubmit`). Before the owner's step the button is
  "Chuyển cho nhân viên" and 100% / 5–8 are information only. A screen that cannot load an input shows the
  plan read-only ("UNKNOWN"), never editable.
- **BR-KPI-22** — Out of P1: "Lấy ý kiến", "Thêm người duyệt" and the collaboration step (`ASSUMPTION
  Q7`); the monthly work plan of PMGM.08 (`ASSUMPTION Q10`). The primary evaluation cadence is
  **monthly** (`ASSUMPTION Q3`).

## 3. Calculation

All calculation is a pure function in `src/lib/*Rules.ts` with tests (CLAUDE.md, rule 5).

- **BR-KPI-30** — Calculation methods (ERD `CALC_METHOD.method_type` + D1): **RATIO_UP** (higher is
  better: actual / target), **RATIO_DOWN** (lower is better: target / actual — DATX writes it "% mục
  tiêu / thực tế"), **TIERED** (value ranges → fixed %, e.g. one stock-out = 70%), **BINARY** (Đạt /
  Không đạt), **FORMULA** (an expression), **LEVELS** (L1/L2/L3 per goal, BR-KPI-09).
- **BR-KPI-31** — Each method has a **cap** and a **floor** (e.g. cap 120%). The raw result is computed
  first, then the floor, then the cap. With no floor configured the floor is **0** — a negative
  achievement would pull the plan below a goal that achieved nothing. **RATIO_UP, RATIO_DOWN and
  FORMULA must have a cap** (target 1, actual 1000 would otherwise be 100 000% and carry the plan to the
  top rating); floor ≤ cap (`calcRules.validateCalcMethod`, ERR-KPI-13). An uncapped one that reaches
  the engine anyway is not computable, never scored. `library.saveCalcMethod` refuses what
  `validateCalcMethod` refuses (ERR-KPI-13).
- **BR-KPI-32** — A **missing actual** gives no achievement — never 0. When the data cannot give an
  answer the goal is **not computable** (ERR-KPI-12) and is treated exactly like a missing actual —
  never 0, never silently dropped. The answers (`calcRules.achievement`):

  | Method | Edge | Answer |
  |---|---|---|
  | RATIO_UP | target 0 / negative / missing | not computable |
  | RATIO_UP | actual 0 | 0% (a real zero is scored) |
  | RATIO_DOWN | actual 0, target > 0 | the **cap** (the best possible result) |
  | RATIO_DOWN | actual 0, target 0 | 100% · target 0, actual > 0 → 0% · negatives → not computable |
  | TIERED | value | the tier `[fromValue, toValue)` holding the actual (`null` = open); a gap → not computable; overlapping tiers refused |
  | BINARY | text | Đạt when the actual equals the target text ignoring case and tone marks → 100%, else 0%; numeric: actual ≥ target |
  | FORMULA | | numbers, `actual`, `target`, `+ - * /`, parentheses, `min`, `max` — nothing else; ÷0 or a missing target → not computable |
  | any | text actual blank | missing |
- **BR-KPI-33** — **LEVELS** (`ASSUMPTION Q1`): exactly on a level → its score; between two levels →
  linear interpolation; past the top level → the top level's score; **below the lowest level → 0** (a
  deliberate cliff when L1 scores more than 0). A goal's levels must be **at least two**, with strictly
  increasing scores L1 < L2 < L3 and strictly monotonic targets — which makes the direction explicit
  (L3's target below L1's = lower is better). A text result matching no level is not computable, so a
  typo never scores 0.
- **BR-KPI-34** — "Tỉ lệ KH cũ" is **higher-is-better** (RATIO_UP) despite the DATX workbook using both
  directions (`ASSUMPTION Q4`).
- **BR-KPI-35** — The **weighted score** of a Goal Plan for a period = Σ (achievement% × weight) / Σ
  weight over its **Active** goals (Changed and Cancelled excluded). A goal without an achievement is
  left out of both sums and marks the score **incomplete** — the score shown is then provisional, and
  the result **cannot be finalised** (`scoreRules.finalizeIssues`: ERR-KPI-09 per unscored goal,
  ERR-KPI-07 for weights). Rounding happens once, at finalisation: 2 decimals, half away from zero
  (`roundScore`, 89.995 → 90.00).
- **BR-KPI-36** — A parent KPI's actual is **measured independently**; it is summed from its children
  only when that KPI is explicitly flagged to roll up (`ASSUMPTION Q8`).

## 4. Results and pay

- **BR-KPI-40** — A period result per Goal Plan holds the total score, the rating level, the payout %
  and an **adjustment** (rule violations, attendance) in **points added to the score**, positive or
  negative; the adjusted score never goes below 0 (`scoreRules.adjustedScore`). **Stored conventions**
  (`resultRules`): `PeriodResult.totalScore` is the **adjusted** score — a Draft stores it unrounded, a
  Final / Locked result stores it **rounded once at finalisation** (`ratedScore`); `adjustmentPct` is
  stored on its own. `ResultDetail.achievementPct` is the per-goal % (floor and cap already applied, or
  the FINAL column of the form); `weightedScore` = achievement × weight / 100. Rating and payout are
  **null while the score is provisional** — a goal not scored, or weights that do not total 100% (within
  the BR-KPI-07 tolerance; Gate 1 QA). **Payout only for Employee plans** — a Company / OrgUnit plan
  is rated but has no payout figure. The payout is read as of the **period's end date**, for the
  employee's unit chain and position on their last working day in the period (BR-KPI-24). The scale is
  the cycle's `ratingScaleId`. An adjustment is set on a **Draft** only and re-scores from the result's
  **stored details** (what HR is looking at), so an adjustment that crosses a level boundary re-rates
  and changes the payout (`resultRules.applyAdjustment`). *Source: ERD `PERIOD_RESULT`; DATX sheet "TH
  KQ" columns.*
- **BR-KPI-41** — The **rating scale** maps a score range to a level. Default sample scale
  **A+ / A / B / C / D** (`ASSUMPTION Q2` — the DATX "TH KQ" sheet is broken with `#REF!`, so no real
  scale is available yet). Each level holds `[minScore, maxScore)`; the top level also takes anything
  above its max; levels must start at 0 and be contiguous (`ratingRules`). The rating reads the
  **rounded, adjusted** score, so it matches the number on screen. The seed's sample: A+ [110, 120] (and
  above) · A [100, 110) · B [90, 100) · C [70, 90) · D [0, 70). `results.saveRatingScale` refuses what
  `validateRatingScale` refuses (ERR-KPI-13).
- **BR-KPI-42** — A **payout rule** maps a rating level to a % of the KPI salary component, optionally
  per org unit or position, from an effective date. Sample table only (`ASSUMPTION Q2`): A+ 120% ·
  A 100% · B 80% · C 50% · D 0% for everyone, and an OrgUnit rule paying Kinh doanh 130% for A+. The most
  specific rule in force wins: **Position**, then the **nearest org unit** up the employee's unit chain,
  then All; among equals the latest `effectiveFrom`. A rule naming both a unit and a position is
  invalid. No rule → **no payout figure** ("chưa có quy tắc"), never 0% (`ratingRules.payoutPctFor`).
  `results.savePayoutRule` refuses what `validatePayoutRule` refuses (ERR-KPI-13) and a level of another
  scale (ERR-KPI-06 `LEVEL_NOT_IN_SCALE`).
- **BR-KPI-43** — Results move **Draft → Final → Locked** and nothing else
  (`resultRules.RESULT_TRANSITIONS`). **Finalising** (`finalizePeriodResults`) recomputes the selected
  Drafts (all of the period's when none are listed) from the **current** data, keeping the adjustment,
  and checks each with `finalizeCheck`: weights first (ERR-KPI-07), then each **not computable** goal
  (ERR-KPI-12, detail = the reason), then each goal **with no achievement** (ERR-KPI-09); every issue
  names its result (`data.resultId`). It is **all or none** — one result with an issue refuses the whole
  call, writes nothing and lists every issue of every result (product owner, Gate 1). On success:
  Final, `finalizedAt` = the gateway clock, the score rounded once; emits `results.finalized`. A listed
  result that is not Draft → 04 (`NOT_DRAFT`), of another period → 06, no Draft → 04. **Locking**
  (`lockPeriodResults`) turns the period's Final results Locked (audit action LOCK); Drafts stay; no
  Final result → 04. It does not touch `CyclePeriod.isLocked`. Once the cycle is **Closed**, nothing is
  calculated, adjusted or finalised (04 `CYCLE_CLOSED`), and finalising re-checks that the plan is still
  Approved / Locked (04 `NOT_ELIGIBLE`). Only finalised results are exported to
  payroll, and the export is recorded (T6). *Source: ERD `PERIOD_RESULT.status`, `PAYROLL_EXPORT`.*
- **BR-KPI-44** — `calculateResults` computes a **Draft** per Approved / Locked plan of the period's
  cycle (`resultRules.buildPeriodResults`); a Final or Locked result is never recomputed (returned
  unchanged); an existing Draft keeps its id and adjustment and gets fresh details. Refused once the
  cycle is Closed (ERR-KPI-04). **Employee plan** — only from a **Completed KPI_EVAL form** for
  (subject, plan, period), its **FINAL column**; no completed form → **no result** (`ASSUMPTION Q17`).
  The form is the snapshot of the goals Active when it opened (BR-KPI-17), so every goal on it counts
  even if since Changed / Cancelled (E026's T01). **Company / OrgUnit plan** — `calcRules.achievement`
  on the **current** actuals of its Active goals; a Quarter / Half / Year with no own actual adds up its
  months by the KPI's aggregation (`aggregatePeriodActuals`), the target likewise from the months' split
  targets; a goal flagged `rollUpFromChildren` sums its CASCADE children (`ASSUMPTION Q8`); NO_ACTUAL
  and NOT_COMPUTABLE stay null, never 0.

## 5. State sets (declared in `src/data/types.ts`, Phase 1.1)

Every status in the app comes from one of these sets; each has a Vietnamese `*_LABEL` map beside it
and `src/data/types.test.ts` keeps the two in step. Codes are English (D8).

| Set | Values | Source |
|---|---|---|
| Record (master data) | Active · Inactive | ERD `status` of org unit, position, account, scale, connection |
| Tenant | Active · Suspended | ERD |
| Org unit type | Company · Division · Department · Team | ERD "Company/Khoi/PhongBan/Nhom" |
| Job level | Director · DeptHead · TeamLead · Specialist · Staff · Collaborator | ERD "GĐ/TP/TN/CV/NV/CTV" |
| Employment | Probation · Official · Resigned | ERD "Thử việc/Chính thức/Nghỉ việc" |
| Auth provider | Local · SSO | ERD |
| Role | EMPLOYEE · MANAGER · HR · CNB · BOD · ADMIN | ERD `ROLE.code` |
| Scope | Self · DirectReports · OrgUnit · Tenant | ERD `USER_ROLE.scope_type` |
| BSC perspective | FIN · CUS · PRO · LNG | ERD |
| Calc method | RATIO_UP · RATIO_DOWN · TIERED · BINARY · FORMULA · LEVELS | ERD + D1 |
| KPI frequency | Week · Month · Quarter · Year | ERD "Tuần/Tháng/Quý/Năm" |
| Aggregation | SUM · AVG · LAST | ERD |
| Library (KPI, template) | Draft · Active · Archived | ERD |
| KPI category tag | EFFICIENCY · VOLUME · COST — secondary tag only | DATX, `ASSUMPTION Q5` |
| Cycle | Planning · Active · Evaluating · Closed | ERD |
| Period type | Month · Quarter · Half · Year | ERD |
| Plan type | KPI (P2 adds Probation) | ERD |
| Owner type | Company · OrgUnit · Employee | ERD |
| Goal Plan | Draft · Submitted · **Returned** · Approved · Locked | ERD + Returned (plan §6.4, BR-KPI-12) |
| Goal | Active · Changed · Cancelled | ERD |
| Goal visibility | PUBLIC · PRIVATE | D2 |
| KRI type | KRItc · KRIpt — stored, hidden | D4, `ASSUMPTION Q6` |
| Target type | NUMERIC · TEXT | HR guide p. 23 (D7) |
| Target level | L1 · L2 · L3 | D1 |
| Alignment | CASCADE · LINK | ERD |
| Source (data source, actual) | MANUAL · EXCEL · API | ERD |
| Connection auth | APIKey · OAuth2 · Basic | ERD |
| Sync run | Running · Succeeded · PartiallyFailed · Failed | D7 |
| Import type | Actual · GoalPlan · OrgData · Library | ERD |
| Import batch | Validating · Committed · Rejected | ERD |
| Form type | GOAL_SETTING · GOAL_CHANGE · KPI_EVAL (P2 adds PROBATION_EVAL, CONTRACT_EVAL, REVIEW_360) | ERD |
| Actor rule | SELF · DIRECT_MANAGER · MANAGER_L2 · HR · CNB · ROLE | ERD |
| Step action | SUBMIT · APPROVE · EDIT · RETURN · CANCEL · AUTO_FORWARD · AUTO_LOCK — EDIT is never recorded (BR-KPI-23) | ERD + CANCEL, AUTO_LOCK (D7) |
| Overdue behaviour | AUTO_FORWARD · REMIND · LOCK | ERD + LOCK (BR-KPI-13) |
| Evaluation column | SELF · MANAGER · FINAL | D6 |
| Form | Open · InProgress · Completed · Cancelled — "overdue" is derived, not a status | ERD |
| Goal change | ADD · MODIFY · CANCEL | BR-KPI-15 (D7) |
| Launch timing | NOW · SCHEDULED · RECURRING | D5 |
| Launch | Scheduled · Launched · Cancelled | D5 |
| Recipient mode | ALL · FILTER | D5 |
| Launch trigger | PERIOD_END (P2 adds HIRE_DATE, CONTRACT_END) | D5 |
| Payout scope | All · OrgUnit · Position | ERD "Tất cả/Khối/Chức danh" |
| Period result | Draft · Final · Locked | ERD |
| Notification event | FORM_LAUNCHED · STEP_ASSIGNED · DEADLINE_REMIND · RETURNED (Phase 3 adds KPI_ALERT) | ERD + STEP_ASSIGNED |
| Notification channel | InApp · Email (P1 sends in-app only) | ERD |
| Notification | Queued · Sent · Read · Failed | ERD |
| Audit action | CREATE · UPDATE · DELETE · LOCK · UNLOCK | ERD |

## 6. Error catalogue

Copy lives in `src/lib/errorCatalog.ts`; never retype it on a screen.

| Code | Trigger | Surface | Title |
|---|---|---|---|
| ERR-KPI-01 | A read through the DataGateway failed | empty-state with retry | Không tải được dữ liệu |
| ERR-KPI-02 | An id does not exist in the caller's tenant (another tenant's id answers the same) | empty-state | Không tìm thấy dữ liệu |
| ERR-KPI-03 | A write failed for a reason the user cannot fix | toast with retry | Không lưu được thay đổi |
| ERR-KPI-04 | The write is not allowed in the record's current state (locked plan, locked period, Final / Locked result, step moved on) | toast with reload | Thao tác không còn hợp lệ |
| ERR-KPI-05 | The actor is not entitled (not the step's actor, no valid delegation, no permission) | toast | Bạn không có quyền thực hiện thao tác này |
| ERR-KPI-06 | Invalid input (missing field, unresolved or cross-tenant reference, duplicate) | inline | Dữ liệu chưa hợp lệ |

| ERR-KPI-07 | Active weights ≠ 100% ± 0.01 | inline | Tổng trọng số chưa đạt 100% |
| ERR-KPI-08 | Goal count outside 5–8 | inline | Số chỉ tiêu phải từ 5 đến 8 |
| ERR-KPI-09 | An item lacks the step's score or required comment; an unscored goal at finalisation | inline | Còn chỉ tiêu chưa chấm điểm hoặc chưa nhận xét |
| ERR-KPI-10 | An alignment would create a cycle | inline | Liên kết này tạo vòng lặp giữa các chỉ tiêu |
| ERR-KPI-11 | Allocations + self-assigned exceed the parent target | inline | Phân giao vượt mục tiêu của chỉ tiêu cha |
| ERR-KPI-12 | Achievement not computable from the data | inline | Chưa tính được % hoàn thành |
| ERR-KPI-13 | Invalid scoring configuration (method, tiers, levels, rating scale, payout rule) | inline | Cấu hình tính điểm chưa hợp lệ |

Only ERR-KPI-01 and 03 are retried automatically (`isRetryable`). A failed write shows as a toast
whatever the entry's surface. Rules return `RuleIssue { code, ref, detail, data }` lists (`ref` = the row
to mark, `data` = the numbers shown beside the copy); an adapter throws them with `toKpiError(issues)`
— the first issue's code, every issue on `KpiError.issues`.

## 7. Tenancy and data

- **BR-KPI-50** — **Tenant isolation.** Every read and write is scoped to one tenant; a user of tenant B
  never sees, by any path, data of tenant A, and no write can store a reference to another tenant's row
  (ERR-KPI-06). *Source: plan §3.2; Phase 1.1 review.*
- **BR-KPI-51** — The prototype holds **no real personnel data**. The "Dữ liệu giả lập" banner is shown
  on every screen. *Source: plan §10.*
- **BR-KPI-52** — An actual records its **source** (manual, Excel batch, API sync) and when it was
  recorded; actuals are snapshots, and only the current one per goal and period counts. Recording an
  actual is refused (`actualRules.actualIssues`, the same rule checks every import row): the period is
  locked → ERR-KPI-04 `PERIOD_LOCKED`; the plan's result for the period is already Final / Locked → 04
  `RESULT_FINAL`; the goal is not Active → 06 `GOAL_NOT_ACTIVE`; the period belongs to another cycle →
  06 `PERIOD_NOT_IN_CYCLE`; nothing entered → 06 `ACTUAL_REQUIRED`; a NUMERIC goal needs a finite number
  and no text, a TEXT goal non-blank text and no number → 06 `ACTUAL_TYPE_MISMATCH`; the period has not
  started (its start date after today in the tenant zone) → 06 `PERIOD_NOT_STARTED` (`ASSUMPTION Q18`).
  A negative number is accepted. Only a batch still **Validating** can be rejected — a Committed batch
  has written its actuals (`actualRules.canRejectImport`, ERR-KPI-04). *Source: ERD `GOAL_ACTUAL`.*

## 8. Open assumptions (plan §9)

| # | Question | Default in use | Rules affected |
|---|---|---|---|
| Q1 | Does LEVELS interpolate between L1–L2–L3? | Yes, linear, capped at the top level | BR-KPI-33 |
| Q2 | The rating scale and payout table? | Sample A+/A/B/C/D, marked as an assumption | BR-KPI-41, 42 |
| Q3 | Main evaluation monthly or quarterly? | Monthly | BR-KPI-22, seed |
| Q4 | Is "Tỉ lệ KH cũ" higher-is-better? | Yes | BR-KPI-34 |
| Q5 | BSC or "Hiệu quả / Khối lượng / Chi phí"? | BSC primary, the other a secondary tag | BR-KPI-06 |
| Q6 | What are KRItc / KRIpt? | Field hidden | BR-KPI-06 |
| Q7 | "Lấy ý kiến", "Thêm người duyệt", collaboration step in P1? | No (P2) | BR-KPI-22 |
| Q8 | Parent KPI actual independent or summed? | Independent; summed only when flagged | BR-KPI-36 |
| Q9 | Does a KGI have a numeric target? | Optional field, not scored | BR-KPI-02 |
| Q10 | CMC's monthly work plan in P1? | No | BR-KPI-22 |
| Q11 | Does P1 track "tự thực hiện" (what a manager personally achieved on a cascaded goal)? | No — shown as "—" | BR-KPI-07 |
| Q12 | The permission catalogue, the default role → permission matrix and the default scopes? The sources are silent | §9 as written: union of roles, MANAGER = OrgUnit + children, company plan readable by all, BOD read-only, ADMIN holds everything | BR-KPI-60…64 |
| Q13 | Is the KPI payout prorated for someone who joins or leaves mid-period? | No — full payout % for any period worked | BR-KPI-24, 42 |
| Q14 | The DATX library sheet has weights that do not sum to 100%, blank or contradictory calculation methods, mixed rows and garbled targets — how is it read? | Cleaned as listed in `src/data/fixtures/README.md` ("DATX cleaning"): weights normalised, methods filled / corrected by meaning, mixed rows split, BSC perspective mapped by subject. HR to confirm "Tồn kho" / "Xả tồn" direction and the Kế toán opex definition | Seed, BR-KPI-06, 30, 34 |
| Q15 | KPI frequency and aggregation (absent from DATX)? | Monthly; SUM for money, counts and volumes, AVG for ratios, LAST for headcount and stock | Seed, BR-KPI-11, 36 |
| Q16 | Which system feeds each KPI? | Sorama, My Result, CMS, MHTC as the workbook names them; ERP Sale, ERP Kho vận, CRM CSKH, HRIS and "Nhập tay" are invented samples | Seed, BR-KPI-05 |
| Q17 | Does an employee get a period result without a completed evaluation form (e.g. from the actuals, or the manager's column)? | No — an Employee plan is scored only from a COMPLETED KPI_EVAL form's FINAL column; no completed form, no result | BR-KPI-44, seed |
| Q18 | May an actual be recorded for a period that has not started yet? | No — refused (ERR-KPI-06 `PERIOD_NOT_STARTED`) | BR-KPI-52 |
| Q19 | What does a LINK's `contributionPct` mean (a share of the parent's target, or of the child's result)? | Informational only — shown, never computed | BR-KPI-07 |
| Q20 | In a cycle that does not start in January, is Q1 January–March or the cycle's first three months? | The cycle's first three months | BR-KPI-27 |

## 9. Roles, permissions and data scope (Phase 1.3)

Implemented in `src/lib/permissionRules.ts` (catalogue, default matrix, `can`, the menu filter and the route
guard); the session exposes it as `useSession().can(code, resource?)`. **None of the sources describes roles,
permissions or scopes** (`docs/source-map.md` has no entry): everything in this section is a Syntra decision
or `ASSUMPTION Q12`, except the six roles and four scopes themselves (ERD `ROLE`, `USER_ROLE`).

- **BR-KPI-60** — A person's access is the **union** of their role assignments (USER_ROLE rows): every role
  contributes its permissions over its own scope. There is no "active role" to pick. *Source: product owner,
  2026-10-19.*
- **BR-KPI-61** — **A permission is never a workflow decision.** `can` answers "may this person use this
  capability on this data at all"; whether they may SUBMIT / APPROVE / RETURN a form is decided only by the
  step's actor rule or a valid delegation (BR-KPI-20, 21). There is no `goal.approve` permission (the ERD's
  example code is not adopted). Either refusal is ERR-KPI-05. *Source: Phase 1.3 analysis.*
  **The gateway enforces `can()` on every write** (Gate 1; a form action checks only the Active account
  and leaves the rest to `workflowRules`) — `architecture.md`, "Authorization".
- **BR-KPI-62** — **Every account with an employee record also holds EMPLOYEE / Self**, so "Của tôi" works for
  a manager, HR or BOD. A system account (no employee) does not, and its "Của tôi" screens are empty, not
  failed. *Source: plan §7.1 ("Của tôi" — every role).*
- **BR-KPI-63** — **The company plan is readable by the whole tenant** (`goalplan.view` on the Company owner
  needs no scope): every cascade starts from it. Editing it needs a Tenant scope or an OrgUnit scope on the
  root unit. *ASSUMPTION Q12.*
- **BR-KPI-64** — **Scopes resolve on "today" in the tenant's zone** (the gateway clock), over every
  assignment effective that day (both ends inclusive; a concurrent assignment counts too):
  Self = the account's own employee · DirectReports = people whose effective assignment names me as manager,
  one level, never me · OrgUnit = the unit, its subtree when `includeChildren` (Inactive units included), the
  people assigned there, and the Company owner when the subtree holds the tenant's single root · Tenant =
  everything. Someone whose last day (`leftOn`) has passed — or who is Resigned with none recorded — is out of
  every scope. A scope that cannot resolve (no unit, an unknown one) covers nothing. *ASSUMPTION Q12.*
- **Fail closed.** An unknown code, a row pointing at an unknown role or permission, a row of another tenant,
  an Inactive account and an owner that cannot be resolved all deny (BR-KPI-50).
- **The menu and the route guard follow the same permission.** Each menu item names one; a group is shown
  when any of its items is; a route nobody may open shows ERR-KPI-05 inside the shell. A detail page still
  checks its own record with `can(code, resource)`. Under the default matrix the menu reproduces plan §7.1,
  except ADMIN, who sees every group.

**The catalogue (28 codes).** S = checked against the data's owner through the scope; T = tenant-wide
capability. Default holders (✓):

| Code | S/T | EMP | MGR | HR | CNB | BOD | ADMIN |
|---|---|---|---|---|---|---|---|
| org.view · library.view · goalplan.view · actual.view · result.view · delegation.manage | T/S | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| org.manage · user.manage · datasource.manage · notification.manage · audit.view | T | | | | | | ✓ |
| library.manage · cycle.manage · actual.import · form.launch · result.finalize · rating.config | T | | | ✓ | ✓ | | ✓ |
| team.view | T | | ✓ | | | | ✓ |
| goalplan.edit · evidence.upload | S | ✓ | ✓ | ✓ | | | ✓ |
| goalplan.lock · goalplan.import | T | | | ✓ | | | ✓ |
| form.proxy · form.cancel — only over subjects in scope | S | | | ✓ | | | ✓ |
| actual.enter | S | | ✓ | ✓ | ✓ | | ✓ |
| form.start | S | | ✓ | ✓ | | | ✓ |
| result.export | T | | | | ✓ | | ✓ |
| dashboard.view | S | | ✓ | ✓ | | ✓ | ✓ |

The view codes and `delegation.manage` are scope-sensitive (S); `org.view` and `library.view` are tenant-wide.
**Default scopes:** EMPLOYEE Self · MANAGER OrgUnit (the unit they head) + children · HR, CNB, BOD, ADMIN
Tenant. **ADMIN holds every code** (product owner, 2026-10-19 — a deviation from plan §7.1, where ADMIN saw only
"Hệ thống"). Permission ids are `perm.<code>`, the same in every tenant. Adding a code after Gate 1 is a Large
change.
