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
> **Track T2 (2026-10-19)** added §3b — the KPI library's write rules (BR-KPI-74…76), enforced by
> `src/lib/libraryRules.ts` in every `library.save*` of the mock.
> **Track T7 (2026-10-19)** added §4b — notifications, files and the audit log — in
> `src/lib/notificationRules.ts`, `src/lib/fileRules.ts` and `src/lib/auditRules.ts`.

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
| **Chỉ tiêu mẫu (KPI definition)** | A reusable item in the KPI library, which a goal may be created from. "Chuẩn" = a standard item from the seed (`isSystem`) |
| **Bộ mẫu (KPI template)** | A set of library items with default weights, for one org unit, one position, or everyone (Chung) |
| **Danh mục (catalogues)** | The library's reference lists: the four BSC perspectives (Viễn cảnh) and the measure units (Đơn vị đo) |
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
| **Phạm vi dữ liệu (scope)** | Whose data a role's permissions reach: Bản thân (Self) · Cấp dưới trực tiếp · Theo đơn vị (+ đơn vị trực thuộc) · Toàn công ty |
| **Đơn vị** | Any node of the org tree, whatever its type; "Phòng ban" is only the Department type. Not "Đơn vị tính" (unit of measure, T2) |
| **Chức danh / Cấp bậc** | Job position (`JobPosition`) / its level (`JobLevel`: Giám đốc … Cộng tác viên). "Giám đốc" is a level, not the BOD role ("Ban điều hành") |
| **Phân công chính / Kiêm nhiệm** | An employee's primary assignment (unit + position + direct manager, exactly one on any date) / a concurrent one (`isPrimary = false`) |
| **Quản lý trực tiếp** | The `managerEmployeeId` of a primary assignment — the line the workflow follows. Not the MANAGER role ("Quản lý") |
| **Điều chuyển** | A transfer: a new primary assignment from a date, which ends the running one the day before (BR-KPI-65) |
| **Thông báo** | An in-app notice to one person (the bell in the top bar); "Đánh dấu đã đọc" marks it read (§4b) |
| **Mẫu thông báo** | The tenant's text for one event × channel, with **biến** (`{{variable}}`) filled when it is sent |
| **Lịch nhắc hạn** | Per workflow step: "Nhắc trước … ngày" its deadline, and what happens when it runs over (BR-KPI-13) |
| **Nhật ký** | The audit log — who changed what, when, for whom ("A thay cho B") and why |

---

## 1. Structure — tiers, Goal Plans, goals

- **BR-KPI-01** — Goals exist on **three tiers**: Company → Department (org unit) → Individual. Each
  Goal Plan has exactly one owner of one tier. *Source: NoteX minutes; ERD `GOAL_PLAN.owner_type`.*
- **BR-KPI-02** — A Goal Plan holds **3–5 KGI**. A KGI may carry a numeric target but is **not scored**
  (`ASSUMPTION Q9`). *Source: DATX department sheets; DATX slides pp. 21–22.*
- **BR-KPI-03** — A Goal Plan holds **5–8 KPIs**. It applies to PLANS, not to library templates (BR-KPI-77). *Source: plan §6.2 (1.5 `goalPlanRules`), NoteX minutes.*
- **BR-KPI-04** — A Goal Plan can be submitted only when its goals' weights sum to **100%**, compared with
  a tolerance of ±0.01 (a sum of 99.99% or 100.01% from rounding counts as 100%). *Source: HR guide
  p. 22; Manager guide p. 26; email template ("if the total weight is less than 100%").*
