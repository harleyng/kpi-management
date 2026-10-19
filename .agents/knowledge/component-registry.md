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
| `EvidenceAttach` (T5) | "N bằng chứng" popover for one goal in one period: list (file → `getFileUrl`, link), and attach a file or a link when `canAdd`; T4's evidence management (4.4.6) reuses it and adds removal |
| `toastError` (T5) | `toastError(error)` — a failed write as a toast with the catalogue copy (`errorSpecOf`); the dev toolbar re-exports it |
| `StatusBadge` additions (T5) | `DelegationStateBadge` (derived state), `PlanAdjustingBadge` ("Đang điều chỉnh") |

## `src/components/forms/` (T5 — the form screens)

| Component / hook | Purpose |
|---|---|
| `useFormLookups` | Names (people from the session directory — no second query), periods, cycles, steps for any forms screen |
| `useFormDetail(formId)` | One form + plan + history + `formStanding` (what this user may do now) + `mayView` |
| `FormsTable` | The list of forms (inbox, mine, team, HR): subject/type, period, step, step deadline, status + "Quá hạn" — `stepTiming` only, never actor resolution per row |
| `FormStepStrip` · `FormHistory` | The numbered steps with their state in words · the recorded actions naming both people for proxy / delegation |
| `FormActionBar` (+ `FormCommentDialog`) | Sticky foot: totals, blocker sentences (catalogue copy + rule data; link to the first row), `standing.actions`, "Lưu nháp"; saves unsaved edits then acts in ONE mutation; stale step → inline notice |
| `EvaluationFormBody` · `GoalPlanFormBody` · `GoalChangeFormBody` | KPI_EVAL table (editable column next to the goal, `evaluationTotal`, evidence) · registration plan read-only (+ `StartAdjustmentButton`) · thin adjustment proposal editor |
| `DelegationsPanel` | "Ủy quyền": list with derived state, create (`delegationIssues` first), revoke (`canRevokeDelegation`) |
| `formCopy.ts` | Titles and the sentences around the rules' answers (`blockerSentences`, `readOnlySentence`, `actingAsSentence`, `returnedSentence`, `formatInUnit`) |

## `src/components/launches/` (T5 — "Khởi chạy phiếu")

