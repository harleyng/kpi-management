import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 3 — the live dashboard on the seed (WBS 4.7.1–4.7.4). The numbers asserted are the seed's
 * stored results (`src/data/fixtures/README.md`), the same ones `dashboard.seed.test.ts` pins.
 * `SHOT=<dir>` also saves screenshots there, for design reviews.
 */

const SHOT = process.env.SHOT;
const shot = async (page: Page, name: string) => {
  if (SHOT) await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true });
};

async function becomePersona(page: Page, search: string, role: RegExp) {
  await page.goto('/my/kpi');
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  await page.getByRole('combobox', { name: /^Chọn người dùng/ }).click();
  await page.getByPlaceholder('Tìm theo tên, đơn vị hoặc vai trò').fill(search);
  await page.getByRole('option').first().click();
  await expect(page.getByRole('combobox', { name: role })).toBeVisible();
}

test.describe('@smoke Dashboard (Phase 3)', () => {
  test('BOD opens on T02 at the company, drills to a department and opens a person', async ({ page }) => {
    await becomePersona(page, 'Ban điều hành', /vai trò .*Ban điều hành/);
    await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    // The company's own T02 result is a Draft: shown, labelled "Tạm tính", unrated.
    await expect(page.getByRole('navigation', { name: 'Đường dẫn' })).toContainText('Công ty Syntra');
    const summary = page.locator('dl').first();
    await expect(summary).toContainText('106,07');
    await expect(summary).toContainText('Tạm tính');
    await shot(page, '1-bod-company');

    // Company → Khối Kinh doanh (no plan of its own) → Kinh doanh.
    const units = page.getByRole('table', { name: 'Các đơn vị trực thuộc' });
    await units.getByRole('button', { name: 'Khối Kinh doanh' }).click();
    await expect(page.locator('dl').first()).toContainText('Chưa có kế hoạch riêng');
    await page.getByRole('table', { name: 'Các đơn vị trực thuộc' }).getByRole('button', { name: 'Phòng Kinh doanh', exact: true }).click();
    await expect(page.locator('dl').first()).toContainText('105,45');
    await shot(page, '2-bod-department');

    const people = page.getByRole('table', { name: /^Nhân viên của/ });
    await people.getByRole('row').nth(1).getByRole('button').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Chi tiết từng chỉ tiêu' })).toBeVisible();
    await shot(page, '3-bod-person');
    await page.keyboard.press('Escape');

    // Back returns to the Khối.
    await page.goBack();
    await expect(page.locator('dl').first()).toContainText('Chưa có kế hoạch riêng');
  });

  test('the assistant summarises what is on screen, labelled simulated', async ({ page }) => {
    await becomePersona(page, 'Ban điều hành', /vai trò .*Ban điều hành/);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Tóm tắt' }).click();
    const card = page.getByRole('region', { name: /Trợ lý KPI/ });
    await expect(card.getByText('Giả lập', { exact: true })).toBeVisible();
    await expect(page.getByText(/Công ty Syntra đạt 106,07 điểm kỳ T02/)).toBeVisible();
    await page.getByRole('button', { name: 'Có bao nhiêu phiếu quá hạn?' }).click();
    // The summary says it once; the answer says it again.
    await expect(page.getByText(/phiếu đang quá hạn trong phạm vi bạn xem/)).toHaveCount(2);
    await shot(page, '4-assistant');
  });

  test('the operations report counts T02 forms and lists the overdue ones', async ({ page }) => {
    await becomePersona(page, 'Ban điều hành', /vai trò .*Ban điều hành/);
    await page.goto('/dashboard?tab=van-hanh');
    await expect(page.getByText('Hoàn thành 22/27 phiếu', { exact: false })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Phiếu quá hạn' }).getByRole('row').nth(1)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xuất báo cáo vận hành (Excel)' })).toBeEnabled();
    await shot(page, '5-operations');
  });

  test('a manager sees their own department as the root — no company above it', async ({ page }) => {
    await becomePersona(page, 'Đỗ Văn Hùng', /vai trò .*Quản lý/);
    await page.goto('/dashboard');
    const crumbs = page.getByRole('navigation', { name: 'Đường dẫn' });
    await expect(crumbs).toHaveText('Phòng Kinh doanh');
    await expect(page.getByRole('table', { name: /^Nhân viên của/ })).toBeVisible();
    await shot(page, '6-manager');
  });

  test('an employee sees "KPI của tôi" with finalised figures only', async ({ page }) => {
    await page.goto('/my/results');
    await expect(page.getByRole('heading', { name: /^KPI của tôi — kỳ T02/ })).toBeVisible();
    await shot(page, '7-my-results');
  });
});
