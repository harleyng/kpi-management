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
| `PageHeader` | Title, description, actions, `status` badge, `breadcrumb` (a sub-page shows its area automatically; a detail page passes an explicit trail) — every route-level screen; sets the browser title, its `h1` takes focus on navigation |
| `UnsavedChangesGuard` | `when={dirty}` on an editor page: asks before leaving to another path (`useBlocker`, data router only) and on reload |
| `PlaceholderPanel` | "Chưa xây dựng", then "Phần việc: WP x.y.z, Track Tn" + the list of remaining work |
| `EmptyState` / `EmptyStateCard` | "There is nothing here" for a panel / a whole page, with an optional next action |
| `ErrorStateCard` / `ErrorState` | A failed read for a page / inside a panel or popover; takes a catalogue `spec` (`errorSpecOf(error)`), `role="alert"` |
| `DataTable` | The management table: columns (`numeric`, `sortValue`), the `useQuery` result, first-use vs filtered empty, `—` for missing cells, client paging or `serverPage` for `Page<T>` lists, `toolbar` (search/filters) and `actions` (primary CTA) in a row ABOVE the card, totals `footer` |
| `MissingValue` | `—` with sr-only "chưa có" (exported from `DataTable.tsx`) |
| `FormField` / `RequiredLegend` | Label + control (render prop with id/ARIA) + hint + announced error; "* Bắt buộc" legend |
| `EntityCombobox` | Searchable single/multiple picker (Popover + cmdk, `matchesSearch`); never misreports a selected value (loading / failed / no longer in list) |
| `KpiPicker` | Library KPI picker grouped by BSC perspective; Draft/Archived disabled; `excludeIds` |
| `EmployeePicker` | Person picker with an `EmployeeFilter` (direct reports, unit); resigned shown disabled |
| `OrgUnitTree` / `OrgUnitTreeView` | ARIA tree of the org (roving tabindex, ↑↓←→ Home End Enter/Space), single or multiple, search above >10 units |
| `InlineNotice` (T4) | A short tinted notice inside a panel (`info` / `warning` / `negative`, 1px border, icon + title + body) — why an action is blocked, what a preview means; `alert` only for something that just failed |
| `LaterPhaseNotice` | "Phase sau — chưa có trong P1" info notice at the top of a screen kept for a later phase (the API sync and connections, BR-KPI-56); pairs with `NavChild.laterPhase`, which tags the menu item "Phase sau" in `AppSidebar` |
| `ConfirmDialog` | Confirmation before an irreversible action (lock, finalise, delete); `destructive` for removals |
| `StatusBadge` | The `Tone` primitive, plus one badge per state set (`GoalPlanStatusBadge`, `FormStatusBadge` with `atMyStep`, `OverdueBadge`, `CycleStatusBadge`, `PeriodResultStatusBadge`, `GoalStatusBadge`, `LibraryStatusBadge`, `LaunchStatusBadge`, `ImportBatchStatusBadge`, `SyncRunStatusBadge`, `NotificationStatusBadge`, `EmploymentStatusBadge`, `RecordStatusBadge`); tones in `statusTones.ts`; `AttentionBadge` (Phase 3: "Dưới ngưỡng" / "Thiếu số liệu" / "Xếp loại thấp", `ATTENTION_LABEL` in `statusTones.ts`) |
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
| `OrgStructureTab` · `OrgUnitDetailPage` | Cơ cấu: the tree (`OrgUnitTreeView`, "Hiện đơn vị ngừng dùng" `?inactive=1`) — a unit opens on `/system/org/structure/:unitId`: ancestors as breadcrumb, head, dates, staff today, sub-units, Sửa / Thêm đơn vị trực thuộc / Ngừng dùng (blocked reasons from `unitEndIssues`) |
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
| `PerspectivesSection` · `UnitsSection` (`CataloguesSections.tsx`) | Viễn cảnh BSC (rename / reorder) and Đơn vị đo (code locked while in use) — each record edits in a dialog |
| `CalcMethodsPanel` / `CalcMethodSheet` | Methods with "Đang dùng" counts; editor with the tier editor and the in-use lock (BR-KPI-80), live `validateCalcMethod` per tier |
| `KpiTemplatesPage` / `TemplateDetailPage` + `TemplateEditor` | `/admin/templates` list ("Cần xem lại" in words) and `/admin/templates/:id` editor page with the sticky weight-total / item-count footer (warnings, Q26), `KpiPicker` to add items, `UnsavedChangesGuard` |
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
| `GoalPlanWorkspace` | One Goal Plan end to end: `PlanHeader` (+ readiness strip and "Gửi"), `KgiSection` (KGI in `KgiDialog`), `GoalTable` (rows open the goal page under `basePath`), `CascadeDialog`; loading / error / not-found states; every decision from `usePlanWorkspace` |
| `PlanPage` · `GoalPage` (`GoalPlanPages.tsx`) | A plan / one goal on its own route for each `kind` (my, members, unit, cycles), checked by `planRouteAllows` (BR-KPI-90); the goal page's facets Thông tin / Phân bổ theo kỳ / Liên kết (`useFacetTab`, `?tab=`) reuse `GoalEditorPanel` / `PeriodSplitPanel` / `LinkGoalPanel`; `goalNav.ts` builds the urls |
| `PlanHeader` | Owner, status, registration step, weight / goal / KGI counts, the read-only reason, "Cần xử lý trước khi gửi" / "Lưu ý" (each item jumps to its row), "Gửi" / "Chuyển cho nhân viên" with confirm |
| `GoalTable` | Goals ordered by perspective (Changed / Cancelled muted, struck), weight-total footer, optional D3 bucket columns, a row menu whose disabled items carry their reason |
| `GoalEditorPanel` | §5.1 fields inline; a library pick fills only untouched fields; levels section (ASSUMPTION Q1 hint); partial-save handling |
| `PeriodSplitPanel` / `LinkGoalPanel` | Split by month / quarter with "Chia đều" and live warnings; link up to the manager's / unit's / company's goals (visible ones only) |
| `CascadeDialog` | "Phân giao": from a Company / OrgUnit plan "Giao cho: Đơn vị \| Nhân viên" (native radios; shown only when `cascadeTargetPlans` finds unit plans) — unit plans with the head's name, or reports; a target the user may not edit now is disabled with the reason, HR acting as proxy is named ("thao tác thay …"); share, weight (remaining to 100%), method when the parent's is not share-safe, bucket preview "Mục tiêu / Đã giao / Tự giao / Chưa giao", ERR-KPI-11 inline. A unit target's child goal belongs to the unit head |
| `ApplyTemplateDialog` | "Thêm từ bộ mẫu" (BR-KPI-77), opened beside "Thêm chỉ tiêu" on `GoalPlanWorkspace`: grouped template `Select` ("Gợi ý cho …" / "Bộ mẫu khác", `templatesForPlan`), preview table (KPI, weight, target, Thêm / skip reason from `goalCopy.TEMPLATE_SKIP_COPY`), totals after adding (weight, count, missing targets — warnings), "Thêm N chỉ tiêu" via `useApplyTemplate`; a part-way refusal keeps the dialog open and says how many were added. Reads the plan's goals whole (private too) |
| `StartRegistrationButton` | "Bắt đầu đăng ký" on a Company / OrgUnit plan (BR-KPI-19) — hidden unless startable now (not Locked, no open registration, `cycleAllowsLaunch`, `form.start`, a unit head); dialog: head, each step with who acts now (`registrationRoute`), SLA and overdue, a warning for an unattended step that locks, due date (default `defaultStartDueDays`), `canStartForm` issues in catalogue copy. Row action in `CyclePlansPanel` |
| `StartFormLoadError` | ERR-KPI-01 title + "Thử lại" in place of a start-form button whose reads failed (`StartAdjustmentButton`, `StartRegistrationButton`) |
| `PlanLockActions` | HR's lock (confirm), unlock (reason + new due date when a form is open), lock history from the audit log |
| `CycleDetailPage` + `CycleDetail.tsx` (`CycleActions`, `PeriodsPanel`, `CyclePlansPanel`, `CycleFormDialog`) | `/admin/cycles/list/:cycleId`: next-status action, facets Đợt đánh giá (generate in a dialog → preview → apply, lock switches) / Goal Plan (filters, create Company / OrgUnit plan, "Bắt đầu đăng ký" on a unit plan — the "Phiếu đăng ký" column says "Chưa bắt đầu" / "Chưa có trưởng đơn vị" until one runs; rows open the plan page). `PeriodsPanel` / `CyclePlansPanel` are also the "Đợt đánh giá" / "Goal Plan" sub-pages (`CyclesPage section`) under a `CyclePicker` |
| `CyclePicker` + `useSelectedCycle` | `?cycle=` with `cycleRules.defaultCycleId` |
| `goalCopy.ts` | `EDIT_REASON_COPY`, `issueText` (catalogue title + the detail's words), `formatTarget`, `formatWeight`, `planOwnerName` |

## `src/components/actuals/` (Track T4)

| Component | Purpose |
|---|---|
| `ImportUploadCard` | Stages 1–2 of ANY import: "Tải mẫu" (+ controls such as the month) and "Tải tệp lên" → `readSheet` + `parseSheet`; a non-workbook comes back as FILE_UNREADABLE. T1/T2/T3 reuse it with their spec |
| `ImportPreview` | The preview of ANY import: `source: 'local'` (not sent — banner, no actions) or `'batch'`; file errors replace the table; rows with errors first, "Chỉ dòng lỗi", each error = column + catalogue sentence; warnings; sticky footer for the actions |
| `ActualEntrySheet` | The side sheet to enter one goal's month: blockers before typing, value (number or Đạt/Không đạt), note, "Lưu và sang chỉ tiêu kế tiếp", snapshot history, `EvidencePanel` |
| `EvidencePanel` | Evidence of a goal for a month: list (file / link, who, when), add a link or a file, remove. T5's evaluation form reuses it |
| `ActualValue` / `SourceTypeTag` | A value (`—` when none, never 0) / where it came from (icon + label, muted — a category, not a status) |
| `CycleSelect` / `MonthSelect` | The shared pickers (default: the Active cycle; the latest month ended) |
| `ActualEntryTab` · `ActualImportTab` · `SyncTab` (+ `ScheduleText`, `RunSyncDialog`) · `useCycleGoalData` · `useCyclePeriodParams` | The three sub-pages of Số liệu & import (`?cycle=&period=`), and the composite read of a cycle's goals with one combined state |
| `ImportBatchPage` · `SyncConnectionPage` (`ActualsDetailPages.tsx`) · `BatchPreview` | One import batch (`/admin/actuals/import/:batchId`) and one connection's runs (`/admin/actuals/sync/:connectionId`) |
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
| `WorkflowsTab` · `WorkflowDetailPage` + `WorkflowStepEditor` | Quy trình duyệt: the workflows table; one workflow's step settings on its own page with `validateWorkflow` inline, `workflowEditWarnings` and `UnsavedChangesGuard` · `NewLaunchPage` hosts `LaunchPanel` |
| `RecipientFilterFields` · `recipients.ts` | "Người nhận" ALL / FILTER fields · `EMPTY_RECIPIENT_FILTER`, `recipientSummary` |

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

## `src/components/dashboard/` (Phase 3, WBS 4.7.1–4.7.4)

| Component | Purpose |
|---|---|
| `useDashboardSelection` / `useFocusUnit` | `?cycle=&period=` (period defaults to `defaultDashboardPeriod` once every period's results loaded) and `?unit=` (pushed, so Back returns up; a unit outside the scope falls back to the root) |
| `OverviewTab` | "Tổng quan": breadcrumb, `UnitSummary`, child units or staff, side column (attention, BSC, trend, assistant); "Kỳ chưa chốt" notice; whole-read error with "Thử lại" |
| `UnitSummary` / `UnitBreadcrumb` | The focus unit's figures as a definition strip; `<nav aria-label="Đường dẫn">` starting at the viewer's highest unit, `aria-current` on the last |
| `ChildUnitsTable` / `StaffTable` | Child units (own score + status, Δ, staff average n/m, "Xếp loại thấp"); the unit's people (stored score, rating, % lương, Δ, status) — a name opens T6's `ResultDetailDialog` with `plan` (visibility mode) |
| `SidePanels` | `Panel` / `PanelState` (own loading / error), `AttentionList` (5 + "Xem tất cả", hidden goals counted), `PerspectiveBars` (a table: neutral bars, 100% line, weight share), `TrendChart` (Recharts, no animation, hollow Draft points, "Xem dạng bảng") |
| `DashboardFigures` | `DeltaValue` ("(tạm tính)", why it is missing), `StaffAverageValue`, `Figure` |
| `InsightCard` | "Trợ lý KPI · Giả lập": collapsed summary, a labelled question box + 5 suggested questions, `aria-live` answers, catalogue errors with retry |
| `OperationsTab` | "Vận hành": registration / evaluation / results sections, progress bar, overdue table → `/forms/:id`, "Xuất báo cáo vận hành (Excel)" (exceljs on click, disabled with its reason when empty) |
| `MyKpiSummary` | "KPI của tôi" on `/my/results`: latest official result, Δ only against an official month, months as text, attention list |

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
| `resultView.ts` (T6) | Display mapping for the result screens: `buildResultRows` (one join, Maps), `payoutState`, `statusCounts`, `isShownToEmployee` (BR-KPI-82), `draftSelection`, `formatPoints`, `UNKNOWN_OWNER` — tested |
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
| `scoreRules.ts` | `weightedScore` (provisional + `complete`), `lineWeightedScore`, `finalizeIssues` / `canFinalize`, `adjustedScore`, `roundScore`, `ratedScore`, `rollUpActual`, `aggregatePeriodActuals`; T6: `scoreBreakdown` (raw · adjustment · stored total · clamped — never summed on screen) |
| `goalPlanRules.ts` | T3: `planSummaries` / `planSummary`, `remainingWeight`, `nextSortOrder`, `evenSplit`, `periodTargetIssues`. `WEIGHT_TOLERANCE`, `totalWeight`, `isWeightComplete`, `submitIssues`, `canEditPlan`, `planStatusOnEnterStep`, `statusAfterUnlock`, `canLock` / `canUnlock`, `planAfterChanges`, `applyGoalChanges`, `changeItemIssues` (`{ draft }`) |
| `alignmentRules.ts` | `wouldCreateCycle`, `allocationBuckets` ("chưa giao", leavers), `allocationIssue`, `checkAlignment`; T3: `goalAllocationIssues`, `cascadedGoalDraft`, `SHARE_SAFE_METHODS` |
| `ratingRules.ts` | `ratingFor`, `validateRatingScale`, `payoutPctFor`, `validatePayoutRule` |
| `formRules.ts` | `canSubmit` (KPI_EVAL / GOAL_SETTING / GOAL_CHANGE), `validateScoreInput`, `evaluationTotal`, `columnPct` |
| `workflowRules.ts` | `validateWorkflow`, `resolveStepActors`, `entitlement`, `TRANSITIONS` / `transition`, **`checkAction`** (the gateway's only entry for `forms.act`), `isFrozen`, `mayEditAtCurrentStep`, `stepDeadline`, `isOverdue`, `overdueActions`, `remindersDue` / `reminderKey`, `onUnlock`, `isInInbox`, `launchDueDate`, `validateLaunch`, `dueScheduledLaunches`, `resolveRecipients`, `launchRuleFirings`; Gate 1: `canStartForm`, `canCancelLaunch`, `validateLaunchRule`, `launchTimingIssues`, `delegationIssues`, `canRevokeDelegation`, `editRefusal`, `editStanding`, `markHandled`, `assigneesOf` |
| `libraryRules.ts` (T2) | BR-KPI-74…80: `normaliseCode`, `codeIssues`, `otherCodesOf`, `perspectiveIssues`, `measureUnitIssues`, `calcMethodIssues` (+ separate `lock`), `methodScoringChanged`, `kpiDefinitionIssues`, `activeTemplatesContaining`, `templateIssues` → `{ errors, warnings }`, `templateWeightTotal`, `libraryUsage`, `templateAudience`; export rows `libraryExportRows`, `templateExportRows` |
| `workflowRules.ts` | (T7: `effectiveOverdueBehaviour` — what the scheduler will really do, shared by `overdueActions` and the reminder) `validateWorkflow`, `resolveStepActors`, `entitlement`, `TRANSITIONS` / `transition`, **`checkAction`** (the gateway's only entry for `forms.act`), `isFrozen`, `mayEditAtCurrentStep`, `stepDeadline`, `isOverdue`, `overdueActions`, `remindersDue` / `reminderKey`, `onUnlock`, `isInInbox`, `launchDueDate`, `validateLaunch`, `dueScheduledLaunches`, `resolveRecipients`, `launchRuleFirings`; Gate 1: `canStartForm`, `canCancelLaunch`, `validateLaunchRule`, `launchTimingIssues`, `delegationIssues`, `canRevokeDelegation`, `editRefusal`, `editStanding`, `markHandled`, `assigneesOf` |
| `cycleRules.ts` (Gate 1) | `CYCLE_NEXT`, `cycleIssues`, `periodIssues`, `canEditCycle`, `statusChangeIssues`, `canLockPeriod`, `cycleAllowsLaunch` (BR-KPI-25); T3: `generatePeriods`, `mergeGeneratedPeriods`, `periodInput`, `nextCycleStatus`, `defaultCycleId` |
| `resultRules.ts` (Gate 1) | The period-result pipeline the mock and the seed share: `buildPeriodResults`, `applyAdjustment`, `finalizePeriodResults`, `lockPeriodResults` → `ResultChanges`; `computeResult`, `finalizeCheck`, `RESULT_TRANSITIONS`, `canRecalculate` / `canAdjust` / `canTransition`, `evaluationLines` / `actualLines` / `planLines`, `currentLinesOf`; T6: `subjectAssignment` (the assignment a payout is read for, shared with the payroll file) (BR-KPI-40, 43, 44) |
| `orgAdminRules.ts` (T1) | `unitIssues`, `unitEndIssues`, `unitUsage`, `headIssues`, `positionIssues`, `positionUsage`, `employeeIssues`, `resignationPlan` (B3), `resignationImpact`, `assignmentIssues`, `managerOutsideUnit`, `transferPlan` (B1), `tenantIssues`, `isValidTimeZone`, `Draft<T>` — transition-based, `RuleIssue[]` — tested + `fixtures/orgGuards.test.ts` |
| `accessAdminRules.ts` (T1) | `accountIssues`, `accountPlan` (B2), `userRoleIssues`, `userRoleRemovalIssues`, `isProtectedUserRole`, `accessIssues` (BR-KPI-72), `tenantAdmins`, `ADMIN_LOCKED_PERMISSIONS`, `scopeCoverage`, `widestScope` — tested |
| `orgImportRules.ts` / `importColumns.ts` (T1) | `ORG_DATA_COLUMNS` (`ImportColumn<Row>` — the template and T4's parser share it), `orgDataRowErrors` (file + tenant, a manager later in the file is valid, loops across both) — tested |
| `excel/workbook.ts` / `excel/orgDataTemplate.ts` (T1) | `buildTemplateWorkbook` (exceljs imported on call only), `orgDataTemplateSpec` — tested |
| `orgIssueCopy.ts` (T1) | `ORG_ISSUE_COPY` (sentence per rule sub-code), `orgIssueText`, `fieldIssues`, `otherIssues` — completeness tested against the rule sources |
| `cumulativeRules.ts` (Plan B, B0 — PEND-05) | `cumulativeMonths`, `runningFigure` (partial + `complete`, unlike `aggregatePeriodActuals`), `cumulativeActual`, `cumulativeTarget` (no proration), `cumulativeAchievement` → on track / year progress / `provisional` (`ASSUMPTION Q51`) — not wired yet |
| `workRules.ts` (Plan B, B0 — PEND-14) | `DEFAULT_WORK_SCORING`, `workScoringIssues`, `workScoreIssue`, `totalTaskWeight`, `taskWeightIssues`, `effectiveWeights` (Q64), `kqcv`, `hsht`, `hsnvRequired`, `hsnvIssues`, `finalWorkScore` (Q61) — structural types until 8.1 adds the entities |
| `actualRules.ts` (Gate 1, T4) | `actualIssues` = `entryBlockers` (plan / period / result / goal — what the entry screen shows before typing) + `valueIssues`; `isResultFinalised`, `currentActual`, `syncKeepsHumanActual`, `syncRunStatus`, `isEvidenceUrl`, `monthlySchedule` (BR-KPI-52, 56, 57) |
| `importRules.ts` (T4) | THE shared import framework: `ImportColumn` / `ImportTemplateSpec`, `parseSheet(spec, matrix)`, `normaliseCell`, `parseNumberCell` / `parseDateCell` / `parseTextCell`, `importError`, `batchCounts`, `canCommitImport`, `canRejectImport`, `errorsByRow`, `previewOrder` (BR-KPI-53, 54) — shared by T1/T2/T3, changing it is Large |
| `actualImportRules.ts` (T4) | `ACTUAL_IMPORT_SPEC` / `ACTUAL_COLUMNS`, `resolveActualRow`, `validateActualRows`, `actualImportWarnings`, `actualTemplateRows` (BR-KPI-53) |
| `actualEntryRules.ts` (T4) | `buildActualEntryRows` (the manual-entry table, decided whole), `actualEntrySummary`, `filterActualEntryRows`, `defaultCycle` / `monthsOf` / `defaultMonth` (the shared pickers) |
| `excel.ts` (T4) | `writeTemplate(spec, rows, lists)` → Blob, `writeSheets(sheets)` → a plain report workbook (Phase 3), `readSheet(buffer)` → cell matrix — exceljs, loaded lazily; imported only by lazy screens |
| `orgRules.ts` | `isEffectiveOn`, `primaryAssignmentOn`, `managerOf`, `unitAncestry`, `descendantUnitIds`, `wouldCreateUnitCycle`, `isEmployedOn` / `isEmployedDuring` / `employedFraction`, `scopeSubjectOn`, `scopeCoversEmployee` (the scope semantics 1.3 shares) |
| `notificationRules.ts` (T7) | `NOTIFICATION_VARIABLES`, `VARIABLES_BY_EVENT`, `templateVariables`, `templateIssues`, `renderTemplate` (never a raw `{{…}}`), `formatViDate`, `periodPhrase`, `deadlineConsequence`, `notificationRecipients`, `stepActedNotification`, `notificationRef`, `notificationSourceKey`, `inAppTemplateFor`, `isInAppNotification` (BR-KPI-45…47) |
| `auditRules.ts` (T7) | `auditChanges` (field diff; `null` = unreadable), `auditSubjectName` (name column, else the person it is about), `dayRangeToInstants` (BR-KPI-49) |
| `fileRules.ts` (T7) | `MAX_FILE_BYTES`, `ALLOWED_FILE_TYPES`, `FILE_ACCEPT`, `fileIssues` (BR-KPI-48, `ASSUMPTION Q30`) |
| `planAccessRules.ts` (T3) | Above goalPlan + workflow rules: `planEditability` / `planEditabilityFrom` (+ `PlanEditReason`, `UNKNOWN_EDITABILITY`), `submitAvailability(From)` (a `checkAction` dry run), `canSeeGoal` / `visibleGoals` (D2), `planReadiness`, `linkCandidatePlans`, `openRegistrationOf`, `planOwnerOf` |
| `goalPlanImportRules.ts` (T3) | `GOAL_PLAN_IMPORT_COLUMNS`, `goalPlanImportIssues`, `goalPlanImportDrafts` + the `GoalPlanImportDraft` hand-off type for T4 (BR-KPI-26) |
| `numberInput.ts` | `parseDecimalInput` (vi-VN `9.600.000.000` / `92,5`; blank → `null`, never 0), `formatDecimalInput` |
| `formViewRules.ts` (T5) | `formStanding` (what a user may do on a form now — a composition of `workflowRules`, display hint), `submitCheckInput` (THE content-check builder, shared with the mock), `stepTiming`, `delegationState` / `isDelegationRevocable`, `goalDraftFromGoal` / `goalDraftFromKpi`, `workflowEditWarnings`, `actorDirectoryOf` — tested, incl. `formViewRules.parity.test.ts` against the seeded mock |
| `payrollRules.ts` (T6) | BR-KPI-81: `isPayrollResult`, `payoutNote` / `PAYROLL_NOTE_LABEL` (Q39), `payrollPreview`, `buildPayrollSheet` (stored numbers only), `payrollFileName` |
| `dashboardRules.ts` (Phase 3) | BR-KPI-83…89, Q40–Q43: `buildDashboard` (scope via `can('dashboard.view')`, staff placed per period by `subjectAssignment`, own-plan score, Δ, official staff average), `staffOfUnit`, `unitPath`, `rankableUnits`, `scoreDelta`, `previousPeriod`, `defaultDashboardPeriod`, `flaggedLevelIds` / `isResultFlagged`, `goalAttention` (`AT_RISK_ACHIEVEMENT_PCT` = 90), `perspectiveBreakdown`, `trendSeries`, `latestOfficialResult`, `formProgress` / `overdueRows` (T5's `stepTiming`), `planProgress`, `ratingDistribution`, `formsInScope` / `plansInScope` / `resultsInScope`, `operationsReport`, `dashboardSnapshot` / `snapshotDigest` / `rankSnapshotUnits` — tested, seed gate in `mock/dashboard.seed.test.ts` |
| `dashboardExport.ts` (Phase 3) | `operationsSheets` (the "Vận hành" sections as `ReportSheet`s), `isOperationsReportEmpty` — tested |
| `isoDate.ts` | `Clock`, `todayOf`, `toZonedDate`, `addDays`, `daysBetween`, `minDate`, `isWithin`, `isIsoDate`, `addDaysToInstant` (calendar days in a zone, wall time kept), `toZonedLocalInput` / `fromZonedLocalInput` (`datetime-local` ↔ instant), `zoneOffsetLabel` (`GMT+7`) |

Test factories for rule tests: `src/test/builders.ts` (deliberately not the seed fixtures).

## `src/integrations/`

| File | Purpose |
|---|---|
| `data/index.ts` | `getDataGateway()`, `resolveAdapterName()` — tested |
| `data/types.ts` | The `DataGateway` contract (Phase 1.1 fills it) |
| `data/mockGateway.ts` / `data/supabaseGateway.ts` | Adapters — never imported outside `integrations/data/` |
| `insight/index.ts` · `types.ts` · `mockInsightGateway.ts` | `getInsightGateway()`; the contract (`summarise` / `explain` / `ask` over a `DashboardSnapshot`, `SUGGESTED_QUESTIONS`, `MAX_QUESTION_LENGTH`); the deterministic mock (`intentOf` — whole-phrase matching, diacritics folded) — tested |

## `src/hooks/queries/`

Conventions in its `README.md`. Keys are `[tenantId, root, ...params]`.

| File | Hooks |
|---|---|
| `org.ts` | Reads: `useOrgUnits`, `useEmployees(filter)`, `usePositions`, `useAssignments(filter)`, `useUserAccounts`, `useRoles`, `useRolePermissions`, `useUserRoles`, `usePermissions` (each with its `*Key`); `useOrgDirectory` / `useAccessDirectory` (data only when EVERY list loaded — pre-checks never run on a partial list). Writes (T1, one `useOrgMutation` shape: catalogue toast, `issuesOf(error)` for the form, roots invalidated on settle): `useSaveOrgUnit`, `useSavePosition`, `useSaveEmployee`, `useSaveAssignment`, `useSaveUserAccount`, `useSaveUserRole`, `useDeleteUserRole`, `useSetRolePermissions`, `useSaveTenant` (+ tenants), `useResignEmployee` (`ResignError.stage`) — tested |
| `library.ts` | Reads `useKpiDefinitions(filter)`, `usePerspectives`, `useMeasureUnits`, `useCalcMethods`, `useCalcTiers`, `useKpiTemplates`, `useKpiTemplateItems`, `useLibraryGoalUsage` (root `goals`); writes `useSavePerspective`, `useSaveMeasureUnit`, `useSaveCalcMethod`, `useSaveKpiDefinition`, `useSaveKpiTemplate` — reject to the caller (`mutateAsync`), invalidate their root (+ `*Key`) |
| `system.ts` (T7) | `useNotificationTemplates` / `useSaveNotificationTemplate`; `useNotifications(unreadOnly)` and `useAuditLog(filter, enabled)` (`useInfiniteQuery` over keyset pages); `useUnreadNotificationCount` (in-app only, `capped` past 500); `useMarkNotificationRead`, `useMarkAllNotificationsRead` (each on its own, rejects with the first failure); `useFile`, `useUploadFile`, `useOpenFile` · `useAuditEntries(filter)` (T3: one record's whole history, own `auditLog/all` key — never the paged key) |
| `system.ts` (T6 part) | `downloadFile(tenantId, fileId)`, `useDownloadFile` (payroll files) |
| `actuals.ts` (T4) | Reads: `useDataSources`, `useConnections`, `useMappings`, `useSyncRuns`, `useActuals(filter)`, `useImportBatches`, `useImportBatch`, `useEvidence`, `useFileObject`. Writes: `useSaveDataSource`, `useSaveConnection`, `useRecordActual`, `useStageImport` (upload → stage, the file id kept per `File` for a retry, the failing step named), `useCommitImport`, `useRejectImport`, `useRunSync`, `useAddEvidence` (link or file), `useDeleteEvidence`, `useOpenFile` · `useAttachEvidence` (T5: upload + record, for the evaluation form) |
| `results.ts` (T6) | `useRatingScales`, `useRatingLevels`, `usePayoutRules`, `useSavePayoutRule`, `useDeletePayoutRule`, `usePeriodResults`, `useResultDetails`, selectors `useResultRows` / `usePayrollPreview` / `useResultBreakdown`, `useCalculateResults`, `useSetAdjustment`, `useFinalizeResults` (+ `isBlockedFinalize`: issues → panel, else toast), `useLockResults`, `usePayrollExports`, `useExportPayroll` (export, then download; the two fail separately) |
| `writeFeedback.ts` | `toastWriteError(error, step?)` — catalogue title + the rule's own reason (`issueText`) |
| `session.ts` | `useTenants` (`tenantsKey` = `['platform','tenants']`), `useSessionDirectory(tenantId)` (`sessionDirectoryKey`), `useResetSeed` (reseed + latency/failure defaults + `resetQueries()` + `devStore` reset), `readGatewayNow`, `hasDevControls` — the ONE place hooks take `tenantId` explicitly (they run before a session exists) |
| `keys.ts` | `queryKey(tenantId, root, ...params)` (tenant first — every `*Key` above uses it), `KEY_ROOTS` (root → the entities it reads), `rootsAffectedBy(entity)`, `TENANTS_KEY`, `DEV_NOW_KEY` (`['dev','now']`, the one clock is not tenant data) — tested |
| `goals.ts` (T3) | G3 reads with `*Key` (cycles, periods, plans, KGIs, goals, levels, splits, alignments); `useGoals` = VISIBLE goals (D2), `useGoalRows` = every row for aggregates; writes via `useGatewayWrite` (catalogue toast, refresh on every outcome); `useSaveGoal` (+ `PartialGoalSaveError`), `useCascadeGoal` (+ `CascadeOrphanError`), `useApplyTemplate` (+ `TemplateApplyError`), `useSubmitPlanForm`; composites `usePlanWorkspace`, `usePlanSummaries`, `usePlansEditability` (Employee AND unit plans — with a unit plan present it reads every GOAL_SETTING form, matched by plan, so a head change mid-form is not missed), `useGoalLookups`, `useActorDirectory` · `useAllPeriods` (T5: every cycle's periods, to name a form's period). T4's actuals screens read `useGoals`; T5's form bodies read `useGoalRows` for their own plan |
| `startForm.ts` | `useStartFormContext(plan, formType)` — a form started by hand: default workflow, its steps, the owner (unit head), the open form of the type, the route (`registrationRoute`), `today`, the default due date and `issuesFor(dueDate)` = `canStartForm` with the gateway's context; `status` loading / error / ready. Its own file because it reads both `forms.ts` and `goals.ts` |
| `toasts.ts` | `toastWriteError` (catalogue copy, optional persistent), `toastSaved` |
| `forms.ts` (T5) | Workflows, launches, launch rules, forms (paged), one form, actions, evaluation items, change items, inbox, delegations — reads with `*Key`; writes invalidate their roots; `useActOnForm` saves `UnsavedEdits` then acts · `useFormList(filter)` (T3: all pages at once, own `forms/all` key). T7's read-only `workflows.ts` was folded in here at the merge |
| additions | `library.ts` `useCalcMethods`; `org.ts` `usePositions`; `session.ts` `useGatewayClock` (the gateway clock + tenant zone, re-read each render) |
| `dashboard.ts` (Phase 3) | `useDashboardModel(selection)` (→ `DashboardData`, `buildDashboard`, one combined state), `useResultLines(result, plan)` (attention + BSC for one result, names by visibility), `useOperationsReport(selection, read)` |
| `insight.ts` (Phase 3) | `useInsightSummary(snapshot)`, `useExplainInsight(snapshot, nodeId)` (`insightKey` = tenant, `insight`, kind, snapshot digest), `useAskInsight()` (mutation, nothing stored) |
| `results.ts` additions (Phase 3) | `useResultsOfPeriods(periodIds)` (one query per period, `periodResultsKey`; data only once all loaded); `useResultBreakdown(result, { plan })` — with `plan`, goal names follow visibility (`hidden` lines) |
| `dev.ts` | The ONLY toolbar access to `gateway.dev`: `useSimulatedNow` (`simulatedNowKey`, staleTime ∞, re-read on open), `useSetSimulatedNow` (`{ to }` or `{ shiftDays }` via `addDaysToInstant` in the tenant zone), `useSetLatency`, `useSetFailureMode` (all three mirror into `devStore` and invalidate every query), `useRunScheduler` (session tenant, invalidates `[tenantId]`) — tested |
| `useGatewayEventInvalidation` | Subscribes the cache to the gateway's `entity.changed` for one tenant; invalidates the affected roots once per microtask — tested; mounted by `GatewayEventBridge` |

## Mock adapter and seed (Phase 1.2) — for tests only outside `src/integrations/data/`

| Item | What it does |
|---|---|
| `mock/gateway.test-util.ts` | `newGateway()` (fresh mock, `MemoryStorage`, no latency, shared seed, notification listener OFF unless `notifications: true` — then await `gateway.notificationsSettled()`), `rejection()`, `flush()` |
| `@/data/fixtures` `SYNTRA` / `DEMO` | Seeded ids by readable key: `SYNTRA.user('E016')`, `SYNTRA.employee(…)`, `SYNTRA.unit('KD')`, `SYNTRA.id('Goal', …)`, `personas` |

