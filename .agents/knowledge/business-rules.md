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
> **Track T2 (2026-10-19)** added §3b — the KPI library's write rules (BR-KPI-74…80), enforced by
> `src/lib/libraryRules.ts` in every `library.save*` of the mock.
> **Track T7 (2026-10-19)** added §4b — notifications, files and the audit log — in
> `src/lib/notificationRules.ts`, `src/lib/fileRules.ts` and `src/lib/auditRules.ts`.
> **Track T3 (2026-10-19)** added `src/lib/planAccessRules.ts` (who may edit / send a plan, who sees a
> PRIVATE goal — shared by the gateway guard and the screens), `goalPlanImportRules.ts` (BR-KPI-26), period
> generation (`cycleRules.generatePeriods`), the period split (`goalPlanRules.evenSplit` /
> `periodTargetIssues`) and the cascade rules (`alignmentRules.goalAllocationIssues` / `cascadedGoalDraft`).
> **Track T4 (2026-10-19)** added BR-KPI-53…57 and Q33–Q37: `src/lib/importRules.ts` (the shared import
> framework), `actualImportRules.ts`, `actualEntryRules.ts`, and the sync / evidence rules in `actualRules.ts`.
> **Track T6 (2026-10-19)** added the payroll export (BR-KPI-81, `src/lib/payrollRules.ts`, `ASSUMPTION
> Q38`, `Q39`) and the result screens; the glossary below gained the result and pay terms.
> **Phase 3 (2026-10-19)** added §11 — the live dashboard and the simulated assistant (BR-KPI-83…89,
> `ASSUMPTION Q40`–`Q43`) — in `src/lib/dashboardRules.ts` and `src/integrations/insight/`.
> **22/10/2026 meeting** added §12 — changes the business **decided but the prototype does not do yet**
> (PEND-01…13, `ASSUMPTION Q44`–`Q58`). The rules above stay authoritative for the code until each
> change is built; a rule it will replace carries a *Pending* note.

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
| **Điểm KPI** | A period result's total — the weighted score of its goals plus the adjustment, never below 0, rounded once at finalisation (`PeriodResult.totalScore`). Not "điểm tổng" |
| **Điểm có trọng số** | One goal's points in a result: achievement % × weight / 100 (`ResultDetail.weightedScore`) |
| **Điều chỉnh điểm** | Points added to or taken from a Draft result for violations / attendance (`adjustmentPct`, in points). Never the GOAL_CHANGE "điều chỉnh Goal Plan" (BR-KPI-15) |
| **Xếp loại / thang xếp loại** | A rating level / the rating scale (A+/A/B/C/D sample, `ASSUMPTION Q2`) |
| **Quy tắc quy đổi** | A payout rule: rating level → % hưởng lương KPI, for all, a unit or a position (BR-KPI-42) |
| **% hưởng lương KPI** | The share of the KPI pay component a result earns (`payoutPct`). One term on every screen and in the file; not "% lương" |
| **Chốt kết quả / khóa kết quả** | Draft → Final (rounded, frozen) / Final → Locked (BR-KPI-43). "Khóa kết quả" is NOT "khóa kỳ" (`CyclePeriod.isLocked`), and "chốt kết quả" is not the evaluation form's step 3 |
| **Xuất file lương / lịch sử xuất file** | The payroll export (BR-KPI-81) / the list of past exports. Not "bảng lương" — the system holds no salary amounts |

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
  saved: the column is required and must resolve in the tenant (the integrity check, ERR-KPI-06), and the
  goal editor requires it. Other fields (weight > 0, a target, dates in order) are checked on **Gửi**
  (`submitIssues`), so a draft can be saved while it is being built (T3). The data source names the
  report or system the number is read from (ERP Sale, MHTC, CMS báo cáo kế toán…) — provenance, not a
  connection: in Phase 1 every actual is entered by hand or imported from Excel, whatever the source
  (BR-KPI-55, 56). *Source: NoteX minutes §2.3; ERD `GOAL.data_source_id` (required).*
- **BR-KPI-06** — Every KPI belongs to exactly one **BSC perspective**. DATX's "Hiệu quả / Khối lượng /
  Chi phí" classification is a secondary tag only (`ASSUMPTION Q5`). The KRI type (KRItc / KRIpt) is
  hidden until its meaning is confirmed (`ASSUMPTION Q6`, D4). *Source: HR guide p. 22; DATX sheet
  "2. KPIs phòng ban".*
- **BR-KPI-07** — Goals are joined by **cascade** (parent goal allocated down, `allocatedValue`) or
  **link** (child contributes to a parent, `contributionPct`). A goal can never be its own ancestor (no
  cycles, A → B → A refused). For a cascaded goal the manager sees four buckets (D3): **assigned**
  ("Đã giao", to units or employees) = Σ `allocatedValue` (derived); **self-assigned / tự giao** = the parent's
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
the manager — BR-KPI-12 step 1 or 3). **Unit targets:** from a Company / OrgUnit plan a goal may also be
cascaded to the OrgUnit plans of the **nearest planned units below** in the same cycle — a unit without a
plan is passed through, a planned unit stops the walk, a unit no longer in use is skipped
(`planAccessRules.cascadeTargetPlans`); the child goal belongs to the unit head. Writing into the unit plan
follows `canEditPlan`: no form → the head or HR (Draft/Returned); a form open → the step's actor, or HR as
proxy (`form.proxy`, both recorded). The CEO, owner of the Company plan, cannot write into a department plan.
A **link**'s `contributionPct` (0, 100] is informational only
(`ASSUMPTION Q31`).
*Source: HR guide p. 24; email template steps 1–2.*
  > **Pending (22/10/2026 meeting, §12):** PEND-03 — the chain is Company → Khối → Phòng → employee. Cascading to the nearest planned units is built (unit targets, above); still open: whether every Khối holds a plan, and the direct vs Khối manager (`Q40`, `Q56`).
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
  `SPLIT_NO_AGGREGATION` (a typed-in KPI: each period uses only its own split). It shows on the goal row and
  the plan's readiness strip, because quarters and the year are built from the month splits
  (`resultRules`). *Source: DATX column "Phân bổ mục tiêu theo tháng"; ERD `GOAL_PERIOD_TARGET`.*
  **The target of a period** (PEND-04, built 2026-10-23 — `calcRules.targetForPeriod` with the cycle's
  periods, `resultRules.periodTarget`): its own split; else, for a **Month**, the split of the Quarter, then
  Half, then Year holding it (`monthTargetFromSplit`, `ASSUMPTION Q67`): SUM → that split ÷ the calendar months
  it covers (Q1 3,75 tỷ → 1,25 tỷ a month), AVG / LAST → the split itself, no aggregation → not computable; for a
  **longer** period, its months' targets added up by the aggregation. A goal that **is** split never scores a
  SUM (or typed-in) month or quarter against the annual target: a period with no split of its own and none to
  derive from is **not computable** (`null`, `SPLIT_INCOMPLETE` warns); AVG / LAST and the Year fall back to the
  goal's target. A goal with no split at all keeps its target in every period. Labels: the goal row and the
  split panel say "Phân bổ theo quý" / "theo tháng" (`goalPlanRules.splitPeriodType`); the panel opens on the
  saved type. Cumulative tracking (PEND-05, `Q51`) is Plan B's.

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
  **Top-down and bottom-up run in parallel** (22/10, PEND-01, built 2026-10-23, `ASSUMPTION Q44, Q45`): a launch
  (`FormLaunch.startStepNo`) or a by-hand start (`StartFormInput.startStepNo`) may start the forms at the owner's
  own step — the steps before it are skipped and record nothing; the plan is Draft there; at most the owner's step
  (06 `START_STEP_INVALID`, `workflowRules.startStepIssues`); step 1 is stored as `null`; a scheduled launch whose
  start step no longer fits its edited workflow starts at step 1 (`initialStep`). A return still goes to
  `returnToStepNo` (a bottom-up form returned past the owner lands on the skipped step 1 — allowed). A manager's
  own plan works the same way (Q44). Any workflow with a SELF step may use it (monthly work, Plan B); a rule's
  recurring launches start at step 1. **Step 4 records and locks by itself when configured** (PEND-02,
  `ASSUMPTION Q46`: on the workflow template, manual by default): a last step with `autoApprove` is approved by
  the system (`AUTO_APPROVE`, no actor) in the same write as the move that enters it — the manager's APPROVE
  completes the form and the plan goes straight to Locked (`settleAutoSteps`; audited LOCK reason
  `AUTO_APPROVE`), with no content check (the person before already passed it); forms already waiting at the
  step when it is switched on stay with HR. `validateWorkflow`: `autoApprove` only on the last step, never step
  1, on a step that allows APPROVE, and no AUTO_FORWARD into it (`AUTO_FORWARD_INTO_AUTO_APPROVE`; one that
  slipped in acts as REMIND). The step's SLA, overdue and reminders never fire (the form never rests there).
  Nobody is notified of the automatic lock (`ASSUMPTION Q29`). **HR may send the plan back to the manager**
  at step 4 (RETURN → step 3, comment required, plan Submitted); the form's due date does not move, so a late
  return can make step 3 overdue at once (HR unlocks with a new date, BR-KPI-14).
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
- **BR-KPI-16** — **Evaluation runs in three steps** (22/10 meeting, PEND-07/08, built 2026-10-23): (1) the
  employee enters the actual of each goal on the form (BR-KPI-17) with evidence and an explanation —
  the % beside it is **computed by the system** (`formRules.computedItemPct` = `calcRules.achievement` on
  the form's actual and the period's target snapshot), never typed: a typed self % is refused (ERR-KPI-04
  `SYSTEM_COLUMN`); no actual → no %, never 0, and the form still goes on (its total "tạm tính"); (2) the
  **direct manager decides**: their % starts at the system's (`itemsOnEnterColumn`, on entering the step)
  and follows it while untouched; a different % (also where the system has none) or an actual they
  corrected after the employee sent it needs a comment (06 `OVERRIDE_COMMENT_REQUIRED`,
  `ACTUAL_CHANGE_COMMENT_REQUIRED` — `ASSUMPTION Q49`); (3) **"HR ghi nhận kết quả"** — HR records the
  manager's result: FINAL = MANAGER whenever the step is entered from another column (a return to the
  manager drops an earlier HR edit); HR changes it only in special cases, with a reason (06
  `OVERRIDE_REASON_REQUIRED`, audited — `ASSUMPTION Q47`). Two %s closer than 0.005 are the same score
  (`samePct`). Defaults written on step entry are audited with reason `STEP_ENTRY` / `AUTO_FORWARD`; an
  AUTO_FORWARD skips `canSubmit`, so a manager step entered that way may carry no comment. A typed % stays
  within the method's cap, or without one the most it can award (top tier / level, at least 100 —
  `scoreCeiling`). *Source: NoteX minutes §2.3 and 22/10/2026; Manager guide pp. 98–109; SF4C PMGM.12.*