| Component | Purpose |
|---|---|
| `LaunchesTab` + `LaunchPanel` | Launch list (open forms / cancel a Scheduled one) and the inline "Tạo đợt khởi chạy" panel (`validateLaunch`, `launchTimingIssues`, `cycleAllowsLaunch`) |
| `LaunchRulesTab` | Recurring rules (inline on/off, edit dialog, `validateLaunchRule`) |
| `AdminFormsTab` | Every form, keyset-paged by the gateway (Trang trước / Trang sau), filters incl. `?launch=` |
| `WorkflowsTab` | Step settings per workflow with `validateWorkflow` inline and `workflowEditWarnings` |
| `RecipientFilterFields` · `recipients.ts` | "Người nhận" ALL / FILTER fields · `EMPTY_RECIPIENT_FILTER`, `recipientSummary` |

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
| `utils.ts` | `cn`, `formatDate`, `formatDateTime`, `formatNumber`, `formatPercent`, `foldDiacritics`, `downloadBlob` (vi-VN, Asia/Ho_Chi_Minh) |
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
| `scoreRules.ts` | `weightedScore` (provisional + `complete`), `lineWeightedScore`, `finalizeIssues` / `canFinalize`, `adjustedScore`, `roundScore`, `ratedScore`, `rollUpActual`, `aggregatePeriodActuals` |
| `goalPlanRules.ts` | `WEIGHT_TOLERANCE`, `totalWeight`, `isWeightComplete`, `submitIssues`, `canEditPlan`, `planStatusOnEnterStep`, `statusAfterUnlock`, `canLock` / `canUnlock`, `planAfterChanges`, `applyGoalChanges`, `changeItemIssues` (`{ draft }`) |
| `alignmentRules.ts` | `wouldCreateCycle`, `allocationBuckets` ("chưa giao", leavers), `allocationIssue`, `checkAlignment` |
| `ratingRules.ts` | `ratingFor`, `validateRatingScale`, `payoutPctFor`, `validatePayoutRule` |
| `formRules.ts` | `canSubmit` (KPI_EVAL / GOAL_SETTING / GOAL_CHANGE), `validateScoreInput`, `evaluationTotal`, `columnPct` |
| `workflowRules.ts` | `validateWorkflow`, `resolveStepActors`, `entitlement`, `TRANSITIONS` / `transition`, **`checkAction`** (the gateway's only entry for `forms.act`), `isFrozen`, `mayEditAtCurrentStep`, `stepDeadline`, `isOverdue`, `overdueActions`, `remindersDue` / `reminderKey`, `onUnlock`, `isInInbox`, `launchDueDate`, `validateLaunch`, `dueScheduledLaunches`, `resolveRecipients`, `launchRuleFirings`; Gate 1: `canStartForm`, `canCancelLaunch`, `validateLaunchRule`, `launchTimingIssues`, `delegationIssues`, `canRevokeDelegation`, `editRefusal`, `editStanding`, `markHandled`, `assigneesOf` |
| `cycleRules.ts` (Gate 1) | `CYCLE_NEXT`, `cycleIssues`, `periodIssues`, `canEditCycle`, `statusChangeIssues`, `canLockPeriod`, `cycleAllowsLaunch` (BR-KPI-25) |
| `resultRules.ts` (Gate 1) | The period-result pipeline the mock and the seed share: `buildPeriodResults`, `applyAdjustment`, `finalizePeriodResults`, `lockPeriodResults` → `ResultChanges`; `computeResult`, `finalizeCheck`, `RESULT_TRANSITIONS`, `canRecalculate` / `canAdjust` / `canTransition`, `evaluationLines` / `actualLines` / `planLines`, `currentLinesOf` (BR-KPI-40, 43, 44) |
| `actualRules.ts` (Gate 1) | `actualIssues` (`recordActual` and T4's import rows), `isResultFinalised` (BR-KPI-52) |
| `orgRules.ts` | `isEffectiveOn`, `primaryAssignmentOn`, `managerOf`, `unitAncestry`, `descendantUnitIds`, `wouldCreateUnitCycle`, `isEmployedOn` / `isEmployedDuring` / `employedFraction`, `scopeSubjectOn`, `scopeCoversEmployee` (the scope semantics 1.3 shares) |
| `formViewRules.ts` (T5) | `formStanding` (what a user may do on a form now — a composition of `workflowRules`, display hint), `submitCheckInput` (THE content-check builder, shared with the mock), `stepTiming`, `delegationState` / `isDelegationRevocable`, `goalDraftFromGoal` / `goalDraftFromKpi`, `workflowEditWarnings`, `actorDirectoryOf` — tested, incl. `formViewRules.parity.test.ts` against the seeded mock |
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
| `org.ts` | `useOrgUnits` (`orgUnitsKey`), `useEmployees(filter)` (`employeesKey`) |
| `library.ts` | `useKpiDefinitions(filter)`, `usePerspectives`, `useMeasureUnits` (+ `*Key`) |
| `session.ts` | `useTenants` (`tenantsKey` = `['platform','tenants']`), `useSessionDirectory(tenantId)` (`sessionDirectoryKey`), `useResetSeed` (reseed + latency/failure defaults + `resetQueries()` + `devStore` reset), `readGatewayNow`, `hasDevControls` — the ONE place hooks take `tenantId` explicitly (they run before a session exists) |
| `keys.ts` | `queryKey(tenantId, root, ...params)` (tenant first — every `*Key` above uses it), `KEY_ROOTS` (root → the entities it reads), `rootsAffectedBy(entity)`, `TENANTS_KEY`, `DEV_NOW_KEY` (`['dev','now']`, the one clock is not tenant data) — tested |
| `forms.ts` (T5) | Workflows, launches, launch rules, forms (paged), one form, actions, evaluation items, change items, inbox, delegations — reads with `*Key`; writes invalidate their roots; `useActOnForm` saves `UnsavedEdits` then acts |
| `goals.ts` (T5 reads) | `useCycles`, `usePeriods`, `useAllPeriods`, `useGoalPlans`, `useGoalPlan`, `useKgis`, `useGoals`, `useTargetLevels` — T3 adds the writes |
| `actuals.ts` (T5 reads) | `useDataSources`, `useEvidence`, `useAttachEvidence` (upload + record), `useOpenFile` — T4 adds the rest |
| additions | `library.ts` `useCalcMethods`; `org.ts` `usePositions`; `session.ts` `useGatewayClock` (the gateway clock + tenant zone, re-read each render) |
| `dev.ts` | The ONLY toolbar access to `gateway.dev`: `useSimulatedNow` (`simulatedNowKey`, staleTime ∞, re-read on open), `useSetSimulatedNow` (`{ to }` or `{ shiftDays }` via `addDaysToInstant` in the tenant zone), `useSetLatency`, `useSetFailureMode` (all three mirror into `devStore` and invalidate every query), `useRunScheduler` (session tenant, invalidates `[tenantId]`) — tested |
| `useGatewayEventInvalidation` | Subscribes the cache to the gateway's `entity.changed` for one tenant; invalidates the affected roots once per microtask — tested; mounted by `GatewayEventBridge` |

## Mock adapter and seed (Phase 1.2) — for tests only outside `src/integrations/data/`

| Item | What it does |
|---|---|
| `mock/gateway.test-util.ts` | `newGateway()` (fresh mock, `MemoryStorage`, no latency, shared seed), `rejection()`, `flush()` |
| `@/data/fixtures` `SYNTRA` / `DEMO` | Seeded ids by readable key: `SYNTRA.user('E016')`, `SYNTRA.employee(…)`, `SYNTRA.unit('KD')`, `SYNTRA.id('Goal', …)`, `personas` |

