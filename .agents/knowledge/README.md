# Knowledge base — Syntra KPI

Structured project knowledge for the agent panel. There are **two kinds of file** here; do not
confuse them:

- **Current truth (read automatically):** the short rule files below. They are "what is true right
  now". An agent reads the relevant ones on its first turn.
- **History (grep only):** `decisions-log.md`. That is the chronological "why" — an audit trail, **not**
  a source of current truth. Grep it by date or keyword when you need the reasoning behind a past
  decision; never read it whole once it grows.

These are **living documents** — update them after any task that establishes a pattern, changes a
business rule, or uncovers a pitfall.

## The files

| File | Kind | Contents |
|---|---|---|
| `architecture.md` | current truth | Stack, `src/` structure, route table, the `DataGateway` data layer, fixtures, testing conventions |
| `business-rules.md` | current truth | Rules `BR-KPI-xx`: the three tiers, Goal Plans, the three P1 processes, calculation, results & pay, state sets, error catalogue, open assumptions (`ASSUMPTION Qn`) |
| `design-system.md` | current truth | Colour tokens, typography, Button/Badge API, the status → tone mapping for Goal Plans and forms, table patterns |
| `common-pitfalls.md` | current truth | Mistakes already made and things easy to get wrong — newest first, dated |
| `component-registry.md` | current truth | Catalogue of custom components and hooks by folder |
| `decisions-log.md` | **history (grep)** | Dated decisions with their reasoning |

Documents written for **people** (the product owner, HR) live in `docs/`:
`plans/KPI_repo_plan.md` (the plan) · `flows/current-flow.md` (today's Excel process) ·
`flows/new-flow.md` (the process on the system) · `source-map.md` (where each fact comes from) ·
`erd/kpi_erd.mermaid` (the ERD).

## The current-truth ↔ history split (important)

`decisions-log.md` is the **audit trail**, not the rulebook. When a decision establishes or changes a
rule, **the rule file is authoritative** — you MUST update `business-rules.md` / `architecture.md` /
`common-pitfalls.md` so the current truth is discoverable without reading history. The log entry
records *why*; the rule file records *what*. A rule that lives only in the log is effectively lost —
agents will not find it.

> The `/log-decision` skill writes the terse log entry AND prompts the rule-file update in one pass.

## Which agent reads what

| Agent | Reads (current truth only) |
|---|---|
| `cpo` | `business-rules.md` (+ `docs/plans/KPI_repo_plan.md`) |
| `ba-expert` | `business-rules.md`, `architecture.md` (+ `docs/source-map.md`, `docs/flows/*`) |
| `hr-performance-expert` | `business-rules.md` (§1, §3, §4), `common-pitfalls.md` |
| `workflow-expert` | `business-rules.md` (§2, §5), `architecture.md` (+ `docs/flows/new-flow.md`) |
| `cto` | `architecture.md`, `common-pitfalls.md` |
| `ui-ux` | `design-system.md`, `component-registry.md` (+ `.agents/skills/ui-ux-designer/reference/*` — craft floor, critique, audit, copy) |
| `system-architect` | `architecture.md`, `business-rules.md`, `common-pitfalls.md` (+ `docs/erd/kpi_erd.mermaid`) |
| `qa` | `architecture.md`, `business-rules.md`, `common-pitfalls.md` |

Editing a rule file propagates to every agent on its next invocation — no agent definitions need to change.

## How to use it

1. **Starting a task:** read the relevant rule files. Do NOT read `decisions-log.md` whole; grep it only
   for a specific past rationale.
2. **Finishing a task:** update the relevant rule file(s) with what you learned.
3. **When you make or are corrected on a decision:** record it in `decisions-log.md` (use
   `/log-decision`) **and** update the authoritative rule file.