- **BR-KPI-17** — The evaluation form **snapshots, when it opens**, the period's recorded actual and its
  target (`resultRules.periodActual` / `periodTarget`): a Quarter / Half / Year adds up its months by the
  KPI's aggregation; its target is its own split, else its months' splits aggregated, else the goal's
  target only for a Year or an AVG / LAST KPI — a SUM quarter never borrows the annual target (`null` →
  not computable). The **actual on the form** starts as the snapshot and is **entered by the employee**
  at the SELF step and correctable by the manager at the MANAGER step (22/10, PEND-06, `ASSUMPTION Q48`);
  it is an EDIT on the form, not `actual.enter` — the §9 matrix is unchanged. Refused: at another step
  (04 `ACTUAL_NOT_EDITABLE`), a locked period / a Final result (04), a period not started (06), the wrong
  kind of value (06 `ACTUAL_TYPE_MISMATCH`); clearing it is allowed; a resent unchanged value is not a
  change. The snapshots stay read-only ("Lúc mở phiếu"). When the form **completes**, each actual changed
  on it (≠ its snapshot, not empty) of a **Month** form becomes the current `GoalActual` with source
  **FORM** (`recordFormActuals`, entered by whoever last set it); a quarter form's figure stays on the form
  (`ASSUMPTION Q36`); a write `entryBlockers` refuses is skipped and named on the form's audit row
  (`FORM_ACTUAL_SKIPPED`), never blocking the completion. The form shows the period's target (the
  annual one beside it), the actual, the three %s, evidence and the totals. *Source: plan §5.5; NoteX
  22/10/2026.*
- **BR-KPI-18** — A form can be **submitted** only when the weights sum to 100% (BR-KPI-04) and every
  item that requires a score or comment at that step has one (`formRules.canSubmit`, D6). *Source:
  Manager guide p. 26.*