- **BR-KPI-05** — **Every KPI has a data source** ("KPI phải đo được"). A goal without one cannot be
  saved. *Source: NoteX minutes §2.3; ERD `GOAL.data_source_id` (required).*
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
*Source: HR guide p. 24; email template steps 1–2.*
- **BR-KPI-08** — A goal is **public or private** (visibility, D2). *Source: HR guide pp. 21–22.*
- **BR-KPI-09** — A goal may carry **target levels L1/L2/L3** (`GoalTargetLevel`), set per assigned goal
  (not per method). Each level has a numeric or text target (per the goal's `targetType`) and the score
  earned for reaching it, e.g. L1 → 0%, L2 → 100% ("Nguyên tắc đánh giá") (D1). *Source: HR guide
  pp. 23, 28; import columns P–T p. 63.*
- **BR-KPI-10** — A goal's target is either **numeric** or **text** (Đạt / Không đạt). *Source: HR guide p. 23.*
- **BR-KPI-11** — A goal's target may be **allocated by period** (monthly/quarterly targets). *Source: DATX
  column "Phân bổ mục tiêu theo tháng"; ERD `GOAL_PERIOD_TARGET`.*

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
  per (reminderKey, recipient) — BR-KPI-46. AUTO_LOCK audits the plan's lock as `LOCK` with reason `AUTO_LOCK` and
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
  pp. 150–155.* Being a step's actor is never a permission (BR-KPI-61). The line read is the **primary**
  assignment's manager (`orgRules.managerOf`); a concurrent (kiêm nhiệm) manager is NOT a step actor,
  although the DirectReports scope (BR-KPI-64) counts every assignment — so such a manager can see the
  person but has no step to act on (noted at T1, unchanged; a Workflow-lane decision). A transfer (T1)
  therefore moves the manager steps of open forms to the new manager.
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

## 3b. KPI library (track T2, WBS 4.2.1–4.2.4)

Every rule below is a pure function in `src/lib/libraryRules.ts` that the mock's `library.save*` calls
inside the write's transaction (a refusal rolls the whole save back) and the screens call to explain a
refusal before it happens. The checks that read OTHER tables — codes of the catalogue, rows using a unit
or method, Active templates holding a KPI — become an RPC or a trigger in Phase 5. Updates re-check only
what they change: the seed predates these rules, and saving a seed row unchanged always succeeds.

- **BR-KPI-74** — **Codes** of KPI definitions, measure units and calculation methods are stored trimmed
  and upper-cased, are required, and are **unique per tenant ignoring case** (ERR-KPI-06 `CODE_TAKEN`).
  A name is required. A definition needs a perspective, unit, method, frequency and aggregation from the
  fixed sets. *Source: Syntra decision (T2); ERD unique codes.* `codeIssues`, `kpiDefinitionIssues`.
- **BR-KPI-75** — The **four BSC perspectives are fixed**: they can be renamed and reordered, never
  created and never re-coded (ERR-KPI-06 `PERSPECTIVE_FIXED` / `CODE_LOCKED`). Every definition has one
  (BR-KPI-06). *Source: HR guide p. 22; plan Q5.* `perspectiveIssues`.
- **BR-KPI-76** — A definition may lack a **default data source** while Draft, but needs one to be
  **Active** (ERR-KPI-06 `DATA_SOURCE_REQUIRED`) — "KPI phải đo được" applied to the library
  (`ASSUMPTION Q25`). A goal still needs its own source (BR-KPI-05). *Source: NoteX §2.3; ERD (nullable).*
- **BR-KPI-77** — A **template** is for one org unit, one position, or everyone (both set → ERR-KPI-06).
  Items: no duplicate KPI, weight ≥ 0, a default target that is a number or blank (ERR-KPI-06). The
  **weight total of 100% (±0.01) and the 5–8 item count are WARNINGS, never refusals** (`ASSUMPTION
  Q26`): the template saves, and the Goal Plan made from it is what BR-KPI-03/04 gate. *Source: ERD
  `KPI_TEMPLATE`; DATX's 4-item sets (fixtures README, Q14).* `templateIssues` → `{ errors, warnings }`.
- **BR-KPI-78** — **Library status** Draft ⇄ Active ⇄ Archived; any move is allowed and "Lưu trữ" never
  deletes. Only Active items can be newly picked (KpiPicker). A KPI cannot **leave Active** while an
  **Active template** holds it (ERR-KPI-04 `IN_ACTIVE_TEMPLATE`, listing the templates). Archiving a KPI
  that goals or API mappings use is allowed — a goal holds its own perspective, unit, method and
  formula ids and never reads the definition when it scores. A Draft or Archived KPI cannot be **added**
  to a template (ERR-KPI-06 `KPI_NOT_ACTIVE`); one already there stays, with a warning (`ASSUMPTION
  Q27`). *Source: Syntra decision (T2).* `kpiDefinitionIssues`, `activeTemplatesContaining`.
- **BR-KPI-79** — A **standard item** ("Chuẩn", `isSystem`, seed only) can be edited like any item
  except its **code** (ERR-KPI-06 `SYSTEM_CODE_LOCKED`). Every seeded KPI is standard, so a stricter rule
  would freeze the whole library (`ASSUMPTION Q28`). A tenant-created item is never standard.
- **BR-KPI-80** — **Catalogue rows in use.** A measure unit referenced anywhere (a definition, goal, KGI
  or pending change proposal) keeps its **code** (ERR-KPI-04 `UNIT_CODE_IN_USE`); its name and decimals
  (display only, 0–6) can change. A **calculation method used by any goal** — any status, any cycle,
  closed ones included — or a pending proposal keeps its **scoring fields**: type, cap, floor, formula
  and tiers (compared order-insensitively) are locked (ERR-KPI-04 `METHOD_IN_USE`, with the goal count);
  name, description and code stay editable. A goal reads its method live (`Goal.calcMethodId`), so an
  edit would silently re-score every open period. To change how goals score, create a new method.
  Shape rules on any method (ERR-KPI-13): tiers only on TIERED, a formula only on FORMULA, no cap or
  floor on LEVELS (its ceiling is the top level, BR-KPI-33); BR-KPI-31 (`validateCalcMethod`) still
  applies, and is reported before the lock. *Source: product owner decision 2026-10-19;
  hr-performance-expert review.* `calcMethodIssues`, `methodScoringChanged`, `measureUnitIssues`.
- **Export (WBS 4.2.5)** — "Xuất Excel" writes the library (items by code; references as codes; sets as
  their Vietnamese labels), the templates (one row per item) and the code lists, in the column order the
  Library import will read. **Library import is deferred** to T4's shared import framework (WBS 4.4.3);
  it needs `LibraryImportRow` to gain the tag, data-source and status columns — a contract change.
  `libraryExportRows`, `templateExportRows`.

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

## 4b. Notifications, files and the audit log (Track T7)

- **BR-KPI-45** — **Who is notified, of what** (in-app only in P1; `notificationListener.ts`, rules in
  `notificationRules.ts`):
  - a launch → **FORM_LAUNCHED** to each form's subject (employed on the launch day, Active account);
    and **STEP_ASSIGNED** to the step-1 assignees other than the subject (registration step 1 is the
    direct manager) — none when the form is frozen at once (its registration plan already locked);
  - a form started by hand, or a form that **re-enters its step** because HR unlocked its plan with a
    new due date (BR-KPI-14) → **STEP_ASSIGNED** to the step's assignees;
  - SUBMIT / APPROVE / AUTO_FORWARD to a next step → **STEP_ASSIGNED** to the new assignees
    ("Hệ thống" names the actor of an auto-forward);
  - RETURN → **RETURNED** to whoever it went back to, naming who returned it (and for whom) and the
    comment of that return;
  - a step nearing its deadline → **DEADLINE_REMIND** (BR-KPI-46), whose `{{consequence}}` warns what
    the scheduler WILL do (`workflowRules.effectiveOverdueBehaviour`: lock the plan, hand the form on, or
    nothing when the configured behaviour cannot apply).
  Assignees are the step's actors plus their valid delegates (`assigneesOf`): **a delegator and their
  delegate are both told** — except the form's subject on a review step of their own form, who is never
  told to act there (BR-KPI-21) even when they are also the reviewer's delegate (`assigneesOf` lists such
  a delegate; the inbox has the same gap — flagged to the workflow lane). **Nobody is told about their own action** — neither the person who acted
  nor the person they acted for (proxy / delegation). **No notice** for a completed or cancelled form,
  an AUTO_LOCK, or a step going overdue (`ASSUMPTION Q29`). An event with no in-app Vietnamese template
  **notifies nobody** — the template screen flags the missing one. The rendered subject and body are
  stored (re-rendering from an edited template would rewrite what was said). Delivery is best effort
  in the prototype: a failed notice is reported to the diagnostics, never undoes the action that caused
  it. *Source: email template "Email khởi chạy" / "Email nhắc Deadline" (both sent to each step owner);
  STEP_ASSIGNED and RETURNED are Syntra's (D7); Phase 2 T7 review (workflow-expert).*
