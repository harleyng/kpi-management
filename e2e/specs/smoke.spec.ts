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
const ROUTES: [path: string, title: string][] = [
  ['/my/kpi', 'KPI của tôi'],
  ['/my/tasks', 'Việc cần xử lý'],
  ['/my/results', 'Kết quả của tôi'],
  ['/team/kpi', 'KPI đội nhóm'],
  ['/team/reviews', 'Duyệt & đánh giá'],
  ['/dashboard', 'Dashboard'],
  ['/admin/cycles', 'Chu kỳ'],
  ['/admin/library', 'Thư viện KPI'],
  ['/admin/templates', 'Bộ mẫu'],
  ['/admin/launches', 'Khởi chạy phiếu'],
  ['/admin/actuals', 'Số liệu & import'],
  ['/admin/results', 'Kết quả & lương'],
  ['/system/org', 'Tổ chức'],
  ['/system/users', 'Người dùng & quyền'],
  ['/system/data-sources', 'Nguồn dữ liệu'],
  ['/system/notification-templates', 'Mẫu thông báo'],
  ['/system/audit-log', 'Nhật ký'],
];

/**
 * Routes whose page a Phase 2 track has built — they no longer show the "Chưa xây dựng" placeholder.
 * A track adds its routes here when it replaces the placeholder.
 */
const BUILT: ReadonlySet<string> = new Set([
  // T5 — Phê duyệt & đánh giá
  '/my/tasks',
  '/team/reviews',
  '/admin/launches',
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

  for (const [path, title] of ROUTES) {
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

      await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}$`));
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      if (!BUILT.has(path)) await expect(page.getByText('Chưa xây dựng', { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

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
