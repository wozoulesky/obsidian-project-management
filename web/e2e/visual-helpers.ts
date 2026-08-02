import { expect, type Page } from '@playwright/test'

export const screenshotOptions = {
  animations: 'disabled',
  caret: 'hide',
  fullPage: false,
  maxDiffPixels: 100,
} as const

export async function freezeVisualTime(page: Page) {
  await page.clock.setFixedTime(new Date(2026, 6, 28, 12, 15))
}

export async function openReadyPage(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
}

export async function openReadyDashboard(page: Page) {
  await openReadyPage(page, '/dashboard')
  await expect(
    page.getByRole('heading', { level: 1, name: '全局驾驶舱' }),
  ).toBeVisible()

  await expect(
    page.getByRole('img', { name: /最近七期实际交付柱状图/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: '真实项目进度' }),
  ).toBeVisible()
  const detailGrid = page.getByTestId('dashboard-detail-grid')
  await expect(detailGrid).toBeVisible()

  let previousSignature: string | undefined
  await expect.poll(async () => {
    const signature = await page.evaluate(() => {
      const healthBody = document.querySelector('.portfolio-health-stage__body')
      const detail = document.querySelector('[data-testid="dashboard-detail-grid"]')
      if (!(healthBody instanceof HTMLElement) || !(detail instanceof HTMLElement)) {
        return 'missing'
      }
      const healthRect = healthBody.getBoundingClientRect()
      const detailRect = detail.getBoundingClientRect()
      return [
        Math.round(healthRect.width),
        Math.round(healthRect.height),
        Math.round(detailRect.width),
        Math.round(detailRect.top),
      ].join(':')
    })
    const stable = previousSignature === signature && signature !== 'missing'
    previousSignature = signature
    return stable
  }).toBe(true)
}
