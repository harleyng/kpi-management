# Component registry — Syntra KPI

> Living document. Referenced by: `ui-ux`, `cto`. Check here before building anything new.
> State on 2026-10-19 (Phase 0): the shell and the shared primitives, carried over from the OmniX
> Studio scaffold with the OmniX business parts removed. Phase 1.4 adds DataTable, FormField,
> KpiPicker, EmployeePicker, OrgUnitTree and the per-set status badges.

---

## `src/components/ui/` — shadcn primitives (never edited)

alert-dialog · badge (semantic tones `positive` / `warning` / `negative` / `info` / `muted`) · button ·
card · command · dialog · dropdown-menu · input · label · popover · progress · scroll-area · select ·
separator · skeleton · slider · sonner (top-right toaster) · switch · tabs · textarea · tooltip.

## `src/components/layout/`

| Component | Purpose |
|---|---|
| `AppShell` | The frame: sidebar + top bar + `<Outlet/>` inside `RouteErrorBoundary` + `Suspense` |
| `AppSidebar` | Left navigation from `navConfig`, collapsible to an icon rail (⌘B), state in `sidebarStore` |
| `SidebarAccount` | The account block at the foot of the sidebar (user, roles, sign-out placeholder) |
| `TopBar` | Tenant name + the permanent **"Dữ liệu giả lập"** banner; the session switcher arrives in 1.3 |
| `RouteErrorBoundary` | Catches render errors; reloads once on a stale chunk |
| `navConfig.ts` | `NAV_GROUPS` (5 groups, roles per group, 17 items), `HOME_URL` |

## `src/components/shared/`

| Component | Purpose |
|---|---|
| `PageHeader` | Title, description, actions — every route-level screen |
| `PlaceholderPanel` | "Chưa xây dựng", then "Phần việc: WP x.y.z, Track Tn" + the list of remaining work |
| `EmptyState` / `EmptyStateCard` | "There is nothing here" for a panel / a whole page, with an optional next action |
| `ErrorStateCard` | A failed read in place of the table; takes a catalogue `spec` (`errorSpecOf(error)`) |
| `ConfirmDialog` | Confirmation before an irreversible action (lock, finalise, delete); `destructive` for removals |
| `StatusBadge` | The `Tone` primitive; per-set badges (Goal Plan, form, cycle, result) are added beside it in 1.4 |
| `Pagination` | Footer of a paged table; pairs with `paginate()` |
| `SearchInput` | Magnifier-in-a-field; the caller filters (with `foldDiacritics`) |
| `SectionTitle` | A titled section inside a page body |
| `CopyButton` | Hover-revealed copy-to-clipboard with an announced confirmation |

## `src/contexts/`

| File | Purpose |
|---|---|
| `useSession.ts` | `useSession()` → `tenantId`, `tenantName`, `user`, `roles`, `hasRole`, `isSimulated` |
| `SessionContext.tsx` | Provider — Phase 0 placeholder identity holding every role |

## `src/lib/`

| File | Purpose |
|---|---|
| `errorCatalog.ts` | `ERROR_CATALOG` (ERR-KPI-01…13), `KpiError` (+ `issues`), `RuleIssue` / `ruleIssue()`, `toKpiError()`, `errorSpecOf()` — tested |
| `pagination.ts` | `paginate()`, `DEFAULT_PAGE_SIZE`, `PAGE_SIZE_OPTIONS` — tested |
| `utils.ts` | `cn`, `formatDate`, `formatDateTime`, `formatNumber`, `formatPercent`, `foldDiacritics`, `downloadBlob` (vi-VN, Asia/Ho_Chi_Minh) |
| `sidebarStore.ts` | Zustand: sidebar collapsed (persisted as `kpi.sidebar`) |
| `permissionRules.ts` | Stub — `can()` and `visibleNavGroups()` in Phase 1.3 |

### Rules (Phase 1.5) — pure functions, co-located tests, no clock of their own

Every rule that needs the time takes `Clock { now, tz }` (`isoDate.ts`). Checks return `RuleIssue[]`
(`errorCatalog.ts`), never throw; an adapter throws them with `toKpiError`. **Frozen signatures**
(changing them costs every track): `achievement`, `weightedScore`, `canSubmit`, `checkAction` /
`transition`, `RuleIssue`.

| File | Main exports |
|---|---|
| `calcRules.ts` | `achievement` / `achievementPct` (6 methods → SCORED / NO_ACTUAL / NOT_COMPUTABLE), `applyFloorCap`, `targetForPeriod`, `goalAchievementInput`, `validateCalcMethod`, `validateTargetLevels`, `parseFormula` / `evaluateFormula` (safe, no `eval`) |
| `scoreRules.ts` | `weightedScore` (provisional + `complete`), `lineWeightedScore`, `finalizeIssues` / `canFinalize`, `adjustedScore`, `roundScore`, `ratedScore`, `rollUpActual`, `aggregatePeriodActuals` |
| `goalPlanRules.ts` | `WEIGHT_TOLERANCE`, `totalWeight`, `isWeightComplete`, `submitIssues`, `canEditPlan`, `planStatusOnEnterStep`, `statusAfterUnlock`, `canLock` / `canUnlock`, `planAfterChanges`, `applyGoalChanges` |
| `alignmentRules.ts` | `wouldCreateCycle`, `allocationBuckets` ("chưa giao", leavers), `allocationIssue`, `checkAlignment` |
| `ratingRules.ts` | `ratingFor`, `validateRatingScale`, `payoutPctFor`, `validatePayoutRule` |
| `formRules.ts` | `canSubmit` (KPI_EVAL / GOAL_SETTING / GOAL_CHANGE), `validateScoreInput`, `evaluationTotal`, `columnPct` |
| `workflowRules.ts` | `validateWorkflow`, `resolveStepActors`, `entitlement`, `TRANSITIONS` / `transition`, **`checkAction`** (the gateway's only entry for `forms.act`), `isFrozen`, `mayEditAtCurrentStep`, `stepDeadline`, `isOverdue`, `overdueActions`, `remindersDue` / `reminderKey`, `onUnlock`, `isInInbox`, `launchDueDate`, `validateLaunch`, `dueScheduledLaunches`, `resolveRecipients`, `launchRuleFirings` |
| `orgRules.ts` | `isEffectiveOn`, `primaryAssignmentOn`, `managerOf`, `unitAncestry`, `descendantUnitIds`, `wouldCreateUnitCycle`, `isEmployedOn` / `isEmployedDuring` / `employedFraction`, `scopeSubjectOn`, `scopeCoversEmployee` (the scope semantics 1.3 shares) |
| `isoDate.ts` | `Clock`, `todayOf`, `toZonedDate`, `addDays`, `daysBetween`, `minDate`, `isWithin`, `isIsoDate` |

Test factories for rule tests: `src/test/builders.ts` (deliberately not the seed fixtures).

## `src/integrations/`

| File | Purpose |
|---|---|
| `data/index.ts` | `getDataGateway()`, `resolveAdapterName()` — tested |
| `data/types.ts` | The `DataGateway` contract (Phase 1.1 fills it) |
| `data/mockGateway.ts` / `data/supabaseGateway.ts` | Adapters — never imported outside `integrations/data/` |
| `insight/index.ts` | `getInsightGateway()` — the simulated AI assistant (Phase 3) |

## `src/hooks/queries/`

Empty in Phase 0 — conventions in its `README.md`.
