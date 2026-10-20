# Design system — Syntra KPI

> Living document. Referenced by: `ui-ux`.
> Tokens live in `src/index.css` (CSS variables, HSL) and `tailwind.config.ts`. `Inter` is loaded in
> `index.html`. Inherited from the OmniX Studio scaffold; the livestream-only tokens (`stage-*`,
> `kind-*`, `audio-*`, `scene-*`) were dropped.
> The design judgement (mode, craft floor, refuse list, critique/audit) lives in
> `.agents/skills/ui-ux-designer/reference/` — adapted from impeccable and Anthropic's frontend-design.

---

## Principles (Operate mode)

Every P1 screen is an **Operate** surface: the user came to finish a task. Ambition shows as precision
and restraint, not expression (`reference/operate-craft.md`).

1. **Standard controls, familiar navigation.** The brand lends type, palette, density and one signature
   move — never the layout, the navigation model or the controls.
2. **Restrained colour.** Neutrals carry the screen; primary purple marks primary actions, selection and
   focus only; `support-*` tones appear only where they mean a state.
3. **Density where comparison happens.** Tables over card grids; no nested cards; no hero-metric tiles.
4. **Every state designed** — loading, empty, error, blocked (with the reason), read-only, long content.
5. **Sentence case everywhere.** No ALL-CAPS labels, no eyebrow above a heading: Vietnamese capitals
   stack diacritics and lose legibility at small sizes, and an eyebrow is template chrome.
6. **Motion conveys state only**, 150–250 ms; no entrance choreography.
7. **Words are design.** Glossary terms, actions that keep their name from button to toast, errors that
   say how to recover (`reference/copy.md`).

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
mapping lives in **exactly one place**: `src/components/shared/statusTones.ts` (pinned by
`statusTones.test.ts`), rendered by one badge per state set in `StatusBadge.tsx` (`GoalPlanStatusBadge`,
`FormStatusBadge`, `CycleStatusBadge`…). A screen passes only the status. Never pick a tone at the call site.

The tones follow one principle — **five colours, one meaning each**:

| Tone | Colour | Means |
|---|---|---|
| `info` | blue | **waiting** — on someone else or on the system |
| `positive` | green | **in effect ("applying") or succeeded** |
| `warning` | yellow | **needs action** — waiting on the person looking at it, or a warning |
| `negative` | red | **error** — refused or failed |
| `muted` | grey | **cancelled**, ended, or not started yet (a draft) |

### Goal Plan

| Status | Label (vi) | Tone | Why |
|---|---|---|---|
| Draft | Nháp | `muted` | not yet sent |
| Submitted | Đã gửi | `info` | waiting on the approver |
| Returned | Bị trả lại | `warning` | the owner must fix it |
| Approved | Đã duyệt | `positive` | settled |
| Locked | Đã khóa | `positive` + lock icon | in effect for the cycle |

### Form (phiếu)

| Status | Label (vi) | Tone | Note |
|---|---|---|---|
| Open | Mới | `info` | launched, waiting on its first actor |
| InProgress | Đang xử lý | `info` — `warning` when it is at **my** step | the inbox highlights my turn |
| Completed | Hoàn thành | `positive` | |
| Cancelled | Đã hủy | `muted` | |
| *Overdue* (derived) | Quá hạn | `negative` | a flag next to the status, not a status — `<OverdueBadge>` |

"My step" is `formTone(status, atMyStep)`; whether it IS my step comes from `workflowRules`.

### Cycle and period result

| Set | Value → tone |
|---|---|
| Cycle | Planning `info` · Active `positive` · Evaluating `warning` · Closed `muted` (over) |
| Period result | Draft `muted` · Final `info` (waiting to be locked) · Locked `positive` |

### The other state sets

| Set | Value → tone |
|---|---|
| Goal | Active `positive` · Changed `muted` (superseded; read the replacement) · Cancelled `muted` |
| Library (KPI, template) | Draft `muted` · Active `positive` · Archived `muted` |
| Launch | Scheduled `info` · Launched `positive` · Cancelled `muted` |
| Import batch | Validating `info` · Committed `positive` · Rejected `negative` |
| Sync run | Running `info` · Succeeded `positive` · PartiallyFailed `warning` (+ a row count via `detail`) · Failed `negative` |
| Notification | Queued `info` · Sent `positive` · Read `positive` · Failed `negative` |
| Employment | Probation `info` · Official `positive` · Resigned `muted` |
| Record (Active/Inactive) | Active `positive` · Inactive `muted` |
| Delegation (derived) | Upcoming `info` · Active `positive` · Expired `muted` · Revoked `muted` |
| Goal change type | Add `positive` · Update `info` · Cancel `muted` |

---

## Typography

- **Font:** `Inter, sans-serif`, applied globally on `body`; `font-sans` in Tailwind.
- One family; a fixed rem scale with a tight ratio, no fluid headings: `text-xs` (captions, nav group
  labels, table headers) · `text-sm` (the dense default for tables and nav) · `text-base` · `text-xl`
  (page titles) · `text-2xl` (large figures). Weights 400/500/600/700. Hierarchy comes from size and
  weight, never from uppercase or letter-spacing.
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

A **state set** column badges every row in its tone, so an in-effect row reads green. A derived flag
(overdue, attention) is still added only to the rows it applies to.

---

## Layout patterns

