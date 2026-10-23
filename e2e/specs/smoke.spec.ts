import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * @smoke — every menu item opens its page, with no console error, and the simulated-data banner is
 * on screen. Keep ROUTES in step with `navConfig.ts` and the route table in architecture.md.
 *
 * Since Phase 1.3 the menu follows the session's permissions, so the walk first switches to an ADMIN
 * persona (who holds every permission). Until the Phase 1.2 seed exists the session cannot load: the
 * tests that need a session skip themselves; once `src/data/fixtures/index.ts` exists they run, and a
 * session that fails to load FAILS them. The banner test runs either way — no state may hide it.
 */
/**
 * A route a track has BUILT may name a landmark its page must show: `[role, accessible name]`.
 * Every route is built now — none may show the "Chưa xây dựng" placeholder.
 */
type Landmark = [role: 'table' | 'list', name: string];
/** `area` = the menu parent to unfold before the sub-item is visible. */
const ROUTES: [path: string, title: string, area: string | null, built?: Landmark][] = [
  ['/my/kpi', 'KPI của tôi', null],
  ['/my/tasks/inbox', 'Chờ tôi xử lý', 'Việc cần xử lý'],
  ['/my/tasks/forms', 'Phiếu của tôi', 'Việc cần xử lý'],
  ['/my/tasks/delegations', 'Ủy quyền', 'Việc cần xử lý'],
  ['/my/work', 'Công việc tháng', null],
  ['/my/results', 'Kết quả của tôi', null],
  ['/team/kpi/members', 'KPI nhân viên', 'KPI đội nhóm'],
  ['/team/kpi/unit', 'KPI bộ phận', 'KPI đội nhóm'],
  ['/team/reviews', 'Duyệt & đánh giá', null],
  ['/team/work', 'Công việc tháng của đội', null],
  ['/dashboard/overview', 'Tổng quan', 'Dashboard'],
  ['/dashboard/operations', 'Vận hành', 'Dashboard'],
  ['/admin/cycles/list', 'Kỳ đánh giá', 'Chu kỳ'],
  ['/admin/cycles/periods', 'Đợt đánh giá', 'Chu kỳ'],
  ['/admin/cycles/plans', 'Goal Plan', 'Chu kỳ'],
  ['/admin/library/definitions', 'Chỉ tiêu mẫu', 'Thư viện KPI', ['table', 'Danh sách chỉ tiêu mẫu']],
  ['/admin/library/perspectives', 'Viễn cảnh BSC', 'Thư viện KPI'],
  ['/admin/library/units', 'Đơn vị đo', 'Thư viện KPI'],
  ['/admin/library/calc-methods', 'Phương pháp tính', 'Thư viện KPI'],
  ['/admin/templates', 'Bộ mẫu', null, ['table', 'Danh sách bộ mẫu']],
  ['/admin/launches/runs', 'Đợt khởi chạy', 'Khởi chạy phiếu'],
  ['/admin/launches/rules', 'Lịch tự động', 'Khởi chạy phiếu'],
  ['/admin/launches/forms', 'Phiếu đã tạo', 'Khởi chạy phiếu'],
  ['/admin/launches/workflows', 'Quy trình duyệt', 'Khởi chạy phiếu'],
  ['/admin/actuals/entry', 'Nhập tay', 'Số liệu & import'],
  ['/admin/actuals/import', 'Nhập từ Excel', 'Số liệu & import'],
  ['/admin/actuals/sync', 'Đồng bộ API', 'Số liệu & import'],
  ['/admin/results/period', 'Kết quả theo kỳ', 'Kết quả & lương'],
  ['/admin/results/rating', 'Xếp loại & quy đổi', 'Kết quả & lương'],
  ['/admin/results/payroll', 'Xuất file lương', 'Kết quả & lương'],
  ['/system/org/structure', 'Cơ cấu', 'Tổ chức'],
  ['/system/org/employees', 'Nhân sự', 'Tổ chức'],
  ['/system/org/positions', 'Chức danh', 'Tổ chức'],
  ['/system/org/company', 'Công ty', 'Tổ chức'],
  ['/system/users/accounts', 'Tài khoản', 'Người dùng & quyền'],
  ['/system/users/roles', 'Vai trò & quyền', 'Người dùng & quyền'],
  ['/system/data-sources/catalogue', 'Danh mục nguồn', 'Nguồn dữ liệu'],
  ['/system/data-sources/connections', 'Kết nối API', 'Nguồn dữ liệu'],
  ['/system/notification-templates', 'Mẫu thông báo', null, ['table', 'Mẫu thông báo theo sự kiện']],
  ['/system/audit-log', 'Nhật ký', null, ['table', 'Nhật ký thay đổi']],
];

