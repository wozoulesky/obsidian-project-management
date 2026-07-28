import { expect, test, type Page } from '@playwright/test'

const routes = [
  '/dashboard',
  '/tasks',
  '/gantt',
  '/requirements',
  '/defects',
] as const

test.beforeEach(({ browserName }, testInfo) => {
  void browserName
  test.skip(
    testInfo.project.name !== 'compact',
    'Responsive assertions run once in the compact Chromium project.',
  )
})

async function openReadyPage(
  page: Page,
  route: (typeof routes)[number],
) {
  await page.goto(route)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
}

test('1024px routes avoid body overflow while data surfaces scroll internally', async ({
  page,
}) => {
  for (const route of routes) {
    await openReadyPage(page, route)
    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      root:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    }))
    expect(overflow, `${route} body overflow`).toEqual({ body: 0, root: 0 })
  }
})

test('767px dashboard places the rail first, uses two metrics columns, and stacks charts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 767, height: 900 })
  await openReadyPage(page, '/dashboard')

  const layout = await page.evaluate(() => {
    const rail = document.querySelector('.app-rail')!.getBoundingClientRect()
    const header = document.querySelector('.app-header')!.getBoundingClientRect()
    const cards = Array.from(
      document.querySelectorAll('.dashboard-layout--charts > section'),
      (element) => element.getBoundingClientRect(),
    )
    const metrics = getComputedStyle(
      document.querySelector('.metrics-grid')!,
    ).gridTemplateColumns
    return {
      chartRows: cards.map(({ top }) => top),
      headerTop: header.top,
      metricColumns: metrics.split(' ').filter(Boolean).length,
      railTop: rail.top,
    }
  })

  expect(layout.railTop).toBeLessThan(layout.headerTop)
  expect(layout.metricColumns).toBe(2)
  expect(layout.chartRows[1]).toBeGreaterThan(layout.chartRows[0]!)
  await expect(page.getByRole('img', { name: /趋势图/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /任务状态分布/ })).toBeVisible()
})

test('767px inspectors follow their data surface and Escape restores the trigger', async ({
  page,
}) => {
  await page.setViewportSize({ width: 767, height: 900 })
  await openReadyPage(page, '/tasks')

  const trigger = page.locator('button[id^="task-trigger-"]').first()
  await trigger.focus()
  await trigger.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).not.toHaveAttribute('aria-modal')

  const positions = await page.evaluate(() => ({
    dialogTop: document.querySelector('[role="dialog"]')!.getBoundingClientRect()
      .top,
    tableTop: document.querySelector('.task-table')!.getBoundingClientRect().top,
  }))
  expect(positions.dialogTop).toBeGreaterThan(positions.tableTop)

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('767px requirements and defects remain readable through internal scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 767, height: 900 })

  await openReadyPage(page, '/requirements')
  await expect(page.locator('.requirement-board')).toBeVisible()
  await expect(page.locator('.requirement-page__content')).toHaveCSS(
    'overflow-x',
    'auto',
  )

  await openReadyPage(page, '/defects')
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.locator('.defect-table')).toHaveCSS('overflow-x', 'auto')
})

test('767px Gantt collapses the task tree without hiding the timescale', async ({
  page,
}) => {
  await page.setViewportSize({ width: 767, height: 900 })
  await openReadyPage(page, '/gantt')

  const toggle = page.locator('.gantt-task-tree-toggle')
  const scale = page.locator('.gantt-scale')
  await expect(toggle).toBeVisible()
  await expect(scale).toBeVisible()
  await expect(scale.locator('button')).toHaveCount(3)
  const selectedScale = scale.locator('button[aria-pressed="true"]')
  await expect(selectedScale).toHaveCount(1)

  await toggle.click()
  await expect(page.locator('.gantt-layout')).toHaveClass(
    /gantt-layout--task-tree-collapsed/,
  )
  await expect(scale).toBeVisible()
  await expect(selectedScale).toHaveCount(1)
})
