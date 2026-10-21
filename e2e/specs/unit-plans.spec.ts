import { expect, test, type Page } from '@playwright/test';

/**
 * @smoke — the company → department tier of Goal Plans (BR-KPI-07, 19): HR starts a department
 * plan's registration by hand from Quản trị KPI › Chu kỳ › Goal Plan, and cascades a company goal
 * down to a department plan with the assigned / not-assigned figures right. Every KPI 2027 unit plan
 * is Locked in the seed, so the registration runs on KPI 2028 and the cascade on an unlocked
 * Phòng Chăm sóc khách hàng.
 */

async function become(page: Page, name: string, role: string) {
  await page.goto('/my/kpi');
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  await page.getByRole('combobox', { name: /^Chọn người dùng/ }).click();
  await page.getByPlaceholder('Tìm theo tên, đơn vị hoặc vai trò').fill(name);
  await page.getByRole('option').first().click();
  await expect(page.getByRole('combobox', { name: new RegExp(`vai trò .*${role}`) })).toBeVisible();
}

const HR = ['Kha Thị Duyên', 'Nhân sự'] as const;
const planRow = (page: Page, owner: string) => page.getByRole('row').filter({ has: page.getByText(owner, { exact: true }) });

test.describe('@smoke Goal Plan công ty → bộ phận', () => {
  test('HR starts Phòng Kinh doanh\'s registration; it waits for the division director at step 1', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await become(page, ...HR);
    await page.goto('/admin/cycles/plans');
    await page.getByRole('combobox', { name: 'Chu kỳ' }).click();
    await page.getByRole('option', { name: /KPI 2028/ }).click();

    await page.getByRole('button', { name: 'Tạo Goal Plan công ty / bộ phận' }).click();
    const create = page.getByRole('dialog');
    await create.getByRole('combobox', { name: /Tầng/ }).click();
    await page.getByRole('option', { name: 'Bộ phận' }).click();
    await create.getByRole('combobox', { name: /Bộ phận/ }).click();
    await page.getByRole('option', { name: 'Phòng Kinh doanh' }).click();
    await create.getByRole('button', { name: 'Tạo Goal Plan' }).click();
    await expect(page).toHaveURL(/\/admin\/cycles\/plans\/[^/]+\/[^/?]+/);
    await page.goBack();

    const row = planRow(page, 'Phòng Kinh doanh');
    await expect(row.getByText('Chưa bắt đầu')).toBeVisible();
    await row.getByRole('button', { name: 'Bắt đầu đăng ký Goal Plan của Phòng Kinh doanh' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Đỗ Văn Hùng').first()).toBeVisible(); // the head — the subject
    await expect(dialog.getByRole('listitem').first()).toContainText('Phạm Quốc Bảo'); // step 1: the director
    await dialog.getByRole('button', { name: 'Bắt đầu đăng ký' }).click();
    await expect(page.getByText('Phiếu đang chờ Phạm Quốc Bảo ở bước 1.')).toBeVisible();
    await expect(row.getByText(/Bước 1\/4/)).toBeVisible();
    await expect(row.getByRole('button', { name: /Bắt đầu đăng ký/ })).toHaveCount(0);

    await become(page, 'Phạm Quốc Bảo', 'Quản lý');
    await page.goto('/my/tasks/inbox');
    await expect(page.getByText('Đỗ Văn Hùng').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('HR cascades part of company revenue to Phòng CSKH; assigned and not-assigned update', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await become(page, ...HR);
    await page.goto('/admin/cycles/plans');

    const cskh = planRow(page, 'Phòng Chăm sóc khách hàng');
    await cskh.getByRole('button', { name: 'Mở khóa' }).click();
    const unlock = page.getByRole('dialog');
    await unlock.getByLabel(/Lý do mở khóa/).fill('Nhận phân giao doanh thu');
    await unlock.getByRole('button', { name: 'Mở khóa' }).click();
    await expect(cskh.getByRole('button', { name: 'Khóa', exact: true })).toBeVisible();

    await planRow(page, 'Công ty Syntra').getByRole('button', { name: /^Xem Goal Plan/ }).click();
    await page.getByRole('button', { name: /^Thao tác với chỉ tiêu Doanh thu/ }).first().click();
    await page.getByRole('menuitem', { name: 'Phân giao' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('radio', { name: 'Đơn vị' })).toBeChecked();
    await dialog.getByRole('combobox', { name: /Đơn vị nhận/ }).click();
    await page.getByRole('option', { name: /Phòng Chăm sóc khách hàng/ }).click();
    await dialog.getByLabel(/^Phần giao/).fill('10.000.000.000');
    // The CSKH plan is already at 100%: the suggested weight is 0 and refused until one is typed.
    await expect(dialog.getByText('Trọng số phải lớn hơn 0.')).toBeVisible();
    await dialog.getByLabel(/^Trọng số/).fill('10');
    const preview = dialog.getByLabel('Phân bổ sau khi giao');
    await expect(preview).toContainText('154.000.000.000');
    await expect(preview).toContainText('6.800.000.000');
    await dialog.getByRole('button', { name: 'Phân giao' }).click();
    await expect(page.getByText('Đã phân giao chỉ tiêu')).toBeVisible();
    await expect(page.getByRole('cell', { name: '154.000.000.000' }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
