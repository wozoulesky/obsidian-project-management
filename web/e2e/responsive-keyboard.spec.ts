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

test('390px shell reserves separate rows for content and bottom navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openReadyPage(page, '/dashboard')

  const layout = await page.evaluate(() => {
    const main = document.querySelector('.app-main')!
    const rail = document.querySelector('.app-rail')!
    const navigation = document.querySelector('.app-rail__nav')!
    return {
      mainRow: getComputedStyle(main).gridRowStart,
      navigationScrollable: navigation.scrollWidth >= navigation.clientWidth,
      railRight: rail.getBoundingClientRect().right,
      railRow: getComputedStyle(rail).gridRowStart,
      viewportWidth: window.innerWidth,
    }
  })

  expect(layout).toMatchObject({
    mainRow: '1',
    navigationScrollable: true,
    railRow: '2',
  })
  await expect(page.locator('.app-header')).toHaveCount(0)
  expect(layout.railRight).toBeLessThanOrEqual(layout.viewportWidth)
})

test('600px dashboard stacks its health body and retains two metric columns', async ({
  page,
}) => {
  await page.setViewportSize({ width: 600, height: 900 })
  await openReadyPage(page, '/dashboard')

  const layout = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll('.portfolio-health-stage__body > *'),
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
  await expect(
    page.getByRole('img', { name: /最近七期实际交付柱状图/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: '真实项目进度' }),
  ).toBeVisible()
})

test('390px complex workspaces keep wide content inside local scroll regions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })

  await openReadyPage(page, '/tasks')
  await expectLocalHorizontalScroll(page.locator('.task-fan__scroll'))

  await openReadyPage(page, '/tasks?view=board')
  await expectLocalHorizontalScroll(page.locator('.task-board__scroll'))

  await openReadyPage(page, '/tasks?view=timeline')
  const taskTimeline = page.locator('.task-timeline__scroll')
  await expectLocalHorizontalScroll(taskTimeline)
  await taskTimeline.focus()
  await expect(taskTimeline).toBeFocused()
  const taskTimelineOverflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  }))
  expect(taskTimelineOverflow).toEqual({ body: 0, root: 0 })

  await openReadyPage(page, '/gantt')
  await expectLocalHorizontalScroll(page.locator('.gantt-timeline'))

  await openReadyPage(page, '/requirements')
  await expectLocalHorizontalScroll(page.locator('.requirement-page__board-scroll'))

  await openReadyPage(page, '/defects')
  await expectLocalHorizontalScroll(page.locator('.defect-matrix-scroll'))

  await openReadyPage(page, '/actors')
  await expectLocalHorizontalScroll(page.locator('.actor-network-scroll'))
})

test('390px task selections open one keyboard-operable detail drawer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openReadyPage(page, '/tasks')

  const trigger = page.locator('button[id^="task-list-trigger-"]').nth(1)
  await trigger.focus()
  await trigger.press('Enter')
  await expect(trigger).toHaveAttribute('aria-pressed', 'true')
  await expect(trigger).toBeFocused()

  const opener = page.getByRole('button', { name: '查看任务详情' })
  await expect(opener).toBeVisible()
  await expect(opener).toHaveAttribute('aria-expanded', 'false')
  await opener.focus()
  await opener.press('Enter')

  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await expect(opener).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.task-context')).toHaveCount(1)
  await expect(drawer.getByRole('button', { name: '关闭任务详情' }))
    .toBeFocused()
  const drawerBox = await drawer.boundingBox()
  expect(drawerBox).not.toBeNull()
  expect(drawerBox!.x).toBeGreaterThanOrEqual(0)
  expect(drawerBox!.x + drawerBox!.width).toBeLessThanOrEqual(390)
  expect(drawerBox!.y).toBeGreaterThanOrEqual(0)
  expect(drawerBox!.y + drawerBox!.height).toBeLessThanOrEqual(844)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(opener).toHaveAttribute('aria-expanded', 'false')
  await expect(opener).toBeFocused()

  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  }))
  expect(overflow).toEqual({ body: 0, root: 0 })
})

test('390px Gantt keeps local timeline scrolling and its selected scale', async ({
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
  const timeline = page.locator('.gantt-timeline')
  await expectLocalHorizontalScroll(timeline)
  await timeline.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
    element.dispatchEvent(new Event('scroll'))
  })
  await expect
    .poll(async () => timeline.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0)

  await toggle.click()
  await expect(page.locator('.gantt-layout')).toHaveClass(
    /gantt-layout--task-tree-collapsed/,
  )
  await expect(scale).toBeVisible()
  await expect(selectedScale).toHaveCount(1)
})
