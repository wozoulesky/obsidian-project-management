import { expect, test } from '@playwright/test'

import {
  freezeVisualTime,
  openReadyDashboard,
  openReadyPage,
  screenshotOptions,
} from './visual-helpers'

const keyPages = [
  { name: 'tasks', path: '/tasks' },
  { name: 'gantt', path: '/gantt' },
  { name: 'requirements', path: '/requirements' },
  { name: 'defects', path: '/defects' },
] as const

test.use({ reducedMotion: 'reduce' })
test.beforeEach(async ({ page }) => {
  await freezeVisualTime(page)
})

test('defect conversion links the persistent defect and task contexts', async ({
  page,
}) => {
  await page.goto('/defects')
  await expect(
    page.getByRole('heading', { level: 1, name: '缺陷矩阵' }),
  ).toBeVisible()

  await page.getByRole('button', { name: '查看 离线恢复失败' }).click()
  const defectContext = page.getByRole('complementary', {
    name: '缺陷上下文',
  })
  await expect(
    defectContext.getByRole('heading', { name: '离线恢复失败' }),
  ).toBeVisible()
  await defectContext
    .getByRole('button', { name: '转为修复任务' })
    .click()

  const repairTask = defectContext.getByRole('link', {
    name: 'FIX-D-104 修复：离线恢复失败',
  })
  await expect(repairTask).toBeVisible()
  await repairTask.click()

  await expect(page).toHaveURL(/\/tasks\?selected=task-fix-defect-104$/)
  const taskContext = page.getByRole('region', { name: '智能任务上下文' })
  await expect(taskContext.getByRole('heading', {
    name: '修复：离线恢复失败',
  })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

for (const keyPage of keyPages) {
  test(`${keyPage.name} key page matches its visual baseline`, async ({
    page,
  }) => {
    await openReadyPage(page, keyPage.path)

    await expect(page).toHaveScreenshot(`${keyPage.name}.png`, screenshotOptions)
  })
}

test('desktop comparison captures representative 1280px and 768px layouts', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'Explicit comparison viewports run once in the desktop project.',
  )

  await page.setViewportSize({ width: 1280, height: 800 })
  await openReadyDashboard(page)
  await expect(page).toHaveScreenshot(
    'comparison-dashboard-1280.png',
    { ...screenshotOptions, maxDiffPixels: 200 },
  )

  await page.setViewportSize({ width: 768, height: 1024 })
  await openReadyDashboard(page)
  await expect(page).toHaveScreenshot(
    'comparison-dashboard-768.png',
    { ...screenshotOptions, maxDiffPixels: 500 },
  )

  await openReadyPage(page, '/tasks')
  await expect(page).toHaveScreenshot(
    'comparison-tasks-768.png',
    screenshotOptions,
  )

  await openReadyPage(page, '/gantt')
  await expect(page).toHaveScreenshot(
    'comparison-gantt-768.png',
    screenshotOptions,
  )

  await page.setViewportSize({ width: 1440, height: 900 })
})
