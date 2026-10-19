# Common pitfalls — Syntra KPI

> Living document. Things that have gone wrong or are easy to get wrong. **Newest first**, dated.
> Add an entry whenever a non-obvious bug bites.
>
> The entries below were **inherited from the OmniX Studio scaffold on 2026-10-19** — only the ones
> that belong to the shared stack (React, React Router, Radix, React Query, Vite, Zustand, `Intl`).
> Each keeps the date it was first recorded there.

---

## 2026-10-19 — `queryClient.clear()` does not refetch what is on screen

`clear()` empties the cache but a mounted `useQuery` keeps its observer's last result and does not
refetch until something re-renders it — after a reseed the screen kept showing rows that no longer
existed. **Rule.** To drop everything AND reload what is mounted, use `queryClient.resetQueries()`
(`useResetSeed`). Likewise, an app-level error screen must check `error && !data`: a failed BACKGROUND
refetch keeps its data, and replacing the app over it unmounts the controls (the dev toolbar) that caused it.

---

## 2026-10-19 — Seed rows never pass through the gateway, so nothing validates them unless a test does

The mock loads the seed straight into its tables — no transaction, no integrity check. A fixture that
pointed at another tenant's row, a duplicate code or a step of the wrong workflow would load fine and fail
only when a screen tried to write next to it. Worse, a seeded form 78 days past its due date looked
correct until the first scheduler run locked it.

**Rule.** `seed.test.ts` inserts every seeded row into a `Tx` and runs `validateTransaction` — the same
check every write passes — and asserts the timeline (no step overdue and unhandled at the last tick but
the one named). Change a fixture, run it.

---

## 2026-10-19 — React Router v6 hands out a NEW `navigate` after every navigation

`useNavigate()` (outside a data router) returns a function that depends on the current location, so a
`useCallback(…, [navigate])` is re-created on every route change — and a context value memoised on it
re-renders EVERY consumer on every navigation. Caught by the SessionProvider stability test.

**Rule.** In a provider or any long-lived handler, keep `navigate` in a ref (`latest.current.navigate`)
and give the callback no dependency on it.

---

## 2026-10-19 — Node ≥ 22's global `localStorage` shadows jsdom's in Vitest

Node ships an experimental `localStorage` accessor that is `undefined` without `--localstorage-file`, and it
wins over jsdom's: `localStorage.clear()` in a test throws "Cannot read properties of undefined". Reading it
also prints an ExperimentalWarning per worker.

**Rule.** `src/test/setup.ts` re-points `localStorage` / `sessionStorage` at `globalThis.jsdom.window` when
the global is Node's accessor (checked through the property descriptor, never by reading it). Do not remove it.

---

## 2026-10-19 — The session hooks are the ONE place a hook takes `tenantId` explicitly

`useTenants` / `useSessionDirectory(tenantId)` (`src/hooks/queries/session.ts`) run inside the
`SessionProvider`, before `useSession()` exists. Every other hook reads the tenant from `useSession()`;
do not copy the explicit-tenant shape elsewhere. A disabled `useSessionDirectory(null)` is `isPending`
for ever — the provider checks for a tenant first.

---

## 2026-10-15 — `NavLink` overwrites the `aria-current` you pass it

A link meant to be "current" on pages outside its own url LOOKED current (its class came from our own
match), but a screen reader was told nothing: `NavLink` computes `aria-current` from its own url-only
match and sets it after the props you spread.

**Rule.** When "current" is decided by anything other than the link's own url, render a plain `Link`
and set `aria-current` yourself.

---

## 2026-10-15 — `generatePath` reads `:param#hash` as ONE parameter name

`generatePath('/x/:id#section', params)` looks for a parameter called `id#section` and lands on the
literal text. The redirect renders; it just goes nowhere.

**Rule.** Build a target with a hash or query in a small path helper, never with `generatePath`.

---

## 2026-09-14 — A Zustand selector that returns `{ … }` is an infinite render loop (v5)

Zustand **v5** compares selector results with `Object.is`, so a new object on every read counts as a
change on every read → "Maximum update depth exceeded".

Select each field on its own (`useStore((s) => s.collapsed)`), or wrap an object/array selector in
`useShallow` from `zustand/react/shallow`. Never derive a new array (`.filter`, `.map`) inside a selector.

---

## 2026-09-03 — A rule helper that is written, tested, and wired to NOTHING

A predicate was exported, covered by tests, and referenced by zero screens — while the bug it existed to
prevent was live. The passing test made the module look finished.

**Rule.** When adding a rule helper, **grep for its callers before calling the task done** — the test
proves it computes the right answer, not that anybody asks the question. On this repo that applies
doubly to `src/lib/*Rules.ts`: a `canSubmit` nobody calls is a Submit button that accepts 90% weights.

---

## 2026-08-28 — A DISABLED React Query query is `isPending` for ever

