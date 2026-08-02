import { expect, test, type Locator, type Page } from '@playwright/test'

import { openReadyPage } from './visual-helpers'

test.beforeEach(({ page }, testInfo) => {
  void page
  test.skip(
    testInfo.project.name !== 'desktop',
    'The approved 1440 × 900 composition runs once in the desktop project.',
  )
})

async function box(locator: Locator) {
  await expect(locator).toBeVisible()
  const value = await locator.boundingBox()
  expect(value).not.toBeNull()
  return value!
}

async function expectTwoColumns(
  page: Page,
  path: string,
  stageSelector: string,
  contextSelector: string,
) {
  await openReadyPage(page, path)
  const stage = await box(page.locator(stageSelector))
  const context = await box(page.locator(contextSelector))
  expect(context.x).toBeGreaterThanOrEqual(stage.x + stage.width)
  expect(context.y).toBeCloseTo(stage.y, 0)
}

test('desktop shell and dashboard preserve the approved first viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyPage(page, '/dashboard')

  const rail = await box(page.locator('.app-rail'))
  const health = await box(page.locator('.portfolio-health-stage'))
  const detail = await box(page.getByTestId('dashboard-detail-grid'))
  expect(rail.width).toBeCloseTo(220, 0)
  expect(health.height).toBeLessThanOrEqual(300)
  expect(detail.y).toBeLessThan(900)
})

test('desktop task workspace keeps filters, fan, context, and timeline in reach', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyPage(page, '/tasks')

  await expect(page.getByTestId('task-filter-toolbar')).toBeVisible()
  const workspace = await box(page.getByTestId('task-workspace'))
  const timeline = await box(page.getByRole('region', {
    name: '独立交付时间线',
  }))
  expect(workspace.height).toBeGreaterThanOrEqual(350)
  expect(workspace.height).toBeLessThanOrEqual(380)
  expect(timeline.y).toBeLessThan(900)
  await expect(page.getByRole('region', { name: '智能任务上下文' }))
    .toBeVisible()
})

test('desktop projects and actors keep their summary contexts alongside the stage', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await expectTwoColumns(
    page,
    '/projects',
    '.project-matrix-panel',
    '.project-summary-panel',
  )
  const summary = await box(page.locator('.project-summary-panel'))
  expect(summary.y).toBeLessThan(900)

  await openReadyPage(page, '/actors')
  const network = await box(page.locator('.actor-network-panel'))
  const context = await box(page.locator('.actor-context-panel'))
  expect(network.width / context.width).toBeGreaterThan(2.7)
  expect(network.width / context.width).toBeLessThan(3.3)
})

test('desktop delivery and quality pages retain stage plus persistent context', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await expectTwoColumns(page, '/gantt', '.gantt-stage', '.gantt-context')
  await expectTwoColumns(
    page,
    '/requirements',
    '.requirement-page__content',
    '.requirement-context',
  )
  await expectTwoColumns(
    page,
    '/defects',
    '.defect-page__stage',
    '.defect-context',
  )
})

test('settings renders only the selected panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openReadyPage(page, '/settings')

  await expect(page.locator('.settings-page__panel:visible')).toHaveCount(1)
  await expect(page.locator('.settings-page__panel[hidden]')).toHaveCount(3)
  await expect(page.locator('.settings-page__panel--active')).toHaveCount(1)
})
