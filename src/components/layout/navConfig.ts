import {
  Activity,
  BellRing,
  BookOpen,
  CalendarRange,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  History,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  Network,
  Rocket,
  ShieldCheck,
  Target,
  Trophy,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionCode } from '@/lib/permissionRules';

/**
 * Left-hand navigation — the **5 groups of plan §7.1** ("Menu theo vai trò"). Inside a group an item
 * is either a destination (`NavLeaf`) or a parent (`NavParent`) whose sub-items are the sub-pages
 * of one area — every screen that used to be a tab is its own sub-page with its own route
 * (product owner, 2026-10-19).
 *
 * Each DESTINATION names the permission it needs (`null` = any signed-in user); a parent has none of
 * its own and shows when any child does; a group shows when any item does. The filter is
 * `visibleNavGroups`, and the AppShell route guard is `canOpenPath`, both in
 * `src/lib/permissionRules.ts` — never a role check in the sidebar. A sub-item inherits its parent
 * area's permission, so the default matrix still reproduces plan §7.1 for every role except ADMIN, who
 * sees all five groups (`navConfig.test.ts` pins both). The one narrower child is "Quy trình duyệt"
 * (`cycle.manage`), which was a tab only cycle managers saw.
 *
 * Destination urls never nest inside another destination's url: a detail route
 * (`/admin/cycles/:cycleId`) is claimed by — and needs the permission of — the one destination it sits
 * under. A parent's own url is not a page: `legacyRedirect` (navRules.ts) sends it to its first
 * sub-page.
 *
 * An item's `title` is the same string its page passes to `<PageHeader title>`: two different
 * words for one screen is how a menu and the page it opens start disagreeing. Add a page with the
 * `/new-page` skill, which keeps the two, the route in `App.tsx` and the route table in
 * `architecture.md` in step.
 *
 * Kept out of `AppSidebar.tsx` so the component file exports only a component (clean hot reload).
 */

/** A sub-page of a parent — no icon: the parent's icon carries the meaning. */
export interface NavChild {
  title: string;
  url: string;
  /** The permission that shows the item AND opens its route (and every detail route under it). */
  permission: PermissionCode | null;
  children?: undefined;
}

export interface NavLeaf extends NavChild {
  icon: LucideIcon;
}

export interface NavParent {
  title: string;
  /** The url prefix every child shares; opening it lands on the first child. */
  url: string;
  icon: LucideIcon;
  children: NavChild[];
  /** Query params that follow a link between sibling sub-pages (`navRules.carrySearch`). */
  carryParams?: readonly string[];
  permission?: undefined;
}

export type NavItem = NavLeaf | NavParent;

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const isNavParent = (item: NavItem): item is NavParent => item.children !== undefined;

