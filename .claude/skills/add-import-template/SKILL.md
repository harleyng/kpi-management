---
name: add-import-template
description: Add an Excel import template to Syntra KPI on top of the shared batch-import framework (WBS 4.4.3) — a downloadable template built with exceljs, per-row validation as pure functions, a preview, batch confirmation, and per-row error reporting. Trigger phrases: "import from Excel", "new import template", "bulk upload", "mẫu import", "nhập hàng loạt".
---

# /add-import-template — add an Excel import on the shared framework

Every import in P1 — organisation & staff (4.1.7), library (4.2.5), Goal Plans (4.3.7), actuals (4.4.3)
— runs on **one** framework built first in Track T4 (WBS 4.4.3). Do not build a second one.

**Library:** `exceljs` only (the npm `xlsx` package is outdated — plan §3.1). Load it lazily inside the
import screen's chunk; never import it from a module the shell loads.

## The five stages (every template goes through all of them)

1. **Template** — a downloadable `.xlsx` generated with exceljs: one header row in Vietnamese, a hidden
   or second sheet with valid values (units, perspectives, period labels), one example row. Download
   with `downloadBlob()` from `src/lib/utils.ts`.
2. **Parse** — read the uploaded file into plain rows (`Record<column, string | number | null>`).
   Parsing does no validation.
3. **Validate per row** — a pure function in `src/lib/import<Thing>Rules.ts`:
   `validateRow(row, context) → { ok: true, value } | { ok: false, errors: RowError[] }`, where `context`
   is what the row is checked against (the tenant's employees, KPI codes, periods). Errors name the
   column and say what is wrong in Vietnamese.
4. **Preview** — a table of every row with its status; valid rows and invalid rows are counted; nothing
   is written yet.
5. **Confirm by batch** — one `IMPORT_BATCH` per upload. Decide and document whether a batch with errors
   commits its valid rows or nothing (default: **nothing**, so a half-imported plan cannot exist). Each
   committed row records `source_type = 'EXCEL'` and its `batchId`.

## Define the template

| Column (header in Vietnamese) | Required | Type | Validation | Maps to |
|---|---|---|---|---|
| `username` | ✓ | text | exists in tenant, active | `employeeId` |
| … | | | | |

Use the field lists in plan §5.2 (Goal Plan import, from HR guide pp. 61–63) and §5.3 (actuals import,
HR guide pp. 75–76) as the starting point.

## Tests — `src/lib/import<Thing>Rules.test.ts`

Valid row; each required column missing; wrong type; unknown username / KPI code / period; a username
from ANOTHER tenant (must fail — tenant isolation); duplicate rows in one file; weights not summing to
100% when the template imports a whole plan.

## Document and verify

`business-rules.md` (the import's rules and the batch policy), `component-registry.md` if you added a
shared piece, then `npm run typecheck && npm run test && npm run build && npm run lint`.
