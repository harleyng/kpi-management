# Decisions log — Syntra KPI

> **History, not current truth.** Newest first. Grep it for the reasoning behind a past decision; the
> rule files (`business-rules.md`, `architecture.md`, …) say what is true now. Add entries with
> `/log-decision`.

---

## 2026-10-23 — Plan B, B1 pre-merge review: closing the dead ends before the contract freezes

**Decision.** system-architect's pre-merge review (approve with changes) and workflow-expert's B2 review found
two months that could never finish and a few gaps, fixed in B1 because the contract and seed freeze at merge:
- A **review launches only for a Locked plan with at least one live task** (`resolveRecipients`,
  `NO_APPROVED_PLAN` / new `NO_WORK_TASKS`, `ASSUMPTION Q69`). Once a review exists the list is frozen, so a
  review on an unapproved or empty plan was a dead end (only HR's cancel left). This replaces plan §7's
  "the manager approves quickly on the form". The seed's E018 March review is gone; her April plan is now the
  seed's Draft plan, launched on its own on 04-05 like her registration.
- **Monthly workflows**: ≥ 2 steps, the employee's among them, never ending on the employee's step
  (`validateWorkflow` `SELF_LAST_STEP`) — otherwise an employee could lock their own plan.
- **Acting for the manager** on an approved plan: a WORK_PLAN delegate of the manager, or HR with `form.proxy`,
  cancels and tracks; the write names the manager as the person acted for (BR-KPI-21).
- A cancelled task is never removed (`TASK_CANCELLED` for REMOVE); progress status agrees with the %
  (`Done` = 100, `NotStarted` = 0, `STATUS_MISMATCH`); one patch per review item.
- `schema.ts`: task status / visibility in their sets, `cancelledBy` / `cancelReason` with `cancelledAt`,
  `approvedBy` needs `approvedAt` (a system approval may leave `approvedBy` empty), no `goalPlanId` on a
  monthly form.
- `work.listWorkTasksOfPlans` — a team's month in one read (no N+1 on `/team/work`).
- Seed: E016's April plan sent 04-04 (inside step 1's SLA); Demo Co's February plan Locked (what the
  isolation tests review). Freeze re-taken (`2027-04-06.A1.B1`).

Deferred with a note: the score import contract and `PERIOD_START` (8.4); a private task is stored, not
enforced on reads (reads are tenant-wide until Phase 5 RLS — B2 decides the screen behaviour).

**Why.** A month that can be launched but never closed is a silent failure the prototype must not teach HR.
Fixing it after merge would be a second Large change on the shared seed.

**Updated alongside.** `business-rules.md` §8 (Q69), §12 (PEND-14); `src/data/fixtures/README.md`;
`KPI_plan_B_monthly_work.md` §3.

---

## 2026-10-23 — Plan B, B1: monthly work data layer; forms do not move until 8.2 / 8.3

