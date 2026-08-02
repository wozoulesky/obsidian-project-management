import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const routes = [
  '/dashboard',
  '/projects',
  '/projects/atlas',
  '/actors',
  '/settings',
  '/tasks',
  '/gantt',
  '/requirements',
  '/defects',
] as const

async function expectNoSeriousOrCriticalViolations(
  page: Parameters<typeof AxeBuilder>[0]['page'],
) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const violations = results.violations
    .filter(({ impact }) => impact === 'serious' || impact === 'critical')
    .map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ any, target }) => ({
        target: target.join(' '),
        details: any.map(({ data }) => data).filter(Boolean),
      })),
    }))

  expect(violations).toEqual([])
}

for (const route of routes) {
  test(`${route} has no serious or critical automatic WCAG A/AA violations`, async ({
    page,
  }) => {
    await page.goto(route)

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
    await expectNoSeriousOrCriticalViolations(page)
  })
}

test('desktop rail and mobile bottom navigation remain accessible', async ({ page }) => {
  await page.goto('/projects')
  const navigation = page.getByRole('navigation', { name: '主导航' })
  await expect(navigation).toBeVisible()
  await expect(page.getByRole('button', { name: /(?:展开|收起)侧边栏/ }))
    .toHaveCount(0)
  await expectNoSeriousOrCriticalViolations(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(navigation).toBeVisible()
  await expectNoSeriousOrCriticalViolations(page)
})

test('project, actor, and quick submit dialogs remain accessible', async ({
  page,
}) => {
  await page.goto('/projects')
  await page.getByRole('button', { name: '新建项目' }).click()
  await expect(page.getByRole('dialog', { name: '新建项目' })).toBeVisible()
  await expectNoSeriousOrCriticalViolations(page)

  await page.getByRole('button', { name: '关闭新建项目' }).click()
  await page.goto('/actors')
  await page.getByRole('button', { name: '新增负责人' }).click()
  await expect(page.getByRole('dialog', { name: '新增负责人' })).toBeVisible()
  await expectNoSeriousOrCriticalViolations(page)

  await page.getByRole('button', { name: '关闭新增负责人' }).click()
  await page.getByRole('button', { name: '快速提交' }).click()
  await expect(page.getByRole('dialog', { name: '快速提交' })).toBeVisible()
  await expectNoSeriousOrCriticalViolations(page)
})

test('dark compact project workflows remain accessible', async ({ page }) => {
  await page.goto('/settings')
  await page.getByLabel('深色').check()
  await page.getByLabel('渐变').check()
  await page.getByLabel('紫色').check()
  await page.getByLabel('紧凑').check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact')
  await expectNoSeriousOrCriticalViolations(page)

  await page.getByRole('link', { name: '项目', exact: true }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: '全部项目' }),
  ).toBeVisible()
  await expectNoSeriousOrCriticalViolations(page)

  await page.getByRole('link', { name: '负责人' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: '协作者网络' }),
  ).toBeVisible()
  await expectNoSeriousOrCriticalViolations(page)
})

test('dark create project validation errors remain accessible', async ({
  page,
}) => {
  await page.goto('/settings')
  await page.getByLabel('深色').check()
  await page.getByRole('link', { name: '项目', exact: true }).click()
  await page.getByRole('button', { name: '新建项目' }).click()
  const dialog = page.getByRole('dialog', { name: '新建项目' })
  await dialog.getByRole('button', { name: '创建项目' }).click()

  await expect(dialog.getByText('请输入项目名称')).toBeVisible()
  await expect(dialog.getByText('请选择有效负责人')).toBeVisible()
  await expectNoSeriousOrCriticalViolations(page)
})

test('compact task detail drawer has no serious or critical violations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByRole('button', { name: '查看任务详情' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectNoSeriousOrCriticalViolations(page)
})
