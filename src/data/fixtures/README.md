# Seed fixtures — the contract between tracks

`src/data/fixtures/` builds the seed the mock gateway loads on first use and on `dev.resetSeed()`
(Phase 1.2). `buildSeed()` in `index.ts` returns it; it is deterministic (two calls are deep-equal).

## Why fixtures are a contract

The seven Phase 2 tracks (T1–T7, `docs/plans/KPI_repo_plan.md` §6.3) run **in parallel** because
they all read the same seed — no track waits for another track's screens.

**Frozen at Gate 1 (2026-10-19), `SEED_VERSION` = `2027-04-06.G1`; re-frozen 2026-10-23 by Plan A's A1
(evaluation items), Plan B 8.1 (monthly work, 55 entities), Plan A's A2 and Plan B 8.2 (3-step WORK_PLAN):
`SEED_VERSION` = `2027-04-06.A1.B1.A2.B2`.** `freeze.test.ts` pins the seed
hash, the gateway surface (`group.method:kind[:permission]`) and the entity count (49). A failing
freeze test means a fixture or the `DataGateway` contract changed — a **Large** change:
1. `system-architect` reviews it;
2. every other track is told before merge;
3. **bump `SEED_VERSION`** (`index.ts`), so browsers holding an older copy reseed;
4. update `FROZEN` in `freeze.test.ts`;
5. `/log-decision`.

What the seed still leaves to the tracks (`seed.test.ts`): the states T1 `Tenant:Suspended`, T3
`Cycle:Evaluating`, T4 `Sync run:Running` (`STATE_EXEMPTIONS`), and the empty `PayrollExport` (T6
wired `exportPayroll` without seeding one — a demo starts with no export; `EMPTY_UNTIL_WIRED`).

## Layout