- **App frame**: a 240px sidebar (`w-60`, hidden below `md`) plus the main area; the top bar carries the
  tenant (building icon + name, no caption above it) and the **"Dữ liệu giả lập" banner** (amber, always
  visible). The sidebar collapses to a 64px icon rail (⌘B / Ctrl-B), a remembered user preference —
  never collapsed by a route.
- **The sidebar is a three-part column**: product mark, scrolling nav (5 groups by role, group captions
  `text-[11px] font-semibold uppercase tracking-wider text-sidebar-section` — a plain grey, the one
  place uppercase is used, so a module reads apart from its near-white items), account block on the bottom edge.
  It sits on a **dark purple surface** (`--sidebar-*` tokens, `bg-sidebar`) to set the frame apart from the
  white body — inside it use only `sidebar-*` colours (`text-sidebar-muted-foreground`, never
  `text-muted-foreground`), and give focus rings `ring-offset-sidebar`.
- **Canvas and cards**: the main area sits on a light blue-grey `bg-canvas` (the top bar, dialogs, sheets and
  inputs stay on white `bg-background`). Cards and tables are **borderless with a soft shadow** — the
  `.border.bg-card` rule in `index.css` does this for `<Card>` (and so `<DataTable>`) and for every
  `rounded-md border bg-card` section. A new white panel uses `bg-card` + `border` and gets it for free;
  don't add your own `shadow-*` or border colour to it.
- **Row dividers**: tables and `divide-y` lists use a very light `--divider` line between rows (global
  rule in `index.css`); headers use a mid purple (`--table-head`, lighter than the menu) with white text — forced in `index.css`, so
  don't set a text colour on a header cell; to highlight one, give it `bg-primary`. A sticky cell uses `bg-inherit` to take its
  row's fill.
- **Areas with sub-pages** (sidebar): a parent is a disclosure button (icon, title, chevron that turns
  90°) over its sub-items — indented, no icon, `h-8`. Accordion: one area unfolded by hand at a time,
  and the area holding the current page always open (its button inert). The filled highlight is on the
  sub-item you are on (`aria-current="page"`, also on its detail pages); the area is marked by weight
  only. On the icon rail the area's icon opens a menu of its sub-items, headed by the area's title.
- **No tabs for pages.** A screen that would need top-level tabs is an area with sub-pages, each its own
  route. Tabs are only for FACETS of one record on its detail page (a cycle's periods / plans; a goal's
  information / split / links), with the tab in the URL (`?tab=`).
- **Page heading**: `<PageHeader title description actions>` on every route-level screen. The title is
  the same string as the menu item; on a sub-page the area shows above it as a breadcrumb
  (`<nav aria-label="Đường dẫn">`, plain text — not an eyebrow). It also sets the browser title.
- **Detail pages**: a list never shows a record's detail below, beside or in place of itself — the
  record opens on its own route. One header order everywhere: breadcrumb with explicit links back
  (`Chu kỳ › KPI 2027`) → title = the record's name with its status badge (`status`) → description =
  context → actions on the right (Sửa…). Not found / not allowed: `ErrorStateCard` ERR-KPI-02 under the
  header, never a blank page. Small create/edit forms are a Sheet or Dialog; a big editor is its own
  page with `<UnsavedChangesGuard when={dirty} />`.
- **Unbuilt blocks**: `<PlaceholderPanel spec items>` naming the WBS work package and track.
- **Tables** (most screens): use `<DataTable>` — it already wraps in `<Card><CardContent className="p-0">`, takes
  the `useQuery` result, and settles error → first load → empty (first-use vs "Không có dòng nào khớp bộ lọc.")
  → rows, sort headers with `aria-sort` (missing values last), `—` for a missing cell, client or server paging; header `text-xs font-medium
  text-muted-foreground` in sentence case; rows `hover:bg-surface-alt`. **Numeric columns right-aligned,
  `tabular`, unit in the header.** Editable cells look editable; values computed by the rules (score,
  "chưa giao", weight total) look computed (muted background, no input border).
- **List toolbar**: search and filters (`toolbar`) on the left and the list's primary action (`actions`)
  on the right, in one row ABOVE the table's card, on the page canvas — never inside the card. Both stay
  in every state (loading, empty, error). With `actions`, the empty state shows only its sentence, not a
  second copy of the button. Page-level actions (export, a cycle / period picker) stay in the
  `PageHeader`.
- **Totals and blockers** sit where the decision is made: the weight total and the computed score at the
  bottom of a Goal Plan or form, with the reason a Submit is disabled spelled out next to it.
- **Empty states**: `<EmptyStateCard>` with a sentence naming the next step — never just "Không có dữ liệu".
- **Failed reads**: `<ErrorStateCard spec={errorSpecOf(error)} onAction={refetch}>` for a page, `<ErrorState>` inside a
  panel or popover — never an empty table.
- **Form fields**: `<FormField label required hint error>{(control) => <Input {...control} />}</FormField>` — `*`
  for required (with `RequiredLegend` "* Bắt buộc" atop long forms), the error beneath the control, announced.
- **Pickers**: `KpiPicker`, `EmployeePicker` (search ignores diacritics; archived KPIs and resigned people show
  disabled but still display as a current value) and `OrgUnitTree` (an ARIA tree, one tab stop). A selected value
  never vanishes: "Đang tải…" while loading, a warning "Không còn trong danh sách" once loaded without it.

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
