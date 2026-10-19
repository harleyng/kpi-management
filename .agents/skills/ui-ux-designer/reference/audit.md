# Audit — technical UI quality

> Adapted from impeccable's `audit` (five dimensions, /20 score) and `harden`. See `NOTICE.md`.
> A code-level check of what is measurable. Document issues; do not fix them in the same pass. Run it on a
> track's screens before the track merges, and on the whole app before Phase 4 UAT.

## Five dimensions, each scored 0–4

### 1. Accessibility
Contrast < 4.5:1; missing labels on inputs (including inputs inside table cells — label by row and
column); icon-only buttons without `aria-label`; no visible focus or a broken tab order; headings out of
order; divs as buttons; status by colour alone; errors not announced; `prefers-reduced-motion` ignored.
0 fails WCAG A · 2 partial · 3 AA mostly met · 4 AA fully met.

### 2. Performance
A whole tenant's rows rendered without pagination; re-render storms on a table edit; heavy libraries
(recharts, exceljs) imported into the shell instead of a lazy route; layout-property animation; a
hand-rolled `manualChunks` (see `common-pitfalls.md`).

### 3. Theming
Raw hex or arbitrary colours outside `index.css` / `tailwind.config.ts`; a status tone chosen at the
call site instead of the per-set badge; tokens that break under `.dark`.

### 4. Responsive
Fixed widths that break at 768; tables without a horizontal-scroll container; touch targets < 44px on
controls used on tablets; text that overflows at 200% zoom; the sidebar not collapsing.

### 5. Implementation integrity
Drift from `design-system.md` and `operate-craft.md` §6 (the refuse list); one-off components where a
shared one exists (`component-registry.md`); calculation in JSX (CLAUDE.md rule 5); retyped error copy
(rule 6); missing loading / empty / error / blocked states; `0` rendered for a missing value.

Bands on /20: 18–20 excellent · 14–17 good · 10–13 acceptable · 6–9 poor · 0–5 critical.

## Hardening checks folded in

- **Text** — long Vietnamese names, long KPI titles, large numbers (13.400.000.000) and 100,01% all fit.
- **Errors** — every gateway read and write has a visible failure path with catalogue copy and a retry;
  user input survives a failed save.
- **Edge cases** — empty lists, no search results, no permission, read-only (locked plan), a terminated
  employee mid-period, concurrent edits (disable the button while a mutation is pending).
- **Large data** — paging or virtualisation beyond a few hundred rows; filters before scrolling.

## Output

```markdown
### 🎨 UI/UX audit — [scope]

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | ? | |
| 2 | Performance | ? | |
| 3 | Theming | ? | |
| 4 | Responsive | ? | |
| 5 | Implementation integrity | ? | |
| **Total** | | **??/20** | **[band]** |

**Findings** — `[P0–P3] issue · location (file:line) · impact · fix`
**Systemic patterns** — [recurring problems, e.g. "status tones chosen inline in 6 components"]
**What's working** — [to keep]

**Verdict:** Pass / Pass with follow-ups / Fail — [the one blocking reason if Fail]
```
