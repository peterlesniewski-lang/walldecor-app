import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('redirects /dashboard to /login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[name="username"]', 'wrong')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    await expect(page.getByText('Nieprawidłowy login lub hasło')).toBeVisible()
  })

  test('logs in successfully and shows sidebar', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[name="username"]', process.env.ADMIN_USERNAME ?? 'admin')
    await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByText('WallDecor', { exact: true })).toBeVisible()
  })

  test('redirects protected app pages to password change when required', async ({ page, request }) => {
    const username = `e2eforce${Date.now()}`
    const adminLoginPage = await request.get('/api/auth/csrf')
    const adminCsrf = await adminLoginPage.json()

    await request.post('/api/auth/callback/credentials', {
      form: {
        username: process.env.ADMIN_USERNAME ?? 'admin',
        password: process.env.ADMIN_PASSWORD ?? 'ChangeMe123!',
        csrfToken: adminCsrf.csrfToken,
        callbackUrl: '/dashboard',
        json: 'true',
      },
    })

    const createResponse = await request.post('/api/users', {
      data: {
        username,
        email: `${username}@example.test`,
        name: 'E2E Forced Password',
        role: 'EMPLOYEE',
      },
    })
    expect(createResponse.ok()).toBeTruthy()
    const created = await createResponse.json()

    await page.goto('/login')
    await page.fill('input[name="username"]', username)
    await page.fill('input[type="password"]', created.temporaryPassword)
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/dashboard|\/change-password/)

    await page.goto('/knowledge')
    await expect(page).toHaveURL(/\/change-password/)

    await request.delete(`/api/users/${created.id}`)
  })
})