- **BR-KPI-19** — Forms are created by a **launch**: form type and workflow template; the step they start at
  (step 1, or the owner's own step — bottom-up, BR-KPI-12); timing — now, on a
  date, or recurring (e.g. the day after each quarter ends); the evaluation period; a due date rule (e.g. 7 days
  after launch); recipients — everyone, or a filter (units ± children, positions, job levels, employment
  status, named people). One launch creates many forms; recipients are resolved when it fires, and a
  subject who already has a non-cancelled form of the same type for the same period (or cycle, for
  registration) is skipped. A registration launch creates the subject's Draft Employee plan when there is
  none; Company and OrgUnit plans are registered by a form started by hand for the unit head. The
  recurring launch (`FORM_LAUNCH_RULE`, trigger `PERIOD_END` + `offsetDays` ≥ 0) moves from P2 into P1
  because the formal evaluation must launch itself, and fires once per (rule, period) (D5). **Which periods
  (PEND-09, built 2026-10-23, `ASSUMPTION Q52`, `Q60`):** one table, `workflowRules.LAUNCH_PERIOD_TYPES` —
  KPI_EVAL is for a **Quarter or the Year** (a Month / Half → ERR-KPI-06 `EVAL_PERIOD_NOT_FORMAL`; the monthly
  continuous evaluation is the work review), WORK_PLAN / WORK_REVIEW for a Month (`MONTH_REQUIRED`). It holds
  for `createLaunch` (`launchPeriodIssues`), for `saveLaunchRule` (`validateLaunchRule` refuses an ACTIVE rule
  of another type; a stopped one may keep it — the seed's monthly rule launched T01–T03 and is off), and for
  the scheduler, which never fires a stored launch or active rule of the wrong type (the rule fires nothing;
  a Scheduled launch is cancelled). The seed runs a quarterly rule (Q1 fired 04-01) and an annual one (no Year
  period yet, so it waits). Starting a
  unit plan's registration by hand needs a Company / OrgUnit plan that is not Locked and has no open
  registration; its subject is the unit head. The screen is "Bắt đầu đăng ký" on the cycle's Goal Plan list
  (`StartRegistrationButton`, pre-checked with `canStartForm`); its default due date is today + the sum of
  the steps' SLAs (`workflowRules.defaultStartDueDays`, 7 days when no step has one). With the default
  template the department head's manager (the division director) acts first at step 1, the head at step 2;
  the Company plan's steps 1 and 3 have no actor and HR acts as proxy. A launch is NOW (fires at once, `scheduledAt` = now) or
  SCHEDULED (strictly in the future, fires at the first tick after); RECURRING comes only from a rule
  (`launchTimingIssues`). Only a Scheduled launch can be cancelled (`canCancelLaunch`, 04). A recurring
  rule launches the **evaluation only**, for a quarter or the year, whole days ≥ 0 (`validateLaunchRule`). Rules fire for periods
  of **Active or Evaluating** cycles (product owner, Gate 1: the last month ends after the cycle moved
  to Evaluating). An evaluation form's items snapshot the **current** actual of (goal, period) at the
  moment the launch fires (BR-KPI-17). *Source: HR guide pp. 89–93.*
- **BR-KPI-20** — Every step defines its **actor rule** (SELF / DIRECT_MANAGER / MANAGER_L2 / HR / CNB /
  ROLE), its allowed actions (SUBMIT / APPROVE / EDIT / RETURN), its SLA in days and whether it approves
  itself (`autoApprove`, the last step only — BR-KPI-12). The direct manager
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
  current step's column (another column → 04) and, at a SELF / MANAGER step, the actual on the form
  (BR-KPI-17); the system's SELF % (04 `SYSTEM_COLUMN`) and the snapshots are never writable (04); a %
  above the goal's method cap — or, without one, `scoreCeiling` — is 06. *Source: Phase 1.1 workflow review; ERD `WORKFLOW_STEP.allowed_actions`.*
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
  days (editable offsets); quarters / halves / the year counted from the cycle start (`ASSUMPTION Q32`), whole
  groups only, no deadlines. Regenerating keeps the id and lock of a period with the same type and label
  (`mergeGeneratedPeriods`).
- **BR-KPI-28** — **Who may change a plan now and send it** is one decision shared by the gateway and the
  screens (`planAccessRules.planEditability` / `submitAvailability`): `goalplan.edit` over the owner, then
  `canEditPlan` with the open registration form's EDIT standing; "Gửi" is a dry run of `checkAction` (step
  allows SUBMIT, the person is entitled, content passes `canSubmit`). Before the owner's step the button is
  "Chuyển cho nhân viên" and 100% / 5–8 are information only. A screen that cannot load an input shows the
  plan read-only ("UNKNOWN"), never editable.
- **BR-KPI-22** — Out of P1: "Lấy ý kiến", "Thêm người duyệt" and the collaboration step (`ASSUMPTION
  Q7`). **Evaluation cadence (PEND-09, built 2026-10-23, replaces `Q3`):** the formal KPI evaluation is
  **quarterly and annual** (KPI_EVAL, BR-KPI-19); the monthly continuous evaluation is the monthly work review
  (PEND-14, `ASSUMPTION Q60`), and a month's KPI result is tracked, never paid (BR-KPI-40, `Q52`). The monthly
  work plan of PMGM.08 is P1 item 4 (`Q59`, reopens `Q10`).
  > **Pending (22/10/2026 meeting, §12):** PEND-10 — probation evaluation moves into P1 (`Q53`).

## 3. Calculation

All calculation is a pure function in `src/lib/*Rules.ts` with tests (CLAUDE.md, rule 5).

- **BR-KPI-30** — Calculation methods (ERD `CALC_METHOD.method_type` + D1): **RATIO_UP** (higher is
  better: actual / target), **RATIO_DOWN** (lower is better: target / actual — DATX writes it "% mục
  tiêu / thực tế"), **TIERED** (value ranges → fixed %, e.g. one stock-out = 70%), **BINARY** (Đạt /
  Không đạt), **FORMULA** (an expression), **LEVELS** (L1/L2/L3 per goal, BR-KPI-09). **Five are offered for a new
  pick** (22/10, PEND-11, built 2026-10-23, `ASSUMPTION Q55`): FORMULA has no source and is hidden from the
  method-type picker and from the goal / KPI method pickers and a method code typed in a Goal Plan import row
  (`libraryRules.pickableMethodTypes`, `pickableMethods`; the row gets 06 `CODE_UNKNOWN`) — never deleted: a FORMULA method still shows its own type, a goal or KPI already on one
  keeps it, and it keeps computing (like an archived item, BR-KPI-78).
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
  **Applying a template** ("Thêm từ bộ mẫu" on the plan page, whoever may edit the plan now — `canEditPlan`):
  only Active templates; suggested first for the plan's position (an Employee plan's primary position),
  then its unit and the units above it, nearest first, then general ones; the rest stay selectable
  (`templateApplyRules.templatesForPlan`). Each item becomes a goal built from its library KPI (name,
  perspective, unit, method, formula, definition, the KPI's default data source; PUBLIC, NUMERIC) with the
  item's default weight and target, the cycle's dates, the plan owner, after the plan's last goal in
  template order. **Append only, never replace**: an item is skipped when the plan already has an Active
  goal of that KPI (private ones included), the KPI is no longer Active, or it has no default data source
  (`templateApplication`). Weight, count and missing targets are warnings, fixed on the plan before Gửi.
  The goals are saved one `saveGoal` at a time; a refusal stops the run and says how many were added
  (`useApplyTemplate`). A registration launch still creates an EMPTY plan — applying at launch is deferred.
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
  the BR-KPI-07 tolerance; Gate 1 QA). **Payout only for Employee plans of a paid period** — a Company /
  OrgUnit plan is rated but has no payout figure, and so is any **Month / Half** result: only a Quarter or the
  Year is paid (`resultRules.PAID_PERIOD_TYPES`, `isPaidPeriod`; PEND-09, built 2026-10-23, `ASSUMPTION Q52`).
  Screens show such a result's payout as "Theo dõi — không tính lương" (`resultView.payoutState(…, period)` →
  `tracked`). The payout is read as of the **period's end date**, for the
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
  payroll — BR-KPI-81. *Source: ERD `PERIOD_RESULT.status`, `PAYROLL_EXPORT`.*
- **BR-KPI-44** — `calculateResults` computes a **Draft** per Approved / Locked plan of the period's
  cycle (`resultRules.buildPeriodResults`); a Final or Locked result is never recomputed (returned
  unchanged); an existing Draft keeps its id and adjustment and gets fresh details. Refused once the
  cycle is Closed (ERR-KPI-04). **Employee plan** — only from a **Completed KPI_EVAL form** for
  (subject, plan, period), its **FINAL column**; no completed form → **no result** (`ASSUMPTION Q17`).
  The form is the snapshot of the goals Active when it opened (BR-KPI-17), so every goal on it counts
  even if since Changed / Cancelled (E026's T01). **Company / OrgUnit plan** — `calcRules.achievement`
  on the **current** actuals of its Active goals; a Quarter / Half / Year with no own actual adds up its
  months by the KPI's aggregation (`aggregatePeriodActuals`), the target is `periodTarget` (BR-KPI-11 — the
  same one an evaluation form snapshots; a SUM quarter with a gap in its split is not computable, never the
  annual target); a goal flagged `rollUpFromChildren` sums its CASCADE children (`ASSUMPTION Q8`); NO_ACTUAL
  and NOT_COMPUTABLE stay null, never 0.
- **BR-KPI-81** — **Payroll export** (`results.exportPayroll`, T6; `payrollRules.buildPayrollSheet`).
  **Who:** `result.export` (C&B, ADMIN) — HR finalises but does not export. **Which results:** the
  period's **Employee** results that are **Final or Locked** (`ASSUMPTION Q38`); Drafts and Company /
  OrgUnit results (no payout, BR-KPI-40) are never in the file, and the screen counts what it leaves out.
  **Which periods (PEND-09, built 2026-10-23):** a Quarter or the Year only — a Month / Half is refused
  (ERR-KPI-06 `PERIOD_NOT_PAID`, `payrollPreview` agrees: `notPaid`), and the export screen offers paid
  periods only, opening on the latest one over. The seed's Q1 holds three Final results (E015, E016, E022).
  None qualifies → ERR-KPI-04 `NO_FINAL_RESULT`. **What:** one row per person, sorted by employee code
  (ties by result id) — code, name, unit and position of `resultRules.subjectAssignment` (the assignment
  the payout % was read for, from the current assignment rows, by their current names), Điểm KPI,
  điều chỉnh điểm, xếp loại, % hưởng lương KPI, status, finalised-at — **copied from the stored result,
  never recomputed**. A **null payout** is a **blank cell with a note**, never 0 and never a refusal
  (`ASSUMPTION Q39`): "Chưa có quy tắc quy đổi" (rated, no rule), "Chưa xếp loại" (no rating), "Không tìm
  thấy xếp loại" (the level is gone); a person who cannot be found stays in the file with "Thiếu thông tin
  nhân viên". **Effect:** an `.xlsx` file (`FileObject`) and its `PayrollExport` record, at the gateway
  clock's time, `payroll.exported` emitted; **no result changes status**. Allowed in a **Closed** cycle
  (exporting computes nothing). **Repeatable** — every export is its own record and file. Results that
  change while the file renders refuse the export (04 `CHANGED_DURING_WRITE`, retry). The file is the
  snapshot; in the mock its bytes live in memory only, so after a reload the record stays and the file
  must be exported again (ERR-KPI-02). *Source: ERD `PAYROLL_EXPORT` (the log only); the sources are
  silent on the file, who exports and when — a Syntra decision (T6, product owner 2026-10-19).*
