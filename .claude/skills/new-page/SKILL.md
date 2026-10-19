---
name: new-page
description: Scaffold a new Syntra KPI route + page + navigation entry — a page component under src/pages, a lazy <Route> in App.tsx under AppShell, an item in the right role group of navConfig.ts, and a row in the architecture.md route table. Use PROACTIVELY before creating any page-level screen. Trigger phrases: "new page", "add a screen/view", "create a route", "add to the menu".
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
next to its neighbours, and place the route under its group's comment:

```tsx
const ThingPage = lazy(() => import('@/pages/ThingPage'));
…
<Route path="/admin/thing" element={<ThingPage />} />
```

Route-level lazy loading is what keeps recharts and exceljs out of the initial chunk — never import a
page eagerly.

Path prefixes follow the menu groups: `/my/*` (Của tôi), `/team/*` (Đội nhóm), `/dashboard`
(Điều hành), `/admin/*` (Quản trị KPI), `/system/*` (Hệ thống).

## 3. Add the navigation entry — `src/components/layout/navConfig.ts`

Navigation is **5 groups by role** (plan §7.1). Add `{ title: 'Tên mục', url: '/<path>', icon }` to
the right group's `items`. The `title` must be the **same string** the page passes to `<PageHeader>` —
two words for one screen is how a menu and its page start disagreeing.

Who sees it is decided by the GROUP's `roles`, filtered by `permissionRules` (Phase 1.3) — never a role
check in the sidebar or the page. If a screen needs a role set no group has, raise it with `cpo` rather
than adding an ad-hoc check.

Not every route belongs in the navigation — a Goal Plan's own page or a form opened from the task inbox
is reached from a list, not from the sidebar.

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
