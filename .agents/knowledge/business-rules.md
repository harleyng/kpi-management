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
  **frozen** while HR has its registration plan locked by hand. *Source: email template "Email nhắc
  Deadline"; SF4C PMGM.09.*
- **BR-KPI-14** — HR can **lock and unlock** a Goal Plan; every lock/unlock is kept in its history. A
  locked plan cannot be edited except through the adjustment process. *Source: HR guide pp. 47–49;
  SF4C PMGM.03, PMGM.06.*
- **BR-KPI-15** — **Adjustment** (GOAL_CHANGE) changes an approved, locked Goal Plan through its own
  approval chain. It is started by hand (`forms.startForm`), at most one open per plan. The proposal is a
  list of `GoalChangeItem`s (ADD / MODIFY / CANCEL, each with a reason); the plan **stays Locked** and
  untouched until the final approval, then: MODIFY creates a new Active goal that `replacesGoalId` the old
  one (→ Changed), CANCEL marks the goal Cancelled, ADD creates a goal. "Đang điều chỉnh" is derived from
  the open form, never a plan status. *Source: SF4C PMGM.06–07; Manager guide.*
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
  because the monthly evaluation must launch itself, and fires once per (rule, period) (D5). *Source:
  HR guide pp. 89–93.*
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
  step (HR's own evaluation goes to another HR user) (`workflowRules.entitlement`). *Source: ERD
  `FORM_STEP_ACTION`, `DELEGATION`; plan §8.1; Phase 1.5 workflow review.*
- **BR-KPI-23** — On a form, **EDIT is a permission, not an action**: it lets the step's actor change the
  subject's plan or scores; those edits are audited, and the form does not move. Only SUBMIT, APPROVE,
  RETURN and CANCEL are recorded by a person; RETURN goes to the step's `returnToStepNo` (default the
  previous step). CANCEL is HR/ADMIN only, with a reason; cancelling a registration form puts its plan
  back to Draft. An action names the step the screen showed — if the form has moved on, it is refused
  (ERR-KPI-04). CANCEL and acting as proxy are the `form.cancel` / `form.proxy` permissions (§9). *Source:
  Phase 1.1 workflow review; ERD `WORKFLOW_STEP.allowed_actions`.*
- **BR-KPI-24** — **Someone who leaves mid-period** is evaluated for every period they worked at least
  one day of (left on 15 Jan → January's evaluation still launches on 1 Feb); their own SELF step has no
  actor, so its overdue behaviour carries the form on to the manager, and their lines are read as of
  their last working day. Registration launches reach only people employed on the launch day. Payout is
  **not prorated** (`ASSUMPTION Q13`; `orgRules.employedFraction` is ready if it is). *Source: plan
  §8.1; Phase 1.5 review.*
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
  the engine anyway is not computable, never scored.
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
  negative; the adjusted score never goes below 0 (`scoreRules.adjustedScore`). *Source: ERD `PERIOD_RESULT`; DATX sheet "TH KQ"
  columns.*
- **BR-KPI-41** — The **rating scale** maps a score range to a level. Default sample scale
  **A+ / A / B / C / D** (`ASSUMPTION Q2` — the DATX "TH KQ" sheet is broken with `#REF!`, so no real
  scale is available yet). Each level holds `[minScore, maxScore)`; the top level also takes anything
  above its max; levels must start at 0 and be contiguous (`ratingRules`). The rating reads the
  **rounded, adjusted** score, so it matches the number on screen. The seed's sample: A+ [110, 120] (and
  above) · A [100, 110) · B [90, 100) · C [70, 90) · D [0, 70).
- **BR-KPI-42** — A **payout rule** maps a rating level to a % of the KPI salary component, optionally
  per org unit or position, from an effective date. Sample table only (`ASSUMPTION Q2`): A+ 120% ·
  A 100% · B 80% · C 50% · D 0% for everyone, and an OrgUnit rule paying Kinh doanh 130% for A+. The most
  specific rule in force wins: **Position**, then the **nearest org unit** up the employee's unit chain,
  then All; among equals the latest `effectiveFrom`. A rule naming both a unit and a position is
  invalid. No rule → **no payout figure** ("chưa có quy tắc"), never 0% (`ratingRules.payoutPctFor`).
- **BR-KPI-43** — Results move **Draft → Final → Locked**; only finalised results are exported to
  payroll, and the export is recorded. *Source: ERD `PERIOD_RESULT.status`, `PAYROLL_EXPORT`.*

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
| ERR-KPI-04 | The write is not allowed in the record's current state (locked plan, step moved on) | toast with reload | Thao tác không còn hợp lệ |
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
  recorded; actuals are snapshots, and only the current one per goal and period counts. *Source: ERD
  `GOAL_ACTUAL`.*

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
