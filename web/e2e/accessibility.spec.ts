import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const routes = [
  '/dashboard',
  '/tasks',
  '/gantt',
  '/requirements',
  '/defects',
] as const

for (const route of routes) {
  test(`${route} has no automatic WCAG A/AA violations`, async ({ page }) => {
    await page.goto(route)

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(
      results.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map(({ target }) => target.join(' ')),
      })),
    ).toEqual([])
  })
}
