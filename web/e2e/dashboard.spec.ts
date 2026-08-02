import { expect, test } from '@playwright/test'

import {
  freezeVisualTime,
  openReadyDashboard,
  screenshotOptions,
} from './visual-helpers'

test.use({ reducedMotion: 'reduce' })
test.beforeEach(async ({ page }) => {
  await freezeVisualTime(page)
})

test('dashboard exposes honest portfolio health and the selected 90-day total', async ({
  page,
}) => {
  await openReadyDashboard(page)

  const metrics = page.getByLabel('项目指标')
  await expect(metrics.getByText('项目总数', { exact: true })).toBeVisible()
  await expect(metrics.getByText('组合开放风险', { exact: true }))
    .toBeVisible()
  await expect(page.getByRole('heading', { name: '风险队列' })).toBeVisible()
  await expect(page.getByText('dev-agent', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: '90 天' }).click()
  await expect(page.getByText('118 项已完成', { exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot(
    'dashboard-90-day.png',
    { ...screenshotOptions, maxDiffPixels: 200 },
  )
})

test('task update persists through SPA navigation into dashboard activity', async ({
  page,
}) => {
  await page.goto('/tasks')
  await expect(
    page.getByRole('heading', { level: 1, name: '任务控制台' }),
  ).toBeVisible()

  await page.getByRole('button', { name: '查看 MCP 权限校验' }).click()
  await expect(page).toHaveURL(/\/tasks\?selected=task-051$/)

  const context = page.getByRole('region', { name: '智能任务上下文' })
  await expect(context.getByRole('heading', { name: 'MCP 权限校验' }))
    .toBeVisible()
  await context.getByRole('spinbutton', { name: '任务进度' }).fill('80')
  await context
    .getByRole('textbox', { name: '进度备注' })
    .fill('E2E 权限边界复核完成')
  await context.getByRole('button', { name: '提交进度' }).click()
  await expect(
    context.getByRole('spinbutton', { name: '任务进度' }),
  ).toHaveValue('80')
  await expect(page).toHaveURL(/\/tasks\?selected=task-051$/)

  await page.getByRole('link', { name: '仪表盘' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(
    page.getByText('将「MCP 权限校验」更新至 80%', { exact: true }),
  ).toBeVisible()
})

test('unknown paths retain the shell and offer a dashboard recovery link', async ({
  page,
}) => {
  await page.goto('/not-a-real-project-page')

  await expect(
    page.getByRole('heading', { level: 1, name: '页面未找到' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: '返回仪表盘' })).toHaveAttribute(
    'href',
    '/dashboard',
  )
  await expect(page.locator('.app-shell')).toBeVisible()
})