- **BR-KPI-46** — **One reminder per person per step entry.** The notice's idempotency key is the
  scheduler's `reminderKey` (form, step, entry time): ticks inside the window write it once per
  recipient; re-entering the step (a return, an unlock) is a new key, so a new reminder; a delegate who
  becomes valid mid-window gets their own. The lead time is the step's `remindDaysBefore` — not a fixed
  day. *Source: BR-KPI-13; product owner, Gate 1.*
- **BR-KPI-47** — **Template variables.** Each event supplies a fixed list (`VARIABLES_BY_EVENT`):
  every event `recipientName`, `subjectName`, `formType`, `period`, `stepName`; FORM_LAUNCHED and
  STEP_ASSIGNED add `stepNo`, `stepCount`, `dueDate` (+ `launchName` / `actorName`); DEADLINE_REMIND
  adds `dueDate` (the STEP deadline) and `consequence`; RETURNED adds `actorName`, `reason`. Saving a
  template that names any other variable, leaves a brace open, or has an empty subject / body (subject
  ≤ 200, body ≤ 2000 characters) is refused (`templateIssues`, ERR-KPI-06). Rendering never shows a
  raw `{{…}}`: a variable with no value is left empty and the spaces tidied. `{{period}}` reads
  "tháng 03/2027", "quý 1/2027", "năm 2027", or the cycle name for a form with no period; dates are
  dd/MM/yyyy. *Source: seeded templates (`catalog.ts`); Phase 2 T7 design.*
