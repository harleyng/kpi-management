# Critique — a scored UX review

> Adapted from impeccable's `critique` (Nielsen heuristics, personas, severity). See `NOTICE.md`.
> Use for: Phase 2 review of a design, and any "review this screen" request. It evaluates the
> experience; for code-level quality use `audit.md`.

## Procedure

1. Open the screen in the running app (`npm run dev`, port 8082) with realistic seed data, at desktop and
   tablet widths. Walk the primary task as each relevant persona. A critique from source code alone must
   say so.
2. Start with the **specificity verdict**: does the screen feel authored for a KPI workflow, or
   interchangeable with any admin template? Name the generic choices (see `operate-craft.md` §6).
3. Score the ten heuristics, 0–4 each. Be honest: 4 means genuinely excellent; most real screens score
   20–32 of 40. Write `n/a` with a reason for a heuristic that cannot apply, and renormalise the maximum.
4. List 3–5 priority issues with P0–P3 severity, then persona red flags, then minor observations.

## The ten heuristics, read for Syntra KPI

| # | Heuristic | What to look for here |
|---|---|---|
| 1 | Visibility of system status | Whose turn is the form, which step, how long until the deadline; save/submit confirmed; weight total live |
| 2 | Match with the real world | Glossary words (KGI, KPI, Goal Plan, cascade/link, định mức); BSC order; periods as HR names them (T01, Q1) |
| 3 | User control and freedom | Save draft, return to previous step, cancel a launch, clear filters, undo a row edit |
| 4 | Consistency and standards | One badge per state set, one button vocabulary, the same column order on plan and form |
| 5 | Error prevention | Submit blocked with the reason; weight tolerance; cascade over-allocation refused before saving |
| 6 | Recognition over recall | KpiPicker from the library instead of typing; the manager's goal visible when linking |
| 7 | Flexibility and efficiency | Keyboard entry across a scoring column; bulk import; filters that persist |
| 8 | Aesthetic and minimalist design | Only what the decision needs; no decorative cards; density where comparison happens |
| 9 | Error recovery | ERR-KPI copy says what failed and what to do; import errors per row, fixable without re-uploading all |
| 10 | Help and documentation | Formula and data source visible on each KPI; helper text that answers a real question |

Scoring per heuristic: **0** absent / user is guessing · **1** rare, major gaps · **2** partial ·
**3** good, minor gaps · **4** excellent throughout. Bands on /40: 36–40 excellent · 28–35 good ·
20–27 acceptable · 12–19 poor · < 12 critical.

## Severity

- **P0 Blocking** — prevents the task, misreports a score or a state, or loses data. Fix now.
- **P1 Major** — significant difficulty or a WCAG AA failure. Fix before the track merges.
- **P2 Minor** — annoyance with a workaround. Next pass.
- **P3 Polish** — no real user impact. Keep these few; a long tail buries what matters.

## Personas (walk the primary action as 2–3 of them)

| Persona | Typical red flags |
|---|---|
| **Nhân viên** registering goals at month start | Cannot tell how far from 100% they are; linking needs the manager's goal code from memory; evidence upload hidden |
| **Trưởng phòng** scoring 8 reports in one sitting | No keyboard flow down a column; must open each form separately; cannot see self-score next to own score |
| **HR / C&B** closing a period | No overview of overdue forms; finalising has no confirmation naming the period; export without a reconciliation total |
| **Ban điều hành** on the dashboard | Numbers without targets or trend; cannot drill from company to department; assumptions not labelled |
| **First-time user** | Jargon without a tooltip (CSF, KRI); icon-only buttons; empty states that say nothing about the next step |

Name the exact element and interaction that fails each persona; do not describe the persona.

## Cognitive load quick check

Flag: a wall of options without grouping; a memory bridge (information needed on one screen shown only
on another); hidden navigation; jargon; visual noise; the same pattern behaving differently in two
places; a task that needs two screens at once; a context switch mid-task.

## Output

```markdown
### 🎨 UI/UX critique — [screen]

**Specificity verdict** — [authored for this task, or which generic defaults it uses]

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | ? | |
| … | | | |
| **Total** | | **??/40** | **[band]** |

**Priority issues**
- **[P?] What** — why it matters · fix · where (file / component)

**Persona red flags** — [persona: what broke]
**Minor observations** — [short list]
**What's working** — [2–3 specific things to keep]

**Verdict:** Approve / Approve with corrections / Request redesign — [the one blocking reason if not Approve]
```
