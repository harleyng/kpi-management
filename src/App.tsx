import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { HOME_URL } from '@/components/layout/navConfig';

/**
 * Route-level code splitting: each page is its own async chunk, loaded on demand. `<Suspense>`
 * lives inside `AppShell` (around `<Outlet/>`) so the app frame stays mounted while a chunk loads.
 *
 * Every route mirrors an item in `navConfig.ts` (plan §7.1) and a row of the route table in
 * `.agents/knowledge/architecture.md`. Add one with the `/new-page` skill.
 */
const MyKpiPage = lazy(() => import('@/pages/MyKpiPage'));
const MyTasksPage = lazy(() => import('@/pages/MyTasksPage'));
const MyResultsPage = lazy(() => import('@/pages/MyResultsPage'));
const TeamKpiPage = lazy(() => import('@/pages/TeamKpiPage'));
const TeamReviewsPage = lazy(() => import('@/pages/TeamReviewsPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const CyclesPage = lazy(() => import('@/pages/CyclesPage'));
const KpiLibraryPage = lazy(() => import('@/pages/KpiLibraryPage'));
const KpiTemplatesPage = lazy(() => import('@/pages/KpiTemplatesPage'));
const FormLaunchesPage = lazy(() => import('@/pages/FormLaunchesPage'));
const ActualsImportPage = lazy(() => import('@/pages/ActualsImportPage'));
const ResultsPayrollPage = lazy(() => import('@/pages/ResultsPayrollPage'));
const OrgUnitsPage = lazy(() => import('@/pages/OrgUnitsPage'));
const UsersRolesPage = lazy(() => import('@/pages/UsersRolesPage'));
const DataSourcesPage = lazy(() => import('@/pages/DataSourcesPage'));
const NotificationTemplatesPage = lazy(() => import('@/pages/NotificationTemplatesPage'));
const AuditLogPage = lazy(() => import('@/pages/AuditLogPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

const App = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/" element={<Navigate to={HOME_URL} replace />} />

      {/* Của tôi — every role */}
      <Route path="/my/kpi" element={<MyKpiPage />} />
      <Route path="/my/tasks" element={<MyTasksPage />} />
      <Route path="/my/results" element={<MyResultsPage />} />

      {/* Đội nhóm — managers */}
      <Route path="/team/kpi" element={<TeamKpiPage />} />
      <Route path="/team/reviews" element={<TeamReviewsPage />} />

      {/* Điều hành — BOD, managers, HR */}
      <Route path="/dashboard" element={<DashboardPage />} />

      {/* Quản trị KPI — HR, C&B */}
      <Route path="/admin/cycles" element={<CyclesPage />} />
      <Route path="/admin/library" element={<KpiLibraryPage />} />
      <Route path="/admin/templates" element={<KpiTemplatesPage />} />
      <Route path="/admin/launches" element={<FormLaunchesPage />} />
      <Route path="/admin/actuals" element={<ActualsImportPage />} />
      <Route path="/admin/results" element={<ResultsPayrollPage />} />

      {/* Hệ thống — admin */}
      <Route path="/system/org" element={<OrgUnitsPage />} />
      <Route path="/system/users" element={<UsersRolesPage />} />
      <Route path="/system/data-sources" element={<DataSourcesPage />} />
      <Route path="/system/notification-templates" element={<NotificationTemplatesPage />} />
      <Route path="/system/audit-log" element={<AuditLogPage />} />

      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Routes>
);

export default App;