- **BR-KPI-48** — **Attachments**: at most **10 MB**, formats PDF, images (PNG, JPG, GIF, WebP), Word,
  Excel, CSV and text, decided by the file's extension (a MIME type the browser reports must agree);
  an empty file is refused (`fileRules.fileIssues`, ERR-KPI-06; checked by the upload button and again
  by `system.uploadFile`). `ASSUMPTION Q30`. In the mock a file's content lives in memory: after a page
  reload the row remains but opening it answers ERR-KPI-02. *Source: none — product owner default.*
- **BR-KPI-49** — **The audit log is append-only** and written by the gateway in the SAME transaction as
  the change it records (never by a screen): who (and for whom), the entity, the action, the row
  before / after and the reason. Notifications are not audited. The screen shows only the changed
  fields, statuses in words, and filters by entity, person and days in the tenant's zone (a backwards
  range is refused before any query). It is read with `audit.view` — **ADMIN only** under the default
  matrix; whether HR should read it too is open (product owner to confirm; changing the matrix is a
  Large change). *Source: ERD `AUDIT_LOG`; BR-KPI-14, 21.*

## 5. State sets (declared in `src/data/types.ts`, Phase 1.1)

Every status in the app comes from one of these sets; each has a Vietnamese `*_LABEL` map beside it
and `src/data/types.test.ts` keeps the two in step. Codes are English (D8).

