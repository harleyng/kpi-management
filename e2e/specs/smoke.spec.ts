import { expect, test } from '@playwright/test';

/**
 * @smoke — every menu item opens its page, with no console error, and the simulated-data banner is
 * on screen. Keep ROUTES in step with `navConfig.ts` and the route table in architecture.md.
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

test.describe('@smoke app shell', () => {
  test('the root redirects to KPI của tôi', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/my\/kpi$/);
    await expect(page.getByRole('heading', { level: 1, name: 'KPI của tôi' })).toBeVisible();
  });

  test('the simulated-data banner is visible', async ({ page }) => {
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

      await page.goto('/my/kpi');
      await page
        .getByRole('navigation', { name: 'Điều hướng chính' })
        .getByRole('link', { name: title, exact: true })
        .click();

      await expect(page).toHaveURL(new RegExp(`${path.replace(/\//g, '\\/')}$`));
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      await expect(page.getByText('Chưa xây dựng', { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test('an unknown address shows the not-found page', async ({ page }) => {
    await page.goto('/khong-ton-tai');
    await expect(page.getByRole('heading', { level: 1, name: 'Không tìm thấy trang' })).toBeVisible();
  });
});
