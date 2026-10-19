# Design system — Syntra KPI

> Living document. Referenced by: `ui-ux`.
> Tokens live in `src/index.css` (CSS variables, HSL) and `tailwind.config.ts`. `Inter` is loaded in
> `index.html`. Inherited from the OmniX Studio scaffold; the livestream-only tokens (`stage-*`,
> `kind-*`, `audio-*`, `scene-*`) were dropped.

---

## Colour

Tokens are written as `H S% L%` (**not** wrapped in `hsl()`) so Tailwind opacity modifiers work:
`bg-primary/10`, `text-support-negative/60`. A full `.dark` override set exists.

### Brand

| Token | Tailwind | Value | CSS variable (light) |
|---|---|---|---|
| Primary | `bg-primary` / `text-primary` | `#863EEA` | `--primary: 265 80% 58%` |
| Primary foreground | `text-primary-foreground` | `#ffffff` | `--primary-foreground: 0 0% 100%` |
| Primary subtle (background) | `bg-primary-subtle` | very light purple | `--primary-subtle: 265 100% 97%` |

`--ring` shares the primary value. The page background is **white** (`--background: 0 0% 100%`).

### Neutral scale

`bg-neutral-05` `#fafafa` · `bg-neutral-10` `#f5f5f5` · `bg-neutral-20` `#e5e5e5` ·
`bg-neutral-30` `#d4d4d4` · `text-neutral-50` `#737373` · `text-neutral-60` `#525252` ·
`text-neutral-90` `#1a1a1a`.

`--muted-foreground: 240 4% 46%`. `bg-surface` is the clean plane; `bg-surface-alt` is the subtle
emphasis (table row hover, placeholders).

### Semantic

| State | Tailwind | CSS variable (light) |
|---|---|---|
| Positive | `text-support-positive` / `bg-support-positive-subtle` | `158 64% 40%` |
| Negative | `text-support-negative` / `bg-support-negative-subtle` | `0 72% 51%` |
| Warning | `text-support-warning` / `bg-support-warning-subtle` | `38 92% 50%` |
| Info | `text-support-info` / `bg-support-info-subtle` | `217 91% 60%` |

---

## Status → tone mapping (MANDATORY)

If "Đã duyệt" renders green on one screen and grey on another, users stop trusting the interface. The
mapping lives in **exactly one place**: `src/components/shared/StatusBadge.tsx` — one badge per state set
(Phase 1.4). Never pick a tone at the call site.

The tones follow one principle: **muted** = nothing happening yet · **info** = waiting on someone else /
the system · **warning** = waiting on the person looking at it, or needs attention · **positive** =
settled and good · **negative** = refused or failed. A **locked** thing is settled, so it is not red.

### Goal Plan

| Status | Label (vi) | Tone | Why |
|---|---|---|---|
| Draft | Nháp | `muted` | not yet sent |
| Submitted | Đã gửi | `info` | waiting on the approver |
| Returned | Bị trả lại | `warning` | waiting on the owner to fix it — the row they must act on |
| Approved | Đã duyệt | `positive` | settled |
| Locked | Đã khóa | `muted` + lock icon | final and read-only; not an alarm |

### Form (phiếu)

| Status | Label (vi) | Tone | Note |
|---|---|---|---|
| Open | Mới | `muted` | launched, nobody has acted |
| InProgress | Đang xử lý | `info` — `warning` when it is at **my** step | the inbox highlights my turn |
| Completed | Hoàn thành | `positive` | |
| Cancelled | Đã hủy | `muted` | |
| *Overdue* (derived) | Quá hạn | `negative` | a flag next to the status, not a status |

### Cycle and period result

| Set | Value → tone |
|---|---|
| Cycle | Planning `muted` · Active `info` · Evaluating `warning` · Closed `positive` |
| Period result | Draft `muted` · Final `info` · Locked `positive` |

---

## Typography

- **Font:** `Inter, sans-serif`, applied globally on `body`; `font-sans` in Tailwind.
- Scale: `text-[10px]` (nav group labels) · `text-xs` · `text-sm` (the dense default for tables and nav)
  · `text-base` · `text-xl` (page titles) · `text-2xl` (large figures). Weights 400/500/600/700.
