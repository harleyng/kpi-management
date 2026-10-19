---
name: new-page
description: Scaffold a new Syntra KPI route + page + navigation entry — a page component under src/pages, a lazy <Route> in App.tsx under AppShell, an item (or a sub-item of an area) in the right role group of navConfig.ts, detail routes under their list, and a row in the architecture.md route table. Use PROACTIVELY before creating any page-level screen. Trigger phrases: "new page", "add a screen/view", "create a route", "add to the menu".
---

# /new-page — scaffold a route, a page and its navigation

One page = one file. There is no version-routing indirection.

## 1. Create the page component

`src/pages/<Name>Page.tsx`, default-exporting a component. Read identity and tenant from
`useSession()` (`@/contexts/useSession`) and data from the relevant `use…()` hook in
`src/hooks/queries/` — never from `getDataGateway()` directly.

Start from `<PageHeader title description actions>` and, for anything not yet built, a
`<PlaceholderPanel spec items>` naming the **WBS work package and track** (e.g.
`"WP 4.3.2 · Track T3"`) and listing the remaining work in Vietnamese.

UI copy is **Vietnamese, inline**. Code and comments are English.

## 2. Add the `<Route>` in `src/App.tsx`

Every route nests inside `<Route element={<AppShell />}>`. Import the page **lazily** at the top,
next to its neighbours, and place the route under its group's comment. The `path` is **absolute** and
the route's **first attribute** — `navConfig.test.ts` parses them from the file:

```tsx
const ThingPage = lazy(() => import('@/pages/ThingPage'));
…
<Route path="/admin/thing" element={<ThingPage />} />
```

Route-level lazy loading is what keeps recharts and exceljs out of the initial chunk — never import a
page eagerly. Sub-pages of one area share ONE module and pick their section by prop
(`<KpiLibraryPage section="units" />`); a detail page is a named export pulled in with
`lazy(() => import('@/pages/X').then((m) => ({ default: m.ThingDetailPage })))`.

Path prefixes follow the menu groups: `/my/*` (Của tôi), `/team/*` (Đội nhóm), `/dashboard/*`
(Điều hành), `/admin/*` (Quản trị KPI), `/system/*` (Hệ thống).

## 3. Add the navigation entry — `src/components/layout/navConfig.ts`

Navigation is **5 groups by role** (plan §7.1). An item is either a destination
`{ title, url, icon, permission }` or a **parent** `{ title, url, icon, children, carryParams? }` whose
children `{ title, url, permission }` are one area's sub-pages. **A screen with tabs is not a page —
each tab is a sub-page with its own route** (product owner, 2026-10-19). The `title` must be the
**same string** the page passes to `<PageHeader>` — two words for one screen is how a menu and its page
start disagreeing; on a sub-page that also makes the area show as its breadcrumb.

- A child's `url` sits under its parent's; a parent's own url has NO route (the shell redirects it to
  the first child via `legacyRedirect` in `src/lib/navRules.ts` — add the area there).
- A destination's `permission` shows the item AND opens its route and every detail route under it.
  Sub-items inherit their area's permission; a narrower one changes who sees the group — check plan
  §7.1 in `navConfig.test.ts`. Never a role check in the sidebar or the page.
- Destination urls never nest inside one another (the test fails) — `/admin/thing/new` is a detail
  route of `/admin/thing`, not a menu item.

**Detail pages are routes, not menu items.** A record opens at `<list url>/:id` — never below, beside
or in place of its list (product owner, 2026-10-19). It takes `<PageHeader breadcrumb={[{ label: '<list
title>', to: '<list url>' }]} title={record.name} status={<Badge/>}>`, checks its record (unknown id →
ERR-KPI-02 under the header) and, for an editor, renders `<UnsavedChangesGuard when={dirty} />`.

## 4. Update the route table

Add the route to `.agents/knowledge/architecture.md` (the route table), with its menu group, roles and
the WBS work package(s) it implements. That table is how every agent finds its way around.

## 5. Navigation is `useNavigate()`, NEVER `asChild` + `<Link>`

`<Button asChild><Link>` fails to render silently (see `common-pitfalls.md`). Use
`const navigate = useNavigate(); … onClick={() => navigate('/thing')}`.

## 6. Verify

Phase 4: `npm run typecheck && npm run test && npm run build && npm run lint` all green; the smoke spec
in `e2e/specs/` lists every menu route, so add the new one there. Adding a page is Medium-sized — follow
the full four-phase workflow unless the user says otherwise. Close with **`/log-decision`** if it
introduced a new pattern.
