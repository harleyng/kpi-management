import { expect, test, type Page } from '@playwright/test';

/**
 * Đợt 1 (PEND-06/07/08) — an evaluation form through its three steps on the seed:
 * the employee enters the actual and the system computes the %; the manager keeps the system's %;
 * HR records the manager's result. Each step's person is picked in the session switcher.
 */

async function become(page: Page, name: string) {
  await page.goto('/my/kpi');
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  await page.getByRole('combobox', { name: /^Chọn người dùng/ }).click();
  await page.getByPlaceholder('Tìm theo tên, đơn vị hoặc vai trò').fill(name);
  await page.getByRole('option').first().click();
  await expect(page.getByRole('combobox', { name: new RegExp(name) })).toBeVisible();
}

async function openFromInbox(page: Page, subject: string) {
  await page.goto('/my/tasks/inbox');
  await page.getByRole('button', { name: `Mở phiếu Đánh giá KPI của ${subject}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Đánh giá KPI — ${subject}` })).toBeVisible();
}

test.describe('@smoke evaluation form (PEND-06/07/08)', () => {
  test('employee enters the actual → manager keeps the system\'s % → HR records it', async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const subject = 'Âu Văn Định'; // E033, manager Ngô Minh Tuấn (E011)

    // 1 — the employee: a new actual recomputes the system's %, then every goal gets its explanation.
    await become(page, subject);
    await openFromInbox(page, subject);
    const table = page.getByRole('table', { name: 'Các chỉ tiêu đánh giá' });
    const firstActual = table.getByRole('textbox', { name: /— Thực tế$/ }).first();
    await firstActual.fill('3');
    await expect(table.getByText(/^Số ban đầu:/).first()).toBeVisible();
    const explanations = table.getByRole('textbox', { name: /— Giải trình$/ });
    for (let i = 0; i < (await explanations.count()); i++) await explanations.nth(i).fill('Theo báo cáo tháng 3.');
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await expect(page.getByText('Đã gửi').first()).toBeVisible();

    // 2 — the manager: the % starts at the system's; sending it on needs nothing more.
    await become(page, 'Ngô Minh Tuấn');
    await openFromInbox(page, subject);
    await expect(page.getByRole('table', { name: 'Các chỉ tiêu đánh giá' }).getByRole('textbox', { name: /— Quản lý đánh giá \(%\)$/ }).first()).not.toHaveValue('');
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    await expect(page.getByText('Đã gửi').first()).toBeVisible();

    // 3 — HR records the manager's result ("Ghi nhận", not "Duyệt").
    await become(page, 'Kha Thị Duyên'); // E035, HR
    await openFromInbox(page, subject);
    await page.getByRole('button', { name: 'Ghi nhận', exact: true }).click();
    await expect(page.getByText('Đã ghi nhận').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('@smoke registration returned by HR (PEND-02)', () => {
  test('HR sends a plan at "ghi nhận và khóa" back to the manager, with a reason', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await become(page, 'Kha Thị Duyên'); // E035, HR
    await page.goto('/my/tasks/inbox');
    await page.getByRole('button', { name: 'Mở phiếu Đăng ký KPI của Hà Văn Phong' }).click(); // E040, at HR's step
    await page.getByRole('button', { name: 'Trả lại', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('Chỉ tiêu tồn kho chưa liên kết KPI phòng, đề nghị quản lý xem lại.');
    await dialog.getByRole('button', { name: 'Trả lại', exact: true }).click();
    await expect(page.getByText('Đã trả lại').first()).toBeVisible();
    await expect(page.getByText(/Bước 3\/4/)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
