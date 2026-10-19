# Component registry — Syntra KPI

> Living document. Referenced by: `ui-ux`, `cto`. Check here before building anything new.
> State on 2026-10-19 (Phase 1.4): the shell and the shared primitives from the OmniX scaffold, plus
> the Phase 1.4 UI kit — DataTable, FormField, ErrorState, EntityCombobox, KpiPicker, EmployeePicker,
> OrgUnitTree and the per-set status badges.

---

## `src/components/ui/` — shadcn primitives (never edited)

alert-dialog · badge (semantic tones `positive` / `warning` / `negative` / `info` / `muted`) · button ·
card · checkbox (T1) · command · dialog · dropdown-menu · input · label · popover · progress · scroll-area · select ·
separator · sheet (T1/T2: right-hand side panel, `SheetHeader` / `SheetBody` / sticky `SheetFooter`, `hideClose`) · skeleton · slider · sonner (top-right toaster) · switch · table (added in 1.4) · tabs · textarea · tooltip.

## `src/components/layout/`

| Component | Purpose |
|---|---|
| `AppShell` | The frame: sidebar + top bar + `<Outlet/>` inside `RouteErrorBoundary` + `Suspense`; the **route guard** (`canOpenPath` → `AccessDenied`) |
| `AppSidebar` | Left navigation from `navConfig` filtered by `visibleNavGroups(NAV_GROUPS, access)` (permissions), collapsible to an icon rail (⌘B), state in `sidebarStore` |
| `SidebarAccount` | The account block at the foot of the sidebar — DISPLAYS the identity (user, email, roles); no switcher here |
| `TopBar` | `SessionSwitcher` + `DevToolbar` + `NotificationBell` (T7) + the permanent **"Dữ liệu giả lập"** banner |
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
| `EditSheet` (T1) | The right-hand editor sheet: title, scrolling body, sticky footer (Hủy / submit + `footerStart`), `problems` above the actions (`role="alert"`), "Bỏ thay đổi chưa lưu?" on a dirty close, `wide` for sectioned records. Keep dialogs OUTSIDE it — a portal still bubbles React submit events to the sheet's form |
| `BlockedReason` (T1) | Why an action is disabled, as visible `text-xs` text (a span, so it fits in a field hint); give the action `aria-describedby` |
| `ConfirmDialog` `details` | Optional list under the body ("Thêm: … / Bỏ: …") |

## `src/components/org/` and `src/components/access/` (Track T1)

| Component | Purpose |
|---|---|
| `OrgStructureTab` | Tree (`OrgUnitTreeView`, `?unit=`, "Hiện đơn vị ngừng dùng" `?inactive=1`) beside the unit's detail: head, dates, staff today, Sửa / Thêm đơn vị trực thuộc / Ngừng dùng (blocked reasons from `unitEndIssues`) |
| `UnitSheet` | Add / edit a unit — parent options exclude its own subtree; head picker limited to the unit's people |
| `EmployeesTab` / `EmployeeSheet` | People with today's primary line; the wide sheet (`?emp=`, `new`) = "Hồ sơ" + "Phân công" |
| `AssignmentDialog` | `first` · `transfer` · `concurrent` · `end`; preview from `transferPlan`, outside-unit warning from `managerOutsideUnit` |
| `ResignDialog` | Last working day + `resignationImpact`; `useResignEmployee` (accounts Inactive first); partial failure stays open with "Thử lại" |
| `PositionsTab` | Positions + "Đang phân công" count; stop blocked with the reason |
| `TenantTab` | The current company's name, code, zone; status read-only |
| `ImportActions` | "Tải mẫu nhập" (lazy exceljs) + disabled "Nhập từ file" with its visible reason (WBS 4.1.7) |
| `AccountsTab` / `AccountSheet` | Accounts with roles and "Phạm vi rộng nhất"; the sheet (`?acct=`) = account form + `RoleAssignments` |
| `RoleAssignments` | Role rows with scope and "N nhân viên" (`scopeCoverage`); protected / last-admin rows locked with the reason; inline "Gán vai trò" |
| `PermissionMatrix` / `RolePermissionSheet` | Read matrix (sticky header + first column, `Check` / `—` with labels); per-role edit sheet, confirm lists the diff and the accounts reached |
| `accessContext.ts` | `accessContextOf`, `railIssues` (the admin rails on a proposed change), `MODULE_LABEL`, `permissionsByModule` |
| `notify.ts` | `toastError(error)` (catalogue copy) and `toastSuccess(title)` — write feedback for every screen (T2) |