const RESULT_PERIOD = ['cycle', 'period'] as const;

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Của tôi',
    items: [
      { title: 'KPI của tôi', url: '/my/kpi', icon: Target, permission: null },
      {
        title: 'Việc cần xử lý',
        url: '/my/tasks',
        icon: Inbox,
        children: [
          { title: 'Chờ tôi xử lý', url: '/my/tasks/inbox', permission: null },
          { title: 'Phiếu của tôi', url: '/my/tasks/forms', permission: null },
          { title: 'Ủy quyền', url: '/my/tasks/delegations', permission: null },
        ],
      },
      { title: 'Kết quả của tôi', url: '/my/results', icon: Trophy, permission: null },
    ],
  },
  {
    label: 'Đội nhóm',
    items: [
      {
        title: 'KPI đội nhóm',
        url: '/team/kpi',
        icon: Network,
        carryParams: ['cycle'],
        children: [
          { title: 'KPI nhân viên', url: '/team/kpi/members', permission: 'team.view' },
          { title: 'KPI bộ phận', url: '/team/kpi/unit', permission: 'team.view' },
        ],
      },
      { title: 'Duyệt & đánh giá', url: '/team/reviews', icon: ClipboardCheck, permission: 'team.view' },
    ],
  },
  {
    label: 'Điều hành',
    items: [
      {
        title: 'Dashboard',
        url: '/dashboard',
        icon: LayoutDashboard,
        carryParams: ['cycle', 'period', 'unit'],
        children: [
          { title: 'Tổng quan', url: '/dashboard/overview', permission: 'dashboard.view' },
          { title: 'Vận hành', url: '/dashboard/operations', permission: 'dashboard.view' },
        ],
      },
    ],
  },
  {
    label: 'Quản trị KPI',
    items: [
      { title: 'Chu kỳ', url: '/admin/cycles', icon: CalendarRange, permission: 'cycle.manage' },
      {
        title: 'Thư viện KPI',
        url: '/admin/library',
        icon: BookOpen,
        children: [
          { title: 'Chỉ tiêu mẫu', url: '/admin/library/definitions', permission: 'library.manage' },
          { title: 'Viễn cảnh BSC', url: '/admin/library/perspectives', permission: 'library.manage' },
          { title: 'Đơn vị đo', url: '/admin/library/units', permission: 'library.manage' },
          { title: 'Phương pháp tính', url: '/admin/library/calc-methods', permission: 'library.manage' },
        ],
      },
      { title: 'Bộ mẫu', url: '/admin/templates', icon: LayoutTemplate, permission: 'library.manage' },
      {
        title: 'Khởi chạy phiếu',
        url: '/admin/launches',
        icon: Rocket,
        children: [
          { title: 'Đợt khởi chạy', url: '/admin/launches/runs', permission: 'form.launch' },
          { title: 'Lịch tự động', url: '/admin/launches/rules', permission: 'form.launch' },
          { title: 'Phiếu đã tạo', url: '/admin/launches/forms', permission: 'form.launch' },
          { title: 'Quy trình duyệt', url: '/admin/launches/workflows', permission: 'cycle.manage' },
        ],
      },
      {
        title: 'Số liệu & import',
        url: '/admin/actuals',
        icon: FileSpreadsheet,
        carryParams: RESULT_PERIOD,
        children: [
          { title: 'Nhập tay', url: '/admin/actuals/entry', permission: 'actual.import' },
          { title: 'Nhập từ Excel', url: '/admin/actuals/import', permission: 'actual.import' },
          { title: 'Đồng bộ API', url: '/admin/actuals/sync', permission: 'actual.import' },
        ],
      },
      {
        title: 'Kết quả & lương',
        url: '/admin/results',
        icon: Wallet,
        carryParams: RESULT_PERIOD,
        children: [
          { title: 'Kết quả theo kỳ', url: '/admin/results/period', permission: 'result.finalize' },
          { title: 'Xếp loại & quy đổi', url: '/admin/results/rating', permission: 'result.finalize' },
          { title: 'Xuất file lương', url: '/admin/results/payroll', permission: 'result.finalize' },
        ],
      },
    ],
  },
  {
    label: 'Hệ thống',
    items: [
      {
        title: 'Tổ chức',
        url: '/system/org',
        icon: Users,
        children: [
          { title: 'Cơ cấu', url: '/system/org/structure', permission: 'org.manage' },
          { title: 'Nhân sự', url: '/system/org/employees', permission: 'org.manage' },
          { title: 'Chức danh', url: '/system/org/positions', permission: 'org.manage' },
          { title: 'Công ty', url: '/system/org/company', permission: 'org.manage' },
        ],
      },
      {
        title: 'Người dùng & quyền',
        url: '/system/users',
        icon: ShieldCheck,
        children: [
          { title: 'Tài khoản', url: '/system/users/accounts', permission: 'user.manage' },
          { title: 'Vai trò & quyền', url: '/system/users/roles', permission: 'user.manage' },
        ],
      },
      {
        title: 'Nguồn dữ liệu',
        url: '/system/data-sources',
        icon: Database,
        children: [
          { title: 'Danh mục nguồn', url: '/system/data-sources/catalogue', permission: 'datasource.manage' },
          { title: 'Kết nối API', url: '/system/data-sources/connections', permission: 'datasource.manage' },
        ],
      },
      { title: 'Mẫu thông báo', url: '/system/notification-templates', icon: BellRing, permission: 'notification.manage' },
      { title: 'Nhật ký', url: '/system/audit-log', icon: History, permission: 'audit.view' },
    ],
  },
];

/** Every destination of the menu — the childless items and every sub-item, in menu order. */
export const NAV_DESTINATIONS: readonly NavChild[] = NAV_GROUPS.flatMap((g) => g.items.flatMap((i): NavChild[] => (isNavParent(i) ? i.children : [i])));

/** The landing route — every signed-in user has "Của tôi". */
export const HOME_URL = '/my/kpi';

/**
 * Routes of `App.tsx` that no menu item claims and every signed-in user may open: the root redirect,
 * the not-found page, and a form (`/forms/:formId`, T5) — reached from the inbox, the team list, HR's
 * list and notifications, so no single menu item owns it; the page checks the record itself
 * (`useFormDetail.mayView`) and the gateway decides every action. Anything else must be a nav item —
 * `navConfig.test.ts` fails otherwise, so a new page can never be open to everyone by accident.
 */
export const PUBLIC_PATHS: readonly string[] = ['/', '*', '/forms/:formId'];

/** Re-exported so the sidebar mark and the favicon agree on the product's glyph family. */
export const PRODUCT_ICON = Activity;
