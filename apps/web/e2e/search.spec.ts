import { expect, test } from '@playwright/test';

test('Mock Provider completes a cited search and restores it after refresh', async ({ page }) => {
  const health = await page.request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  await expect(health.json()).resolves.toMatchObject({
    ok: true,
    service: 'cairn',
    availableProviders: expect.arrayContaining(['mock']),
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: /答案会变化/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Cairn Mock/ })).toBeVisible();

  const question = `Playwright evidence check ${test.info().project.name}`;
  await page.getByLabel('输入搜索问题').fill(question);
  await page.getByRole('button', { name: /^搜索$/ }).click();

  await expect(page).toHaveURL(/\/search\/ses_/);
  await expect(page.getByRole('heading', { name: question })).toBeVisible();
  await expect(page.locator('.status-badge')).toContainText('完成');
  await expect(page.locator('.answer-prose')).toContainText(question);
  await expect(page.locator('.citation').first()).toBeVisible();
  await expect(page.locator('.source-card').first()).toBeVisible();
  await expect(page.getByText('引用校验通过')).toBeVisible();

  const resultUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(resultUrl);
  await expect(page.locator('.answer-prose')).toContainText(question);
  await expect(page.locator('.source-card').first()).toBeVisible();
});
