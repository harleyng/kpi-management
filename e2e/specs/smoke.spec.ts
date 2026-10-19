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
 * A route a track has BUILT names the landmark its page must show instead of the placeholder:
 * `[role, accessible name]`.
 */
type Landmark = [role: 'table' | 'list', name: string];
const ROUTES: [path: string, title: string, built?: Landmark][] = [
  ['/my/kpi', 'KPI của tôi'],
  ['/my/tasks', 'Việc cần xử lý'],
  ['/my/results', 'Kết quả của tôi'],
  ['/team/kpi', 'KPI đội nhóm'],
  ['/team/reviews', 'Duyệt & đánh giá'],
  ['/dashboard', 'Dashboard'],
  ['/admin/cycles', 'Chu kỳ'],
  ['/admin/library', 'Thư viện KPI', ['table', 'Danh sách chỉ tiêu mẫu']],
  ['/admin/templates', 'Bộ mẫu', ['list', 'Danh sách bộ mẫu']],
  ['/admin/launches', 'Khởi chạy phiếu'],
  ['/admin/actuals', 'Số liệu & import'],
  ['/admin/results', 'Kết quả & lương'],
  ['/system/org', 'Tổ chức'],
  ['/system/users', 'Người dùng & quyền'],
  ['/system/data-sources', 'Nguồn dữ liệu'],
  ['/system/notification-templates', 'Mẫu thông báo', ['table', 'Mẫu thông báo theo sự kiện']],
  ['/system/audit-log', 'Nhật ký', ['table', 'Nhật ký thay đổi']],
];

/** Routes whose page is built (no "Chưa xây dựng" placeholder any more) — add a track's routes as it lands. */
const BUILT: ReadonlySet<string> = new Set([
  '/system/org', '/system/users', // T1
  '/my/kpi', '/team/kpi', '/admin/cycles', // T3
  '/admin/actuals', '/system/data-sources', // T4
  '/my/tasks', '/team/reviews', '/admin/launches', // T5
  '/my/results', '/admin/results', // T6
  '/dashboard', // Phase 3
]);

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

  for (const [path, title, built] of ROUTES) {
    test(`${path} opens "${title}" from the menu without console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(err.message));

      await requireSession(page);
      await becomeAdmin(page);
      await page
        .getByRole('navigation', { name: 'Điều hướng chính' })
        .getByRole('link', { name: title, exact: true })
        .click();

      // A built screen may keep its selection in the query string (`?cycle=&period=`).
      await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}(\\?.*)?$`));
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      if (built) {
        await expect(page.getByRole(built[0], { name: built[1] })).toBeVisible();
      } else if (BUILT.has(path)) {
        // A built page settles into content or its own empty state — never the placeholder.
        await expect(page.getByText('Chưa xây dựng', { exact: true })).toHaveCount(0);
        await page.waitForLoadState('networkidle');
      } else {
        await expect(page.getByText('Chưa xây dựng', { exact: true })).toBeVisible();
      }
      expect(errors).toEqual([]);
    });
  }

  test('T1: a role\'s permission change is confirmed with exactly what it adds', async ({ page }) => {
    await requireSession(page);
    await becomeAdmin(page);
    await page.goto('/system/users?tab=vai-tro');
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
    await page.goto('/admin/launches?tab=forms');
    await page.getByRole('button', { name: /^Mở phiếu Đánh giá KPI của/ }).first().click();
    await expect(page).toHaveURL(/\/forms\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: /^Đánh giá KPI — / })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Các bước của phiếu' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('an unknown address shows the not-found page', async ({ page }) => {
    await requireSession(page);
    await page.goto('/khong-ton-tai');
    await expect(page.getByRole('heading', { level: 1, name: 'Không tìm thấy trang' })).toBeVisible();
  });
});