**Decision.** Six entities in a new group G8 (D10 — D9 is A1's; the ERD file untouched): `WorkPlan` (status = the Goal Plan
set without `Approved`, `WORK_PLAN_STATUSES`), `WorkTask` (visibility reuses the Goal visibility set rather than
a twin `TASK_VISIBILITIES`), `WorkReview` (Hsnv only in MANAGER / FINAL), `WorkReviewItem`, `WorkResult` (a
snapshot with **no status** — no row = "tạm tính"), `WorkScoringConfig` (one per tenant; the read returns
`null` when none and the hook applies `DEFAULT_WORK_SCORING` — no sentinel row). `FormInstance.workPlanId`;
form types WORK_PLAN / WORK_REVIEW. A new `work` gateway group edits content; a launch creates the month's plan
(Draft) and, for a review, the review row and one item per live task. Moving the forms stays with 8.2 / 8.3:
`checkAction` refuses WORK_* with `WORK_FORM_NOT_BUILT` (HR's CANCEL passes), `formStanding` offers no move,
`canSubmit` answers the same. Task edits (`taskEditBlockers`): before approval at the step that allows EDIT;
after it only the manager's cancel with a reason and progress — **no ADD after approval** (not in CMC);
frozen once the review exists (its items were taken), everything frozen once the result is recorded. A task
must overlap its month, not lie inside it (`ASSUMPTION Q68`). `PERIOD_START` waits for 8.4 (a trigger the
scheduler ignored would be a silent failure). Seed: the Kinh doanh pilot across T02–T04; the freeze re-taken
(`2027-04-06.B1`, 55 entities, 12 `work.*` methods); the seed size budget 1.5 M → 1.6 M characters.
system-architect and hr-performance-expert: approved with changes, all applied.

**Why.** The plan puts data before forms; refusing what is not wired is louder than a form that moves while
its plan and result stay behind. Cross-row checks in `schema.ts` (review ↔ form ↔ plan ↔ employee / period)
stand in for the database's foreign keys and RLS.

**Updated alongside.** `business-rules.md` §5, §8 (Q68), §12 (PEND-14); `architecture.md` (data layer, freeze,
D10); `component-registry.md`; `src/data/fixtures/README.md`; `KPI_plan_B_monthly_work.md` §3.

---
## 2026-10-23 — PEND-11: FORMULA is hidden from new picks, never deleted

**Decision.** `libraryRules.RETIRED_METHOD_TYPES = ['FORMULA']`; `pickableMethodTypes` / `pickableMethods` filter
the method-type picker (`CalcMethodSheet`), the goal and KPI method pickers (`GoalEditorPanel`,
`KpiDefinitionSheet`) and a method code typed in a Goal Plan import row (06 `CODE_UNKNOWN`). A stored FORMULA
method, goal or KPI keeps its own value on screen and keeps computing (`calcRules` untouched). `ASSUMPTION Q55`.

**Why.** No source (PMGM guides, DATX) lists a FORMULA method; the meeting's "five methods" map to the other five.
Deleting it would break any goal already on it — the same reason archiving a library item only hides it (BR-KPI-78).
The import row was the one path left that could still make a new FORMULA goal.

**Updated alongside.** `business-rules.md` BR-KPI-30, §8 Q55, §12 (PEND-11 row removed); `new-flow.md` §5 table;
plan tables.

## 2026-10-23 — Plan A, A1: the system computes the self %, the employee enters the actual, HR records the manager's result

**Decision.** PEND-06/07/08 built on `ASSUMPTION Q47–Q49` (BR-KPI-16, 17, 23, 52). The SELF column is the
system's % (`formRules.computedItemPct`) on the actual entered on the form and the period's target snapshot; a typed
self % is 04 `SYSTEM_COLUMN`. The manager's % starts at it and follows it until overridden; an override or a
corrected actual needs a comment; FINAL = MANAGER on every entry from another column, an HR change needs a reason.
Step-entry defaults run in one helper (`applyColumnEntry`) from `forms.act` and the scheduler's AUTO_FORWARD. A
completed **Month** form writes each changed actual as a `GoalActual` of the new source FORM
(`ACTUAL_SOURCE_TYPES`, separate from the data sources' `SOURCE_TYPES`). Forms snapshot the period's target and,
for a quarter, its months' sum (`resultRules.periodActual` / `periodTarget`). KPI_EVAL step 2 no longer requires a
comment on every row.

**Why.** Writing a FORM actual on a quarter form (a proposed Q68) would shadow the months in `actualFor`: a later
monthly correction or import would never reach the quarter again — so Q36 stays and a quarter's figure stays on the
form. Comparing the form's actual with the CURRENT actual (instead of its snapshot) would make an untouched form
revert an HR correction made after launch. A SUM quarter scored against the annual target gives 20% for a quarter
on plan, so `periodTarget` returns `null` (not computable) rather than borrow it. A required comment on every
manager row contradicted "comment only when the manager differs" (Q49).

**Consequence.** Seed results moved (FINAL now = the manager's, mostly the system's %): the story's adjustments
became E023 +2 (88.97 C → 90.97 B) and E040 −2 (100.30 A → 98.30 B); the seed size budget went 1.5 M → 1.6 M;
`SEED_VERSION` 2027-04-06.A1 and a new freeze hash. Plan B must rebase: `EvaluationItem` gained six fields and
`GoalActual.sourceType` is `ActualSourceType`. Left for A3: `resultRules.actualLines` still borrows the annual
target for a quarter with no split, and Q67 (a month under a quarter-only split).

**Updated alongside.** `business-rules.md` BR-KPI-16, 17, 23, 52, §8 Q33/Q47–Q49, §12 (PEND-06/07/08 removed,
PEND-04 narrowed); `architecture.md` ERD deviation D9 and `SEED_VERSION`; `docs/flows/new-flow.md` §4 and §4G;
plan tables (`KPI_plan_A_kpi.md` A1 ✅, `KPI_update_plan_2210.md` §4, §6).

## 2026-10-23 — Plan B, B0: monthly work scoring and cumulative tracking as pure rules, ahead of their entities

**Decision.** `src/lib/workRules.ts` (PEND-14) and `src/lib/cumulativeRules.ts` (PEND-05) land before any
entity, hook or screen, reading structural types so they merge at any turn of the shared order. Q61–Q66 run on
their proposals. Three choices differ from a literal reading of the plan: `finalWorkScore` is **not**
`hsnv ?? hsht` — a Hsnv is used only while Hsht is below the threshold (a stale one is ignored) and a required
Hsnv not yet set gives `null`; a cumulative SUM target is never prorated (month splits, else quarter / half
splits that tile the window, else the annual target for the whole cycle only, else `null`); a cumulative figure
with a month missing is computed from the months that have data and every achievement on it is `provisional`,
unlike `aggregatePeriodActuals`, which stays `null` on a gap. KQcv uses weights normalised after a cancelled task
(Q64); Hsnv is required strictly below the threshold, compared with a 1e-9 tolerance. hr-performance-expert:
approved with changes (provisional flag, boundary tests), applied.

**Why.** The formulas are the part that must be right before anyone trusts the screens, and they depend on
nothing that is still moving in Plan A. Not fabricating numbers (no proration, no 0 for a missing month, no Hsnv
that no longer applies) follows BR-KPI-32.

**Updated alongside.** `business-rules.md` §8 (Q51, Q61–Q66), §12 (PEND-05, 14); `new-flow.md` §4G
(Quy trình 4, lũy kế), §5, §6; `source-map.md` (PMGM.08–09, HR / Manager / Employee guide pages);
`component-registry.md`; `KPI_plan_B_monthly_work.md` §3.

---

## 2026-10-23 — Đợt 0: open questions run on their proposals; PEND-04 is half built; FORMULA is the extra method

**Decision.** No answer came back for Q2 and Q44–Q60, so each change builds on the proposal in
`business-rules.md` §8 and cites `ASSUMPTION Qn`; Q53 and Q57 got concrete proposals; Q67 is new (a month's
target when a goal is split by quarter only). PEND-04 was checked in code: the split, `SPLIT_MISMATCH` /
`SPLIT_INCOMPLETE` and Company / OrgUnit quarter results work; a quarterly KPI_EVAL form still shows the annual
target and a month under a quarter-only split takes the annual target. PEND-11: no source lists five methods;
mapped onto the sources, FORMULA is the one without a counterpart and no seed uses it — hide it from the picker.

**Why.** Waiting for HR would stall both plans; proposals are easy to reverse. Verifying before building
PEND-04 turned "probably done" into a short, concrete fix list.

**Updated alongside.** `business-rules.md` §8 (Q10, Q53, Q55, Q57, Q59, Q60, Q67), §12 (PEND-04, 11, 14);
`new-flow.md` §6; `KPI_repo_plan.md` §1, §9; `KPI_update_plan_2210.md` §6, §8; `KPI_plan_A_kpi.md` §3.

---

## 2026-10-22 — The 22/10 meeting's decisions are recorded as pending changes, not as current rules

**Decision.** (product owner) The system design / Phase 1 scope meeting (NoteX, 22/10/2026) is
recorded in `business-rules.md` §12 as **PEND-01…13**, with its open points as `ASSUMPTION Q44`–`Q58`
(§8). The headline changes: top-down and bottom-up registration in parallel; record-and-lock by HR,
automatic or manual by configuration; the employee enters the actual and the system computes the %; the
manager decides the result and HR only records it; annual targets split into quarters, tracked
cumulatively; formal evaluation quarterly and annual, monthly continuous; probation evaluation in P1;
manual data only; role dashboards. Each affected BR carries a *Pending* note; the rules themselves are
unchanged.

**Why.** `business-rules.md` is what the code enforces and what agents read as truth. Rewriting
BR-KPI-12/16/17 now would describe a prototype that does not exist: a QA test written from the new text
would fail against the screens, and the demo would contradict the docs. Several points also conflict
with each other or with the seed (the minutes' quarter example sums to 17.5 tỷ against a 15 tỷ year,
Q50; a Khối with KPIs vs Q40's "Khối has no plan"), so they need answers before they become rules.

**Consequence.** Building a PEND item = move its text into the BR it names, drop the note and the §12
row, and answer its Qs. PEND-03, 10 and 12 touch fixtures or add a form type — Large. Two items were already partly built on 2026-10-21 and are marked so: PEND-03 (cascade to the
nearest planned units) and PEND-11 (actuals by hand and Excel; the product owner kept Excel, which
resolves Q54).

**Updated alongside.** `business-rules.md` (header, *Pending* notes on BR-KPI-07, 11, 12, 16, 17, 22,
§8 Q2/Q3/Q33/Q40 + Q44–Q58, new §12); `docs/flows/new-flow.md` (§4G, §5 change table, §6 questions,
§7 entry); `docs/source-map.md` (the meeting as a source, its section map).

---

## 2026-10-21 — Phase 1 records actuals by hand and by Excel import only; the API sync is a later phase

**Decision.** (product owner) P1 has no API and no integration with other systems: actuals come from manual
entry and Excel import. "Đồng bộ API" and "Kết nối API" stay in the prototype on simulated data, tagged
"Phase sau" in the sidebar (`NavChild.laterPhase`) and by a notice at the top of each page
(`LaterPhaseNotice`, also on the two detail pages). No rule or data change.

**Why.** The guide and the video presented the ERP sync as part of the monthly P1 routine ("ngày 1, 06:00 ERP
Sale đẩy số"); readers would plan the rollout around an integration that is not in scope. Keeping the screens
(rather than hiding them) lets the product owner still show the later flow.

**Updated alongside.** `business-rules.md` BR-KPI-55, 56; `docs/flows/new-flow.md` §1, §4, §4E, §7;
`docs/plans/KPI_repo_plan.md` §1 and WBS 4.4.4–4.4.5.

**Follow-up (same day).** Choosing a KPI's data source stays in P1 — BR-KPI-05 requires it — but it read as
setting up an integration. The library form shows a yellow warning notice under the field ("Phase 1: nguồn dữ liệu
không phải kết nối" — the source is the report or system the number comes from; P1 numbers are entered by
hand or by Excel). The product owner asked for a banner rather than a field hint. BR-KPI-05 says the same.

---

## 2026-10-21 — "Thêm từ bộ mẫu": a KPI template is applied to a Goal Plan, append-only

**Decision.** (product owner asked for it) The plan page gets "Thêm từ bộ mẫu" beside "Thêm chỉ tiêu", for
whoever may edit the plan now. Active templates only, suggested by position → unit (and units above) →
general (`templateApplyRules.templatesForPlan`); each item becomes a goal from its library KPI with the
item's default weight and target (`templateApplication`); items already in the plan, no longer Active, or
without a default data source are skipped with the reason. Saved one `saveGoal` at a time
(`useApplyTemplate`). No contract change. Applying a template automatically at a registration launch is
deferred.

**Why.** `new-flow.md` §1A already promised "chọn chỉ tiêu hoặc áp bộ mẫu", but goals could only be added one
by one. Append-only because a plan at step 2 already holds what the manager cascaded at step 1 — replacing
would silently drop those goals and their alignments. A KPI without a default data source is skipped,
not saved: the gateway does not check `dataSourceId` on save, so the goal would only fail later at Gửi
(BR-KPI-05). "Already in the plan" reads the plan's goals unfiltered: the screen's list hides PRIVATE goals
from some viewers, and a hidden goal must not be added twice.

**Updated alongside.** `business-rules.md` BR-KPI-77; `docs/flows/new-flow.md` §1A and §7;
`component-registry.md`.

---

## 2026-10-21 — The company → department tier gets its two screens: start a unit registration, cascade to unit plans

**Decision.** (product owner, phase 2 approved) HR starts a Company / OrgUnit plan's registration from
"Bắt đầu đăng ký" on the cycle's Goal Plan list (`StartRegistrationButton`, pre-checked with
`canStartForm`; the dialog shows who acts at each step now via `workflowRules.registrationRoute`; default
due date = today + Σ step SLAs, `defaultStartDueDays`). From a Company / OrgUnit plan, "Phân giao" also
offers the OrgUnit plans of the NEAREST planned units below (`planAccessRules.cascadeTargetPlans`); the child
goal belongs to the unit head. `usePlansEditability` now decides unit plans too. The bucket column
"Phân bổ nhân viên" and the preview's "Đã giao NV" are both "Đã giao". No contract, fixture or rule change.

**Why.** Without them the role guide could not walk company → department at all. "Nearest" rather than
"every unit below": cascading the company straight to a department under a planned Khối would skip a level
and the Khối's "chưa giao" would never see it. A default due date of 7 days is shorter than the template's
3+3+3+2 = 11 days of SLAs, and `stepDeadline` takes the earlier of the two, so steps 3–4 would be due almost
at once. `usePlansEditability` read forms by `plan.ownerEmployeeId` (null for unit plans), so every unit plan
was UNKNOWN — the list's "Phiếu đăng ký" column was empty and the lock dialog thought no form was open;
reading by the unit head instead would miss a form started for a previous head, so with a unit plan present
it reads every GOAL_SETTING form and matches by plan, as the gateway does.

**Consequence.** Who writes into a department plan is unchanged: no form → head or HR; a form open → the
step's actor or HR as proxy (recorded for that actor). The division director receives the form first (step
1), the head at step 2; the CEO can never write into a department plan, and a director cannot cascade from
the Company plan (the action needs ownership of the parent plan or `goalplan.lock`). The guide's order is:
company plan → department plans → HR cascades → start registration. A Company plan's steps 1 and 3 have no
actor (HR proxies; step 1 auto-locks unseen if left), so the dialog warns.

**Updated alongside.** `business-rules.md` BR-KPI-07 (unit targets, "assigned" wording) and BR-KPI-19 (the
screen, default due date, routing); `docs/flows/new-flow.md` §2 and §7; `component-registry.md`.

---

## 2026-10-20 — "Chu kỳ" split into Kỳ đánh giá / Đợt đánh giá / Goal Plan

**Decision.** (product owner) "Chu kỳ" is an area with three sub-pages: **Kỳ đánh giá**
(`/admin/cycles/list` — the cycle list; a cycle opens at `/list/:cycleId` with its status step, edit and
the two facets), **Đợt đánh giá** (`/admin/cycles/periods` — the periods of the cycle picked in `?cycle=`)
and **Goal Plan** (`/admin/cycles/plans` — that cycle's plans). A plan opens at
`/admin/cycles/plans/:cycleId/:planId`: the cycle stays a path segment so BR-KPI-90's "a plan of the
route's cycle" check is unchanged. `?cycle=` is carried between the three; `/admin/cycles` and the old
`?cycle=&plan=` links redirect. The menu labels are the product owner's words; the domain terms in
`business-rules.md` (Chu kỳ = cycle, kỳ = period) and the period labels elsewhere ("Kỳ đánh giá" pickers
on launches, forms, reviews) are not renamed yet.

**Why.** HR works periods and plans of one cycle day to day; the cycle record itself is opened rarely.

**Updated alongside.** `architecture.md` (route table), `component-registry.md`, `navConfig.ts`, `navRules.ts`.

---

## 2026-10-19 — Sub-pages instead of tabs; a record's detail is its own route; the list toolbar above the card

**Decision.** (product owner) Every page that bundled views as tabs is an AREA in the menu with one
sub-page per former tab, each its own route (11 areas: Việc cần xử lý, KPI đội nhóm, Dashboard, Thư
viện KPI — Danh mục split into Viễn cảnh BSC and Đơn vị đo —, Khởi chạy phiếu, Số liệu & import, Kết
quả & lương, Tổ chức, Người dùng & quyền, Nguồn dữ liệu). A list never shows a record's detail below,
beside or in place of itself: cycles, Goal Plans, goals (the workspace's inline `?goal=&mode=` panels),
templates, workflows, import batches, API connections and org units open on their own routes; KGI,
period generation and catalogue rows edit in dialogs. A list's search/filters and primary action sit in
a row above the table card. Renamed sub-items that repeated their area: Chờ tôi xử lý, KPI nhân viên,
Lịch tự động, Phiếu đã tạo, Quy trình duyệt, Kết quả theo kỳ. "Quy trình duyệt" needs `cycle.manage`
(was a tab only cycle managers saw; a custom role with `form.launch` alone no longer sees it). Old
links (`?tab=`, `?plan=`, `?batch=`, `?bo=`, `?cycle=`, `?unit=`, a parent url) redirect after the route
guard (`navRules.legacyRedirect`). The app moved to the data router for `useBlocker`.

**Why.** Tabs hid destinations from the menu and stacked a second navigation inside the page; a detail
under or beside its list mixed two scopes on one screen and could not be linked cleanly. Plan routes
exposed that `getGoalPlan` checks only the tenant, so plan pages check `planRouteAllows`.

**Updated alongside.** `architecture.md` (route table, page chrome), `design-system.md` (sidebar areas,
no tabs for pages, detail pages, list toolbar), `common-pitfalls.md`, `/new-page` skill, `navConfig.ts`.

---

## 2026-10-19 — Visual refresh: dark purple sidebar, grey canvas, shadowed cards, five-colour badges

**Decision.** The sidebar sits on dark purple (`--sidebar-*`); the main area on a light grey `--canvas`
with borderless, shadowed white cards; tables keep very light `--divider` row lines under a light grey
header. These are global rules in `index.css`, not edits to `components/ui`. Badges now use five colours
with one meaning each: blue waiting · green in effect or succeeded · yellow needs action · red error ·
grey cancelled/ended/draft. This **replaces** the Phase 1.4 "a badge marks the exception" rule — an
in-effect state (Active goal, Locked plan, Active cycle) is now green rather than grey.

**Why.** Product owner's direction: the frame should read apart from the body, and a badge's colour
should tell the state at a glance.

**Updated alongside.** `design-system.md` (layout patterns, status → tone tables, badge), `statusTones.ts`
and its test, `architecture.md` / `CLAUDE.md` UI line.

---

## 2026-10-19 — Phase 3: one scoped drill-down, stored figures only, an assistant that only phrases a snapshot

**Decision.** (product owner: tracks merged first; Q40–Q43 defaults; a thin deterministic assistant)
`/dashboard` is ONE drill-down ("Tổng quan") rooted at the viewer's highest `dashboard.view` unit — the
manager dashboard is the same screen scoped to their unit — plus "Vận hành"; the employee's view is
"KPI của tôi" on `/my/results`. Stored results are shown as stored; a Draft is "Tạm tính" and never in an
official count. A Khối shows "Chưa có kế hoạch" + an unweighted official staff average (Q40), never
ranked against plan scores. Attention: goal < 90%, result in the scale's two lowest bands (Q41). Δ vs the
previous period of the same type, rounded once (Q42). People are placed per period by
`subjectAssignment` (Q43) and the scope is checked per UNIT, not via `coverage.employeeIds` (which is
"as of today" and drops leavers). "Quá hạn" = T5's `stepTiming`. The `InsightGateway` takes a
scope-filtered `DashboardSnapshot` and phrases it; its keys carry the snapshot digest. No contract or
fixture change.

**Why.** A Khối average presented as a "unit score" would rank people-averages against plan scores (cto /
hr-performance-expert). Re-deriving a score on screen could disagree with T6's screens and the payroll
file — the dashboard and the gate test read the stored rows. A person checked through today's employee
coverage vanishes from every past month once they resign (system-architect). An assistant fed raw reads
could cite a PRIVATE goal or another unit the viewer cannot see; fed only the snapshot, it cannot.
T6's `useResultBreakdown` named every goal (fine for HR and the person); from the dashboard a manager or
BOD would have seen PRIVATE goal names — it now takes `{ plan }` for visibility mode.

**Consequence.** `src/lib/dashboardRules.ts` is the only place a dashboard number is derived; the seed gate
(`mock/dashboard.seed.test.ts`) pins T02 company 106.07 Draft, departments' stored scores, Khối staff
averages, T03 forms 20/6/1, plans 23/1/1/1/2, the T02 rating distribution A 3 · B 12 · C 2, E021 / E024
/ E018 placement, the manager's scope and Demo Co isolation. The "Quá hạn" count includes a form frozen
by AUTO_LOCK (E027), as T5's lists do — change both together if HR wants frozen forms apart.

**Updated alongside.** `business-rules.md` §5 (derived flags), §8 (Q40–Q43), new §11 (BR-KPI-83…89);
`docs/flows/new-flow.md` §1, new §4F, §6, §7; `architecture.md` (route table, `InsightGateway`, "Dashboard
data", phases); `component-registry.md`; `docs/source-map.md`.

## 2026-10-19 — Phase 2 integration: tracks merged T1→T2→T7→T3→T4→T5→T6, ids renumbered, duplicate hooks folded

**Decision.** All seven tracks are on `main` (each merge passed the Phase 4 gate; Playwright smoke green
at the end). Before merging, each track's own ids were renumbered on its branch so they stay unique: T1
Q19–24 · BR-KPI-65…73 · ERR-KPI-14…16 (unchanged) · T2 Q25–28, BR-KPI-74…80 · T7 Q29–30 · T3 Q31–32 ·
T4 Q33–37 · T6 Q38–39. New-flow sections: 4C T1 org, 4D T7 notifications, 4E T4 actuals. Duplicated hooks
were folded, one owner per read: `useDataSources` → `actuals.ts`; `useWorkflows` / `useWorkflowSteps` →
`forms.ts` (T7's `workflows.ts` deleted); `useFormList` (T3) joins T5's `forms.ts`; `useAllPeriods` (T5)
joins T3's `goals.ts`; `useAttachEvidence` (T5) joins T4's `actuals.ts`; `useDownloadFile` (T6) and
`useAuditEntries` (T3) join T7's `system.ts`; `toastError` lives only in `components/shared/toastError.ts`.
Form bodies (T5) and the result detail / finalise check (T6) read their own plan with `useGoalRows`; the
actuals screens (T4) read `useGoals` (visibility, D2).

**Why.** Every track started its open questions at Q19 off the same base, so a merged `business-rules.md`
had two Q19s meaning different things — and code comments citing `ASSUMPTION Q20` would have pointed at
the wrong one. T3's `useAuditEntries` and T7's paged `useAuditLog` shared `auditLogKey`: one cache entry
would have held an array under one hook and `{ pages }` under the other — it now has its own `'all'`
segment (same for `formListKey`). T3's `useGoals` returns `{ goals, hiddenCount }`, which T4/T5/T6 called
as an array.

**Consequence.** Follow-ups not done at the merge: one `toastWriteError` / `toastError` helper (four
remain: `org.ts`, `writeFeedback.ts`, `toasts.ts`, `notify.ts`); one exceljs loader (four modules load it
lazily — `excel.test.ts` allow-lists them); one `useOpenFile` (T4's mutation and T7's callback); T1's org
import and T2's library import onto T4's framework. Phase 3 numbers its assumptions from Q40 and rules
from BR-KPI-83. (Found after the merge: T6 and T7 had BOTH defined BR-KPI-45/46 in a gap below the
base maximum; T6's payroll export and employee-visibility rules are now BR-KPI-81 / 82.)

**Updated alongside.** `component-registry.md` (hooks table), `architecture.md` (route table, smoke
`BUILT` set, deferrals: none), `business-rules.md` §8 (Q19–Q39 in order), `docs/flows/new-flow.md` §4C–4E.

## 2026-10-19 — T1: org and access guards are transition-based rules shared by screen and gateway, run after the structural check

**Decision.** The org rules (BR-KPI-65…73) live in `src/lib/orgAdminRules.ts` and `accessAdminRules.ts`,
compare the draft with the stored row and fire only on the change they are about. The mock runs them in
`groups/orgTx.ts` AFTER `validateTransaction` on the written state; screens run the same functions as a
pre-check, only on complete lists (`useOrgDirectory`). Behaviours inside the existing methods: B1 transfer
(new primary from D ends the running one on D − 1), B2 a new employee account gets EMPLOYEE / Self and
`employeeId` is immutable, B3 recording a last working day ends the assignments past it, and
`setRolePermissions` writes the diff. ERR-KPI-14/15/16 are T1's; other tracks number from 17.

**Why.** A rule checked against the whole row would make seeded edge cases (E040's manager hired after
him, an Inactive unit with history) uneditable forever — renaming them would fail. Rules before the
structural check would read a foreign id first and could answer differently from a missing one, and
would turn the Gate 1 answers ("duplicate", "one root", "below itself") into rule sub-codes. A transfer
as two writes (end, then add) leaves a gap — or two primaries — when the second fails. B3 was added
during implementation: without it a resignation needs three writes, or leaves an assignment running
after the last working day.

**Consequence.** T4's `commitImport` must call the `orgTx` helpers (employees → assignments → accounts),
never `upsert` org rows itself. `fixtures/orgGuards.test.ts` fails if a seed change would make a row
uneditable.

**Updated alongside.** `business-rules.md` §0, §6, §8 (Q19–Q24), §10, BR-KPI-20 note; `architecture.md`
(mock table, "T1 guards"); `component-registry.md`; `docs/flows/new-flow.md` §4C and §7.

## 2026-10-19 — T1 scope: current company only, editable matrix, import split with T4, resignation locks the login first

**Decision.** (product owner) Tenant management edits the current company's name, code and zone; no
creating or suspending, and a company can never suspend itself. The role → permission matrix is
editable per role, confirmed with the exact additions and removals; ADMIN always keeps `org.manage` /
`user.manage`, and nobody can remove the last company-wide ADMIN or their own `user.manage`. WBS 4.1.7:
T1 ships the template and the row rules, T4 wires staging and commit. A manager outside the unit line is
allowed with a warning. "Cho nghỉ việc" sets the accounts Inactive BEFORE recording the resignation.
`SCOPE_TYPE_LABEL.OrgUnit` is "Theo đơn vị".

**Why.** `saveTenant` only edits the actor's home tenant and a new tenant has no roles, accounts or root —
nobody could ever sign in; suspending your own company hides it from the switcher with no way back. An
admin unticking `user.manage` on their own role, or deactivating the last ADMIN, would strand the demo
with only a reseed to recover. Moving the shared import framework into T1 would hold up the first merge
for six tracks. Resign-then-lock, on a failed second write, leaves someone who has left with a live
login. "Đơn vị" alone read like "Đơn vị tính" on T2's screens.

**Updated alongside.** `business-rules.md` §0, §8 (Q21, Q24), §10 (BR-KPI-71…73); `docs/flows/new-flow.md` §7.
## 2026-10-19 — Track T2: library write rules, export now, import on T4's framework

**Decision.** The KPI library (WBS 4.2.1–4.2.4) enforces BR-KPI-74…80 through `src/lib/libraryRules.ts`,
called inside each `library.save*` of the mock — no contract or fixture change. Product-owner choices:
1. **Export now, import later**: "Xuất Excel" (library, templates, code lists) ships; Library import waits
   for T4's shared framework (4.4.3) and the `LibraryImportRow` columns it needs (a contract change then);
2. **Templates warn, they do not block**: weight total ≠ 100% and item count outside 5–8 are warnings
   (`ASSUMPTION Q26`); only ADDING a Draft/Archived KPI is refused;
3. **A method used by any goal keeps its scoring fields** (type, cap, floor, formula, tiers): a goal reads
   its method live, so an edit would re-score open periods; create a new method instead;
4. standard (`isSystem`) items are editable except their code (`Q28`) — every seed KPI is standard;
5. archiving a KPI is refused only while an Active template holds it (`Q27`); goals keep working.
Hook placement: `useDataSources` (G4) lives in `hooks/queries/library.ts` until T4 moves it (cto suggested
`actuals.ts`, system-architect `library.ts` — picked the one that cannot add/add-conflict with T4).

**Why.** The seed predates the rules (HCNS's Active template holds Draft KPIs; Demo Co's templates total
50% / 40%); strict template rules would have forced a Large fixture change. Locking a used method keeps
finalised and draft scores from drifting silently (hr-performance-expert confirmed `resultRules` reads
`Goal.calcMethodId` live). A one-off Library importer would be thrown away when T4 lands.

**Updated alongside.** `business-rules.md` (§0, BR-KPI-03, new §3b, §5, §8 Q25–Q28), `docs/flows/new-flow.md`
(§1A, §5 row 8, §6, §7), `docs/source-map.md`, `architecture.md` (routes, mock table, phases),
`component-registry.md`, fixtures README.

---
## 2026-10-19 — T7: notifications come from one adapter-agnostic listener; nobody is told about their own action

**Decision.** `src/integrations/data/notificationListener.ts` turns `form.launched`, `form.stepActed`,
`form.dueSoon` and a form created by hand / re-entering its step (HR unlock) into in-app notices,
reading only through the `DataGateway` contract and writing `system.recordNotification`. Who is told
what is BR-KPI-45: subjects get FORM_LAUNCHED, the people now holding a form get STEP_ASSIGNED /
RETURNED / DEADLINE_REMIND; delegates are told alongside their delegator; neither the actor nor the
person they acted for is ever told. The mock registers it once (`rt.bus.subscribeAll`); the shared test
gateway turns it off unless asked (`notifications: true` + `notificationsSettled()`).

**Why.** Inside the mock it could have read the transaction directly, but then Phase 5 would rewrite it;
built on the contract it moves to a server outbox unchanged. Without "ignore every other event" its own
`Notification` writes would wake it again. Left on in every test, its asynchronous writes would land in
the middle of the many tests that collect every event and assert the exact list. Without the unlock
rule, a frozen employee unlocked by HR heard nothing until the reminder window, days later
(workflow-expert review).

**Consequence.** A failed read loses that notice (reported to the diagnostics, never thrown into the
action) — accepted for the prototype. `dev.resetSeed` bumps a generation so work started on the old
data writes nothing.

**Updated alongside.** `business-rules.md` §4b BR-KPI-45, 46; `architecture.md` "Notifications (T7)";
`docs/flows/new-flow.md` §4D.

## 2026-10-19 — T7: the reminder warns what the scheduler WILL do (`effectiveOverdueBehaviour`)

**Decision.** The fallback "AUTO_FORWARD on the last step, LOCK outside registration → REMIND" moved out
of `overdueActions` into `workflowRules.effectiveOverdueBehaviour`, called by the scheduler, by the
reminder's `{{consequence}}` and by the "Lịch nhắc hạn" table.

**Why.** Reading the step's raw `onOverdue`, a misconfigured step's reminder promised "Goal Plan sẽ bị
khóa" for a lock that never happens — two copies of one rule drifting apart.

**Updated alongside.** `business-rules.md` BR-KPI-45; `component-registry.md` (workflowRules).

## 2026-10-19 — T7 assumptions: no overdue notice (Q29), 10 MB attachments (Q30), audit log stays ADMIN-only

**Decision.** (Q29) No notice when a step goes overdue — `NOTIFICATION_EVENTS` has no such code; the
deadline reminder already says what will happen and an auto-forward tells the next person. (Q30) An
attachment is ≤ 10 MB and one of PDF, images, Word, Excel, CSV, text — enforced in the upload button
and in `system.uploadFile`. Templates naming a variable their event does not supply are refused in
`saveNotificationTemplate` (`templateIssues`). The audit log keeps `audit.view` (ADMIN) — flagged to
the product owner, not changed.

**Why.** Reusing DEADLINE_REMIND after the deadline would read "Sắp đến hạn" for something already late;
adding a code is a frozen-set + fixture change (Large). An unvalidated template variable renders empty
in every notice without anyone noticing. Opening the audit log to HR changes the permission matrix
(Large) — a product decision, not a track's.

**Updated alongside.** `business-rules.md` §4b BR-KPI-47…49 and §8 Q29, Q30; `new-flow.md` §6, §7.

## 2026-10-19 — T7: keyset lists page with "Tải thêm"; a built route names its table in the smoke spec

**Decision.** `listNotifications` / `listAuditLog` return keyset `Page<T>` with no total, so their
screens use `useInfiniteQuery` + `flattenPages` + `LoadMoreFooter`, not `DataTable`'s `serverPage`
(which needs a total). `ENTITY_NAME_LABEL` was added beside `ENTITY_NAMES`. In
`e2e/specs/smoke.spec.ts` a built route gives the name of a table it shows instead of expecting
"Chưa xây dựng".

**Why.** Page numbers over a keyset cursor would need a total the contract does not have (a Large
change); a refetch while rows arrive can put one row on two pages, hence the dedupe. The smoke spec
failed as soon as the first placeholder was replaced.

**Updated alongside.** `component-registry.md` (`LoadMoreFooter`, `flattenPages`); `architecture.md`
route table note; `business-rules.md` §5 (entity names).
## 2026-10-19 — Track T3: Goal Plans, cascade, cycles; one shared "may I edit / send" decision

**Decision.** T3 builds `/my/kpi`, `/team/kpi` and `/admin/cycles` with NO contract or fixture change.
Product owner (Phase 1): 4.3.7 ships its pure rules now (`goalPlanImportRules`, BR-KPI-26) and its screen
with T4's framework; "Gửi" lives on the plan page (T3), approve / return stay T5; PRIVATE goals are seen by
the owner, their manager chain and Tenant scopes, enforced on screens (RLS in Phase 5); a period split that
does not fit is a warning only. Design reviews (cto, ui-ux, system-architect, workflow-expert,
hr-performance-expert) added: `planAccessRules.ts` ABOVE goalPlan / workflow rules (avoids an import
cycle) holding the one edit decision the mock guard and the screens share (parity test over the seed);
"Gửi" as a dry run of `checkAction` (the first draft enabled it for a manager at step 3); editability
UNKNOWN (read-only) while any input is missing; a `saveGoal` allocation guard only when target / type /
"tự giao" change; the cascaded child copies the method only when share-safe and never copies levels,
split or weight; a split tolerance relative to the target, `SPLIT_INCOMPLETE` and `SPLIT_NO_AGGREGATION`;
periods generated only for ≤ 12 whole months (`ASSUMPTION Q32`); LINK `contributionPct` informational
(`ASSUMPTION Q31`); detail views as search params; goal edit / split / link inline, dialogs only for lock,
unlock, history and cascade; two-write saves surface partial failure (`PartialGoalSaveError`,
`CascadeOrphanError`) and refresh on every outcome.

**Pre-merge review.** QA: parity also checked after a RETURN, an HR lock with the form open, expired
delegations and a Closed cycle. UI/UX critique (31/40, 15/20): amber is carried by icons, never by text
(contrast); the goal name column is sticky beside the D3 buckets. **Exception kept:** "Phân giao" stays a
dialog (operate-craft reserves modals for confirmations) — it is a short write over one parent goal whose
bucket preview sits inside it; revisit if the dialog grows. Open P2s: hook-level tests for the composite
hooks, 768 px table columns, cycle-row selection affordance, toast position.

**Why.** A control the screen enables must be a write the gateway accepts — one function, tested against
the gateway, cannot drift. Quarters and years are built from month splits, so a split warning must be
visible everywhere a plan is listed even though it never blocks.

**Other tracks.** T4: `saveGoal` may now refuse 11 / 06 on a cascaded parent; import `GoalPlanImportDraft`
from `goalPlanImportRules` (don't redeclare), commit with `goalplan.import`, a missing plan is created as
Draft; extend `actuals.ts`. T5: extend `forms.ts` (`useFormList`, `useWorkflowSteps`, `useDelegations`);
use `planAccessRules` for edit / send decisions and `canSeeGoal` on goal names; Gửi is in T3, labelled
"Chuyển cho nhân viên" before the owner's step. T6: use `canSeeGoal`; the `saveGoal` guard. T7: T3 added
`useAuditEntries` to `system.ts`. Phase 5: replace the cascade's two writes with one `cascadeGoal`
transaction; enforce D2 in RLS.

**Updated alongside.** `business-rules.md` (header, BR-KPI-05, 07, 08, 11, 26–28, Q31, Q32),
`docs/flows/new-flow.md` (§6, §7), `architecture.md` (route table, detail views, mock notes),
`component-registry.md`, `common-pitfalls.md`, `e2e/specs/smoke.spec.ts` (`BUILT`).
## 2026-10-19 — Track T4: actuals enter by one rule, imports commit whole, the sync never overwrites a person

**Decision.** Product owner (T4 Phase 1–2): an employee does not enter actuals (Q33); only Approved /
Locked plans take actuals (Q35); actuals are monthly only (Q36); the API sync skips a goal whose current
number a person entered (Q37). Manual entry, every Excel row and every API reading pass ONE rule
(`actualRules.actualIssues` = `entryBlockers` + `valueIssues`). The import framework (`importRules`,
`ImportUploadCard`, `ImportPreview`, `mock/imports.ts` handlers) is shared: a file with cell errors is
stopped in the browser; a staged batch commits whole, re-validated at commit, or not at all; a corrected
file is a new batch. Row-error details store the issue CODE (`ImportRowError.detail`), rendered by
`issueText` from `ISSUE_DETAIL_COPY` — the frozen type was NOT widened (an optional field breaks the
"`T | null`, never `?:`" convention and the seed hash). exceljs loads only inside `src/lib/excel.ts`.
Q34 (C&B cannot upload the file) turned out moot: C&B's EMPLOYEE role holds `evidence.upload`.

**Why.** Three paths with three copies of "may this number be recorded" drift on the first rule change —
a quarter actual accepted by the import but refused by hand would silently override the summed months
(`aggregatePeriodActuals` only sums when the quarter has no own actual). A sync that overwrote a manual
correction would undo HR's reconciliation every month at 06:00, the pay-relevant direction. A half-
committed batch leaves a month where some goals carry this file's numbers and others last week's, with no
way to tell which. Storing rendered Vietnamese in a batch would freeze today's copy into every stored row.

**Consequence.** The four plans HR reopened on 04-05 take no new actual until re-approved, so a T03 sync
is PartiallyFailed on the seed (7 refused readings — a useful demo). T1/T2/T3 add their import type by a
spec, a `src/lib/import<Thing>Rules.ts` validator and a handler; they delete their deferral.

**Updated alongside.** `business-rules.md` (BR-KPI-52…57, Q33–Q37), `architecture.md` (Imports, mock
table, track deferrals), `component-registry.md`, `common-pitfalls.md`, `docs/flows/new-flow.md` (§4E,
§6, §7), `docs/source-map.md` (HR pp. 24, 75–80), plan §5.3 note.

---
## 2026-10-19 — T5 screens: one form route, a display-hint rule layer, thin cuts

**Decision.** Track T5 (WBS 4.5.1–4.5.5 + D5) is screens and hooks only — no contract, fixture,
permission or stored-state change. Product owner (phase 1/2):
1. One form page, `/forms/:formId`, in `PUBLIC_PATHS`; the page checks its own record (subject, current
   assignee, someone in its history, `goalplan.view` / `form.proxy` over its owner) — reached from the
   inbox, the team list, HR's list and (T7) notifications.
2. `src/lib/formViewRules.ts` composes the existing workflow rules into "what may THIS user do now"
   (`formStanding`), in the gateway's order (closed → plan not loaded → own review → ACTOR > DELEGATE >
   PROXY on behalf of the first actor → frozen; CANCEL by the cancel right alone, sent as oneself). It
   decides nothing new and is a DISPLAY HINT: a gateway refusal is always shown.
3. The mock's `submitCheckOf` now calls `formViewRules.submitCheckInput`, so the screen's blockers and
   `forms.act` build the content check from the same rows (a mock-internal refactor, not a contract change).
4. Thin cuts: workflow configuration edits only step name / SLA / overdue / reminder / requires-comment
   (a tab on "Khởi chạy phiếu", hidden without `cycle.manage`); the registration form shows the plan
   read-only (T3 owns the editor); the adjustment editor is thin (CANCEL; MODIFY weight/target; ADD from
   the library). The launch recipient preview is cut.
5. Evidence on the evaluation form is read with ONE `listEvidence({ periodId })` and grouped by goal;
   attaching = `system.uploadFile` then `actuals.addEvidence` (two writes, not atomic — retry on failure).

**Why.** Two places deciding the same thing drift: a button the gateway refuses is a broken screen, a
hidden button the gateway would accept is a stuck form — `formViewRules.parity.test.ts` runs every seeded
open form against every relevant account on the mock, both directions, so it cannot happen silently.
Computing `formStanding` per row of a 500-form list costs actor resolution per row, so lists show only
`stepTiming` (step, deadline, overdue). A client recipient preview would re-run `resolveRecipients` on a
client-assembled directory and could disagree with what the launch actually does; the contract does not
return skipped people, so showing them needs a contract change (known gap for the PO).

**Consequence.** Phase 5: per-user read filtering of forms and delegations is RLS's job (subject,
assignees, delegates, managers, HR) — the client check is not a boundary; today every browser reads the
tenant's delegations to resolve standings. `expectedStepId` does not catch a form returned and
resubmitted back to the same step (low risk, noted). T3 adds a "Mở Goal Plan" link from the registration
form once its editor route exists; T4 reuses `EvidenceAttach`; T7 links notifications to `/forms/:id`.

**Updated alongside.** `architecture.md` (route table), `business-rules.md` §5 (derived flags),
`component-registry.md`, `common-pitfalls.md`.
## 2026-10-19 — T6: payroll export takes Final or Locked Employee results, blank % never blocks, status never changes

**Decision.** `results.exportPayroll` is wired (T6, BR-KPI-81): the period's Employee results that are
Final OR Locked (`ASSUMPTION Q38`) go into an `.xlsx` (exceljs, dynamically imported by
`mock/payrollWorkbook.ts` only), every number copied from the stored result; a null payout is a blank cell
with its reason (`ASSUMPTION Q39`); exporting changes no status, works in a Closed cycle and is repeatable.
Async work in a mock write goes through the new `Runtime.preparedWrite` (authorize → prepare → await
render → re-authorize and re-check → commit; `CHANGED_DURING_WRITE`). The rating scale is read-only until
Q2 is answered; payout rules are editable. An employee sees a result's figures only once it is Final or
Locked (BR-KPI-82). `primaryAssignmentOn` breaks same-day ties by id. The seed is untouched: no export is
seeded, freeze hash unchanged, so no other track is affected.

**Why.** Requiring Locked would make C&B wait on a second HR act although a Final result is already
frozen; making export lock would turn a read into a lifecycle change. Blocking a blank % would block the
period forever — a Final result is never recomputed, so adding a rule afterwards cannot fill it — and
writing 0 would tell payroll to pay nothing. CSV breaks in Vietnamese-locale Excel (`;`, decimal comma).
Rendering in a read then writing would build data for a refused actor and race a lock in between. Showing
an employee a Draft promises a figure HR may still adjust. A same-day tie decided by row order could put a
person in a different unit in the file than the one their payout % was read for.

**Consequence.** HR finalises and locks; only C&B (and ADMIN) exports. Mock files live in memory: after a
reload the record stays and the file is exported again. The sources are silent on all of this — a Syntra
decision (`source-map.md`, "Where the sources are silent").

**Updated alongside.** `business-rules.md` (§0 glossary, BR-KPI-43, 45, 46, §8 Q38, Q39); `docs/flows/new-flow.md`
§4B, §5, §6, §7; `architecture.md` (routes, `preparedWrite`, deferrals); `component-registry.md`;
`common-pitfalls.md`; `docs/source-map.md`; `src/data/fixtures/README.md`.

---

## 2026-10-19 — Gate 1 passed: rules wired, permissions enforced, fixtures frozen

**Decision.** Gate 1 now means: every Phase 1 rule is wired into the mock, and nothing is deferred or
guard-pending **bar the Phase 2 tracks' own work packages** (`registry.trackOwned`: T4 `stageImport`,
`commitImport`, `runSync`; T6 `exportPayroll`) — the original "both lists empty" test
was redefined, since those methods ARE the tracks' work. Every user write declares its authorization and
the gateway enforces `can()` on it (`authorize.ts`). Product-owner decisions:
1. an employee's result comes only from a Completed evaluation form's FINAL column (`ASSUMPTION Q17`);
2. finalising is all-or-none;
3. recurring launches fire in Active or Evaluating cycles;
4. reminders are deduped by T7 via `form.dueSoon.reminderKey`, not by the scheduler;
5. writes with no dedicated permission reuse existing codes (`saveWorkflow` → `cycle.manage`, launches
   and launch rules → `form.launch`, result lifecycle → `result.finalize`, `saveTenant` → `org.manage`)
   rather than grow the 28-code catalogue.
The freeze guard `src/data/fixtures/freeze.test.ts` pins the seed hash, the gateway surface with each
write's permission and the entity count; `SEED_VERSION` = `2027-04-06.G1`.

**Why.** The tracks start in parallel on one seed and one contract; a silent change to either would break
the others, so a change must fail a test, not slip through review. A new permission code after Gate 1 is a
Large change; reusing the code whose holders already run that screen kept the matrix unchanged.

**Updated alongside.** `business-rules.md` (header, §9), `architecture.md` (Authorization, mock table,
Track-owned deferrals, Fixtures strategy, Phases), `src/data/fixtures/README.md`.

---

## 2026-10-19 — Gate 1, workflow lane: forms, launches, scheduler, lock/unlock, cycles, plan-edit guards wired

**Decision.** Every workflow method of the mock calls the rules and only the rules: `forms.act` →
`checkAction` (the mock always builds the `submitCheck`); edits → `editRefusal` with the actor's
`editStanding` (delegate / proxy inferred, because the edit contracts carry no `onBehalfOfUserId`);
plan edits → `canEditPlan` (context from rows: cycle Closed, the open registration and whether this
actor may EDIT at its step, owner = employee or unit head, plan admin = `goalplan.edit` Tenant-wide);
alignments → `checkAlignment` on the child's plan; levels → `validateTargetLevels`; launches →
`validateLaunch` + `launchTimingIssues` + `cycleAllowsLaunch` + `resolveRecipients`; the scheduler →
`dueScheduledLaunches`, `launchRuleFirings`, `overdueActions`, `remindersDue`. New `cycleRules`
(Planning → Active → Evaluating → Closed, Planning-only edits, periods, which forms a cycle accepts).
Product-owner decisions: recurring rules fire for Active OR Evaluating cycles; the scheduler does not
dedupe reminders — `form.dueSoon.reminderKey` lets T7 write one notification per step entry. Contract
change before the freeze: `form.dueSoon` gained a required `reminderKey`. Not added: the skipped
recipients on `form.launched` (would be a contract change; `fireLaunch` returns them, nothing exposes
them); an event for a form started by hand — the `entity.changed` CREATE of the `FormInstance`
(`launchId: null`) announces it.

**Why.** A rule copied into the mock drifts; the edit contracts have no "on behalf of" field, so a
delegate's or HR's draft could not otherwise be saved; reminders deduped by scheduler state would need a
new column, while the key makes the listener idempotent for free.

**Updated alongside.** `business-rules.md` BR-KPI-13/14/15/19/21/23 and new BR-KPI-25 (cycles),
`architecture.md` (Track-owned deferrals, mock table, `form.dueSoon`), `docs/flows/new-flow.md` §1–4A,
§7, the `listInbox` comment in `src/integrations/data/types.ts`.

---

## 2026-10-19 — Gate 1 scoring lane: one result pipeline for the mock and the seed

**Decision.** `src/lib/resultRules.ts` is the only producer of `PeriodResult` / `ResultDetail`: pure
orchestrators over plain rows (`buildPeriodResults`, `applyAdjustment`, `finalizePeriodResults`,
`lockPeriodResults`) return a `ResultChanges` set; the mock applies it to its transaction, the seed's
`ResultScript` to its arrays. Stored conventions in BR-KPI-40 (Draft = adjusted unrounded, Final =
rounded once; payout only for Employee plans; rating/payout null while incomplete). Employee results
only from a completed evaluation's FINAL column, with every goal on the form counted Active (the form
is the snapshot) — `ASSUMPTION Q17`. Finalising is all-or-none and lists every issue of every result
(07, then 12, then 09, each tagged `data.resultId`). `src/lib/actualRules.ts` guards `recordActual`
(and T4's import rows): locked period / finalised result → 04; goal not Active, other cycle, wrong
kind, empty, period not started (`ASSUMPTION Q18`) → 06. `saveCalcMethod`, `saveRatingScale`,
`savePayoutRule` now refuse invalid configuration (13; level of another scale 06).

**Why.** A seed that typed scores in, or a second copy of the arithmetic in the mock, would drift from
the rules the moment either changed; one pipeline means a recalculated seeded Draft is byte-identical
(tested). All-or-none finalising keeps a period's payroll batch consistent (product owner).

**Updated alongside.** `business-rules.md` (BR-KPI-40, 43, new 44, 52, 31/41/42 lines, §6 ERR-KPI-04,
§8 Q17/Q18), `architecture.md` (Track-owned deferrals, `groups/results.ts`, Fixtures strategy),
`docs/flows/new-flow.md` (§4B, §6, §7), fixtures README, `errorCatalog.ts` (ERR-KPI-04 trigger).

---

## 2026-10-19 — Phase 1.4 dev toolbar: "Công cụ demo"

**Decision.** The mock's `dev` controls live in a popover beside the "Dữ liệu giả lập" banner, shown
whenever the gateway has `dev` (every build — the Vercel prototype is a demo). What it switched on is
mirrored in `devStore`, NOT persisted (a remembered failure mode would break the next demo). Clock,
latency and failure changes invalidate every query without awaiting it; the scheduler invalidates its
tenant; a reseed restores latency/failure defaults and drops the cache with `resetQueries()` (a bare
`clear()` leaves mounted queries showing old rows). `SessionProvider` now replaces the app only when the
tenants' FIRST load fails — a failed background refetch keeps the session, so "fail every call" cannot
unmount the toolbar that would switch it off.

**Why.** Approved Phase 2 design; the two cache/session points were found while building it.

**Updated alongside.** `component-registry.md`, `common-pitfalls.md`, `src/hooks/queries/README.md`.

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
  (new `ASSUMPTION Q13`);
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
(Q13); `component-registry.md`; `new-flow.md` §7; the `WorkflowStep` comment in `types.ts`.

---

## 2026-10-19 — Phase 1.2: the mock is a schema-checked store behind one per-call runtime; rule-dependent methods wait for their rule

**Decision.** `src/integrations/data/mock/`: every method runs through `runtime.ts` (latency, failure
injection, input/output copies, tenant check, authorize, transaction, integrity, save, events after
commit). `schema.ts` declares each table's writable columns, foreign keys (kind + delete policy, nested
and polymorphic paths), unique indexes and checks; `integrity.ts` enforces them at commit. A method whose
RESULT is a rule's answer is *deferred* (rejects `KpiDeferredError`, never retried); a method whose rule
only REFUSES is a *pending guard* (works now). Gate 1 requires both lists (`mockGateway.registry`) empty.

**Why.** One generic integrity check is what lets the isolation suite be generated from the schema; a
hand-written "does this id exist in the tenant" per method is the check that gets forgotten. Copying a
rule into the mock to make a method work before 1.5 would demonstrate behaviour the real system will
not have (common-pitfalls); rejecting everything instead would block T3/T4 from saving a draft goal.

**Phase 4 (QA).** The audit entry is written in the write's own transaction, and the clock saved in the
same batch as the tables — a listener writing audit afterwards lost it on a storage error, and a clock
save after the commit could report a stored write as failed (the user retries: a duplicate).

**Updated alongside.** `architecture.md` ("Mock adapter (Phase 1.2)"), contract comments in
`src/integrations/data/types.ts` (unknown tenant → 02, recordAudit tenant check, keyset cursor, listener
failures, `setNow(null)`), `errorCatalog.ts` (`KpiDeferredError`).

---

## 2026-10-19 — The seed's "now" is 2027-04-06 09:00; the scheduler last ran 2027-04-01 09:00; every form's history replays

**Decision.** The simulated clock starts at `SEED_NOW` and flows with real time; `setNow(null)` returns to
`SEED_NOW`, not real time (D-b); a reload continues from the saved simulated time. Every seeded overdue
state is what daily ticks up to `LAST_SCHEDULER_TICK` produce, and exactly one step is overdue and
unhandled (E029's open adjustment). Evaluation recipients follow 1.5's `resolveRecipients` (Approved /
Locked plan at launch), so the five AUTO_LOCKed staff are evaluated too.

**Why.** Real time (October 2026) is before the 2027 cycle. The first draft seeded forms 78 days past due
with nothing handled — the first `runDue` would have locked or forwarded half the company; a test now
fails if any seeded open step was overdue at the last tick.

**Updated alongside.** `src/data/fixtures/README.md` ("The story"), `timeline.ts`, `seed.test.ts`.

---

## 2026-10-19 — D-c: a 9th department "Kinh doanh"; D-e: deterministic seed ids

**Decision.** DATX's "Tư vấn" set becomes "Phòng Kinh doanh" (head E006 = the §8.2 "TP Sale"); the five
DATX sets with no unit are templates with `orgUnitId = null`. Seed ids come from `seedId(...parts)` —
UUID-shaped (version nibble 8), stable across builds — instead of pasted literals.

**Why.** The E2E scenario names a Sales manager the 8 DATX departments do not have. 2 000 pasted UUIDs
would be unreviewable and impossible to reference from a test.

**Updated alongside.** `src/data/fixtures/README.md` (conventions), plan §6.4 wording, `architecture.md`.

---

## 2026-10-19 — DATX cleaning, frequency/aggregation and data sources are ASSUMPTIONS Q14–Q16

**Decision.** The library is the DATX sheet cleaned item by item (weights normalised, methods corrected by
meaning, mixed rows split, BSC mapped by subject — Q14); every KPI monthly with SUM / AVG / LAST by kind
(Q15); four data sources as named in the workbook, five invented (Q16). Q12 is 1.3's and Q13 is 1.5's.

**Why.** Taken literally the sheet scores lead time and response time higher-is-better, ships three sets
whose weights cannot be submitted, and has no frequency at all.

**Updated alongside.** `business-rules.md` §4 (sample scale) and §8 (Q14–Q16), fixtures README ("DATX
cleaning"), `docs/source-map.md`.

---

## 2026-10-19 — Query keys are tenant-first and invalidated from the gateway's events

**Decision.** `src/hooks/queries/keys.ts`: `queryKey(tenantId, root, ...params)`; each root of `KEY_ROOTS`
names the entities it reads; `useGatewayEventInvalidation` (one `GatewayEventBridge` in `main.tsx`)
invalidates every root an `entity.changed` touches, once per microtask.

**Why.** `forms.act` changes a form, a plan and other people's inboxes; a mutation that had to list every
other track's keys would miss one, and the screen would show yesterday's state with nothing looking broken.

**Updated alongside.** `src/hooks/queries/README.md`, `architecture.md` (Data layer).

---

## 2026-10-19 — Phase 1.3: permissions are data, a person's access is the union of their roles, and approving is never a permission

**Decision.** `src/lib/permissionRules.ts` declares 28 `module.action` codes (ids `perm.<code>`, the same in
every tenant) and the DEFAULT role → permission matrix the seed builds its rows from; `can(profile, code,
resource?)` evaluates the LOADED ROLE_PERMISSION / USER_ROLE rows, so T1's edits take effect. Access is the
union of a person's roles — the switcher picks tenant and person, never a role. There is no `goal.approve`:
SUBMIT / APPROVE / RETURN are the step's actor rule (BR-KPI-61); only `form.proxy` and `form.cancel` gate
forms, and both are scope-sensitive. Defaults: MANAGER = OrgUnit (the unit they head) + children; HR, CNB,
BOD, ADMIN = Tenant; **ADMIN holds every code** (product owner — plan §7.1 showed ADMIN only "Hệ thống").
Everything fails closed. All of it is `ASSUMPTION Q12`: no source describes roles or scopes.

**Why.** A hard-coded matrix would make T1's "Người dùng & quyền" screen a lie the moment HR edited a
mapping. An approval permission would sooner or later disagree with the actor rule — a manager holding
`goal.approve` who is not the plan's direct manager would see an Approve button that the workflow refuses.
An "active role" picker adds a second concept to every demo and an impossible state (a manager viewing as
EMPLOYEE while holding a task at their step). DirectReports for managers would hide a department head's
sub-teams and their unit plan.

**Updated alongside.** `business-rules.md` §0 glossary, BR-KPI-20/23 cross-references, §8 Q12, new §9
(BR-KPI-60…64 + the catalogue table); `docs/flows/new-flow.md` §4A, §6, §7; `src/data/fixtures/README.md`
(seed requirements for 1.2); `src/data/types.ts` (`Permission` comment).

---

## 2026-10-19 — Phase 1.3: the menu and the route guard read the same permission; the session is one query and stays referentially stable

**Decision.** Each `NavItem` names a `permission` (`null` = any signed-in user); `NavGroup.roles` and 1.4's
role-only `navRules.ts` are gone. The sidebar shows `visibleNavGroups(NAV_GROUPS, access)`; AppShell renders
ERR-KPI-05 for a path `canOpenPath` refuses (longest url-segment match); `navConfig.test.ts` fails if a route
in `App.tsx` is neither a menu item nor in `PUBLIC_PATHS`. The session loads ONE directory query per tenant
(`[tenantId, 'sessionDirectory']`, `Promise.all`), renders children only once resolved, rebuilds the profile
when "today" (gateway clock, tenant zone) changes, keeps a background-refetch failure on screen as a toast,
and validates the stored `kpi.session.v1` ids against what it loaded. Switch handlers read `navigate` from a ref.

**Why.** Seven tracks guarding their own routes would miss one, and a missed route is a silent leak; a route
with no menu item would have been open to everyone. A partial directory (roles without their permissions)
fails open or closed at random. React Router v6's `navigate` changes on every navigation, so a handler
depending on it re-created the session value and re-rendered every consumer per route change (the stability
test caught it).

**Updated alongside.** `architecture.md` (route table, Client state, phases), `component-registry.md`,
`common-pitfalls.md` (navigate identity, Node `localStorage` in Vitest, session hooks' explicit tenant),
`src/hooks/queries/README.md`.

---

## 2026-10-19 — Phase 1.4: the UI kit never shows a stale or dropped value, and a badge marks the exception

**Decision.** Tones for every state set live in `statusTones.ts`; a set's ordinary state is `muted`
(Goal Active, Library Active, Employment), Record Active gets no badge, and `formTone(status, atMyStep)`
turns my step amber. `DataTable` and the pickers take the `useQuery` result and go through `loadPhase`:
an error replaces cached rows, a disabled query is `idle` (never an endless skeleton), a refetch dims
rows. Pickers read the WHOLE list (archived KPIs, resigned people listed disabled) and the trigger says
"Đang tải…" / "Không tải được danh sách" / "Không còn trong danh sách" rather than going blank. Picker
search is client-side (`matchesSearch`), never a hook filter. Query keys are `[tenantId, root, ...params]`.
The menu filter `navRules.visibleNavGroups(roles)` is role-based and temporary: Phase 1.3's
permission-based menu and route guard replace it.

**Why.** Reviews (cto, ui-ux) found the silent failures: an Active-only KPI list made every goal on an
archived KPI show an empty picker that would still submit the old id; reading `isPending` alone hung a
disabled query on skeletons; a green "Đang áp dụng" on every library row drowned the one row that
mattered; `search` in the employees key flashed pending on every keystroke. Root-first keys broke 1.2's
`[tenantId, root]` event invalidation.

**Updated alongside.** `design-system.md` (Status → tone, other state sets, tables, fields, pickers),
`component-registry.md`, `architecture.md` (directory, route-table note on menu filtering, phases).

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