| Set | Values | Source |
|---|---|---|
| Record (master data) | Active · Inactive | ERD `status` of org unit, position, account, scale, connection |
| Tenant | Active · Suspended | ERD — Suspended: BR-KPI-73 |
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
| Library (KPI, template) | Draft · Active · Archived — any move allowed; leaving Active is refused while an Active template holds the KPI (BR-KPI-78) | ERD |
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
| Entity name | the 49 P1 entities, each labelled for the audit log (`ENTITY_NAME_LABEL`) | ERD + D1/D5/D7 |

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
| ERR-KPI-14 | Ending / deactivating a unit or a position still in use (T1, BR-KPI-69, 70) | inline | Đang được sử dụng, chưa thể ngừng |
| ERR-KPI-15 | A change that would leave no administrator, take `org.manage`/`user.manage` from ADMIN, lock the actor out, or suspend their own company (T1, BR-KPI-72, 73) | inline | Thao tác này sẽ làm mất quyền quản trị |
| ERR-KPI-16 | An invalid direct manager: oneself, not employed over the assignment, or a reporting loop (T1, BR-KPI-66) | inline | Quan hệ báo cáo chưa hợp lệ |

T1's rules raise these (and ERR-KPI-06) with a `detail` sub-code; `src/lib/orgIssueCopy.ts` holds the
sentence shown for each one. Codes from other tracks start at ERR-KPI-17.

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
| Q19 | The org guards (assignments, managers, unit heads, ending units and positions, accounts) — no source describes them | §10 as written, a Syntra decision | BR-KPI-65…71 |
| Q20 | Does a transfer re-route open forms? | Yes — the manager is resolved at the time of the action (BR-KPI-20) | BR-KPI-20, 65 |
| Q21 | May a direct manager sit outside the employee's unit line? | Yes, with a warning on screen | BR-KPI-66 |
| Q22 | May a unit with open Goal Plans be ended? | No — refused until the cycle is Closed | BR-KPI-69 |
| Q23 | May someone with direct reports, or a unit head, resign? | Yes, with a warning; nothing is reassigned by itself | BR-KPI-67, 68 |
| Q24 | Tenant management in P1? | Edit the current company only (name, code, time zone); no creating, no suspending (a company cannot suspend itself, and nothing could reactivate it) | BR-KPI-73 |
| Q25 | Must a library item name its data source? | Only to be Active; a Draft may leave it blank | BR-KPI-76 |
| Q26 | Must a template's weights total 100% and hold 5–8 items? | No — both are warnings; the plan made from it is gated | BR-KPI-77 |
| Q27 | What does archiving a library item do? | Hides it from new picks only; refused while an Active template holds it; goals keep working | BR-KPI-78 |
| Q28 | May a tenant edit a standard (seeded) library item? | Yes, except its code | BR-KPI-79 |
| Q29 | Is a person notified when their step goes overdue (and the form is auto-forwarded or the plan locked)? The event set has no overdue code | No — the deadline reminder already says what will happen; an auto-forward tells the next person (STEP_ASSIGNED). A `STEP_OVERDUE` event is a P2 candidate | BR-KPI-45 |
| Q30 | Size and format limits of attachments? No source states them | 10 MB; PDF, images, Word, Excel, CSV, text | BR-KPI-48 |

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

## 10. Organisation and people (Track T1)

Implemented in `src/lib/orgAdminRules.ts` and `src/lib/accessAdminRules.ts` (pure; the screens pre-check
with them and `mock/groups/orgTx.ts` enforces them). **No source describes these rules** — every one is
a Syntra decision (`ASSUMPTION Q19`–`Q24`). Each check is **transition-based**: it fires only on the
change it is about, so a seeded row that predates a rule stays editable (`fixtures/orgGuards.test.ts`
lists the one exception: E040, whose manager was hired after them).