- **BR-KPI-82** — **An employee sees their own result's figures only once it is Final or Locked**
  (`resultView.isShownToEmployee`): a Draft may still be adjusted, so "Kết quả của tôi" shows it as
  "Đang tổng hợp", with no score, rating or payout anywhere on the page. *Source: Syntra decision (T6).*

### Monthly work review (PEND-14, Plan B — `src/lib/workRules.ts`)

- **BR-KPI-91 — The monthly work review form.** WORK_REVIEW runs SELF → MANAGER → FINAL (HR records); its
  workflow ends on FINAL with the columns in order, is launched for a Month only (`LAUNCH_PERIOD_TYPES`) and
  only for a Locked plan with a live task (Q69). The effects come from the column ENTERED
  (`workReviewEffects`, `syncWorkReview` after every move): entering MANAGER fills its EMPTY task scores and
  KLcv from SELF (a 0 stays; comments and Hsnv never copied); a RETURN onto SELF clears manager cells still
  equal to SELF; entering FINAL overwrites it with MANAGER (Hsnv and reason included) and clears HR's comments.
  An HR step set to approve itself (PEND-02) runs its entry effects in the same write, so the manager's send
  copies MANAGER into FINAL and records the month. Each prefill is audited with its reason. `canSubmit` =
  `reviewSubmitIssues` of the step's column, plus `workFinalOverrideIssues` at FINAL. *ASSUMPTION Q71.*
- **BR-KPI-92 — KQcv, KLcv, Hsht, Hsnv.** KQcv = Σ effective weight × task score over live tasks (cancelled
  tasks normalised out, Q64); KLcv = the discipline score; Hsht = (resultWeight × KQcv + disciplineWeight ×
  KLcv) / 100, per tenant, default 70 / 30 (Q62). Strictly below the threshold (default 80) the manager must
  give **Hsnv** (0–100, Q61) **with a reason**, and Hsnv becomes the final score; otherwise the final score is
  Hsht and a leftover Hsnv counts for nothing. 0 is a score; an empty cell is not. Screens show 2 decimals and
  never round up across the threshold (`displayWorkScore`: 79.996 → 79,99). The "KPI tháng (tham khảo)" table is
  read only and never part of Hsht (D-W3).