`enabled: Boolean(id)` plus `isPending` in a loading gate hangs the screen when the id is missing: in v5
a disabled query never leaves the pending state.

Settle "is there even an id" BEFORE anything waits on a query keyed by it.

---

## 2026-08-27 — A Radix `asChild` Slot STRINGIFIES `NavLink`'s `className` render prop

`<NavLink className={({ isActive }) => ...}>` inside `<TooltipTrigger asChild>` silently stops working:
the Slot merges `className` by **string-joining**, so the FUNCTION is joined as its own source text. The
link ends up with no real classes — no error anywhere. Under a Slot, resolve the state yourself
(`useMatch`) and pass a **string** (see `AppSidebar.tsx`).

---

## 2026-08-22 — A REDIRECT derived from a still-loading query fires before the data that would prevent it

A wizard redirected to `min(currentStep, reachableStep)`; on a fresh load the queries were briefly
empty, so the gate read "nothing is done" and redirected **permanently**. It presented as a flaky test.

**An empty answer and a pending one are different facts.** Anything irreversible — a redirect, a
`<Navigate replace>`, a destructive default — waits for every query it reads.

---

## 2026-08-22 — A `useEffect` whose deps array names a later `const` is a TDZ crash, not a warning

The dependency array is evaluated **during render**. An effect above `const patch = useCallback(…)` that
lists `patch` throws `ReferenceError: Cannot access 'patch' before initialization` on first render.

---

## 2026-08-22 — A search that compares `toLowerCase()` is broken for Vietnamese

Lower-casing does not touch tone marks, so "Nguyễn" is unreachable by typing `nguyen`. Users routinely
type without diacritics. Use **`foldDiacritics`** from `src/lib/utils.ts` on BOTH sides of the
comparison, and the shared `SearchInput`.

---

## 2026-08-21 — Slicing a formatted date to get the time prints the YEAR in Vietnamese

`formatDateTime(...).slice(-5)` works in `en-GB` and is wrong in `vi-VN`, which puts the time first.
Never reach into `Intl` output by position — ask it for the fields you want.

---

## 2026-08-21 — `Number(null)` is `0`, so a nullable number becomes a real zero

`Number(null) === 0` and `value ?? 0` both turn "we do not know" into "it is zero". On this repo that is
a missing actual scoring 0% (BR-KPI-32). Check for `null` first and render `—`.

---

## 2026-08-20 — Two files differing only by capitalisation is a trap on macOS

The macOS file system is **case-insensitive**, so `import '@/contexts/sessionContext'` can resolve to
`SessionContext.tsx` locally and break on Linux CI. That is why the contract is `useSession.ts` and the
provider `SessionContext.tsx`. **Two files in one folder must never differ only in letter case.**

---

## 2026-08-20 — `asChild` on `<Button>` with `<Link>` fails to render silently

No message, no console error — the component simply does not appear. Navigate with `useNavigate()`:

```tsx
const navigate = useNavigate();
<Button onClick={() => navigate('/my/kpi')}>KPI của tôi</Button>
```

---

## 2026-08-20 — `<Suspense>` does NOT catch errors

Every page is `lazy()`. A throw during render — or a stale chunk failing to load after a redeploy
(`Failed to fetch dynamically imported module`) — **blanks the entire app**. `RouteErrorBoundary` sits
**inside** Suspense around `<Outlet/>`, and reloads **once** on a chunk error.

---

## 2026-08-20 — Vite inlines `VITE_*` at BUILD time, not runtime

Changing `VITE_DATA_ADAPTER` in `.env` or in Vercel without rebuilding leaves the old value in the
bundle. That is also why an unknown value makes `getDataGateway()` throw instead of falling back.

---

## 2026-08-20 — `vite build` does NOT type-check

A type error ships if only `npm run build` runs. `npm run typecheck` (tsc) is a separate Phase 4 gate and
the first CI step.

---

## 2026-08-20 — ESLint needs the TypeScript parser named explicitly for `.mts`

The shared `typescript-eslint` config only attaches its parser to `**/*.{ts,tsx}`. A `scripts/**`
override that does not set `parser: tseslint.parser` fails on the first type annotation with a bare
"Unexpected token :".

---

## 2026-08-20 — A hand-rolled `manualChunks` can break the production build

Splitting vendors by hand (charts into their own chunk) caused a **production-only** crash —
`Cannot read properties of undefined (reading 'forwardRef')` — because that chunk evaluated before React
was ready. Rollup's default async splitting is sufficient. **Do not add `manualChunks`** without a
measurement proving it is needed; it matters here because recharts arrives in Phase 3. The "chunk larger
than 500 kB" warning is expected, not a fault.

---

## 2026-08-20 — A simulated adapter must reuse the rules, never copy them

A mock that re-implements a transition table or a formula drifts from the rules the tests cover, and the
prototype then demonstrates behaviour the real system will not have. `mockGateway` calls
`src/lib/*Rules.ts`; it never contains its own copy.
