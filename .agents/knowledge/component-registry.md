# Component registry — Syntra KPI

> Living document. Referenced by: `ui-ux`, `cto`. Check here before building anything new.
> State on 2026-10-19 (Phase 1.4): the shell and the shared primitives from the OmniX scaffold, plus
> the Phase 1.4 UI kit — DataTable, FormField, ErrorState, EntityCombobox, KpiPicker, EmployeePicker,
> OrgUnitTree and the per-set status badges.

---

## `src/components/ui/` — shadcn primitives (never edited)

alert-dialog · badge (semantic tones `positive` / `warning` / `negative` / `info` / `muted`) · button ·
card · command · dialog · dropdown-menu · input · label · popover · progress · scroll-area · select ·
separator · skeleton · slider · sonner (top-right toaster) · switch · table (added in 1.4) · tabs · textarea · tooltip.

## `src/components/layout/`

| Component | Purpose |
|---|---|
| `AppShell` | The frame: sidebar + top bar + `<Outlet/>` inside `RouteErrorBoundary` + `Suspense`; the **route guard** (`canOpenPath` → `AccessDenied`) |
| `AppSidebar` | Left navigation from `navConfig` filtered by `visibleNavGroups(NAV_GROUPS, access)` (permissions), collapsible to an icon rail (⌘B), state in `sidebarStore` |
| `SidebarAccount` | The account block at the foot of the sidebar — DISPLAYS the identity (user, email, roles); no switcher here |
| `TopBar` | `SessionSwitcher` + `DevToolbar` + the permanent **"Dữ liệu giả lập"** banner |
| `DevToolbar` | "Công cụ demo" popover (only when the gateway has `dev`): trigger says "Đang bật" (dot + word) while an override is on; lazy `dev/DevToolbarPanel` with `DevClockSection` (simulated now in the tenant zone, +1/+7 ngày, về thời điểm seed, đặt ngày giờ), `DevLatencySection` (0/150/1000 ms, `aria-pressed`), `DevFailureSection` (scope `Select` → `group.*` glob + `Switch`), `DevSchedulerSection` (`scheduler.runDue`, summary toast; blocked while failing), `DevResetSection` (`ConfirmDialog` → reseed); `dev/PendingButton` (spinner + `aria-busy`), `dev/toastError` (catalogue copy) — tested |
| `SessionSwitcher` | Tenant dropdown + searchable person picker (grouped by primary role, `matchesSearch` on name/unit/roles, roles as muted text, polite live-region announcement) |
| `SimulatedDataBadge` | The "Dữ liệu giả lập" banner (short "Giả lập" below `lg`, full accessible name) — also on the session screens |
| `SessionScreens` | `SessionLoading` (shell skeleton) · `SessionError` (`errorSpecOf` + retry) · `SessionEmpty` ("Chưa có dữ liệu mẫu", reseed, other tenants) — rendered before a session exists, never call `useSession()` |
| `AccessDenied` | The route guard's panel inside the shell: ERR-KPI-05 title + "Về trang chủ" |
| `RouteErrorBoundary` | Catches render errors; reloads once on a stale chunk |
| `GatewayEventBridge` | Renders nothing; mounted once inside `SessionProvider` (`main.tsx`) — runs `useGatewayEventInvalidation(tenantId)` |
| `navConfig.ts` | `NAV_GROUPS` (5 groups, 17 items, a `permission` per item), `HOME_URL`, `PUBLIC_PATHS` — `navConfig.test.ts` pins plan §7.1 and route coverage |

## `src/components/shared/`