- **BR-KPI-93 — One result per month.** Completing the review writes exactly ONE `WorkResult` per employee and
  month from FINAL, with tasks and scoring read on the server; a null final score is refused (06
  `RESULT_INCOMPLETE`), never stored. HR changing the manager's score of a task needs that task's reason; a
  changed KLcv or effective Hsnv needs the form's (06 `FINAL_REASON_REQUIRED`). A recorded month does not reopen
  in P1 (Q72); it is tracked, never paid (Q52). *Source: CMC PMGM.08–09 (`docs/source-map.md`); Q71, Q72.*

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
| Form type | GOAL_SETTING · GOAL_CHANGE · KPI_EVAL · WORK_PLAN · WORK_REVIEW (P2 adds PROBATION_EVAL, CONTRACT_EVAL, REVIEW_360). `WORK_FORM_TYPES` = the last two (monthly work, PEND-14): period forms on a `WorkPlan` (`FormInstance.workPlanId`), never on a Goal Plan; WORK_PLAN moves since 8.2 (it moves its plan), WORK_REVIEW since 8.3 (its columns prefill on entry, its completion records the month's one `WorkResult`); neither is ever started by hand. A WORK_REVIEW workflow ends on its FINAL column with the columns in SELF → MANAGER → FINAL order | ERD + D10 |
| Work plan | Draft · Submitted · Returned · Locked — the Goal Plan set without `Approved` (`WORK_PLAN_STATUSES`, Goal Plan labels): the manager's approval IS the lock. Mirrors its WORK_PLAN form (`TransitionResult.workPlanStatus`, written only by `workflowContext.setWorkPlanStatus`): up to the employee's step Draft (Returned via RETURN), after it Submitted (an AUTO_FORWARD too), the final APPROVE Locked with `approvedAt` / `approvedBy` = whoever pressed Duyệt (a delegate or HR proxy included; the history names whom they acted for), a cancel back to Draft with its tasks kept. No unlock in P1 | D10 |
| Work task progress | NotStarted · InProgress · Done · Cancelled (Chưa bắt đầu · Đang thực hiện · Hoàn thành · Đã hủy) — `Cancelled` only through `work.cancelWorkTask` (manager, reason, Q64) | D10, HR guide p. 26 |
| Actor rule | SELF · DIRECT_MANAGER · MANAGER_L2 · HR · CNB · ROLE | ERD |
| Step action | SUBMIT · APPROVE · EDIT · RETURN · CANCEL · AUTO_FORWARD · AUTO_LOCK · AUTO_APPROVE — EDIT is never recorded (BR-KPI-23); the AUTO_* are the system's, no actor | ERD + CANCEL, AUTO_LOCK (D7), AUTO_APPROVE (PEND-02) |
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
| Entity name | the 49 P1 entities and the 6 monthly-work entities (D10), each labelled for the audit log (`ENTITY_NAME_LABEL`) | ERD + D1/D5/D7/D10 |
| Delegation state — **derived, never stored** | Upcoming · Active · Expired · Revoked (Sắp hiệu lực · Đang hiệu lực · Hết hạn · Đã thu hồi) — from the dates (tenant zone, inclusive) and `revokedAt`, against the gateway clock (`formViewRules.delegationState`) | T5, BR-KPI-21 |

**Derived flags shown beside a status, never a status** (labels in `src/components/shared/statusTones.ts`):
"Quá hạn" (`OVERDUE_LABEL`, a form past its step deadline — `workflowRules.isOverdue`) and
"Đang điều chỉnh" (`PLAN_ADJUSTING_LABEL`, a Locked plan with an open GOAL_CHANGE form, BR-KPI-15), and the
dashboard's "Cần chú ý" flags (`ATTENTION_LABEL`): "Dưới ngưỡng", "Thiếu số liệu", "Xếp loại thấp" (BR-KPI-86).

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
- **BR-KPI-52** — An actual records its **source** (manual, Excel batch, API sync, or **FORM** — a completed
  evaluation form, BR-KPI-17; `ACTUAL_SOURCE_TYPES`, a data source is never of type FORM) and when it was
  recorded; actuals are snapshots, and only the current one per goal and period counts. Recording an
  actual is refused by ONE rule (`actualRules.actualIssues` = `entryBlockers` + `valueIssues`) that
  manual entry, every import row and every API reading pass through, most important first: the goal's
  plan is not **Approved / Locked** → ERR-KPI-04 `PLAN_NOT_APPROVED` (`ASSUMPTION Q35`); the period is
  locked → 04 `PERIOD_LOCKED`; the plan's result for the period is already Final / Locked → 04
  `RESULT_FINAL`; the goal is not Active → 06 `GOAL_NOT_ACTIVE`; the period belongs to another cycle →
  06 `PERIOD_NOT_IN_CYCLE`; the period is a Quarter / Half / Year → 06 `PERIOD_NOT_MONTH` (actuals are
  **monthly**; a longer period adds its months up, so an own quarter actual can never override them —
  `ASSUMPTION Q36`); the period has not started → 06 `PERIOD_NOT_STARTED` (`ASSUMPTION Q18`); nothing
  entered → 06 `ACTUAL_REQUIRED`; a NUMERIC goal needs a finite number and no text, a TEXT goal
  non-blank text and no number → 06 `ACTUAL_TYPE_MISMATCH`. A negative number is accepted. Who may
  enter by hand follows §9: `actual.enter` = MANAGER (their units) · HR · C&B · ADMIN — **an employee
  does not enter actuals by hand**; they enter theirs on the evaluation form, which records it as FORM
  when it completes (`ASSUMPTION Q48`). The latest current snapshot wins whatever its source; an API sync
  never overwrites a FORM one (Q37). The detail codes' Vietnamese copy is `errorCatalog.ISSUE_DETAIL_COPY`. *Source: ERD
  `GOAL_ACTUAL`; T4 Phase 1 (product owner, 2026-10-19).*
- **BR-KPI-53** — **The actuals import** (WBS 4.4.3, `actualImportRules`). Template columns:
  `Mã chỉ tiêu được giao` · `Tên đăng nhập` · `Nhân viên` (reference) · `Mã KPI` · `Tên chỉ tiêu`,
  `Đơn vị đo`, `Mục tiêu kỳ` (reference) · `Kỳ`* · `Giá trị thực tế` · `Giá trị dạng chữ` · `Ghi chú` ·
  `Link bằng chứng`. The key is the **assigned goal id** (CMC exports the goal list and imports it
  back, HR guide pp. 77–80); `Tên đăng nhập` + `Mã KPI` is a Syntra fallback; `Kỳ`, `Ghi chú` and
  `Link bằng chứng` are Syntra additions. The downloaded template is pre-filled with the month's goals
  (Active goals of Approved / Locked plans). Reading the file never guesses: headers match ignoring
  case and tone marks; a number in text form is read only when unambiguous (`1.234,5`, `1234.5`,
  `85%` → 85; `1.234` and `1,234` are refused; a fraction is never rescaled); a blank cell is blank,
  never 0; header, size and cell problems stop the file in the browser (nothing is staged). Per row,
  every problem is listed, nothing is guessed: no key → `GOAL_KEY_REQUIRED`; unknown goal id (another
  tenant's answers the same) → `GOAL_NOT_FOUND`; goal of another cycle → `GOAL_NOT_IN_CYCLE`; unknown
  login → `USER_NOT_FOUND`; unknown code → `KPI_NOT_FOUND`; login + code matching two Active goals →
  `GOAL_AMBIGUOUS`; the two keys naming different goals → `GOAL_KEY_CONFLICT`; `Kỳ` outside the
  batch's cycle → `PERIOD_NOT_FOUND`; then BR-KPI-52 on the cell it concerns; a non-http(s) link →
  `EVIDENCE_URL_INVALID`; two rows for the same goal and month → `DUPLICATE_ROW` on each. A resigned
  owner is accepted while the goal is Active. The preview also WARNS (never blocks) when a row replaces
  a current number (shows the old one) and when a % goal with a target above 1 gets a value in (0, 1].
- **BR-KPI-54** — **The batch lifecycle** (shared by every import type, `importRules`): stage →
  `Validating` with the rows and row errors stored on the batch → **Committed whole or not at all**
  (`canCommitImport`: Validating, has rows, no row error) or `Rejected` (only while Validating). The
  commit re-validates every row against the data as it is then (a month locked since staging) and, if
  any fails, refuses with ERR-KPI-04 and the row issues and writes nothing — the batch is unchanged. A
  corrected file is uploaded as a **new batch**; the old one is rejected by hand. Each committed row is
  an `EXCEL` snapshot with its batch id and the committer; a `Link bằng chứng` becomes a URL evidence
  tied to that actual. An import type whose track has not landed (GoalPlan T3, OrgData T1, Library T2)
  is refused with `KpiDeferredError`.
- **BR-KPI-55** — **Data sources** (WBS 4.4.1): a per-tenant catalogue (unique code, name, type
  MANUAL / EXCEL / API — API sources only feed the later-phase sync, BR-KPI-56 — an owning unit); every goal names one (BR-KPI-05). Admin maintains it
  (`datasource.manage`). API connections and their KPI mappings are seeded and read-only in P1; Admin
  can only switch a connection on or off. The schedule (`0 6 1 * *` = 06:00 on day 1) is documentation —
  no cron runs in P1.
- **BR-KPI-56** — **The API sync** (WBS 4.4.5, simulated ERP Sale). **A later phase, not part of P1** (product
  owner, 2026-10-21): P1 records actuals by hand and by Excel import only — no API, no integration with other
  systems. The sync and the connection screens stay in the prototype on simulated data, tagged "Phase sau" in
  the menu and at the top of each page (`LaterPhaseNotice`). The rules below describe that later flow. Started by hand (`actual.import`)
  for one **month**. An Inactive connection is refused (04) and records no run. For every Active goal of
  the month's cycle whose KPI the connection maps AND whose source is that connection's: if the current
  number came from a person (manual or Excel) it is **kept and the goal skipped** (`ASSUMPTION Q37`);
  a goal with no numeric month target is skipped; otherwise the reading passes BR-KPI-52 and is
  recorded (`API`, no author) or logged as an error. Run status (`syncRunStatus`): loaded and no error →
  Succeeded; loaded and errors → PartiallyFailed; nothing loaded and errors, or nothing to load at all →
  Failed (all skipped → Succeeded). The simulated reading is deterministic per (goal, month), 85–115% of
  the month's target, never below 1 on a RATIO_DOWN goal. Over its own earlier reading the latest wins;
  an Excel import over anything is HR's deliberate act and also wins (with the preview warning).
- **BR-KPI-57** — **Evidence** (WBS 4.4.6): a file or an http(s) link (stored, never fetched) on a goal,
  optionally for a month and an actual; the month must be in the goal's cycle. Added and removed with
  `evidence.upload` on the goal's owner (EMPLOYEE own, MANAGER their units, HR, ADMIN — not C&B's role,
  though a C&B account with an employee record uploads FILES through its EMPLOYEE role, BR-KPI-62).
  An `actualId` must be an actual of the same goal (06). Evidence is NOT frozen by a Final result — it
  documents the number, it does not change a score. Shown wherever the actual is (the entry sheet; T5's
  evaluation form reuses the panel).

## 8. Open assumptions (plan §9)

| # | Question | Default in use | Rules affected |
|---|---|---|---|
| Q1 | Does LEVELS interpolate between L1–L2–L3? | Yes, linear, capped at the top level | BR-KPI-33 |
| Q2 | The rating scale and payout table? | Sample A+/A/B/C/D, marked as an assumption — **22/10:** chị Phương to send the real conversion table | BR-KPI-41, 42 |
| Q3 | Main evaluation monthly or quarterly? | **Closed:** quarterly and annual; monthly is continuous (22/10 meeting) — **built 2026-10-23** (PEND-09, superseded by `Q52`, `Q60`) | BR-KPI-19, 22, seed |
| Q4 | Is "Tỉ lệ KH cũ" higher-is-better? | Yes | BR-KPI-34 |
| Q5 | BSC or "Hiệu quả / Khối lượng / Chi phí"? | BSC primary, the other a secondary tag | BR-KPI-06 |
| Q6 | What are KRItc / KRIpt? | Field hidden | BR-KPI-06 |
| Q7 | "Lấy ý kiến", "Thêm người duyệt", collaboration step in P1? | No (P2) | BR-KPI-22 |
| Q8 | Parent KPI actual independent or summed? | Independent; summed only when flagged | BR-KPI-36 |
| Q9 | Does a KGI have a numeric target? | Optional field, not scored | BR-KPI-02 |
| Q10 | CMC's monthly work plan in P1? | No — **22/10: reopened**, P1 item 4 is the monthly work plan (`ASSUMPTION Q59`, PEND-14) | BR-KPI-22 |
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
| Q31 | What does a LINK's `contributionPct` mean (a share of the parent's target, or of the child's result)? | Informational only — shown, never computed | BR-KPI-07 |
| Q32 | In a cycle that does not start in January, is Q1 January–March or the cycle's first three months? | The cycle's first three months | BR-KPI-27 |
| Q33 | Who enters actuals by hand — the employee too? | No — MANAGER (their units), HR, C&B, ADMIN as §9 says. **Superseded 22/10 (built 2026-10-23, PEND-06):** the employee enters the actual on the evaluation form (`Q48`). The seed's MANUAL rows "entered by the goal owner" predate this and are history | BR-KPI-17, 52 |
| Q34 | Can C&B upload the import file (`system.uploadFile` needs `evidence.upload`)? | Resolved: yes — a C&B account with an employee record holds EMPLOYEE (BR-KPI-62), whose `evidence.upload` covers a file upload. A C&B system account without an employee could not; none exists | BR-KPI-54, 57 |
| Q35 | May actuals be recorded for a goal whose plan is not yet Approved / Locked? | No — refused (ERR-KPI-04 `PLAN_NOT_APPROVED`). A plan HR reopens takes no new actual until re-approved | BR-KPI-52 |
| Q36 | May a Quarter / Half / Year hold its own actual? | No — monthly only (06 `PERIOD_NOT_MONTH`); longer periods always add up their months | BR-KPI-52, 56 |
| Q37 | May an API sync overwrite a number a person entered (manual or Excel)? | No — the goal is skipped and logged; an Excel import does overwrite (HR's act, with a warning) | BR-KPI-56 |
| Q38 | Which results may be exported to payroll, and does exporting lock them? | Employee results that are Final OR Locked; exporting changes no status (locking stays HR's separate act) | BR-KPI-43, 45 |
| Q39 | A finalised result with no payout % (no rule, no rating) — block the export, or export it? | Export it with a blank % and a note; never 0, never blocking (a Final result is frozen) | BR-KPI-81 |
| Q40 | A Khối (or any unit) has no plan of its own: what is its score? | None — "Chưa có kế hoạch". Beside it, the UNWEIGHTED mean of its people's official (Final / Locked) results, labelled "Điểm trung bình nhân viên (không trọng số)" with its n/m; `null`, never 0, when nobody counts. Never ranked against a plan score — **22/10: a Khối director receives KPIs**, so a Khối may need its own plan (PEND-03, `Q56`) | BR-KPI-85 |
| Q41 | When does a goal / a result "need attention"? | A goal below 90% achievement (exactly 90 is not; a fixed number, independent of the rating scale); a goal with no achievement is "Thiếu số liệu", never a warning. A result whose rating is one of the scale's two lowest bands (one on a scale of < 3) | BR-KPI-86 |
| Q42 | What does the dashboard compare a period with? | The previous period of the same type in the same cycle — never an earlier one that happens to have data. Points, rounded once; "(tạm tính)" when a Draft is on either side; none for the first period | BR-KPI-87 |
| Q43 | Under which unit does someone who moved (E021) or left (E024) count? | The unit they sat in on the period's last day (their last working day when earlier) — per period: earlier months under the old unit. Someone with no primary assignment then is "chưa xếp đơn vị", shown to a tenant-wide viewer only | BR-KPI-84 |
| Q44 | Does a manager get their own KPIs top-down or bottom-up? | Both, like an employee — **built 2026-10-23** | PEND-01, BR-KPI-12 |
| Q45 | Bottom-up: where does a registration form start when the manager cascades nothing? | Step 1 becomes optional — the manager sends it on with nothing cascaded, or HR launches straight into the employee's step ("Bắt đầu từ", `startStepNo`) — **built 2026-10-23** | PEND-01, BR-KPI-12, 19 |
| Q46 | Where is automatic record-and-lock configured, and what is the default? | On the registration workflow template (the last step's "Tự động ghi nhận"); manual by default; no notice of the automatic lock (Q29) — **built 2026-10-23** | PEND-02, BR-KPI-12, 14 |
| Q47 | How does HR edit a result "in special cases"? | HR edits the FINAL column with a required reason, audited; the FINAL column defaults to the manager's — **built 2026-10-23** | PEND-08, BR-KPI-16, 23 |
| Q48 | The employee enters the actual on the form: does manual entry by manager / HR (BR-KPI-52) stay, and which number wins? | Manual entry stays; the form's actual is entered by the employee at step 1 and may be corrected by the manager at step 2 (with a comment); a changed actual of a Month form becomes the current FORM actual on completion, the latest snapshot wins — **built 2026-10-23** | PEND-06, BR-KPI-17, 52 |
| Q49 | May the system-computed % be overridden? | Not by the employee; the manager may, with a comment — **built 2026-10-23** | PEND-07, BR-KPI-16, 32 |
| Q50 | The minutes' quarterly example (500 tr + 2 tỷ + 5 tỷ + 10 tỷ = 17.5 tỷ) does not equal the 15 tỷ annual target — are quarter targets per quarter or cumulative? | Per quarter; a total that does not match is a warning (BR-KPI-11) | PEND-04, BR-KPI-11 |
| Q51 | How is "lũy kế" (cumulative) computed for ratios and stock? | By the KPI's aggregation over the cycle's months up to the period viewed: SUM → running sum, AVG → mean of the months that have a number, LAST → the latest number. A month with no actual is never 0 — the figure uses the months that have one and is flagged incomplete. The cumulative target adds up the same way: SUM → the months' splits, else quarter / half splits that tile the window exactly, else the annual target only for the whole cycle — never prorated; AVG → mean of each month's target, the goal's own target where a month has no split; LAST → the last month's (same fallback). A period result still needs every month (`aggregatePeriodActuals` → `null` on a gap); only the running figure is partial. With a month missing, both comparisons are **provisional** ("tạm tính") — a partial actual against the whole window's target. Shown two ways: against the cumulative target (on track) and against the annual target (year progress). TEXT goals, roll-up goals (Q8) and goals with no aggregation are not cumulated (`cumulativeRules.ts`) | PEND-05, BR-KPI-11, 44 |
| Q52 | Is the monthly continuous evaluation scored and paid? Which period produces the payout %? | Monthly is tracked, not paid; quarters and the year are scored and paid — **built 2026-10-23** (closed on its default per plan 22/10 §2.5; HR + C&B may still change it) | PEND-09, BR-KPI-19, 40, 81 |
| Q53 | Probation evaluation: steps, criteria (KPI or competency), trigger? | Three steps like KPI_EVAL — employee self-assesses → direct manager decides → HR records (PEND-08); criteria = the probation KPIs only (competency is P2); outcome Đạt / Không đạt / Gia hạn, the manager's call with a comment; launched automatically 7 days before the probation end date (hire date + the probation length on the employee); Đạt moves the employment status from Thử việc to Chính thức when HR records it. Product owner + HR to confirm before Đợt 6 | PEND-10 |
| Q54 | Does "manual only in P1" also drop the Excel import of actuals? | **Resolved (product owner, 2026-10-21):** no — hand entry and Excel import in P1; the API sync stays on simulated data, tagged "Phase sau" | PEND-11, BR-KPI-53…56 |
| Q55 | The PMGM guide has 5 calculation methods; the prototype has 6 — which goes? | **Checked 2026-10-23 (Đợt 0):** no source lists five methods — the PMGM guides describe one levels mechanism (numeric or Đạt/Không đạt target, xuôi / ngược direction, L1–L3 with a % per level: HR guide p. 23, 28; Manager guide p. 54); DATX adds "% thực tế / mục tiêu", "% mục tiêu / thực tế" and one stepped rule (sheet 2, E65). Mapped: RATIO_UP, RATIO_DOWN, LEVELS, BINARY, TIERED; **FORMULA has no source** and no seeded method or goal uses it. Default: hide FORMULA from the method picker (not deleted — a FORMULA method keeps computing, like BR-KPI-78) — **built 2026-10-23**; HR + BA to confirm | PEND-11, BR-KPI-30 |
| Q56 | Does a Khối hold its own Goal Plan? How does a direct manager differ from a Khối manager? | A Khối has a plan when its director receives KPIs; BA to clarify (Trang's action item) | PEND-03, BR-KPI-01, 07, 85; Q40 |
| Q57 | Historical import: which data (actuals, results, ratings), how many years, shown where? | Period results only (employee, period, score %, rating) — not actuals, no recalculation; any number of years, each into a Closed historical cycle, imported Locked and read-only; shown in the employee's result history and the dashboard's previous periods. C&B / HR import, through the shared import framework (BR-KPI-53). Low priority | PEND-12 |
| Q58 | Is the dashboard's "6 tháng" the cycle's half or the last six months? | The cycle's half (period type Half) | PEND-13, BR-KPI-87 |
| Q59 | Is P1 item 4 CMC's monthly work plan (PMGM.08–09), or only monthly KPI tracking? (reopens Q10) | CMC's monthly work plan — `docs/plans/KPI_monthly_work_plan.md` | PEND-14 |
| Q60 | Does the monthly work review replace the monthly KPI_EVAL form, or run beside it? | Replace it: the work review is the monthly continuous evaluation; KPI_EVAL launches for quarters and the year only (monthly plan D-W3) | PEND-09, PEND-14 |
| Q61 | Is Hsnv a score or a ranking, and on what scale? (CMC labels it "Hsnv – Ranking" and gives no values) | A score on the form's 0–100 scale that replaces Hsht as the month's final score; required only when Hsht is below the threshold, and ignored otherwise (`workRules.finalWorkScore`) | PEND-14 |
| Q62 | Are the 70 / 30 weights and the threshold of 80 fixed, or per company? | Per tenant (`WorkScoringConfig`), default 70 / 30 / 80; the two weights must total 100. One 0–100 scale for task scores, KLcv and Hsnv (CMC prints 1–100 beside KLcv) | PEND-14 |
| Q63 | May a monthly task link to a KPI, and must it? | Optional (`linkedGoalId`, a goal in the employee's own Locked plan); it never affects any score | PEND-14 |
| Q64 | A task cancelled mid-month: dropped from KQcv with the weights redistributed, or kept with 0? | The manager cancels it with a reason; it drops out of KQcv and the remaining weights are normalised to 100. Every task cancelled → no KQcv (`null`, never 0) | PEND-14 |
| Q65 | Deadlines: plan by which day of month M; review by which day of month M+1? | Plan: employee by day 3, manager by day 5 of month M; review: the existing evaluation deadline (day 13 of M+1) | PEND-14 |
| Q66 | Does someone who joins or leaves mid-month get forms? | Yes, if employed on the launch day; nothing prorated by working days (like Q13) | PEND-14 |
| Q68 | May a monthly task run across months (carried-over work)? | Yes: a task must overlap the month, not lie inside it (`workRules.planSubmitIssues` `DATES_OUTSIDE_PERIOD` only for a task wholly outside) | PEND-14 |
| Q69 | Who gets a monthly work review when the month's plan was never approved, or has no live task? | Nobody: the review launch skips a plan that is not Locked (`NO_APPROVED_PLAN`) or has no live task (`NO_WORK_TASKS`) — once a review exists the task list is frozen, so it could never be fixed or scored. HR approves or completes the plan first, then launches that person's review | PEND-14 |
| Q70 | Who sees a monthly task marked "Riêng tư"? | The employee and the managers who see their month; the flag is stored and shown as a tag, **not enforced on reads** — reads are tenant-wide until Phase 5 RLS, and only `team.view` scopes ever list other people's months | PEND-14 |
| Q71 | When the review reaches the manager, what does the manager's column start from? | The manager's empty cells (task scores and KLcv) take the employee's; a 0 he typed stays; comments and Hsnv are the manager's own. A RETURN to the employee clears the manager's cells that are still untouched copies, so the employee's revision reaches the manager; cells the manager changed stay. Entering HR's step copies the manager's column (Hsnv and reason included) and clears HR's own comments; HR changing a task score needs that task's reason, a different KLcv or required Hsnv needs the form's reason (`workFinalOverrideIssues`) | PEND-14 |
| Q72 | Can a recorded month be reopened? | No, not in P1: the completed review is closed and the month's `WorkResult` is final (one per employee and month). A correction later updates that row, never adds a second | PEND-14 |
| Q67 | A goal split by quarter only: what is a month's target? (Was the annual target — wrong for a SUM KPI) | SUM → the quarter's target ÷ the quarter's calendar months; AVG / LAST → the quarter's target (for LAST that is the quarter-end stock, strict for its first months); a typed-in KPI → not computable; a split goal's SUM month with nothing to derive from → not computable — **built 2026-10-23** | PEND-04, BR-KPI-11 |

**Status after Đợt 0 (2026-10-23).** Q2, Q44–Q72 have no answer yet from HR, C&B, BA or the product owner.
Each change builds on the **Default in use** above and cites it as `ASSUMPTION Qn` in the rule it writes, so
no step waits; an answer that differs is a change to that rule (Flow/Spec). Q2 stays on the sample scale until
chị Phương sends the real conversion table. Q59–Q66 detail and the steps they block: `docs/plans/KPI_monthly_work_plan.md` §4 (Plan B).

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
- **BR-KPI-90** — **A Goal Plan opened by its address is checked against the place it opens in**
  (`planRouteAllows`, `planAccessRules.ts`): the viewer needs `goalplan.view` over the plan's owner AND the
  route must fit the plan — under "KPI của tôi" only the viewer's own employee plan; under "KPI nhân viên" an
  employee plan; under "KPI bộ phận" a unit or company plan; under a cycle a plan of that cycle. Otherwise
  ERR-KPI-02, the same answer as an unknown id (the page never reveals whose plan it was). Its goals are
  those of `visibleGoals` (BR-KPI-08) whose plan is that plan. *Source: product owner, 2026-10-19 (plans
  and goals open on their own pages); the gateway's plan read checks only the tenant until Phase 5.*
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

## 11. Live dashboard and assistant (Phase 3, WBS 4.7.1–4.7.4)

Screens: `/dashboard` — "Tổng quan" (4.7.1 executive + 4.7.2 manager, one drill-down) and "Vận hành"
(4.7.3); "KPI của tôi" on `/my/results` (4.7.2 personal); "Trợ lý KPI · Giả lập" (4.7.4). Rules:
`src/lib/dashboardRules.ts`; the assistant: `src/integrations/insight/`. *Source: NoteX minutes
("dashboard sống"), plan §6.2, roadmap R9/R10 — the layout, thresholds, trend and assistant wording have
no source and are Syntra decisions (`docs/source-map.md`).*

- **BR-KPI-83 — Scope.** `/dashboard` needs `dashboard.view` (MANAGER over their unit + children, HR,
  BOD, ADMIN tenant-wide; C&B and EMPLOYEE do not hold it). A unit is shown when the grant covers it
  (the root unit = the Company resource); the view starts at the viewer's HIGHEST visible unit — a
  manager's breadcrumb starts at their own unit, with no company above it. Every count (people, forms,
  plans, results) is over subjects placed in a visible unit (BR-KPI-84). A goal name follows goal
  visibility (BR-KPI-08): a PRIVATE goal the viewer may not see keeps its numbers but is "không thuộc
  phạm vi xem", never named — on the dashboard, in T6's result dialog opened from it, and in the
  assistant. "KPI của tôi" reads `result.view` / Self only.
- **BR-KPI-84 — Stored figures, official counts.** A result's score, rating and % lương KPI are shown
  AS STORED (never recomputed). A Draft is shown "Tạm tính" and never enters an official count — the
  staff average (Q40), the rating distribution, "Nhân viên có kết quả". A person is placed, per period,
  in the unit of their primary assignment on the period's last day (their last working day when
  earlier — `resultRules.subjectAssignment`, the same as T6's screens and the payroll file; Q43), and
  counts when they worked at least one day of the period and hold an Employee plan of the cycle.
- **BR-KPI-85 — Unit score.** A unit's score is its OWN plan's result (the Company plan for the root,
  the OrgUnit plan below). A unit without a plan (every Khối in the seed) shows "Chưa có kế hoạch" and
  the staff average (Q40); a staff average is never called a unit score, never ranked against one
  (best / worst consider units with their own scored plan only).
- **BR-KPI-86 — Attention (Q41).** "Chỉ tiêu cần chú ý" lists the stored goal lines (`ResultDetail`) of
  the unit's own result below `AT_RISK_ACHIEVEMENT_PCT` = 90 ("Dưới ngưỡng") or without an achievement
  ("Thiếu số liệu"), worst first. "Xếp loại thấp" flags a result in the scale's two lowest bands — an
  Employee Draft never flags. The BSC view groups the same lines by the goal's perspective (unknown →
  "Chưa phân loại") through `scoreRules.weightedScore`: an average achievement and a weight share per
  perspective — never parts of the total score.
- **BR-KPI-87 — Difference and trend (Q42).** "Chênh lệch so với kỳ trước (điểm)" = current − previous
  period of the same type and cycle, rounded once (`roundScore`); missing on either side → none (never
  0); "(tạm tính)" when either side is a Draft. The trend draws the plan's stored score per month, a
  Draft point hollow. An employee never sees a Draft point or a Draft side of a difference (BR-KPI-82).
- **BR-KPI-88 — Operations report.** Per cycle: Employee Goal Plans by status (subjects placed today);
  per period: evaluation forms by status and by current step, completion = Completed / not Cancelled,
  results by status and the rating distribution of official Employee results. "Quá hạn" is T5's own
  test (`formViewRules.stepTiming`) — a form past its current step's deadline, including one frozen by
  AUTO_LOCK — so the dashboard and "Duyệt & đánh giá" always agree. "Xuất báo cáo vận hành (Excel)" writes
  the same sections, one sheet each; disabled with its reason when there is nothing to export. It is a
  report, not the payroll file (BR-KPI-81, `result.export`).
- **BR-KPI-89 — The assistant is a simulation.** "Trợ lý KPI" answers from a `DashboardSnapshot` — the
  figures of the unit in focus and its visible children, in the viewer's scope — and nothing else: it
  never computes (every number it says is a snapshot field, `figureRefs`), never ranks a staff average,
  and answers ~5 intents (unit score, best / worst, change, attention, overdue), refusing the rest by
  listing them. Same snapshot → same words. A snapshot of another tenant, an empty or > 300-character
  question → ERR-KPI-06. Labelled "Giả lập" wherever it speaks; nothing it says feeds a score. A real
  model (out of P1) would get the same snapshot as its only context.


## 12. Pending changes — 22/10/2026 meeting (decided, not yet built)

The business confirmed these in the system design meeting (NoteX, 22/10/2026 — `docs/source-map.md`;
proposal and diagrams: `docs/flows/new-flow.md` §4G). **None is in the prototype yet**: until a change
is built, the rule it names stays authoritative. Building one moves its text into that rule, removes the
*Pending* note there, and deletes the row here. Open points are `ASSUMPTION Q44`–`Q72` (§8). Lanes per `CLAUDE.md`: Workflow = workflow-expert + system-architect; KPI Rules =
hr-performance-expert + qa. Rollout order, design and test cases per item: `docs/plans/KPI_update_plan_2210.md`;
the merge order of the two streams: `docs/plans/KPI_plan_A_kpi.md` §2.

| Code | Change | Replaces / affects | Open points | Lane |
|---|---|---|---|---|
| PEND-03 | **Cascade chain Company → Khối → Phòng → employee**; a superior's KPI can be cascaded to a unit or to a named employee. *Partly built 2026-10-21:* a Company / OrgUnit goal cascades to the nearest planned units below (BR-KPI-07 unit targets). Left: a plan for every Khối whose director receives KPIs, the dashboard's Khối score (Q40), the direct vs Khối manager | BR-KPI-01, 07, 85 | Q40, Q56 | Large (fixtures) |
| PEND-05 | **Cumulative (lũy kế) tracking** of quarter / month figures against the annual plan, on results and dashboards. *Rules built 2026-10-23 (Plan B, B0):* `src/lib/cumulativeRules.ts` — running actual and target by aggregation, on-track and year-progress achievements (`ASSUMPTION Q51`); not wired to any screen yet. Left: a read hook, the "Lũy kế" column on the Goal Plan and Results, the dashboard toggle (Đợt 4); `cumulativeTarget` still reads `calcRules.targetForPeriod` without the cycle's periods, so a month under a quarter-only split takes the annual target there — pass the `SplitContext` (Q67, built 2026-10-23 in A3) | BR-KPI-44, 83…88 | Q51, Q67 | KPI Rules |
| PEND-10 | **Probation evaluation** (thử việc → chính thức) moves into P1 (item 3, after items 1 and 4) | `FORM_TYPES` (`PROBATION_EVAL`, P2 today) | Q53 | Large |
| PEND-12 | **Historical data import** (e.g. 10 years of Excel) by C&B / HR — low priority | — (new) | Q57 | Large |
| PEND-13 | **Role dashboards**: leadership (BSC by company / Khối / unit), manager (direct reports' KPIs, registration status, results), HR (registration forms, overdue forms, results by period); filters by month, quarter and 6 months, with cumulative figures | BR-KPI-83…88 | Q51, Q58 | Medium |
| PEND-14 | **Monthly work (P1 item 4)**: at the start of the month the employee (or manager) lists weighted tasks and the manager approves; at the end both score each task (KQcv, 70%) and discipline (KLcv, 30%), Hsht = 70% × KQcv + 30% × KLcv, below 80 the manager decides Hsnv with a reason; HR records or imports scores. Tracked, not paid (Q52). Plan: `docs/plans/KPI_monthly_work_plan.md` (Plan B). *Scoring rules built 2026-10-23 (B0):* `src/lib/workRules.ts` — task weights (±0.01, cancelled tasks normalised out, Q64), KQcv, Hsht, Hsnv required strictly below the threshold, final score (Q61), the tenant's scoring settings (Q62). *Data built 2026-10-23 (B1, merged at turn 2):* six entities (D10), the `work` gateway group, launch-side creation (a WORK_PLAN / WORK_REVIEW launch names the subject's month plan, created Draft; a review takes one item per live task), the rest of `workRules` — `planSubmitIssues` (a task overlaps the month, Q68), `taskEditBlockers` (before approval: edit at the step that allows EDIT; after: only the manager's cancel with a reason and progress; frozen once the review exists, everything once the result is recorded), `progressIssues` (`Done` = 100%, `NotStarted` = 0%), `linkedGoalIssues` (own Locked plan, same cycle), `reviewSubmitIssues` (0 is a score; Hsnv only in MANAGER / FINAL), `workResultOf` — the Kinh doanh pilot seed, hooks. After the pre-merge review: a delegate of the manager (a WORK_PLAN delegation) or HR as proxy cancels and tracks FOR the manager, both named (BR-KPI-21); a cancelled task is never removed; a review launches only for a Locked plan with a live task (Q69); a monthly workflow needs ≥ 2 steps, the employee's among them, and never ends on the employee's step; `listWorkTasksOfPlans` reads a team's month in one call. *WORK_PLAN built 2026-10-23 (B2, merged at turn 4):* the form moves its plan (Draft → Submitted / Returned → Locked; AUTO_FORWARD → Submitted; cancel → Draft, tasks kept); `canSubmit` WORK_PLAN = `planSubmitIssues` from the employee's step on, at SUBMIT and APPROVE alike; `copyFromPreviousMonth` (append; skip done, cancelled, already listed), the last live task cannot be cancelled (`LAST_LIVE_TASK` — a month with nothing to score is a dead end), `weightedProgress`, `followProgress` (status ↔ %); `/my/work`, `/team/work`, `/team/work/:workPlanId`, the WORK_PLAN form body. *WORK_REVIEW built 2026-10-23 (B3, merged at turn 6 — BR-KPI-91…93):* the review moves; `syncWorkReview` after every move — entering MANAGER fills the manager's empty cells from SELF, a RETURN to the employee clears the manager's untouched copies, entering FINAL copies MANAGER (Q71); `canSubmit` WORK_REVIEW = `reviewSubmitIssues` of the step's column + at FINAL `workFinalOverrideIssues`; completion records ONE `WorkResult` from FINAL (`workResultOf`, server rows; a null final score is refused); no reopen (Q72); the review body (tasks with effective weights, KLcv, KQcv / KLcv / Hsht per column shown to 2 decimals never rounded up across the threshold — `displayWorkScore`, Hsnv + giải trình only below it, "KPI tháng (tham khảo)" from `workKpiRules.monthKpiReference`, not scored). An HR step set to approve itself (PEND-02) still copies MANAGER and records once. Left: `PERIOD_START` and score import (8.4), dashboard (8.5) | `Q10`; BR-KPI-19, 22, 91…93 | Q59–Q66, Q68–Q72 | Large (new module) |

**Scope (plan level).** Phase 1 = item 1 (quarterly and annual KPI assignment and evaluation), item 4
(monthly continuous evaluation and the dashboard), item 3 (probation evaluation); build 1 and 4 first.
Phase 2 = 360 review, Bell Curve, training and development (OD), competency. Pilot at two companies at
once, then the other member companies. Setup order: org structure → KPI library → cycle.