- **BR-KPI-65 — Assignments.** An assignment lies inside the employment (`hireDate`…`leftOn`), in an
  Active unit that has not closed by its end, with an Active position; dates in order. An employee has
  at most one primary assignment on any date (schema). **A transfer** — a new primary row from D, or a
  row made primary — ends the running primary on D − 1 in the same write (B1); refused (06
  `PRIMARY_OVERLAP`) when D is not after the running row's start, or another primary already follows.
  A concurrent assignment ends nothing. A transfer with an end date is refused while the running row
  extends past it (06 `TRANSFER_BOUNDED` — it would drop the tail). A past row is never rewritten: it is
  ended and a new one added. The reporting-loop check (BR-KPI-66) looks at the start date only; a loop
  that a LATER change elsewhere would create is not caught (accepted limit).
- **BR-KPI-66 — Direct manager.** Not the person themself; employed on every day of the assignment;
  no loop in the primary reporting line (`orgRules.wouldCreateReportingCycle`) — ERR-KPI-16. A manager
  outside the employee's unit line is allowed, with a warning (Q21). No manager = the top of the line.
- **BR-KPI-67 — Unit head.** Employed today and assigned to the unit or a unit below it (06
  `HEAD_NOT_IN_UNIT`), checked when the head changes. The head is not derived from the reporting line.
- **BR-KPI-68 — Resignation.** "Nghỉ việc" ⇔ a last working day (`leftOn` ≥ hire date). Recording the
  last day ends the assignments that run past it, in the same write (B3); it is refused while an
  assignment starts after it (06 `ASSIGNMENT_AFTER_LEFT_ON`). The login goes Inactive at once, even for
  a last day in the future (the dialog says so). The screen first sets the
  person's Active accounts Inactive, THEN records the resignation, so a failure never leaves someone who
  has left with a live login. Nothing else changes by itself: direct reports, units headed and
  delegations are listed as a warning (`resignationImpact`); open forms carry on (BR-KPI-24).
- **BR-KPI-69 — Ending a unit** (Inactive or an end date). Refused (ERR-KPI-14) while it has an Active
  sub-unit, an assignment running past the end, or a Goal Plan in a cycle that is not Closed. The root
  unit never ends. A child's type ranks strictly below its parent's (Company > Division > Department >
  Team; a level may be skipped). A unit cannot move under an Inactive parent.
- **BR-KPI-70 — Positions.** A position cannot be stopped while an assignment in force today or later
  uses it (ERR-KPI-14).
- **BR-KPI-71 — Employees and accounts.** Employee code and email unique, case-insensitively. Login
  unique case-insensitively (letters, digits, `.`, `_`, `-`). At most one **Active** account per employee
  (an old Inactive one may stay); no Active account for someone who has left. The employee behind an
  account never changes. A new account of an employee gets **EMPLOYEE / Self** in the same write (B2,
  BR-KPI-62), and that row cannot be removed or changed; a system account (no employee) never holds
  EMPLOYEE.
- **BR-KPI-72 — Keeping the company administrable.** Refused (ERR-KPI-15) when a change — a role row
  removed or narrowed, an account deactivated, a role's permissions edited — would leave no Active
  account holding ADMIN with a company-wide scope, take `org.manage` or `user.manage` from ADMIN, or take
  `user.manage` from the person making it. Only a LOSS is refused. A role other than EMPLOYEE never has
  the Self scope; an OrgUnit scope names a unit. `setRolePermissions` writes only the difference.
- **BR-KPI-73 — The company record.** Only the current company is edited (name, code, valid IANA time
  zone). **Suspended** means nobody signs in to it (the session switcher lists Active companies only);
  a company cannot suspend itself (ERR-KPI-15), and P1 has no switch for it (Q24).
- **Import (WBS 4.1.7).** The template and the row validation are T1's (`orgImportRules`,
  `src/lib/excel/`); staging and committing an OrgData batch are T4's shared framework (4.4.3), which
  applies a clean batch through `orgTx` in the order employees → assignments → accounts, as of the
  gateway clock: a known `employeeCode` (case-insensitive) updates name and email — refused on the row
  for someone who has left (`EMPLOYEE_LEFT_IMPORT`); a new person's first assignment starts on the later
  of their hire date and today; a changed unit /
  position / manager is a transfer from that day; a `login` with no Active account creates one.