| Component | Purpose |
|---|---|
| `PageHeader` | Title, description, actions — every route-level screen |
| `PlaceholderPanel` | "Chưa xây dựng", then "Phần việc: WP x.y.z, Track Tn" + the list of remaining work |
| `EmptyState` / `EmptyStateCard` | "There is nothing here" for a panel / a whole page, with an optional next action |
| `ErrorStateCard` / `ErrorState` | A failed read for a page / inside a panel or popover; takes a catalogue `spec` (`errorSpecOf(error)`), `role="alert"` |
| `DataTable` | The management table: columns (`numeric`, `sortValue`), the `useQuery` result, first-use vs filtered empty, `—` for missing cells, client paging or `serverPage` for `Page<T>` lists, `toolbar`, totals `footer` |
| `MissingValue` | `—` with sr-only "chưa có" (exported from `DataTable.tsx`) |
| `FormField` / `RequiredLegend` | Label + control (render prop with id/ARIA) + hint + announced error; "* Bắt buộc" legend |
| `EntityCombobox` | Searchable single/multiple picker (Popover + cmdk, `matchesSearch`); never misreports a selected value (loading / failed / no longer in list) |
| `KpiPicker` | Library KPI picker grouped by BSC perspective; Draft/Archived disabled; `excludeIds` |
| `EmployeePicker` | Person picker with an `EmployeeFilter` (direct reports, unit); resigned shown disabled |
| `OrgUnitTree` / `OrgUnitTreeView` | ARIA tree of the org (roving tabindex, ↑↓←→ Home End Enter/Space), single or multiple, search above >10 units |
| `ConfirmDialog` | Confirmation before an irreversible action (lock, finalise, delete); `destructive` for removals |
| `StatusBadge` | The `Tone` primitive, plus one badge per state set (`GoalPlanStatusBadge`, `FormStatusBadge` with `atMyStep`, `OverdueBadge`, `CycleStatusBadge`, `PeriodResultStatusBadge`, `GoalStatusBadge`, `LibraryStatusBadge`, `LaunchStatusBadge`, `ImportBatchStatusBadge`, `SyncRunStatusBadge`, `NotificationStatusBadge`, `EmploymentStatusBadge`, `RecordStatusBadge`); tones in `statusTones.ts` |
| `Pagination` | Footer of a paged table; pairs with `paginate()` |
| `SearchInput` | Magnifier-in-a-field; the caller filters (with `foldDiacritics`) |
| `SectionTitle` | A titled section inside a page body |
| `CopyButton` | Hover-revealed copy-to-clipboard with an announced confirmation |

## `src/components/results/` (T6)

| Component | Purpose |
|---|---|
| `useResultPeriod` | The cycle + period a result screen shows, kept in `?cycle=&period=` and validated against the loaded lists (`cycleRules.defaultResultCycle` / `defaultResultPeriod` as fallback, URL replaced) |
| `ResultPeriodPicker` | "Chu kỳ" / "Kỳ" selects for a `useResultPeriod` selection (`showPeriod={false}` for cycle-wide content) |
| `ResultCells` | `ScoreValue` (Draft muted), `AdjustmentValue` (signed points), `RatingValue`, `PayoutValue` (`resultView.payoutState`: value · "Không áp dụng" · visible reason) |
| `ResultsTab` | "Kết quả kỳ": status line (filter shortcuts), calculate / finalise (selected or all Drafts) / lock with confirmations, the table, selection of Drafts only |
| `FinalizeIssuesPanel` | A refused all-or-none finalise: every issue grouped by result, in words, "Xem" opens the detail; `role="alert"` |
| `ResultDetailDialog` | One result goal by goal + the three score parts side by side (`scoreBreakdown`) + the Draft adjustment form |
| `RatingTab` / `PayoutRuleDialog` | The scale read-only (`ASSUMPTION Q2`) + payout rules list / editor (`validatePayoutRule` before saving) |
| `PayrollExportTab` | Pre-export counts (`payrollPreview`), "Xuất file lương" (`result.export`), "Lịch sử xuất file" with per-row download and the lost-after-reload state |

## `src/contexts/`

| File | Purpose |
|---|---|
| `useSession.ts` | `useSession()` → `tenantId`, `tenant`, `user` (`id`, `employeeId`, name, email), `roles`, `hasRole`, **`can(code, resource?)`**, `access`, `today`, `tenants`, `people`, `switchTenant`, `switchUser`, `isSimulated` — all referentially stable |
| `SessionContext.tsx` | Provider — loads tenants and one session directory, resolves the stored selection, builds the access profile; renders children only once a session exists — tested |