## `src/components/library/` (track T2)

| Component | Purpose |
|---|---|
| `KpiDefinitionsPanel` / `KpiDefinitionSheet` | "Chỉ tiêu mẫu" table (filters in the URL, goal-usage count) and its side-sheet editor: live `libraryRules` reasons (blocked status, missing source), server issues mapped to fields, closes only on success, discard guard, focus back to the row |
| `CataloguesPanel` | Perspectives (rename / reorder) and measure units (inline edit, code locked while in use) |
| `CalcMethodsPanel` / `CalcMethodSheet` | Methods with "Đang dùng" counts; editor with the tier editor and the in-use lock (BR-KPI-80), live `validateCalcMethod` per tier |
| `TemplateList` / `TemplateEditor` | `/admin/templates` master list ("Cần xem lại" in words) and editor with the sticky weight-total / item-count footer (warnings, Q26) and `KpiPicker` to add items |
| `LibraryExportButton` / `LibraryActions` / `exportLibrary.ts` | "Xuất Excel" (exceljs loaded on click) + the disabled "Nhập từ Excel — sắp có" |
| `DiscardChangesDialog` | "Bỏ thay đổi chưa lưu?" on top of `ConfirmDialog` |
| `libraryCopy.ts` | `issueMessage(issue)` (inline copy per rule `detail`), `fieldErrors`, `methodLockedMessage`, `weightGapMessage`, `parseNumberInput` ("12,5" → 12.5; garbage → NaN, never 0), `numberText` |
| `LoadMoreFooter` | Foot of a KEYSET-paged list (`Page<T>`, no total): "Đang hiển thị n … (mới nhất)" as a polite status + "Tải thêm"; focus moves to the count when the last page arrives; a failed page says so in place (T7) |
| `toastError` | A failed write as a toast in the catalogue's words (moved from `layout/dev/` by T7, shared) |

## `src/components/notifications/` (T7, WBS 4.8.1–4.8.2)

| Component | Purpose |
|---|---|
| `NotificationBell` | Top-bar bell: unread in-app count (primary, hidden at 0, "9+"), popover with "Chưa đọc / Tất cả" tabs, rows as buttons (unread dot + sr-only "Chưa đọc", event label and time apart), click = mark read + navigate (`notificationTarget`), "Đánh dấu tất cả đã đọc", `LoadMoreFooter` — tested |
| `notificationLinks.ts` | `notificationTarget(n)` — Form → `/my/tasks?form=`, GoalPlan → `/my/kpi?plan=`, Goal → `/my/kpi?goal=`, Launch → `/my/tasks`, Result → `/my/results`. **T3 and T5 read these query parameters** to open the record |
| `NotificationTemplateTable` | Event × channel table: in-app in use (no badge), "Thiếu mẫu" warning, e-mail "Chưa gửi ở P1"; opens the dialog |
| `NotificationTemplateDialog` | Subject + body editor: variable chips insert at the caret, live `templateIssues`, preview on sample data, "Bỏ thay đổi?" before discarding — tested |
| `ReminderScheduleTable` | Read-only "Lịch nhắc hạn": every workflow step's SLA, "Nhắc trước … ngày" and the EFFECTIVE overdue behaviour |
| `templateCopy.ts` | `VARIABLE_LABEL`, `EVENT_WHEN`, `PREVIEW_VARS` |

## `src/components/files/` (T7, WBS 4.8.3)

| Component | Purpose |
|---|---|
| `FileUploadButton` | One attachment: `fileIssues` before sending (one toast: catalogue title + the limit broken), `useUploadFile`, `onUploaded(file)`; `accept` narrows formats (`.xlsx` for imports); hint `FILE_LIMITS_HINT` via `aria-describedby` — tested |
| `FileLink` | Paperclip + name + size; opens in a new tab (blank tab opened inside the click, then pointed at the URL; download if blocked); content lost on reload → catalogue toast — tested |

## `src/components/audit/` (T7, WBS 4.8.4)

