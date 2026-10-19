---
name: add-calc-method
description: Add or change how Syntra KPI computes an achievement % — a pure function in src/lib/calcRules.ts with an edge-case test table (actual 0, target 0, cap, floor, level boundaries), the business-rules.md update and a logged decision. KPI Rules lane — hr-performance-expert reviews. Trigger phrases: "new calculation method", "change how % is computed", "RATIO_UP/RATIO_DOWN/TIERED/BINARY/FORMULA/LEVELS", "cap", "floor", "định mức".
---

# /add-calc-method — add or change a calculation method

This is the **KPI Rules** lane: `hr-performance-expert` + `qa` review the design in Phase 2. A method
decides a percentage that becomes a score that becomes pay — treat it accordingly.

## 1. Declare it

- Add the method type to the `CALC_METHOD_TYPES` set in `src/data/types.ts` (ERD `CALC_METHOD.method_type`:
  `RATIO_UP` / `RATIO_DOWN` / `TIERED` / `BINARY` / `FORMULA`, plus `LEVELS` from D1) and its Vietnamese
  label.
- If it needs parameters (tiers, levels, an expression), extend the method's type — never a loose
  `Record<string, unknown>`.

## 2. Implement it — `src/lib/calcRules.ts`

A pure function, no React, no gateway:

```ts
/** BR-KPI-xx — what it computes, and where the rule comes from (source + page). */
export function achievementPct(method: CalcMethod, input: AchievementInput): number | null
```

- Return `null` when the actual is missing — **never 0**.
- Handle division by zero explicitly (`RATIO_UP` with target 0, `RATIO_DOWN` with actual 0) and say in
  a comment what the answer is and why.
- Apply the raw formula, then the **floor**, then the **cap** — one order, everywhere.
- No rounding here unless the rule says so; rounding happens once, at display or at finalisation.
- A value that depends on an open question (Q1 interpolation for `LEVELS`, Q4 direction) uses the
  plan's default and carries `// ASSUMPTION Qn`.

## 3. Test it — `src/lib/calcRules.test.ts`

A table-driven `it.each` with at least:

| Case | Example |
|---|---|
| Normal | actual 80, target 100 → 80 |
| Actual = 0 | — |
| Target = 0 | — |
| Above the cap | actual 150, cap 120 → 120 |
| Below the floor | — |
| Missing actual | `null` → `null` |
| `LEVELS` exactly on L1 / between L1 and L2 / above L3 | per Q1 |
| `BINARY` text target (Đạt / Không đạt) | — |

## 4. Document it

- `.agents/knowledge/business-rules.md` §3 — the method, its formula, cap/floor behaviour and edge
  answers, with the BR code and source.
- `/log-decision` — especially for any edge answer you chose (what target 0 means).

## 5. Verify

`npm run typecheck && npm run test && npm run build && npm run lint`. Grep for the function's callers —
a rule that is tested and wired to nothing is a known trap (`common-pitfalls.md`).
