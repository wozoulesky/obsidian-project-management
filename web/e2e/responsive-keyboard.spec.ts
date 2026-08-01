import { expect, test, type Locator, type Page } from '@playwright/test'

const routes = [
  '/dashboard',
  '/tasks',
  '/gantt',
  '/requirements',
  '/defects',
  '/projects',
  '/projects/atlas',
  '/actors',
  '/settings',
] as const

const viewports = [390, 600, 1280, 1440] as const

test.beforeEach(({ page }, testInfo) => {
  void page
  test.skip(
    testInfo.project.name !== 'compact',
    'Responsive assertions run once in the compact Chromium project.',
  )
})

async function openReadyPage(page: Page, route: string) {
  await page.goto(route)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
}

async function expectLocalHorizontalScroll(locator: Locator) {
  await expect(locator).toBeVisible()
  await expect
    .poll(async () => locator.evaluate(
      (element) => getComputedStyle(element).overflowX,
    ))
    .toMatch(/auto|scroll/)
  const dimensions = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth)
}

test('all routes avoid document overflow at the supported responsive widths', async ({
  page,
}) => {
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of routes) {
      await openReadyPage(page, route)
      const overflow = await page.evaluate(() => ({
        body: document.body.scrollWidth - document.body.clientWidth,
        root:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      }))
      expect(overflow, `${route} at ${width}px`).toEqual({ body: 0, root: 0 })
    }
  }
})

test('390px shell reserves separate rows for header, content, and mobile navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openReadyPage(page, '/dashboard')

  const layout = await page.evaluate(() => {
    const header = document.querySelector('.app-header')!
    const main = document.querySelector('.app-main')!
    const rail = document.querySelector('.app-rail')!
    const navigation = document.querySelector('.app-rail__nav')!
    return {
      headerRow: getComputedStyle(header).gridRowStart,
      mainRow: getComputedStyle(main).gridRowStart,
      navigationScrollable: navigation.scrollWidth >= navigation.clientWidth,
      railRight: rail.getBoundingClientRect().right,
      railRow: getComputedStyle(rail).gridRowStart,
      viewportWidth: window.innerWidth,
    }
  })

  expect(layout).toMatchObject({
    headerRow: '1',
    mainRow: '2',
    navigationScrollable: true,
    railRow: '3',
  })
  expect(layout.railRight).toBeLessThanOrEqual(layout.viewportWidth)
})

test('600px dashboard stacks its signature stage and retains two metric columns', async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 900 })
  await openReadyPage(page, '/dashboard')

  const layout = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll('.portfolio-health-stage__visuals > *'),
      (element) => element.getBoundingClientRect(),
    )
    const metrics = getComputedStyle(
      document.querySelector('.metric-grid')!,
    ).gridTemplateColumns
    return {
      metricColumns: metrics.split(' ').filter(Boolean).length,
      stageRows: cards.map(({ top }) => top),
    }
  })

  expect(layout.metricColumns).toBe(2)
  expect(layout.stageRows[1]).toBeGreaterThan(layout.stageRows[0]!)
  await expect(page.getByRole('img', { name: /趋势图/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /任务状态分布/ })).toBeVisible()
})

test('390px complex workspaces keep wide content inside local scroll regions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })

  await openReadyPage(page, '/tasks')
  await expectLocalHorizontalScroll(page.locator('.task-table'))

  await openReadyPage(page, '/gantt')
  await expectLocalHorizontalScroll(page.locator('.gantt-scroll-region'))

  await openReadyPage(page, '/requirements')
  await expectLocalHorizontalScroll(page.locator('.requirement-page__board-scroll'))

  await openReadyPage(page, '/defects')
  await expectLocalHorizontalScroll(page.locator('.defect-matrix-scroll'))

  await openReadyPage(page, '/actors')
  await expectLocalHorizontalScroll(page.locator('.actor-network-scroll'))
})

test('390px inspectors follow their data surface and Escape restores the trigger', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
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

test('390px Gantt keeps the timescale when its task tree is collapsed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openReadyPage(page, '/gantt')

  const toggle = page.getByRole('button', { name: '折叠任务树' })
  const scale = page.getByRole('group', { name: '时间轴刻度' })
  await expect(toggle).toBeVisible()
  await expect(scale).toBeVisible()
  await expect(scale.getByRole('button')).toHaveCount(3)
  const selectedScale = scale.locator('button[aria-pressed="true"]')
  await expect(selectedScale).toHaveCount(1)
  const scrollRegion = page.locator('.gantt-scroll-region')
  const timelineHeader = page.locator('.gantt-timeline__header')

  await scrollRegion.evaluate((element) => {
    element.scrollTop = 360
    element.dispatchEvent(new Event('scroll'))
  })
  await expect
    .poll(async () => {
      const regionBox = await scrollRegion.boundingBox()
      const headerBox = await timelineHeader.boundingBox()
      return Math.abs((headerBox?.y ?? 0) - (regionBox?.y ?? 0))
    })
    .toBeLessThanOrEqual(2)

  await toggle.click()
  await expect(page.locator('.gantt-layout')).toHaveClass(
    /gantt-layout--task-tree-collapsed/,
  )
  await expect(scale).toBeVisible()
  await expect(selectedScale).toHaveCount(1)
})