| Component | Purpose |
|---|---|
| `AuditActor` / `ShortId` | "Trần Thu Hà" / "Hệ thống", second line "thay cho …"; an id as `abcd1234…` with the full id on hover |
| `auditFormat.tsx` | `AUDIT_FIELD_LABEL`, `fieldLabel`, `formatAuditValue` (statuses through their label map, dates, ids, JSON) |
| `AuditEntryDialog` | One entry: facts as a `dl`, changed fields Trường / Trước / Sau (CREATE: Sau only; DELETE: Trước only), "Xem lịch sử của bản ghi này" deep link |

## `src/components/goals/` (Track T3)

| Component | Purpose |
|---|---|
| `GoalPlanWorkspace` | One Goal Plan end to end: `PlanHeader` (+ readiness strip and "Gửi"), `KgiSection`, `GoalTable`, the inline panels by `?goal=&mode=`, `CascadeDialog`; loading / error / not-found states; every decision from `usePlanWorkspace` |
| `PlanHeader` | Owner, status, registration step, weight / goal / KGI counts, the read-only reason, "Cần xử lý trước khi gửi" / "Lưu ý" (each item jumps to its row), "Gửi" / "Chuyển cho nhân viên" with confirm |
| `GoalTable` | Goals ordered by perspective (Changed / Cancelled muted, struck), weight-total footer, optional D3 bucket columns, a row menu whose disabled items carry their reason |
| `GoalEditorPanel` | §5.1 fields inline; a library pick fills only untouched fields; levels section (ASSUMPTION Q1 hint); partial-save handling |
| `PeriodSplitPanel` / `LinkGoalPanel` | Split by month / quarter with "Chia đều" and live warnings; link up to the manager's / unit's / company's goals (visible ones only) |
| `CascadeDialog` | "Phân giao": reports with a disabled reason, share, weight (remaining to 100%), method when the parent's is not share-safe, bucket preview, ERR-KPI-11 inline |
| `PlanLockActions` | HR's lock (confirm), unlock (reason + new due date when a form is open), lock history from the audit log |
| `CycleDetail` / `CycleFormDialog` | The selected cycle: next-status action, periods (generate → preview → apply, lock switches), the cycle's plans table (filters, create Company / OrgUnit plan) |
| `CyclePicker` + `useSelectedCycle` | `?cycle=` with `cycleRules.defaultCycleId` |
| `goalCopy.ts` | `EDIT_REASON_COPY`, `issueText` (catalogue title + the detail's words), `formatTarget`, `formatWeight`, `planOwnerName` |

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
| `pagination.ts` | also `flattenPages(pages)` — the rows of every loaded keyset page, each once (T7) |
| `utils.ts` | also `formatFileSize(bytes)` (T7) |

### Rules (Phase 1.5) — pure functions, co-located tests, no clock of their own

Every rule that needs the time takes `Clock { now, tz }` (`isoDate.ts`). Checks return `RuleIssue[]`
(`errorCatalog.ts`), never throw; an adapter throws them with `toKpiError`. **Frozen signatures**
(changing them costs every track): `achievement`, `weightedScore`, `canSubmit`, `checkAction` /
`transition`, `RuleIssue`.

| File | Main exports |
|---|---|
| `calcRules.ts` | `achievement` / `achievementPct` (6 methods → SCORED / NO_ACTUAL / NOT_COMPUTABLE), `applyFloorCap`, `targetForPeriod`, `goalAchievementInput`, `validateCalcMethod`, `validateTargetLevels`, `parseFormula` / `evaluateFormula` (safe, no `eval`) |
| `scoreRules.ts` | `weightedScore` (provisional + `complete`), `lineWeightedScore`, `finalizeIssues` / `canFinalize`, `adjustedScore`, `roundScore`, `ratedScore`, `rollUpActual`, `aggregatePeriodActuals` |
| `goalPlanRules.ts` | T3: `planSummaries` / `planSummary`, `remainingWeight`, `nextSortOrder`, `evenSplit`, `periodTargetIssues`. `WEIGHT_TOLERANCE`, `totalWeight`, `isWeightComplete`, `submitIssues`, `canEditPlan`, `planStatusOnEnterStep`, `statusAfterUnlock`, `canLock` / `canUnlock`, `planAfterChanges`, `applyGoalChanges`, `changeItemIssues` (`{ draft }`) |
| `alignmentRules.ts` | `wouldCreateCycle`, `allocationBuckets` ("chưa giao", leavers), `allocationIssue`, `checkAlignment`; T3: `goalAllocationIssues`, `cascadedGoalDraft`, `SHARE_SAFE_METHODS` |
| `ratingRules.ts` | `ratingFor`, `validateRatingScale`, `payoutPctFor`, `validatePayoutRule` |
| `formRules.ts` | `canSubmit` (KPI_EVAL / GOAL_SETTING / GOAL_CHANGE), `validateScoreInput`, `evaluationTotal`, `columnPct` |
| `workflowRules.ts` | `validateWorkflow`, `resolveStepActors`, `entitlement`, `TRANSITIONS` / `transition`, **`checkAction`** (the gateway's only entry for `forms.act`), `isFrozen`, `mayEditAtCurrentStep`, `stepDeadline`, `isOverdue`, `overdueActions`, `remindersDue` / `reminderKey`, `onUnlock`, `isInInbox`, `launchDueDate`, `validateLaunch`, `dueScheduledLaunches`, `resolveRecipients`, `launchRuleFirings`; Gate 1: `canStartForm`, `canCancelLaunch`, `validateLaunchRule`, `launchTimingIssues`, `delegationIssues`, `canRevokeDelegation`, `editRefusal`, `editStanding`, `markHandled`, `assigneesOf` |
| `libraryRules.ts` (T2) | BR-KPI-74…76: `normaliseCode`, `codeIssues`, `otherCodesOf`, `perspectiveIssues`, `measureUnitIssues`, `calcMethodIssues` (+ separate `lock`), `methodScoringChanged`, `kpiDefinitionIssues`, `activeTemplatesContaining`, `templateIssues` → `{ errors, warnings }`, `templateWeightTotal`, `libraryUsage`, `templateAudience`; export rows `libraryExportRows`, `templateExportRows` |
| `workflowRules.ts` | (T7: `effectiveOverdueBehaviour` — what the scheduler will really do, shared by `overdueActions` and the reminder) `validateWorkflow`, `resolveStepActors`, `entitlement`, `TRANSITIONS` / `transition`, **`checkAction`** (the gateway's only entry for `forms.act`), `isFrozen`, `mayEditAtCurrentStep`, `stepDeadline`, `isOverdue`, `overdueActions`, `remindersDue` / `reminderKey`, `onUnlock`, `isInInbox`, `launchDueDate`, `validateLaunch`, `dueScheduledLaunches`, `resolveRecipients`, `launchRuleFirings`; Gate 1: `canStartForm`, `canCancelLaunch`, `validateLaunchRule`, `launchTimingIssues`, `delegationIssues`, `canRevokeDelegation`, `editRefusal`, `editStanding`, `markHandled`, `assigneesOf` |
| `cycleRules.ts` (Gate 1) | `CYCLE_NEXT`, `cycleIssues`, `periodIssues`, `canEditCycle`, `statusChangeIssues`, `canLockPeriod`, `cycleAllowsLaunch` (BR-KPI-25); T3: `generatePeriods`, `mergeGeneratedPeriods`, `periodInput`, `nextCycleStatus`, `defaultCycleId` |
| `resultRules.ts` (Gate 1) | The period-result pipeline the mock and the seed share: `buildPeriodResults`, `applyAdjustment`, `finalizePeriodResults`, `lockPeriodResults` → `ResultChanges`; `computeResult`, `finalizeCheck`, `RESULT_TRANSITIONS`, `canRecalculate` / `canAdjust` / `canTransition`, `evaluationLines` / `actualLines` / `planLines`, `currentLinesOf` (BR-KPI-40, 43, 44) |
| `actualRules.ts` (Gate 1) | `actualIssues` (`recordActual` and T4's import rows), `isResultFinalised` (BR-KPI-52) |
| `orgAdminRules.ts` (T1) | `unitIssues`, `unitEndIssues`, `unitUsage`, `headIssues`, `positionIssues`, `positionUsage`, `employeeIssues`, `resignationPlan` (B3), `resignationImpact`, `assignmentIssues`, `managerOutsideUnit`, `transferPlan` (B1), `tenantIssues`, `isValidTimeZone`, `Draft<T>` — transition-based, `RuleIssue[]` — tested + `fixtures/orgGuards.test.ts` |
| `accessAdminRules.ts` (T1) | `accountIssues`, `accountPlan` (B2), `userRoleIssues`, `userRoleRemovalIssues`, `isProtectedUserRole`, `accessIssues` (BR-KPI-72), `tenantAdmins`, `ADMIN_LOCKED_PERMISSIONS`, `scopeCoverage`, `widestScope` — tested |
| `orgImportRules.ts` / `importColumns.ts` (T1) | `ORG_DATA_COLUMNS` (`ImportColumn<Row>` — the template and T4's parser share it), `orgDataRowErrors` (file + tenant, a manager later in the file is valid, loops across both) — tested |
| `excel/workbook.ts` / `excel/orgDataTemplate.ts` (T1) | `buildTemplateWorkbook` (exceljs imported on call only), `orgDataTemplateSpec` — tested |
| `orgIssueCopy.ts` (T1) | `ORG_ISSUE_COPY` (sentence per rule sub-code), `orgIssueText`, `fieldIssues`, `otherIssues` — completeness tested against the rule sources |
| `orgRules.ts` | `isEffectiveOn`, `primaryAssignmentOn`, `managerOf`, `unitAncestry`, `descendantUnitIds`, `wouldCreateUnitCycle`, `isEmployedOn` / `isEmployedDuring` / `employedFraction`, `scopeSubjectOn`, `scopeCoversEmployee` (the scope semantics 1.3 shares) |
| `notificationRules.ts` (T7) | `NOTIFICATION_VARIABLES`, `VARIABLES_BY_EVENT`, `templateVariables`, `templateIssues`, `renderTemplate` (never a raw `{{…}}`), `formatViDate`, `periodPhrase`, `deadlineConsequence`, `notificationRecipients`, `stepActedNotification`, `notificationRef`, `notificationSourceKey`, `inAppTemplateFor`, `isInAppNotification` (BR-KPI-45…47) |
| `auditRules.ts` (T7) | `auditChanges` (field diff; `null` = unreadable), `auditSubjectName` (name column, else the person it is about), `dayRangeToInstants` (BR-KPI-49) |
| `fileRules.ts` (T7) | `MAX_FILE_BYTES`, `ALLOWED_FILE_TYPES`, `FILE_ACCEPT`, `fileIssues` (BR-KPI-48, `ASSUMPTION Q30`) |
| `planAccessRules.ts` (T3) | Above goalPlan + workflow rules: `planEditability` / `planEditabilityFrom` (+ `PlanEditReason`, `UNKNOWN_EDITABILITY`), `submitAvailability(From)` (a `checkAction` dry run), `canSeeGoal` / `visibleGoals` (D2), `planReadiness`, `linkCandidatePlans`, `openRegistrationOf`, `planOwnerOf` |
| `goalPlanImportRules.ts` (T3) | `GOAL_PLAN_IMPORT_COLUMNS`, `goalPlanImportIssues`, `goalPlanImportDrafts` + the `GoalPlanImportDraft` hand-off type for T4 (BR-KPI-26) |
| `numberInput.ts` | `parseDecimalInput` (vi-VN `9.600.000.000` / `92,5`; blank → `null`, never 0), `formatDecimalInput` |
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
| `org.ts` | Reads: `useOrgUnits`, `useEmployees(filter)`, `usePositions`, `useAssignments(filter)`, `useUserAccounts`, `useRoles`, `useRolePermissions`, `useUserRoles`, `usePermissions` (each with its `*Key`); `useOrgDirectory` / `useAccessDirectory` (data only when EVERY list loaded — pre-checks never run on a partial list). Writes (T1, one `useOrgMutation` shape: catalogue toast, `issuesOf(error)` for the form, roots invalidated on settle): `useSaveOrgUnit`, `useSavePosition`, `useSaveEmployee`, `useSaveAssignment`, `useSaveUserAccount`, `useSaveUserRole`, `useDeleteUserRole`, `useSetRolePermissions`, `useSaveTenant` (+ tenants), `useResignEmployee` (`ResignError.stage`) — tested |
| `library.ts` | Reads `useKpiDefinitions(filter)`, `usePerspectives`, `useMeasureUnits`, `useCalcMethods`, `useCalcTiers`, `useKpiTemplates`, `useKpiTemplateItems`, `useDataSources` (G4 read kept here until T4), `useLibraryGoalUsage` (root `goals`); writes `useSavePerspective`, `useSaveMeasureUnit`, `useSaveCalcMethod`, `useSaveKpiDefinition`, `useSaveKpiTemplate` — reject to the caller (`mutateAsync`), invalidate their root (+ `*Key`) |
| `org.ts` | `useOrgUnits` (`orgUnitsKey`), `useEmployees(filter)` (`employeesKey`), `useUserAccounts` (`userAccountsKey`, T7) |
| `system.ts` (T7) | `useNotificationTemplates` / `useSaveNotificationTemplate`; `useNotifications(unreadOnly)` and `useAuditLog(filter, enabled)` (`useInfiniteQuery` over keyset pages); `useUnreadNotificationCount` (in-app only, `capped` past 500); `useMarkNotificationRead`, `useMarkAllNotificationsRead` (each on its own, rejects with the first failure); `useFile`, `useUploadFile`, `useOpenFile` |
| `workflows.ts` (T7, read-only) | `useWorkflows(formType?)`, `useWorkflowSteps(workflowId?)` — T5 adds the writes |
| `library.ts` | `useKpiDefinitions(filter)`, `usePerspectives`, `useMeasureUnits` (+ `*Key`) |
| `session.ts` | `useTenants` (`tenantsKey` = `['platform','tenants']`), `useSessionDirectory(tenantId)` (`sessionDirectoryKey`), `useResetSeed` (reseed + latency/failure defaults + `resetQueries()` + `devStore` reset), `readGatewayNow`, `hasDevControls` — the ONE place hooks take `tenantId` explicitly (they run before a session exists) |
| `keys.ts` | `queryKey(tenantId, root, ...params)` (tenant first — every `*Key` above uses it), `KEY_ROOTS` (root → the entities it reads), `rootsAffectedBy(entity)`, `TENANTS_KEY`, `DEV_NOW_KEY` (`['dev','now']`, the one clock is not tenant data) — tested |
| `goals.ts` (T3) | G3 reads with `*Key` (cycles, periods, plans, KGIs, goals, levels, splits, alignments); `useGoals` = VISIBLE goals (D2), `useGoalRows` = every row for aggregates; writes via `useGatewayWrite` (catalogue toast, refresh on every outcome); `useSaveGoal` (+ `PartialGoalSaveError`), `useCascadeGoal` (+ `CascadeOrphanError`), `useSubmitPlanForm`; composites `usePlanWorkspace`, `usePlanSummaries`, `usePlansEditability`, `useGoalLookups` |
| `forms.ts` / `actuals.ts` / `system.ts` (T3 reads; T5 / T4 / T7 extend) | `useFormList`, `useWorkflowSteps`, `useDelegations` · `useDataSources` · `useAuditEntries` |
| `toasts.ts` | `toastWriteError` (catalogue copy, optional persistent), `toastSaved` |
| `dev.ts` | The ONLY toolbar access to `gateway.dev`: `useSimulatedNow` (`simulatedNowKey`, staleTime ∞, re-read on open), `useSetSimulatedNow` (`{ to }` or `{ shiftDays }` via `addDaysToInstant` in the tenant zone), `useSetLatency`, `useSetFailureMode` (all three mirror into `devStore` and invalidate every query), `useRunScheduler` (session tenant, invalidates `[tenantId]`) — tested |
| `useGatewayEventInvalidation` | Subscribes the cache to the gateway's `entity.changed` for one tenant; invalidates the affected roots once per microtask — tested; mounted by `GatewayEventBridge` |

## Mock adapter and seed (Phase 1.2) — for tests only outside `src/integrations/data/`

| Item | What it does |
|---|---|
| `mock/gateway.test-util.ts` | `newGateway()` (fresh mock, `MemoryStorage`, no latency, shared seed, notification listener OFF unless `notifications: true` — then await `gateway.notificationsSettled()`), `rejection()`, `flush()` |
| `@/data/fixtures` `SYNTRA` / `DEMO` | Seeded ids by readable key: `SYNTRA.user('E016')`, `SYNTRA.employee(…)`, `SYNTRA.unit('KD')`, `SYNTRA.id('Goal', …)`, `personas` |

