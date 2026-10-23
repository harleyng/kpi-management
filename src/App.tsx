import { lazy } from 'react';
import { Navigate, Route, createRoutesFromElements } from 'react-router-dom';
import { AppRoot } from '@/components/layout/AppRoot';
import { AppShell } from '@/components/layout/AppShell';
import { HOME_URL } from '@/components/layout/navConfig';

/**
 * Route-level code splitting: each AREA is its own async chunk, loaded on demand — its sub-pages
 * share the module and pick their section by prop, so splitting a page into sub-pages does not
 * multiply chunks. `<Suspense>` lives inside `AppShell` (around `<Outlet/>`) so the app frame stays
 * mounted while a chunk loads.
 *
 * Every path is ABSOLUTE and is the FIRST attribute of its route: `navConfig.test.ts` reads them from this
 * file. Each list path mirrors a destination in `navConfig.ts` (plan §7.1) and a row of the route table
 * in `.agents/knowledge/architecture.md`; a detail path sits under its list's path, so the route guard
 * gives it the list's permission. A split area's own url (`/admin/library`) has no route: the AppShell
 * sends it to its first sub-page (`legacyRedirect`). Add one with the `/new-page` skill.
 */
const MyKpiPage = lazy(() => import('@/pages/MyKpiPage'));
const MyTasksPage = lazy(() => import('@/pages/MyTasksPage'));
const MyResultsPage = lazy(() => import('@/pages/MyResultsPage'));
const MyWorkPage = lazy(() => import('@/pages/MyWorkPage'));
const TeamWorkPage = lazy(() => import('@/pages/TeamWorkPages'));
const TeamWorkPlanPage = lazy(() => import('@/pages/TeamWorkPages').then((m) => ({ default: m.TeamWorkPlanPage })));
const TeamKpiPage = lazy(() => import('@/pages/TeamKpiPage'));
const TeamReviewsPage = lazy(() => import('@/pages/TeamReviewsPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const CyclesPage = lazy(() => import('@/pages/CyclesPage'));
const CycleDetailPage = lazy(() => import('@/pages/CycleDetailPage'));
const PlanPage = lazy(() => import('@/pages/GoalPlanPages').then((m) => ({ default: m.PlanPage })));
const GoalPage = lazy(() => import('@/pages/GoalPlanPages').then((m) => ({ default: m.GoalPage })));
const KpiLibraryPage = lazy(() => import('@/pages/KpiLibraryPage'));
const KpiTemplatesPage = lazy(() => import('@/pages/KpiTemplatesPage'));
const TemplateDetailPage = lazy(() => import('@/pages/TemplateDetailPage'));
const FormLaunchesPage = lazy(() => import('@/pages/FormLaunchesPage'));
const NewLaunchPage = lazy(() => import('@/pages/LaunchDetailPages').then((m) => ({ default: m.NewLaunchPage })));
const WorkflowDetailPage = lazy(() => import('@/pages/LaunchDetailPages').then((m) => ({ default: m.WorkflowDetailPage })));
const ActualsImportPage = lazy(() => import('@/pages/ActualsImportPage'));
const ImportBatchPage = lazy(() => import('@/pages/ActualsDetailPages').then((m) => ({ default: m.ImportBatchPage })));
const SyncConnectionPage = lazy(() => import('@/pages/ActualsDetailPages').then((m) => ({ default: m.SyncConnectionPage })));
const ResultsPayrollPage = lazy(() => import('@/pages/ResultsPayrollPage'));
const OrgUnitsPage = lazy(() => import('@/pages/OrgUnitsPage'));
const OrgUnitDetailPage = lazy(() => import('@/pages/OrgUnitDetailPage'));
const UsersRolesPage = lazy(() => import('@/pages/UsersRolesPage'));
const DataSourcesPage = lazy(() => import('@/pages/DataSourcesPage'));
const ConnectionDetailPage = lazy(() => import('@/pages/DataSourcesPage').then((m) => ({ default: m.ConnectionDetailPage })));
const NotificationTemplatesPage = lazy(() => import('@/pages/NotificationTemplatesPage'));
const AuditLogPage = lazy(() => import('@/pages/AuditLogPage'));
const FormDetailPage = lazy(() => import('@/pages/FormDetailPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

export const appRoutes = createRoutesFromElements(
  <Route element={<AppRoot />}>
    <Route element={<AppShell />}>
      <Route path="/" element={<Navigate to={HOME_URL} replace />} />

      {/* Của tôi — every role */}
      <Route path="/my/kpi" element={<MyKpiPage />} />
      <Route path="/my/kpi/plans/:planId" element={<PlanPage kind="my" />} />
      <Route path="/my/kpi/plans/:planId/goals/:goalId" element={<GoalPage kind="my" />} />
      <Route path="/my/tasks/inbox" element={<MyTasksPage section="inbox" />} />
      <Route path="/my/tasks/forms" element={<MyTasksPage section="forms" />} />
      <Route path="/my/tasks/delegations" element={<MyTasksPage section="delegations" />} />
      <Route path="/my/work" element={<MyWorkPage />} />
      <Route path="/my/results" element={<MyResultsPage />} />

      {/* Đội nhóm — managers */}
      <Route path="/team/kpi/members" element={<TeamKpiPage section="members" />} />
      <Route path="/team/kpi/members/:planId" element={<PlanPage kind="members" />} />
      <Route path="/team/kpi/members/:planId/goals/:goalId" element={<GoalPage kind="members" />} />
      <Route path="/team/kpi/unit" element={<TeamKpiPage section="unit" />} />
      <Route path="/team/kpi/unit/:planId" element={<PlanPage kind="unit" />} />
      <Route path="/team/kpi/unit/:planId/goals/:goalId" element={<GoalPage kind="unit" />} />
      <Route path="/team/reviews" element={<TeamReviewsPage />} />
      <Route path="/team/work" element={<TeamWorkPage />} />
      <Route path="/team/work/:workPlanId" element={<TeamWorkPlanPage />} />

      {/* Điều hành — BOD, managers, HR */}
      <Route path="/dashboard/overview" element={<DashboardPage section="overview" />} />
      <Route path="/dashboard/operations" element={<DashboardPage section="operations" />} />

      {/* Quản trị KPI — HR, C&B */}
      <Route path="/admin/cycles/list" element={<CyclesPage section="list" />} />
      <Route path="/admin/cycles/list/:cycleId" element={<CycleDetailPage />} />
      <Route path="/admin/cycles/periods" element={<CyclesPage section="periods" />} />
      <Route path="/admin/cycles/plans" element={<CyclesPage section="plans" />} />
      <Route path="/admin/cycles/plans/:cycleId/:planId" element={<PlanPage kind="cycles" />} />
      <Route path="/admin/cycles/plans/:cycleId/:planId/goals/:goalId" element={<GoalPage kind="cycles" />} />
      <Route path="/admin/library/definitions" element={<KpiLibraryPage section="definitions" />} />
      <Route path="/admin/library/perspectives" element={<KpiLibraryPage section="perspectives" />} />
      <Route path="/admin/library/units" element={<KpiLibraryPage section="units" />} />
      <Route path="/admin/library/calc-methods" element={<KpiLibraryPage section="calc-methods" />} />
      <Route path="/admin/templates" element={<KpiTemplatesPage />} />
      <Route path="/admin/templates/:templateId" element={<TemplateDetailPage />} />
      <Route path="/admin/launches/runs" element={<FormLaunchesPage section="runs" />} />
      <Route path="/admin/launches/runs/new" element={<NewLaunchPage />} />
      <Route path="/admin/launches/rules" element={<FormLaunchesPage section="rules" />} />
      <Route path="/admin/launches/forms" element={<FormLaunchesPage section="forms" />} />
      <Route path="/admin/launches/workflows" element={<FormLaunchesPage section="workflows" />} />
      <Route path="/admin/launches/workflows/:workflowId" element={<WorkflowDetailPage />} />
      <Route path="/admin/actuals/entry" element={<ActualsImportPage section="entry" />} />
      <Route path="/admin/actuals/import" element={<ActualsImportPage section="import" />} />
      <Route path="/admin/actuals/import/:batchId" element={<ImportBatchPage />} />
      <Route path="/admin/actuals/sync" element={<ActualsImportPage section="sync" />} />
      <Route path="/admin/actuals/sync/:connectionId" element={<SyncConnectionPage />} />
      <Route path="/admin/results/period" element={<ResultsPayrollPage section="period" />} />
      <Route path="/admin/results/rating" element={<ResultsPayrollPage section="rating" />} />
      <Route path="/admin/results/payroll" element={<ResultsPayrollPage section="payroll" />} />

      {/* Hệ thống — admin */}
      <Route path="/system/org/structure" element={<OrgUnitsPage section="structure" />} />
      <Route path="/system/org/structure/:unitId" element={<OrgUnitDetailPage />} />
      <Route path="/system/org/employees" element={<OrgUnitsPage section="employees" />} />
      <Route path="/system/org/positions" element={<OrgUnitsPage section="positions" />} />
      <Route path="/system/org/company" element={<OrgUnitsPage section="company" />} />
      <Route path="/system/users/accounts" element={<UsersRolesPage section="accounts" />} />
      <Route path="/system/users/roles" element={<UsersRolesPage section="roles" />} />
      <Route path="/system/data-sources/catalogue" element={<DataSourcesPage section="catalogue" />} />
      <Route path="/system/data-sources/connections" element={<DataSourcesPage section="connections" />} />
      <Route path="/system/data-sources/connections/:connectionId" element={<ConnectionDetailPage />} />
      <Route path="/system/notification-templates" element={<NotificationTemplatesPage />} />
      <Route path="/system/audit-log" element={<AuditLogPage />} />

      {/* One form, from any list — not a menu item; the page checks the record (T5) */}
      <Route path="/forms/:formId" element={<FormDetailPage />} />

      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Route>,
);
