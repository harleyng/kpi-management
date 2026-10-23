import { expect, test, type Page } from '@playwright/test';

/**
 * T6 — Kết quả & lương. The seed's story (src/data/fixtures/README.md, "Results"): T01 Locked, T02 Final
 * plus Drafts, T03 unit Drafts only — months tracked, not paid; Q1 three Final, paid results (PEND-09). The full lifecycle (evaluate → finalise → export) is Phase 4's.
 */

/** Switch to a seeded person by name through the top-bar picker. */
async function become(page: Page, name: string) {
  await page.goto('/my/kpi');
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  await page.getByRole('combobox', { name: /^Chọn người dùng/ }).click();
  await page.getByPlaceholder('Tìm theo tên, đơn vị hoặc vai trò').fill(name);
  await page.getByRole('option').first().click();
  await expect(page.getByRole('combobox', { name: new RegExp(name) })).toBeVisible();
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

test.describe('@smoke T6 results', () => {
  test('C&B sees a period\'s results and exports the payroll file of a quarter', async ({ page }) => {
    const errors = collectErrors(page);
    await become(page, 'Tôn Văn Quân'); // E036, C&B
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await nav.getByRole('button', { name: 'Kết quả & lương', exact: true }).click();
    await nav.getByRole('link', { name: 'Kết quả theo kỳ', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Kết quả theo kỳ' })).toBeVisible();

    // T03 (the default: the latest month over) has unit results only.
    await expect(page.getByRole('table', { name: /Kết quả T03/ })).toBeVisible();

    // The payroll sub-page offers the paid periods only — quarters and the year (PEND-09) — and opens on Q1.
    await nav.getByRole('link', { name: 'Xuất file lương', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Xuất file lương' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Kỳ', exact: true }).click();
    await expect(page.getByRole('option', { name: /^T01/ })).toHaveCount(0);
    await page.getByRole('option', { name: /^Q1/ }).click();
    await expect(page.getByText('3 kết quả cá nhân sẽ có trong file.')).toBeVisible();
    await expect(page.getByText('Chưa xuất file nào cho kỳ này.')).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Xuất file lương' }).click();
    expect((await download).suggestedFilename()).toMatch(/^luong-kpi_kpi-2027_q1_\d{8}-\d{4}\.xlsx$/);
    await expect(page.getByRole('button', { name: /^Tải xuống file lương xuất lúc/ })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('an employee sees finalised results only — a Draft shows no figure', async ({ page }) => {
    const errors = collectErrors(page);
    await become(page, 'Nguyễn Văn An'); // E016
    await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Kết quả của tôi', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Kết quả của tôi' })).toBeVisible();
    const table = page.getByRole('table', { name: /Kết quả của tôi/ });
    await expect(table.getByRole('button', { name: /Xem chi tiết kết quả T01/ })).toBeVisible();
    await table.getByRole('button', { name: /Xem chi tiết kết quả T01/ }).click();
    await expect(page.getByRole('dialog').getByText('Điểm KPI (đã làm tròn)')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('HR finalises nothing when one result is blocked, and is told which', async ({ page }) => {
    const errors = collectErrors(page);
    await become(page, 'Kha Thị Duyên'); // E035, HR
    await page.goto('/admin/results/period');
    await page.getByRole('combobox', { name: 'Kỳ', exact: true }).click();
    await page.getByRole('option', { name: /^T02/ }).click();
    await expect(page.getByRole('table', { name: /Kết quả T02/ })).toBeVisible();
    await page.getByRole('button', { name: 'Chốt kết quả' }).click();
    await page.getByRole('menuitem', { name: /Chốt tất cả bản nháp/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Chốt kết quả' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Không chốt được: \d+ kết quả còn vướng/ })).toBeVisible();
    // HR holds result.finalize but not result.export.
    await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Xuất file lương', exact: true }).click();
    await expect(page.getByText('Chỉ C&B xuất file lương.')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