## `src/lib/`

| File | Purpose |
|---|---|
| `errorCatalog.ts` | `ERROR_CATALOG` (ERR-KPI-01…13), `KpiError` (+ `issues`), `RuleIssue` / `ruleIssue()`, `toKpiError()`, `KpiDeferredError` (a gateway method waiting for its Phase 2 track — never retried), `isRetryable`, `errorSpecOf()` — tested |
| `pagination.ts` | `paginate()`, `serverPageSlice()`, `DEFAULT_PAGE_SIZE`, `PAGE_SIZE_OPTIONS` — tested |
| `utils.ts` | `cn`, `formatDate`, `formatDateTime`, `formatNumber`, `formatPercent`, `foldDiacritics`, `downloadBlob`, `downloadUrl` (T6; revokes a blob URL on a timeout) (vi-VN, Asia/Ho_Chi_Minh) |
| `toastError.ts` (T6) | `toastError(error)` — a failure toast in the catalogue's words (the dev toolbar re-exports it) |
| `resultView.ts` (T6) | Display mapping for the result screens: `buildResultRows` (one join, Maps), `payoutState`, `statusCounts`, `isShownToEmployee` (BR-KPI-46), `draftSelection`, `formatPoints`, `UNKNOWN_OWNER` — tested |
| `sidebarStore.ts` | Zustand: sidebar collapsed (persisted as `kpi.sidebar`) |
| `devStore.ts` | Zustand, NOT persisted: the dev toolbar's mirror of the mock's settings (`clockOverridden`, `latencyMs`, `failure`), `DEFAULT_LATENCY_MS`, `LATENCY_CHOICES`, `devActions`, `hasActiveOverride` |
| `permissionRules.ts` | `PERMISSION_CODES` / `PERMISSION_CATALOGUE`, `DEFAULT_ROLE_PERMISSIONS`, `DEFAULT_ROLE_SCOPE`, `permissionId`, `permissionRows`, `defaultRolePermissionRows`, `buildAccessProfile`, **`can`**, `resourceOfOwner`, `resourceOfSubject`, `roleCodesOf`, `visibleNavGroups`, `canOpenPath` — tested (`permissionFixtures.test-util.ts`) |
| `sessionRules.ts` | `pickTenant`, `pickAccount`, `primaryRole`, `tenantToday`, `sessionPeople`, `groupPeopleByRole`, `SessionDirectory` — tested |
| `sessionStore.ts` | Zustand: the stored tenant + person per tenant (`kpi.session.v1`, shape-validated) — tested |
| `search.ts` | `matchesSearch(query, fields)` — diacritic-insensitive, every word must match — tested |
| `tableSort.ts` | `sortRows`, `compareSortValues` (`vi` collation, missing last), `nextSortDirection` — tested |
| `queryState.ts` | `loadPhase`, `isRefreshing`, `combineQueries` — what a list shows for a query result — tested |
| `orgTree.ts` | `buildTree` (orphan/cycle-safe), `visibleTreeRows`, `ancestorIds`, `pruneTree`, `treeKeyAction` — tested |

### Rules (Phase 1.5) — pure functions, co-located tests, no clock of their own

Every rule that needs the time takes `Clock { now, tz }` (`isoDate.ts`). Checks return `RuleIssue[]`
(`errorCatalog.ts`), never throw; an adapter throws them with `toKpiError`. **Frozen signatures**
(changing them costs every track): `achievement`, `weightedScore`, `canSubmit`, `checkAction` /
`transition`, `RuleIssue`.