| File | What it builds |
|---|---|
| `types.ts` | `CollectionRows` (one collection per `EntityName` + `AuditLog`), `TenantSeed`, `Seed` |
| `ids.ts` | `seedId(...parts)` — deterministic UUID-shaped ids; `idsFor(tenantKey)` |
| `prng.ts` | a fixed-seed generator for fixture VALUES (how far an actual lands from its target) |
| `timeline.ts` | **every date of the story** — `SEED_NOW`, `LAST_SCHEDULER_TICK`, step times |
| `catalog.ts` | library (from DATX), templates, workflows, rating scale, notification texts — as tables |
| `shared.ts` | builders both tenants use (roles + permissions, library, workflows, rating, `goalFromKpi`) |
| `results.ts` | `ResultScript` — calculate / adjust / finalise / lock through `src/lib/resultRules.ts`, applied to the rows |
| `syntra/` | `org.ts` · `goals.ts` · `actuals.ts` · `forms.ts` · `system.ts` · `results.ts` (run last) · `index.ts` |
| `demoCo.ts` | the second tenant |
| `seed.test.ts` | integrity (through the mock's own check), coverage, identity, business and timeline invariants |
| `freeze.test.ts` | the Gate 1 freeze: seed hash, gateway surface, entity count |

## Conventions

- **Every row carries `tenantId`**; `Permission` and `Tenant` are the only global collections.
- **IDs** come from `seedId` / `idsFor('syntra' | 'demo')` with readable keys —
  `SYNTRA.id('Goal', planId, '1')`, `SYNTRA.user('E016')`. Never `crypto.randomUUID()` in a fixture.
  (This replaces the earlier "paste literal UUIDs" rule — decision D-e.) Permission ids are 1.3's
  `perm.<code>`.
- Types come from `src/data/types.ts`; statuses use its fixed sets. Fixtures may call
  `src/lib/permissionRules.ts` (the 1.3 rows are never hand-written) and, once Phase 1.5 lands, the
  rules that PRODUCE rows (results) — never a copy of a rule.
- **No real personal data.** Names are fictional; nothing is copied from the DATX "TH KQ" sheet.
- **No derived value is stored by hand** (total weight, "chưa giao", scores). `PeriodResult` /
  `ResultDetail` are PRODUCED by `ResultScript` (`results.ts`) running the same `resultRules`
  orchestrators the mock's `results.*` methods call; `PayrollExport` stays empty: T6 wired
  `exportPayroll` and kept the seed frozen (`seed.test.ts` `EMPTY_UNTIL_WIRED`).
- Every state of every status set appears (plan §6.4); the few that cannot are listed with a reason in
  `seed.test.ts` (`STATE_EXEMPTIONS`).
- Values that depend on an open question are marked `// ASSUMPTION Qn`.
- The serialised seed stays under 1.5 M characters (localStorage holds about 5 M).

## The story (Syntra, as of `SEED_NOW` = 2027-04-06 09:00, Asia/Ho_Chi_Minh)

The scheduler ran daily at 09:00 until **2027-04-01 09:00** (the tick that fired the T03 evaluation)
and has not run since — the mock never runs it on its own. Every overdue state below is what that
history produces; `seed.test.ts` checks that only the one named form is overdue and unhandled.

- **Org.** Công ty Syntra → Khối Kinh doanh (Kinh doanh, Marketing, CSKH) · Khối Vận hành (Mua hàng,
  Vận hành, Công nghệ) · Khối Hỗ trợ (HCNS, Kế toán, Kế hoạch), plus "Phòng Bán lẻ", closed end-2026
  (Inactive, with its 2026 plan). 42 people: CEO E001 and deputy E002 (BOD), 3 division directors,
  9 heads, 28 staff. Kinh doanh (head E006 = the §8.2 "TP Sale", staff E015–E018) is DATX's "Tư vấn"
  set (decision D-c).
- **Personas.** Starting persona E016 (employee). Manager E006; HR E035 (and E012, head of HCNS, who
  also holds HR — she approves E035's own forms); C&B E036; BOD E001 (also MANAGER of the whole
  company); ADMIN E032 and the system account. E033 has an Inactive old account; E024 resigned on
  03-10 (account Inactive); E018 joined on 03-15 (Probation); E021 moved CSKH → Marketing on 01-01;
  E034 has a concurrent assignment in Kế hoạch.
- **Cycles.** KPI 2026 Closed · **KPI 2027 Active** (T01–T12, Q1–Q4; T01 and T02 locked) · KPI 2028 Planning.
- **Plans.** The company plan and the nine department plans were registered in December and are
  Locked. 28 staff plans:
  - 22 Locked after a normal registration (manager 01-05 → employee 01-07 → manager 01-09 → HR 01-11);
  - **E027 frozen**: AUTO_LOCKed at step 2 on 01-09 and never unlocked (form InProgress, `overdueHandledAt` set);
  - four AUTO_LOCKed (01-09 / 01-11 / 01-12) then **unlocked by HR on 04-05** with a new due date of
    04-15, so their steps started again: **E040 Approved** (at HR), **E017 Submitted** (at the
    manager — the §8.2 "TP returns" plan), **E021 Returned** (returned 04-05 15:00), **E030 Draft**
    (at step 2, three goals so far);
  - **E018 Draft**, registration launched on 04-05 just for her, form Open at step 1, no goals yet.
- **Goals.** Staff plans hold 5 goals (30/25/20/15/10) drawn from their department's; goal 1 is
  CASCADEd (SUM KPIs: 30% of the department's target each) or LINKed (ratio KPIs). Company revenue is
  cascaded 96 + 48 of 160.8 bn → 16.8 bn not yet assigned; Marketing keeps 4.8 bn unassigned; Kinh
  doanh's head keeps 9.6 bn "tự giao". LEVELS goals: E023 (complaint rate, lower is better), E038.
  TEXT goals: E039 and the Công nghệ / Kế toán department plans. A PRIVATE goal: E020. Monthly
  targets are split only for SUM goals (a ratio's monthly target is its target).
  **E026's February adjustment** (Completed GOAL_CHANGE): one goal MODIFIED (old → Changed, new
  `replacesGoalId`), one CANCELLED, one ADDED.
- **Actuals** (T01–T03): ERP Sale API syncs at 06:00 on day 1 (T02 PartiallyFailed — one record
  missing; T03 failed once at 23:00, rerun OK); HR's Excel batch at 07:30 (Committed); manual entries
  by 08:30. T03's CRM file is a **separate batch still Validating, with two row errors**, so CRM goals
  have no T03 actual. One T02 value was corrected by hand on 03-05 (the old snapshot kept, not current).
  A Library import batch was Rejected in February.
- **Evaluations** (recurring rule PERIOD_END + 1, due 12 days, SLA 6/4/2). Recipients follow 1.5's
  `resolveRecipients`: staff employed in the period whose plan was Approved/Locked at launch — so the
  five AUTO_LOCKed staff are evaluated too; E018 is not (no plan on 04-01). 27 forms per month:
  - **T01** all Completed; E032's self-assessment submitted by HR as proxy;
  - **T02** 22 Completed (E023's manager step by a delegate, E006 for E008; E033's by E031 for E011
    before that delegation was revoked); E025, E028 at the manager and E037 at HR, REMINDed on 03-08;
    **E026 AUTO_FORWARDed** on 03-08 (never self-assessed), REMINDed 03-13; **E041 returned by HR at
    the last step** on 03-06, REMINDed 03-11;
  - **T03** (due 04-13, step-1 deadline 04-07 — nothing overdue): 20 Open (six with self-scores
    saved — EDIT, still Open — and three with evidence), E015, E016, E029, E034 at the manager, E020
    and E038 at HR (E020's manager step by the ACTIVE delegate E019 for E007); **E024 Cancelled** by
    HR on 04-02 (left on 03-10).
- **The one unhandled overdue step:** E029's open adjustment (GOAL_CHANGE, started 03-30) — its step-2
  deadline 04-02 fell after the last tick. Move the clock or run the scheduler to see REMIND.
- **Launches.** Registration 01-04 (Launched), new-hire 04-05 (Launched), T01–T03 evaluations
  (RECURRING), "đợt 2" for Probation staff on 04-15 (Scheduled), "đợt 1" (Cancelled before it fired).
- **Delegations** (KPI_EVAL): active E007 → E019 (04-01…04-15), expired E008 → E006 (03-01…03-15),
  revoked E011 → E031 (03-01…04-30, revoked 03-20).
- **Results** (`syntra/results.ts`, run last, through `resultRules` — the gateway recalculating a Draft
  reproduces its row exactly). An Employee plan has a result only from a COMPLETED evaluation form
  (FINAL column, `ASSUMPTION Q17`); Company / department plans are scored from the current actuals.
  **T01** Locked — adjustments E016 −2 and E023 +2 (88.97 C → 90.97 B, payout 50% → 80%); E027 stays
  Draft (its plan stopped at 3 goals, 75%). **T02** Final — E040 −2 (100.30 A → 98.30 B); Draft: E023
  (held — its manager step was a delegate's), E027 (75%) and the company plan (an ERP Sale record never
  arrived); E025, E026, E028, E037, E041 have no completed form, so no result. **T03** calculated only:
  the ten unit plans Draft (CSKH and Mua hàng incomplete — the CRM batch is still Validating).
  Finalised on the evaluation deadline at 09:00 (02-13, 03-13). No payroll export yet. Demo Co: T01
  calculated, D003 Final, its company plan Draft (no actual).
- **Rating** "Thang mẫu A+/A/B/C/D (giả định Q2)": A+ [110,120] 120% · A [100,110) 100% · B [90,100)
  80% · C [70,90) 50% · D [0,70) 0%; Kinh doanh pays 130% for A+ (an OrgUnit payout rule). The 2026
  scale is Inactive.
- **Monthly work** (PEND-14, `syntra/work.ts`, `work.ts`) — the Kinh doanh pilot (manager E006; E015,
  E016, E017; E018 from April), launched by HR by hand each month for the department's staff, at the employee's step (bottom-up, `startStepNo` 2 of the 3-step WORK_PLAN workflow) (unit KDBH,
  staff job levels — the head's own month is not in the pilot). **T02 recorded**: plans approved 02-03, reviews Completed 03-07,
  results produced by `workRules.workResultOf` — E017's Hsht 62.3 < 80 with the manager's Hsnv 70 and a
  reason. **T03 under review** (launched 04-01, step-1 deadline 04-07): E015 self-scores saved (Open), E016
  Open, E017 at the manager since 04-03; E018 (hired 03-15) had no March plan, so the review launch skipped
  her (`ASSUMPTION Q69`); E016's bid task was cancelled 03-15 with a reason. **T04 planning** (launched
  04-01, due 04-08): E015 Locked, E016 Submitted 04-04 (at the manager, reminded from 04-06), E017 Returned
  04-05 (step 1); E018's plan launched on its own on 04-05 like her registration — Draft at step 1, two tasks,
  60% of the weight. One scoring config per tenant (70/30/80). Demo Co: D003's T01 planned, reviewed,
  recorded; T02 planned and Locked (not yet reviewed).
- **System.** In-app notifications for the T03 launch, waiting forms, two returns and one reminder;
  two e-mails (Queued, Failed — P1 sends no e-mail); the audit trail of every lock, auto-lock, unlock,
  cancellation and the revoked delegation.

**Demo Co** is small but has at least one row in every collection Syntra fills and reuses Syntra's
codes (unit `KD`, role codes, KPI codes), so an isolation test can never pass on an empty list. Its
personas: D003 employee (starting persona), D002 manager, D004 HR, D005 C&B, D001 BOD, D006 admin.

## DATX cleaning (`ASSUMPTION Q14`)

The library comes from sheet "2. KPIs phòng ban" (15 sets, 87 rows → 54 definitions). Changes made
to the workbook — each marked `// Q14` in `catalog.ts`:

1. **Weights normalised to 100%**: Marketing (80% → every weight × 1.25); Cửa hàng (90% → Lãi gộp
   30 → 40); Nội dung số ("Tỉ lệ KH hài lòng" had none → 5, taken from "Số sản phẩm mới" 40 → 35).
   4-item sets (Media, CSKH, Vận hành) stay 4 in the TEMPLATE; their department PLANS add a 5th goal
   (BR-KPI-03 applies to plans).
2. **Methods filled or corrected**: blank cells filled (Marketing customer counts → up; Ngân sách QC
   → down; all Vận hành rows → down); "Lead time" and "Hiệu năng" are lower-is-better although written
   "thực tế / mục tiêu"; "DAU" is higher-is-better (Công nghệ wrote it the other way); company "Tỉ lệ
   KH cũ" is higher-is-better (`ASSUMPTION Q4`). "Tồn kho" (up) and "Xả tồn" (down) are kept as
   written — **HR to confirm**.
3. **Rows split**: Mua hàng row 1 → "Chi phí mua hàng" + "Số lần đứt hàng" (the one real TIERED rule:
   0 → 100, 1 → 70, 2 → 40, ≥ 3 → 0); Tư vấn "CR/AOV/HH" → three KPIs (5 / 10 / 5).
4. **Thresholds**: "Lỗi" (target 0) and "Báo cáo đúng hạn" are Đạt / Không đạt (BINARY, TEXT target);
   "Công nợ / HTK ≥ 1" is BINARY on a ratio.
5. **Tags and definitions**: CSKH's salary KPI re-tagged "Chi phí"; Kế toán's "TSLN" definition kept
   ("LN cuối / doanh thu thuần", not Kế hoạch's "doanh thu / chi phí"); Kế toán's opex definition (a
   copy of the salary one) blanked — **HR to confirm**; dual tags "Khối lượng / hiệu quả" → no tag;
   the three HCNS placeholder rows → Draft definitions; garbled targets ("38Đ", "21.000.000đ" per
   order) left blank.
6. **Perspective**: only the company and Kế hoạch sets give a BSC perspective; the others map by
   subject (cost and money → FIN, customers → CUS, operations → PRO, people → LNG) and keep the DATX
   word as the tag (`ASSUMPTION Q5`).
7. **Numbers**: Vietnamese dot thousands read as thousands ("28.957" = 28 957); fractions stored as
   percent on a 0–100 scale (0.15 → 15); DATX targets are monthly — goals hold the year (× 12 for SUM).

The seed predates the library's write rules (business-rules.md §3b, track T2) and is NOT changed by them:
the HCNS template is Active while holding the three Draft HCNS KPIs, and Demo Co's two Active templates
total 50% / 40%. Those are exactly the warning cases the template screen shows (`ASSUMPTION Q26`); saving
any seed row unchanged succeeds (`mock/library.test.ts`).

Other defaults: every KPI is monthly; aggregation SUM for money and counts, AVG for ratios, LAST for
headcount and stock (`ASSUMPTION Q15`); data sources ERP Sale, ERP Kho vận, CRM CSKH, HRIS and "Nhập
tay" are invented — Sorama, My Result, CMS and MHTC are named in the workbook (`ASSUMPTION Q16`);
the 120% cap and 0% floor on ratio methods are invented (DATX states none).

## Identity and permissions (Phase 1.3 requirements)

The session and `can()` (`src/lib/permissionRules.ts`, business-rules.md §9) read these rows, so the seed
must provide them exactly:

- **PERMISSION** rows = `permissionRows()` — the global catalogue, ids `perm.<code>`, identical for every
  tenant. **ROLE_PERMISSION** rows = `defaultRolePermissionRows(tenantId, roles)` for each tenant. Six
  **ROLE** rows per tenant (one per `ROLE_CODES`), with per-tenant ids. Never hand-write these rows.
- **USER_ROLE**: every account with an `employeeId` holds **EMPLOYEE / Self** (BR-KPI-62) plus its persona's
  role with `DEFAULT_ROLE_SCOPE`: MANAGER = `OrgUnit`, `scopeOrgUnitId` = the unit they head,
  `includeChildren: true`; HR / CNB / BOD / ADMIN = `Tenant`.
- **Accounts**: one persona per role; at least one person with two non-EMPLOYEE roles; one `Inactive`
  account (its employee still `Official`); one system account (`employeeId: null`, ADMIN). **The first
  Active account of each tenant is the demo's starting persona** (the session falls back to it).
  `Employee.email` is set for every account holder.
- **Org**: exactly one root unit (`parentId: null`) per tenant; a manager whose unit has a child unit; one
  concurrent (`isPrimary: false`) assignment; one resigned employee with `leftOn` and a closed assignment;
  one dated move between units; one Inactive unit with a historical plan.
- **Demo Co** has its own full persona set, so tenant isolation is demonstrable on screen.
- Adding a permission code, or changing the default matrix, after Gate 1 is a **Large** change.
