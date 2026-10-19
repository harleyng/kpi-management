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
import type { RoleCode } from '@/data/types';

/**
 * Left-hand navigation — **5 groups, 17 items**, exactly plan §7.1 ("Menu theo vai trò").
 *
 * Each group names the roles that see it. Phase 0 shows every group (the placeholder session holds
 * every role); the filtering itself is a permission rule and lands in Phase 1.3
 * (`visibleNavGroups` in `src/lib/permissionRules.ts`) — never a role check in the sidebar.
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
}

export interface NavGroup {
  label: string;
  /** Roles that see this group (plan §7.1). `'ALL'` = every signed-in user. */
  roles: readonly RoleCode[] | 'ALL';
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Của tôi',
    roles: 'ALL',
    items: [
      { title: 'KPI của tôi', url: '/my/kpi', icon: Target },
      { title: 'Việc cần xử lý', url: '/my/tasks', icon: Inbox },
      { title: 'Kết quả của tôi', url: '/my/results', icon: Trophy },
    ],
  },
  {
    label: 'Đội nhóm',
    roles: ['MANAGER'],
    items: [
      { title: 'KPI đội nhóm', url: '/team/kpi', icon: Network },
      { title: 'Duyệt & đánh giá', url: '/team/reviews', icon: ClipboardCheck },
    ],
  },
  {
    label: 'Điều hành',
    roles: ['BOD', 'MANAGER', 'HR'],
    items: [{ title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Quản trị KPI',
    roles: ['HR', 'CNB'],
    items: [
      { title: 'Chu kỳ', url: '/admin/cycles', icon: CalendarRange },
      { title: 'Thư viện KPI', url: '/admin/library', icon: BookOpen },
      { title: 'Bộ mẫu', url: '/admin/templates', icon: LayoutTemplate },
      { title: 'Khởi chạy phiếu', url: '/admin/launches', icon: Rocket },
      { title: 'Số liệu & import', url: '/admin/actuals', icon: FileSpreadsheet },
      { title: 'Kết quả & lương', url: '/admin/results', icon: Wallet },
    ],
  },
  {
    label: 'Hệ thống',
    roles: ['ADMIN'],
    items: [
      { title: 'Tổ chức', url: '/system/org', icon: Users },
      { title: 'Người dùng & quyền', url: '/system/users', icon: ShieldCheck },
      { title: 'Nguồn dữ liệu', url: '/system/data-sources', icon: Database },
      { title: 'Mẫu thông báo', url: '/system/notification-templates', icon: BellRing },
      { title: 'Nhật ký', url: '/system/audit-log', icon: History },
    ],
  },
];

/** The landing route — every role has "Của tôi". */
export const HOME_URL = '/my/kpi';

/** Re-exported so the sidebar mark and the favicon agree on the product's glyph family. */
export const PRODUCT_ICON = Activity;