| File | Main exports |
|---|---|
| `calcRules.ts` | `achievement` / `achievementPct` (6 methods → SCORED / NO_ACTUAL / NOT_COMPUTABLE), `applyFloorCap`, `targetForPeriod`, `goalAchievementInput`, `validateCalcMethod`, `validateTargetLevels`, `parseFormula` / `evaluateFormula` (safe, no `eval`) |
| `scoreRules.ts` | `weightedScore` (provisional + `complete`), `lineWeightedScore`, `finalizeIssues` / `canFinalize`, `adjustedScore`, `roundScore`, `ratedScore`, `rollUpActual`, `aggregatePeriodActuals`; T6: `scoreBreakdown` (raw · adjustment · stored total · clamped — never summed on screen) |
| `goalPlanRules.ts` | `WEIGHT_TOLERANCE`, `totalWeight`, `isWeightComplete`, `submitIssues`, `canEditPlan`, `planStatusOnEnterStep`, `statusAfterUnlock`, `canLock` / `canUnlock`, `planAfterChanges`, `applyGoalChanges`, `changeItemIssues` (`{ draft }`) |
| `alignmentRules.ts` | `wouldCreateCycle`, `allocationBuckets` ("chưa giao", leavers), `allocationIssue`, `checkAlignment` |
| `ratingRules.ts` | `ratingFor`, `validateRatingScale`, `payoutPctFor`, `validatePayoutRule` |
| `formRules.ts` | `canSubmit` (KPI_EVAL / GOAL_SETTING / GOAL_CHANGE), `validateScoreInput`, `evaluationTotal`, `columnPct` |
| `workflowRules.ts` | `validateWorkflow`, `resolveStepActors`, `entitlement`, `TRANSITIONS` / `transition`, **`checkAction`** (the gateway's only entry for `forms.act`), `isFrozen`, `mayEditAtCurrentStep`, `stepDeadline`, `isOverdue`, `overdueActions`, `remindersDue` / `reminderKey`, `onUnlock`, `isInInbox`, `launchDueDate`, `validateLaunch`, `dueScheduledLaunches`, `resolveRecipients`, `launchRuleFirings`; Gate 1: `canStartForm`, `canCancelLaunch`, `validateLaunchRule`, `launchTimingIssues`, `delegationIssues`, `canRevokeDelegation`, `editRefusal`, `editStanding`, `markHandled`, `assigneesOf` |
| `cycleRules.ts` (Gate 1) | `CYCLE_NEXT`, `cycleIssues`, `periodIssues`, `canEditCycle`, `statusChangeIssues`, `canLockPeriod`, `cycleAllowsLaunch` (BR-KPI-25); T6: `defaultResultPeriod`, `defaultResultCycle` |
| `resultRules.ts` (Gate 1) | The period-result pipeline the mock and the seed share: `buildPeriodResults`, `applyAdjustment`, `finalizePeriodResults`, `lockPeriodResults` → `ResultChanges`; `computeResult`, `finalizeCheck`, `RESULT_TRANSITIONS`, `canRecalculate` / `canAdjust` / `canTransition`, `evaluationLines` / `actualLines` / `planLines`, `currentLinesOf`; T6: `subjectAssignment` (the assignment a payout is read for, shared with the payroll file) (BR-KPI-40, 43, 44) |
| `payrollRules.ts` (T6) | BR-KPI-45: `isPayrollResult`, `payoutNote` / `PAYROLL_NOTE_LABEL` (Q20), `payrollPreview`, `buildPayrollSheet` (stored numbers only), `payrollFileName` |
| `actualRules.ts` (Gate 1) | `actualIssues` (`recordActual` and T4's import rows), `isResultFinalised` (BR-KPI-52) |
| `orgRules.ts` | `isEffectiveOn`, `primaryAssignmentOn` (T6: ties broken by id, `latestFirst`), `managerOf`, `unitAncestry`, `descendantUnitIds`, `wouldCreateUnitCycle`, `isEmployedOn` / `isEmployedDuring` / `employedFraction`, `scopeSubjectOn`, `scopeCoversEmployee` (the scope semantics 1.3 shares) |
| `isoDate.ts` | `Clock`, `todayOf`, `toZonedDate`, `addDays`, `daysBetween`, `minDate`, `isWithin`, `isIsoDate`, `addDaysToInstant` (calendar days in a zone, wall time kept), `toZonedLocalInput` / `fromZonedLocalInput` (`datetime-local` ↔ instant), `zoneOffsetLabel` (`GMT+7`) |

Test factories for rule tests: `src/test/builders.ts` (deliberately not the seed fixtures).

## `src/integrations/`

| File | Purpose |
|---|---|
| `data/index.ts` | `getDataGateway()`, `resolveAdapterName()` — tested |
| `data/types.ts` | The `DataGateway` contract (Phase 1.1 fills it) |
| `data/mockGateway.ts` / `data/supabaseGateway.ts` | Adapters — never imported outside `integrations/data/` |
| `insight/index.ts` | `getInsightGateway()` — the simulated AI assistant (Phase 3) |

## `src/hooks/queries/`

Conventions in its `README.md`. Keys are `[tenantId, root, ...params]`.

| File | Hooks |
|---|---|
| `org.ts` | `useOrgUnits` (`orgUnitsKey`), `useEmployees(filter)` (`employeesKey`), T6: `usePositions`, `useAssignments(filter)` |
| `goals.ts` (T6, reads only — T3 appends writes) | `useCycles`, `usePeriods(cycleId)`, `useGoalPlans(filter, {enabled})`, `useGoals(filter, {enabled})` |
| `results.ts` (T6) | `useRatingScales`, `useRatingLevels`, `usePayoutRules`, `useSavePayoutRule`, `useDeletePayoutRule`, `usePeriodResults`, `useResultDetails`, selectors `useResultRows` / `usePayrollPreview` / `useResultBreakdown`, `useCalculateResults`, `useSetAdjustment`, `useFinalizeResults` (+ `isBlockedFinalize`: issues → panel, else toast), `useLockResults`, `usePayrollExports`, `useExportPayroll` (export, then download; the two fail separately) |
| `system.ts` (T6 — T7 appends) | `downloadFile(tenantId, fileId)`, `useDownloadFile` |
| `library.ts` | `useKpiDefinitions(filter)`, `usePerspectives`, `useMeasureUnits` (+ `*Key`) |
| `session.ts` | `useTenants` (`tenantsKey` = `['platform','tenants']`), `useSessionDirectory(tenantId)` (`sessionDirectoryKey`), `useResetSeed` (reseed + latency/failure defaults + `resetQueries()` + `devStore` reset), `readGatewayNow`, `hasDevControls` — the ONE place hooks take `tenantId` explicitly (they run before a session exists) |
| `keys.ts` | `queryKey(tenantId, root, ...params)` (tenant first — every `*Key` above uses it), `KEY_ROOTS` (root → the entities it reads), `rootsAffectedBy(entity)`, `TENANTS_KEY`, `DEV_NOW_KEY` (`['dev','now']`, the one clock is not tenant data) — tested |
| `dev.ts` | The ONLY toolbar access to `gateway.dev`: `useSimulatedNow` (`simulatedNowKey`, staleTime ∞, re-read on open), `useSetSimulatedNow` (`{ to }` or `{ shiftDays }` via `addDaysToInstant` in the tenant zone), `useSetLatency`, `useSetFailureMode` (all three mirror into `devStore` and invalidate every query), `useRunScheduler` (session tenant, invalidates `[tenantId]`) — tested |
| `useGatewayEventInvalidation` | Subscribes the cache to the gateway's `entity.changed` for one tenant; invalidates the affected roots once per microtask — tested; mounted by `GatewayEventBridge` |

## Mock adapter and seed (Phase 1.2) — for tests only outside `src/integrations/data/`

| Item | What it does |
|---|---|
| `mock/gateway.test-util.ts` | `newGateway()` (fresh mock, `MemoryStorage`, no latency, shared seed), `rejection()`, `flush()` |
| `@/data/fixtures` `SYNTRA` / `DEMO` | Seeded ids by readable key: `SYNTRA.user('E016')`, `SYNTRA.employee(…)`, `SYNTRA.unit('KD')`, `SYNTRA.id('Goal', …)`, `personas` |

