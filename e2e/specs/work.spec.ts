import { expect, test, type Page } from '@playwright/test';

/**
 * @smoke — monthly work (PEND-14, Plan B). The seed's April 2027 in Phòng Kinh doanh: Lê Hoàng Phúc
 * (new hire) is still writing her plan at 60% of the weight; Nguyễn Văn An's waits on the manager,
 * Đỗ Văn Hùng. Step 8.2: lập → gửi → duyệt → khóa, then progress in place.
 */

async function become(page: Page, name: string, role: string) {
  await page.goto('/my/kpi');
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  await page.getByRole('combobox', { name: /^Chọn người dùng/ }).click();
  await page.getByPlaceholder('Tìm theo tên, đơn vị hoặc vai trò').fill(name);
  await page.getByRole('option').first().click();
  await expect(page.getByRole('combobox', { name: new RegExp(`vai trò .*${role}`) })).toBeVisible();
}

test.describe('@smoke Công việc tháng', () => {
  test('the employee completes her plan to 100% and sends it; the manager approves and it locks', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await become(page, 'Lê Hoàng Phúc', 'Nhân viên');
    await page.goto('/my/work');
    await expect(page.getByRole('heading', { level: 1, name: 'Công việc tháng' })).toBeVisible();
    await expect(page.getByText('Tổng trọng số đang là 60%. Cần đủ 100% để gửi.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gửi', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: 'Thêm việc' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Tên công việc').fill('Báo cáo tuần cho trưởng nhóm');
    await sheet.getByLabel('Trọng số (%)').fill('40');
    await expect(sheet.getByText('Sau khi lưu, tổng trọng số là 100%.')).toBeVisible();
    await sheet.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByRole('table').getByText('Báo cáo tuần cho trưởng nhóm', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await expect(page.getByText(/Đã gửi Đỗ Văn Hùng duyệt/)).toBeVisible();

    await become(page, 'Đỗ Văn Hùng', 'Quản lý');
    await page.goto('/team/work');
    await expect(page.getByRole('heading', { level: 1, name: 'Công việc tháng của đội' })).toBeVisible();
    await page.getByRole('button', { name: 'Lê Hoàng Phúc', exact: true }).click();
    await expect(page.getByText(/Lê Hoàng Phúc đã gửi kế hoạch/)).toBeVisible();
    await page.getByRole('button', { name: 'Duyệt', exact: true }).click();
    await expect(page.getByText(/Đã khóa ngày/)).toBeVisible();

    // Locked: progress moves in place, the status follows the %.
    await page.getByLabel('Hoàn thành (%) — Báo cáo tuần cho trưởng nhóm').fill('50');
    await page.getByLabel('Hoàn thành (%) — Báo cáo tuần cho trưởng nhóm').press('Enter');
    await expect(page.getByRole('combobox', { name: 'Trạng thái — Báo cáo tuần cho trưởng nhóm' })).toHaveText('Đang thực hiện');
    expect(errors).toEqual([]);
  });

  test('March review: the employee sends, the manager decides Hsnv below 80, HR records the month', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const openReview = async () => {
      await page.goto('/my/tasks/inbox');
      await page.getByRole('button', { name: 'Mở phiếu Đánh giá công việc tháng của Mai Quang Huy' }).first().click();
      await expect(page.getByRole('heading', { level: 1, name: /Đánh giá công việc tháng — Mai Quang Huy/ })).toBeVisible();
    };

    await become(page, 'Mai Quang Huy', 'Nhân viên');
    await openReview();
    await expect(page.getByText('Hsht (Tự đánh giá):')).toContainText('87,2');
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await expect(page.getByText('Đã gửi', { exact: true }).first()).toBeVisible();

    await become(page, 'Đỗ Văn Hùng', 'Quản lý');
    await openReview();
    await page.getByLabel('Quản lý đánh giá — Chăm sóc 30 khách hàng VIP', { exact: true }).fill('50');
    await expect(page.getByText('Hsht dưới ngưỡng: cần quyết định Hsnv.')).toBeVisible();
    await page.getByRole('textbox', { name: /^Hsnv/ }).fill('78');
    await page.getByRole('textbox', { name: /^Giải trình/ }).fill('Nhóm khách VIP chuyển sang quản lý mới giữa tháng.');
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await expect(page.getByText(/Bước 3\/3/)).toBeVisible();

    await become(page, 'Kha Thị Duyên', 'Nhân sự');
    await openReview();
    await page.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
    await expect(page.getByText('Hoàn thành', { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});

