import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('redirects /dashboard to /login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'wrong@walldecor.pl')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    await expect(page.getByText('Nieprawidłowy email lub hasło')).toBeVisible()
  })

  test('logs in successfully and shows sidebar', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', process.env.ADMIN_EMAIL ?? 'admin@walldecor.pl')
    await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByText('WallDecor')).toBeVisible()
  })
})
