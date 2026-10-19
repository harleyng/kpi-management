# Operate craft — how Syntra KPI screens are built

> Adapted from impeccable (Operate mode, craft floor) and Anthropic's frontend-design. See `NOTICE.md`.
> Read this before building or reviewing any screen. `design-system.md` holds the tokens; this file
> holds the judgement.

## 1. Which mode this is

The mode names what the visitor's success looks like on a surface.

| Mode | Success | Syntra KPI surfaces |
|---|---|---|
| **Operate** | The user completes a task | **Every P1 screen**: Goal Plan, evaluation form, task inbox, imports, results, admin, dashboard |
| Read | The user understands something | Future help pages, the flow documents if ever published |
| Persuade | The user decides and acts | None in P1 (a future sales/landing page would be) |

On an **Operate** surface, ambition shows as **precision and restraint**: scanability, consistency,
familiar controls and the real usage scene outrank expression. The test: *can an HR officer who uses
tools like this trust the screen immediately, or must they pause at every subtly-off component?* The
failure mode is not flatness — it is strangeness without purpose: over-decorated buttons, mismatched
controls, gratuitous motion, invented affordances for standard tasks. The tool disappears into the task.

frontend-design's "take aesthetic risk, be distinctive" stance applies to Persuade surfaces only. Its
writing guidance, restraint and self-critique apply everywhere.

## 2. What the visual world may contribute

On a working screen the brand lends four things only: **type, palette, density, and one signature
move**. It never supplies the layout, the navigation model or the controls — those stay standard
(shadcn/Radix components, a side rail, tabs, tables with sortable headers).

- **Type** — Inter, one family. A fixed rem scale with a tight ratio (≈1.125–1.2); no fluid headings.
  Display weights never on labels, buttons or data. Prose measure 65–75ch; tables may run wide.
- **Palette** — Restrained: neutrals carry the screen; the primary purple marks primary actions,
  current selection and focus — never decoration. State colours (`support-*`) appear only where they
  carry meaning. A second neutral layer (`surface-alt`) separates panels and toolbars from content.
- **Density** — permitted and expected: many rows, many labels, compact controls, when the user needs
  them. HR compares eight goals across three scorers; do not space that into cards.
- **Signature move** — one, named concretely, and only after the screen is already clean. Candidate for
  this product: the weight total and computed score as a live, always-visible footer of every Goal Plan
  and form — the number everything else on the screen exists to settle. Not a texture or an ornament.

## 3. Components and states

Every interactive component ships with **default, hover, focus, active, disabled, loading, error** —
not half of them. And every data view handles:

| State | Syntra KPI rule |
|---|---|
| Loading | `Skeleton` holding the layout, never a spinner in the middle of content |
| Empty | `EmptyStateCard` that teaches: distinguish first use, no results, filtered out, no permission |
| Error | `ErrorStateCard` with catalogue copy and a retry — never an empty table for a failed read |
| Blocked action | Disabled **with the reason next to it** ("Tổng trọng số đang là 95%, cần 100%") |
| Read-only | Visibly read-only (actuals on the evaluation form, locked plans) |
| Long content | Long Vietnamese names and KPI titles wrap or truncate with a tooltip; nothing overflows |
| Missing value | `—`, never `0` |

Consistent affordances across the product: one button shape per role, one form-control vocabulary, one
icon set (lucide, one stroke weight). If "Lưu" looks different on two screens, one is wrong.

Overlays escape their container (Radix portals already do this — keep it that way). **A modal is not the
first thought**: inline editing, a side sheet or a page are usually better; reserve modals for
confirmations of irreversible actions (`ConfirmDialog`).

## 4. Motion

150–250 ms, conveying state only: feedback, a row added, a panel opened, loading. No page-load
choreography, no entrance animations on cards, no hover lifts. Respect `prefers-reduced-motion` with an
alternative that still shows the state change.

## 5. Craft floor — verify on the rendered result

Check these together in one look at the real screen, at the sizes it ships at (≥1280 desktop, 768
tablet; mobile is read-only for P1 unless a task says otherwise):

- **Contrast** — body and placeholder text ≥ 4.5:1, large text ≥ 3:1; secondary text on a tinted
  surface takes its tint, not plain grey.
- **Spacing** — tight within a group, generous between groups, more space above a heading than below.
- **Type** — obvious steps of size and weight; same role, same style everywhere; real copy at every width.
- **States** — the table in §3, plus keyboard focus visible on every control.
- **Browser surfaces** — tabular numerals in data (`tabular`), focus rings from `--ring`, text selection
  and underline offsets that belong to the palette.
- **Copy** — the product's own words (see `copy.md`); controls name their action.
- **Coverage** — every requirement of the work package present and findable within seconds.

## 6. Refuse — the defaults that mean nobody decided

These are the category's habits. Reaching for one when nothing in the task asks for it means it was not
decided; recognising it means rewriting the element, not softening it.

**Page scaffolds**
- Same-size cards of icon + heading + text as the page structure; nested cards (always wrong).
- The hero-metric template — big number, small label, supporting stats, gradient accent — as the
  default dashboard tile. A KPI tile earns its number with a target, a trend and a state.
- **An eyebrow / kicker label above a heading.** The heading carries its own weight.
- Section numbers (01 / 02 / 03) unless the content is a real sequence (the four registration steps are).
- A modal for a task that needs neither interruption nor protected focus.

**Surface habits**
- Gradient text; glass/blur as decoration; coloured `border-left` stripes > 1px on cards or alerts.
- Sparklines, progress rings and soft-shadowed rectangles standing in for content.
- Monospace as a "technical" costume rather than for codes and measurements.
- Emoji or Unicode glyphs instead of icons.
- **ALL-CAPS labels.** Vietnamese capitals stack diacritics (QUẢN TRỊ KPI) and lose legibility at small
  sizes; use sentence case with weight or colour for hierarchy.
- Template chrome: meta strings joined with middle dots, labels built as "WORD — fragment", an arrow
  appended to button text, tinted near-black standing in for the foreground token.

frontend-design's calibration list of generated-UI defaults is worth re-reading before any new screen:
the SaaS-card kit (identical rounded cards, one radius and one grey shadow on everything, gradient
washes), the warm-cream + serif + terracotta look, near-black + one acid accent, and broadsheet hairline
layouts. None of them is wrong in itself; each is a default, not a choice.

## 7. Process for a new screen (plan → review against the brief → build → critique)

1. **Plan** briefly before code: the work areas and what each is for, the data read first and its
   states, the primary action, where the totals and blockers sit — as prose plus a small ASCII wireframe.
2. **Review the plan against the work package**: if a part reads like the generic screen you would
   produce for any admin app (card grid, hero metrics), revise it and say what changed and why.
3. **Build** with the standard components and the tokens.
4. **Critique** the rendered screen (screenshots at the shipped sizes), batch the fixes, look again.
   Before calling it done, remove one accessory — the decoration that does not serve the task.

Spend boldness in one place, keep everything around it quiet, and build to the floor above without
announcing it.