- **Figures use `class="tabular"`** (`font-variant-numeric: tabular-nums`): targets, actuals, weights,
  percentages, scores. Without it, numeric columns jitter.

## Radius and spacing

- `--radius: 0.5rem` (8px) is the default `rounded-lg`, alongside `rounded-md` (6) and `rounded-sm` (4).
- Spacing on the 4px scale. Nav rows are `h-9`; icon boxes `h-7 w-7`; the top bar and the sidebar header
  share `h-14` so the two sides line up.

---

## Button

`src/components/ui/button.tsx` — variants: `default` · `destructive` · `outline` · `secondary` ·
`ghost` · `link`. Sizes: `default` (h-9) · `sm` (h-8) · `lg` (h-10) · `icon`.

> ⚠️ **Never use `asChild` to wrap a `<Link>`.** It fails to render silently. Navigate with
> `useNavigate()`. See `common-pitfalls.md`.

## Badge

`src/components/ui/badge.tsx` — beyond `default`/`secondary`/`outline` it carries five semantic tones,
`positive` · `warning` · `negative` · `info` · `muted`, serving exactly the mapping above.

**A badge marks the EXCEPTION, not the norm** in a list where most rows are fine (badge the overdue form,
not every on-time one). This does not apply to a **state set** column, where every row's badge names one
of several statuses.

---

## Layout patterns

- **App frame**: a 240px sidebar (`w-60`, hidden below `md`) plus the main area; the top bar carries the
  tenant name and the **"Dữ liệu giả lập" banner** (amber, always visible). The sidebar collapses to a
  64px icon rail (⌘B / Ctrl-B), a remembered user preference — never collapsed by a route.
- **The sidebar is a three-part column**: product mark, scrolling nav (5 groups by role), account block
  on the bottom edge.
- **Page heading**: `<PageHeader title description actions>` on every route-level screen. The title is
  the same string as the menu item.
- **Unbuilt blocks**: `<PlaceholderPanel spec items>` naming the WBS work package and track.
- **Tables** (most screens): wrap in `<Card><CardContent className="p-0">`; header `text-xs uppercase
  tracking-wide text-muted-foreground`; rows `hover:bg-surface-alt`. **Numeric columns right-aligned,
  `tabular`, unit in the header.** Editable cells look editable; values computed by the rules (score,
  "chưa giao", weight total) look computed (muted background, no input border).
- **Totals and blockers** sit where the decision is made: the weight total and the computed score at the
  bottom of a Goal Plan or form, with the reason a Submit is disabled spelled out next to it.
- **Empty states**: `<EmptyStateCard>` with a sentence naming the next step — never just "Không có dữ liệu".
- **Failed reads**: `<ErrorStateCard spec={errorSpecOf(error)} onAction={refetch}>` — never an empty table.

## Message placement

| Kind | Component |
|---|---|
| Write succeeded / failed | `toast` (sonner, top-right) with catalogue copy on failure |
| A read failed | `ErrorStateCard` in place of the table |
| A field is invalid | `text-xs text-support-negative` directly beneath the field |
| An import row is invalid | the row's own error cell in the preview table |

---

## Accessibility

- Every icon-only button needs an `aria-label`.
- Inputs inside table cells are labelled by their row and column (e.g. `aria-label="Trọng số — Doanh thu"`).
- Never convey status **by colour alone**: badges always carry their text label; overdue carries text too.
- Focus rings use `--ring` (the primary colour); never disable the outline.

## Reporting figures honestly

- A missing value renders `—`; a genuine zero renders `0`. "Chưa nhập số" and "thực tế bằng 0" are
  different answers and score differently (BR-KPI-32).
- A number that is an assumption (sample rating scale, sample payout) says so on screen.
- Format with `formatNumber` / `formatPercent` / `formatDate` from `src/lib/utils.ts` (`vi-VN`,
  Asia/Ho_Chi_Minh).
