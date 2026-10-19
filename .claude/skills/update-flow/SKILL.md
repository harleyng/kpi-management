---
name: update-flow
description: Change a process or a business rule in Syntra KPI and keep the code and documentation in step — docs/flows/*.md, business-rules.md, the rule in src/lib, the state sets, and the decision log. Trigger phrases: "change the flow", "new rule", "the step should be", "rework the process", "đổi quy trình".
---

# /update-flow — change a process without leaving the documentation behind

A process change is **not finished** when only the code changes. This is a prototype whose purpose is to
settle the process with HR, so the documents are half of the product.

## 1. Write the proposal first — `docs/flows/new-flow.md`

- Update the mermaid diagram of the affected process.
- Add a row to the **differences table**: today's behaviour (from `current-flow.md` or the BR code), the
  new behaviour, why, and the impact.
- Anything unresolved goes into **open questions** with an owner — do not guess and move on. If it is
  one of the plan's Q1–Q10, reference it.

Stop here and get agreement if the change is anything more than mechanical.

## 2. Once settled, sweep the code surfaces

| Surface | Where |
|---|---|
| **Screens and routes** | `src/App.tsx`, `src/components/layout/navConfig.ts`, the route table in `architecture.md` |
| **Rules** | `src/lib/*Rules.ts` — `calcRules`, `scoreRules`, `goalPlanRules`, `alignmentRules`, `workflowRules`, `ratingRules`, `formRules`, `permissionRules` — as **pure functions with tests**, never conditions in JSX |
| **State sets** | `src/data/types.ts` (+ label maps) |
| **Fixtures** | `src/data/fixtures/` — after Gate 1 this is a **Large** change (system-architect, tell the tracks) |
| **Error copy** | `src/lib/errorCatalog.ts` — never retype a string on a screen |
| **Notifications** | the template text, if the process sends one |

A rule change that does not touch a test is suspicious. If the rule is real, a test should have had to change.

## 3. Update the documentation

- `.agents/knowledge/business-rules.md` — **the authoritative current rules**. Mandatory.
- `docs/flows/new-flow.md` — the settled decision with its date and reason.
- `docs/flows/current-flow.md` — only if our understanding of today's process changed.
- Run **`/log-decision`** for the entry in `decisions-log.md`.

## 4. Verify

```bash
npm run typecheck && npm run test && npm run build && npm run lint
```

## The check that catches most misses

Read the new rule out loud, then ask: *could QA write a test case from this sentence alone?* If not, the
rule is not specified yet — go back to step 1.
