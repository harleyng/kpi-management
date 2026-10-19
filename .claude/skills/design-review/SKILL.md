---
name: design-review
description: Run a design quality pass on a Syntra KPI screen — `critique` (scored UX review, Nielsen /40 + personas), `audit` (technical UI quality /20), `polish` (fix pass in triage order) or `copy` (Vietnamese interface copy). Uses the ui-ux-designer references adapted from impeccable and Anthropic's frontend-design. Trigger phrases: "review this screen", "critique", "audit the UI", "polish", "make it look better", "UX copy", "đánh giá giao diện".
---

# /design-review — critique, audit, polish or copy

Usage: `/design-review <critique|audit|polish|copy> [route or component]`. With no mode, ask which one
(one line each, below) — never run all four.

| Mode | What it does | Reference |
|---|---|---|
| `critique` | Scored UX review: specificity verdict, Nielsen 10 /40, P0–P3 issues, persona red flags | `.agents/skills/ui-ux-designer/reference/critique.md` |
| `audit` | Technical quality: a11y, performance, theming, responsive, implementation integrity /20 | `.agents/skills/ui-ux-designer/reference/audit.md` |
| `polish` | Fix pass on a finished feature, in triage order, then re-check | `.agents/skills/ui-ux-designer/SKILL.md` (Polish) + `reference/operate-craft.md` §5 |
| `copy` | Rewrite unclear Vietnamese interface text | `.agents/skills/ui-ux-designer/reference/copy.md` |

## Steps

1. Read `.agents/skills/ui-ux-designer/reference/operate-craft.md` (always) and the mode's reference.
2. **Look at the rendered screen.** Start `npm run dev` (port 8082) if it is not running and capture the
   target at 1280 and 768 widths with Playwright (screenshots into the session scratchpad, never into
   the repo). Batch the checks into one look; fix, then look again — not a screenshot per tweak. If the
   app cannot run, say the review is source-only.
3. `critique` and `audit` **report only** — they change no code. Present the report in the reference's
   format and ask which findings to fix.
4. `polish` and `copy` **change code**: they are Small/Medium tasks under the four-phase workflow, so the
   Phase 4 gate applies (`npm run typecheck && npm run test && npm run build && npm run lint`), plus
   `npm run test:e2e:smoke` when a route's headings or menu labels changed. Polish refines the incumbent
   design; if the concept is wrong, stop and say so instead of redesigning quietly.
5. A finding that reveals a missing rule (a new tone, a new pattern) goes into `design-system.md` via
   `/log-decision`.
