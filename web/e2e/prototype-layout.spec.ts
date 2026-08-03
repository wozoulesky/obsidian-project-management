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

test('desktop task views keep one stage and persistent context side by side', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const view of ['fan', 'board', 'timeline'] as const) {
    await openReadyPage(page, `/tasks${view === 'fan' ? '' : `?view=${view}`}`)

    await expect(page.getByTestId('task-filter-toolbar')).toBeVisible()
    const workspace = page.getByTestId('task-workspace')
    const stageRegion = page.getByTestId('task-view-stage')
    const contextRegion = page.getByRole('region', { name: '智能任务上下文' })
    const workspaceBox = await box(workspace)
    const stage = await box(stageRegion)
    const context = await box(contextRegion)
    await expect(workspace.locator(':scope > .task-view-stage')).toHaveCount(1)
    await expect(workspace.locator(':scope > .task-context')).toHaveCount(1)
    expect(await stageRegion.evaluate(
      (element) => element.nextElementSibling?.classList.contains('task-context'),
    )).toBe(true)
    expect(workspaceBox.height).toBeGreaterThanOrEqual(350)
    expect(stage.y).toBeLessThan(900)
    expect(context.x).toBeGreaterThanOrEqual(stage.x + stage.width)
    expect(context.y).toBeCloseTo(stage.y, 0)
    expect(context.y).toBeLessThan(900)
  }

  await openReadyPage(page, '/tasks?view=board')
  await expect(page.locator('.task-board__scroll')).toBeVisible()
  await expect.poll(() => page.locator('.task-board__scroll').evaluate(
    (element) => getComputedStyle(element).overflowX,
  )).toBe('auto')

  await openReadyPage(page, '/tasks?view=timeline')
  const timelineScroll = page.locator('.task-timeline__scroll')
  await expect(timelineScroll).toBeVisible()
  await expect.poll(() => timelineScroll.evaluate(
    (element) => getComputedStyle(element).overflowX,
  )).toBe('auto')
  await expect(timelineScroll).toHaveAttribute('tabindex', '0')
})

test('768px task fan and context stack without clipping the readable stage', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await openReadyPage(page, '/tasks')

  const stageRegion = page.getByTestId('task-view-stage')
  const fanRegion = page.getByRole('region', { name: '关键任务扇面' })
  const contextRegion = page.getByRole('region', { name: '智能任务上下文' })
  const heading = page.getByRole('heading', { level: 1, name: '任务控制台' })
  const stage = await box(stageRegion)
  const fan = await box(fanRegion)
  const context = await box(contextRegion)
  const title = await box(heading)

  expect(context.y).toBeGreaterThanOrEqual(stage.y + stage.height)
  expect(fan.width).toBeGreaterThan(180)
  expect(title.width).toBeGreaterThan(100)
  await expect(page.locator('.task-fan__scroll')).toBeVisible()
  await expect.poll(() => page.locator('.task-fan__scroll').evaluate(
    (element) => getComputedStyle(element).overflowX,
  )).toBe('auto')
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  )).toBe(true)
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
