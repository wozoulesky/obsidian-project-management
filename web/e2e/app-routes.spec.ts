import { expect, test, type Page } from '@playwright/test'

const routeCases = [
  ['/dashboard', '全局驾驶舱', 'PORTFOLIO OVERVIEW', '仪表盘'],
  ['/tasks', '任务控制台', 'PLAN / TASKS', '计划 / 任务'],
  ['/gantt', '甘特排程', 'PLAN / DEPENDENCY', '甘特图'],
  ['/requirements', '需求管线', '计划 / 需求', '需求'],
  ['/defects', '缺陷矩阵', 'QUALITY / RISK', '缺陷'],
  ['/projects', '全部项目', 'PROJECT MATRIX', '项目'],
  ['/projects/atlas', 'Atlas', 'ATLAS', '项目详情'],
  ['/actors', '协作者网络', 'ACTOR NETWORK', '负责人'],
  ['/settings', '设置中心', 'SETTINGS', '设置'],
] as const

async function expectRouteSignature(
  page: Page,
  {
    eyebrow,
    heading,
    navLabel,
    route,
  }: {
    eyebrow: string
    heading: string
    navLabel: string
    route: string
  },
) {
  await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`))
  await expect(
    page.getByRole('heading', { level: 1, name: heading }),
  ).toBeVisible()
  await expect(page.getByText(eyebrow, { exact: true })).toBeVisible()

  const navigation = page.getByRole('navigation', { name: '主导航' })
  await expect(
    navigation.getByRole('link', { name: navLabel, exact: true }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(navigation.locator('a[aria-current="page"]')).toHaveCount(1)
}

for (const [route, heading, eyebrow, navLabel] of routeCases) {
  test(`${route} keeps its signature, active navigation, focus target, and history`, async ({
    page,
  }) => {
    const consoleProblems: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        const { url } = message.location()
        if (url.endsWith('/favicon.ico')) return
        consoleProblems.push(
          `${message.type()}: ${message.text()}${url ? ` (${url})` : ''}`,
        )
      }
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    const previousRoute = route === '/dashboard' ? '/projects' : '/dashboard'
    await page.goto(previousRoute)
    await page.goto(route)
    await expectRouteSignature(page, { eyebrow, heading, navLabel, route })
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`${previousRoute}$`))
    await page.goForward()
    await expectRouteSignature(page, { eyebrow, heading, navLabel, route })

    await page.keyboard.press('Tab')
    const skipLink = page.getByRole('link', { name: '跳到主要内容' })
    await expect(skipLink).toBeFocused()
    await skipLink.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()

    expect(consoleProblems).toEqual([])
    expect(pageErrors).toEqual([])
  })
}
