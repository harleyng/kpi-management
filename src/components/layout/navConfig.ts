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
 * Left-hand navigation — **5 groups, 17 items**, exactly plan §7.1 ("Menu theo vai trò").
 *
 * Each ITEM names the permission it needs (`null` = any signed-in user); a group shows when any of
 * its items does. The filter is `visibleNavGroups`, and the AppShell route guard is `canOpenPath`,
 * both in `src/lib/permissionRules.ts` — never a role check in the sidebar. Under the default
 * matrix this reproduces plan §7.1 for every role except ADMIN, who sees all five groups
 * (`navConfig.test.ts` pins both).
 *
 * An item's `title` is the same string its page passes to `<PageHeader title>`: two different
 * words for one screen is how a menu and the page it opens start disagreeing. Add a page with the
 * `/new-page` skill, which keeps the two, the route in `App.tsx` and the route table in
 * `architecture.md` in step.
 *
 * Kept out of `AppSidebar.tsx` so the component file exports only a component (clean hot reload).
 */

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  /** The permission that shows the item AND opens its route. `null` = every signed-in user. */
  permission: PermissionCode | null;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Của tôi',
    items: [
      { title: 'KPI của tôi', url: '/my/kpi', icon: Target, permission: null },
      { title: 'Việc cần xử lý', url: '/my/tasks', icon: Inbox, permission: null },
      { title: 'Kết quả của tôi', url: '/my/results', icon: Trophy, permission: null },
    ],
  },
  {
    label: 'Đội nhóm',
    items: [
      { title: 'KPI đội nhóm', url: '/team/kpi', icon: Network, permission: 'team.view' },
      { title: 'Duyệt & đánh giá', url: '/team/reviews', icon: ClipboardCheck, permission: 'team.view' },
    ],
  },
  {
    label: 'Điều hành',
    items: [{ title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' }],
  },
  {
    label: 'Quản trị KPI',
    items: [
      { title: 'Chu kỳ', url: '/admin/cycles', icon: CalendarRange, permission: 'cycle.manage' },
      { title: 'Thư viện KPI', url: '/admin/library', icon: BookOpen, permission: 'library.manage' },
      { title: 'Bộ mẫu', url: '/admin/templates', icon: LayoutTemplate, permission: 'library.manage' },
      { title: 'Khởi chạy phiếu', url: '/admin/launches', icon: Rocket, permission: 'form.launch' },
      { title: 'Số liệu & import', url: '/admin/actuals', icon: FileSpreadsheet, permission: 'actual.import' },
      { title: 'Kết quả & lương', url: '/admin/results', icon: Wallet, permission: 'result.finalize' },
    ],
  },
  {
    label: 'Hệ thống',
    items: [
      { title: 'Tổ chức', url: '/system/org', icon: Users, permission: 'org.manage' },
      { title: 'Người dùng & quyền', url: '/system/users', icon: ShieldCheck, permission: 'user.manage' },
      { title: 'Nguồn dữ liệu', url: '/system/data-sources', icon: Database, permission: 'datasource.manage' },
      { title: 'Mẫu thông báo', url: '/system/notification-templates', icon: BellRing, permission: 'notification.manage' },
      { title: 'Nhật ký', url: '/system/audit-log', icon: History, permission: 'audit.view' },
    ],
  },
];

/** The landing route — every signed-in user has "Của tôi". */
export const HOME_URL = '/my/kpi';

/**
 * Routes of `App.tsx` that no menu item claims and every signed-in user may open: the root redirect
 * and the not-found page. Anything else must be a nav item — `navConfig.test.ts` fails otherwise, so a
 * new page can never be open to everyone by accident.
 */
export const PUBLIC_PATHS: readonly string[] = ['/', '*'];

/** Re-exported so the sidebar mark and the favicon agree on the product's glyph family. */
export const PRODUCT_ICON = Activity;
