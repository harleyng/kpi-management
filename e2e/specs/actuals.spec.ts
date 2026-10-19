import { expect, test, type Page } from '@playwright/test';

/**
 * @smoke — Track T4: HR enters, imports and syncs a month's actuals (plan §8.2 "nhập số T01 (tay +
 * Excel + API)", on the seed's open month T03). Every failure must show catalogue copy — never an empty
 * table standing in for a failed read.
 */

/** Switch to the HR persona (E035) by name — searching "Nhân sự" also matches the HR department's staff. */
async function become(page: Page, name: string, role: string) {
  await page.goto('/my/kpi');
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  await page.getByRole('combobox', { name: /^Chọn người dùng/ }).click();
  await page.getByPlaceholder('Tìm theo tên, đơn vị hoặc vai trò').fill(name);
  await page.getByRole('option').first().click();
  await expect(page.getByRole('combobox', { name: new RegExp(`vai trò .*${role}`) })).toBeVisible();
}

test.describe('@smoke Số liệu & import (T4)', () => {
  test('HR enters a T03 number by hand; a missing one shows "—", never 0', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await become(page, 'Kha Thị Duyên', 'Nhân sự');
    await page.goto('/admin/actuals/entry');
    await expect(page.getByRole('combobox', { name: 'Kỳ', exact: true })).toHaveText(/T03/);
    await page.getByRole('button', { name: /chỉ tiêu chưa có số/ }).click(); // filter to the missing ones
    const row = page.getByRole('row').filter({ hasText: 'Chưa có số' }).first();
    await expect(row.getByText('—').first()).toBeVisible();
    await row.getByRole('button', { name: /^Nhập số/ }).click();
    await page.getByLabel(/Giá trị thực tế|Kết quả/).first().fill('2,15');
    await page.getByRole('button', { name: 'Lưu số liệu' }).click();
    await expect(page.getByText('Đã lưu số thực tế')).toBeVisible();
    await expect(page.getByText('Đang dùng')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the seeded CRM batch cannot be committed and says why', async ({ page }) => {
    await become(page, 'Kha Thị Duyên', 'Nhân sự');
    await page.goto('/admin/actuals/import');
    await page.getByRole('button', { name: 'Xem và ghi nhận' }).click();
    await expect(page).toHaveURL(/\/admin\/actuals\/import\/[^/?]+/);
    await expect(page.getByText('Không tìm thấy người dùng nam.hv2')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Ghi nhận \d+ dòng$/ })).toBeDisabled();
    await expect(page.getByText(/Còn 2 dòng lỗi, chưa thể ghi nhận/)).toBeVisible();
  });

  test('a sync of a locked month (T01) fails and logs why', async ({ page }) => {
    await become(page, 'Kha Thị Duyên', 'Nhân sự');
    await page.goto('/admin/actuals/sync');
    // The connection opens on its own page, which holds its run history.
    await page.getByRole('table', { name: 'Kết nối API' }).getByRole('row').nth(1).getByRole('button').first().click();
    await expect(page).toHaveURL(/\/admin\/actuals\/sync\/[^/?]+/);
    await page.getByRole('button', { name: 'Chạy đồng bộ', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Kỳ đồng bộ' }).click();
    await page.getByRole('option', { name: 'T01' }).click();
    await dialog.getByRole('button', { name: 'Chạy đồng bộ kỳ T01' }).click();
    await expect(page.getByText(/Lần chạy vừa xong.*: 0 chỉ tiêu cập nhật/)).toBeVisible();
    await page.getByRole('row').filter({ hasText: 'T01' }).filter({ hasText: 'Thất bại' }).first().getByText(/dòng nhật ký/).click();
    await expect(page.getByText(/Kỳ đã khóa số liệu\./).first()).toBeVisible();
  });
});