/**
 * Once the Phase 1.2 seed exists (its entry file is in the repo), a session MUST load: a broken gateway
 * then fails these tests instead of skipping them. Before that, the tests that need a session skip.
 */
const SEED_EXPECTED = existsSync(fileURLToPath(new URL('../../src/data/fixtures/index.ts', import.meta.url)));

/** Opens the app and requires a session — or, before the seed exists, skips the calling test. */
async function requireSession(page: Page) {
  await page.goto('/my/kpi');
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  if (SEED_EXPECTED) {
    await expect(nav).toBeVisible();
    return;
  }
  const failed = page.getByText('Không tải được dữ liệu', { exact: true });
  await expect(nav.or(failed)).toBeVisible();
  test.skip(!(await nav.isVisible()), 'needs the Phase 1.2 seed (src/data/fixtures/index.ts)');
}

/** Switch to the first person filed under "Quản trị hệ thống" in the top-bar picker. */
async function becomeAdmin(page: Page) {
  await page.getByRole('combobox', { name: /^Chọn người dùng/ }).click();
  await page.getByPlaceholder('Tìm theo tên, đơn vị hoặc vai trò').fill('Quản trị hệ thống');
  await page.getByRole('option').first().click();
  await expect(page.getByRole('combobox', { name: /vai trò .*Quản trị hệ thống/ })).toBeVisible();
}

test.describe('@smoke app shell', () => {
  test('the root redirects to KPI của tôi', async ({ page }) => {
    await requireSession(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/my\/kpi$/);
    await expect(page.getByRole('heading', { level: 1, name: 'KPI của tôi' })).toBeVisible();
  });

  test('the simulated-data banner is visible, with or without a session', async ({ page }) => {
    await page.goto('/my/kpi');
    await expect(page.getByRole('status').filter({ hasText: 'Dữ liệu giả lập' })).toBeVisible();
  });

  for (const [path, title, area, built] of ROUTES) {
    test(`${path} opens "${title}" from the menu without console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(err.message));

      await requireSession(page);
      await becomeAdmin(page);
      const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
      if (area) {
        const toggle = nav.getByRole('button', { name: area, exact: true });
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      }
      // A menu item kept for a later phase carries a "Phase sau" tag after its title.
      await nav.getByRole('link', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( Phase sau)?$`) }).click();

      // A built screen may keep its selection in the query string (`?cycle=&period=`).
      await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}(\\?.*)?$`));
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      if (built) await expect(page.getByRole(built[0], { name: built[1] })).toBeVisible();
      // A built page settles into content or its own empty state — never the placeholder.
      await expect(page.getByText('Chưa xây dựng', { exact: true })).toHaveCount(0);
      await page.waitForLoadState('networkidle');
      expect(errors).toEqual([]);
    });
  }

  test('T1: a role\'s permission change is confirmed with exactly what it adds', async ({ page }) => {
    await requireSession(page);
    await becomeAdmin(page);
    await page.goto('/system/users/roles');
    await page.getByRole('button', { name: 'Sửa quyền — Ban điều hành' }).click();
    await page.getByRole('checkbox', { name: 'Xem nhật ký hệ thống' }).click();
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Lưu thay đổi quyền của vai trò Ban điều hành?' });
    await expect(dialog.getByText('Thêm:')).toBeVisible();
    await expect(dialog.getByText('Xem nhật ký hệ thống')).toBeVisible();
    await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page.getByText('Đã lưu quyền của vai trò.')).toBeVisible();
  });

  test('a form opens from HR\'s list of forms (/forms/:formId, T5)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await requireSession(page);
    await becomeAdmin(page);
    await page.goto('/admin/launches/forms');
    await page.getByRole('button', { name: /^Mở phiếu Đánh giá KPI của/ }).first().click();
    await expect(page).toHaveURL(/\/forms\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: /^Đánh giá KPI — / })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Các bước của phiếu' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('an old link to a tab lands on the sub-page it became', async ({ page }) => {
    await requireSession(page);
    await becomeAdmin(page);
    await page.goto('/admin/library?tab=phuong-phap');
    await expect(page).toHaveURL(/\/admin\/library\/calc-methods$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Phương pháp tính', exact: true })).toBeVisible();
  });

  test('an unknown address shows the not-found page', async ({ page }) => {
    await requireSession(page);
    await page.goto('/khong-ton-tai');
    await expect(page.getByRole('heading', { level: 1, name: 'Không tìm thấy trang' })).toBeVisible();
  });
});
