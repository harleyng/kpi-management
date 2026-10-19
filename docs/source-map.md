# Source map — where each fact comes from

Every business rule in `.agents/knowledge/business-rules.md` cites one of the sources below. The source
files are internal and heavy, so **they are not committed** (`.gitignore` excludes PDF/DOCX/XLSX/PPTX).
They live in the product owner's folder:

`…` = `/Users/m116gb/Downloads/Syntra/Internal/KPI`

## Priority

1. **Syntra's decisions** — the NoteX meeting minutes, the plan (`docs/plans/KPI_repo_plan.md`), and the
   product owner.
2. **The plan's defaults** for open questions Q1–Q10 (plan §9), flagged `ASSUMPTION Qn`.
3. **CMC PMGM user guides and the SF4C approval process** — a reference implementation, not a
   requirement. A CMC feature Syntra has not confirmed is out of P1.
4. **DATX workbook and slides** — an example of today's practice and the seed for the KPI library.

## Sources

| Source | Location | Used for |
|---|---|---|
| Requirements meeting minutes (NoteX) | https://notexapp.com/share/6acdac7b1ec40e06d9b64dc5 | Goals, BSC, three tiers, three-step evaluation, live dashboard, "KPI must be measurable" (§2.3) |
| ERD (P1–P3, 67 tables) | `docs/erd/kpi_erd.mermaid` (copy of `/Users/m116gb/Downloads/Tool/kpi_erd.mermaid`) | Domain types, entity names, relations, state sets |
| CMC PMGM — HR user guide | `…/Request/CMC_PMGM_Userguide_HR.pdf` | Goal fields, import, form launch, lock/unlock, routing |
| CMC PMGM — Manager user guide | `…/Request/CMC_PMGM_User_guide_Manager_v1.0.pdf` | Registration, approval, adjustment, evaluation from the manager's side |
| CMC PMGM — Employee user guide | `…/Request/CMC_PMGM_User_guide_Employee_v1.0.pdf` | Employee side of the same flows (secondary) |
| SF4C approval processes | `…/Request/SF4C_PMGM_Quytrinhpheduyet_v2.0_Ctel.docx` | The PMGM.01–14 process catalogue |
| KPI email templates | `…/Request/Email template for KPI.docx` | The four-step registration process, launch and deadline e-mails |
| DATX KPI workbook | `…/Request/DATX-Bieu mau xay dung bo KPIs.xlsx` | KPI library seed, department templates, today's Excel process |
| DATX KPI guide 2023 (slides) | `…/Request/DATX_KPI_Huong dan va trien khai 2023.pptx` | KGI → CSF → KPI, the six implementation steps |
| Continuous performance guide (slides) | `…/Request/Hướng_dẫn_sử_dụng_Phân_hệ_Hiệu_suất_liên_tục.pptx` | **P2 only** (continuous performance) — not used in P1 |

## Key pages

### CMC PMGM — HR user guide

| Pages | Topic | Feeds |
|---|---|---|
| 20–28 | Goal fields: visibility, type (BSC + KRI), name, unit, weight, description, dates, numeric/text target, levels L1–L3 and their scoring rules, cascade tracking (assigned / self-held / not assigned) | Plan §5.1; BR-KPI-04, 06, 07, 08, 09, 10; D1–D4 |
| 47–49 | Locking and unlocking Goal Plans | BR-KPI-14 |
| 61–63 | Goal Plan import template (columns P–T = levels) | Plan §5.2; `/add-import-template` |
| 75–76 | Actuals import (export the goal list, fill, re-import) | Plan §5.3 |
| 88–95 | Launching forms: type, template, timing (now / date / recurring), period, due date, recipients | Plan §5.4; BR-KPI-19; D5 |
| 150–155 | Workflow routing: steps, actors | BR-KPI-20 |

### CMC PMGM — Manager user guide

| Pages | Topic | Feeds |
|---|---|---|
| 20–29 | The goal table and its buttons; 25–29 the actions (submit blocked when weights ≠ 100% or items unscored, p. 26; "Lấy ý kiến", "Thêm người duyệt", collaboration step) | BR-KPI-04, 18; D6; Q7 |
| 51, 98, 105 | Process overviews (registration, adjustment, evaluation) | `docs/flows/new-flow.md` |
| 98–109 | The evaluation form from the manager's side | Plan §5.5; BR-KPI-16, 17 |

### SF4C — PMGM process catalogue

| Code | Process | P1? |
|---|---|---|
| PMGM.01–02 | Probation goals / probation evaluation | P2 |
| PMGM.03 | Create an employee's Goal Plan (HR imports, then locks) | **P1** |
| PMGM.04–05 | Create Goal Plans for blocks/departments and for the company | **P1** |
| PMGM.06–07 | Edit an employee's / a department's Goal Plan (then lock) | **P1** (adjustment) |
| PMGM.08 | Monthly work plan for employees | Out (Q10) |
| PMGM.09 | Monthly result evaluation — **an employee who misses the deadline is auto-forwarded to the direct manager** | Overdue behaviour (BR-KPI-13); the monthly plan itself is out (Q10) |
| PMGM.10 | Continuous performance | P2 |
| PMGM.11 | Update KPI results (departments send results; HR imports; the import is final) | **P1** (actuals) |
| PMGM.12 | KPI result evaluation | **P1** |
| PMGM.13 | 360 review | P2 |
| PMGM.14 | Contract-expiry evaluation | P2 |

### Email template for KPI

Two e-mails, each in English and Vietnamese: **"Email khởi chạy"** (the registration process has started;
four steps; "you are at step 2 — add goals until the total weight is 100% and link them to your
manager's") and **"Email nhắc Deadline"** (your step on <user>'s plan is due on <date>; after that the plan
is **locked and cannot be edited**). Feeds BR-KPI-12, BR-KPI-13 and the notification templates (T7).

### DATX workbook

| Sheet | Contents | Feeds |
|---|---|---|
| "2. KPIs phòng ban" | Company and department KPI sets: KPI, weight, method ("% thực tế / mục tiêu" or "% mục tiêu / thực tế"), classification (BSC or Hiệu quả/Khối lượng/Chi phí), definition, target. **15 sets, 87 rows** (company + 14 units: Marketing, Ngành hàng Nội dung số, Ngành hàng Lối sống, Media, Tư vấn, CSKH, Mua hàng, Vận hành, Cửa hàng, Sản phẩm, Công nghệ, HCNS, Kế toán, Kế hoạch) → 54 definitions and 15 templates in the seed, cleaned as `ASSUMPTION Q14` (fixtures README) | Library seed (`src/data/fixtures/catalog.ts`), Q4, Q5, Q14 |
| Department sheets (Marketing, HCNS, TC-KT, …) | "Mục tiêu chung (3–5) — KGI", the KPI set, SMART reminder, monthly target allocation | BR-KPI-02, 11; templates |
| "TH KQ" | Result roll-up per employee: % KPI completion, % KPI pay, rating, rule violations, attendance — **broken with `#REF!`**, and holds real names | BR-KPI-40 (columns only); Q2. **Never copy its rows** |

### DATX KPI guide 2023 (slides)

| Pages | Topic |
|---|---|
| 21–22 | KGI → CSF → KPI |
| — | The six implementation steps (strategy → KGI → CSF → KPI → targets → review) |
