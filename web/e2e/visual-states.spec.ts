import { expect, test, type Route } from '@playwright/test'

import {
  freezeVisualTime,
  openReadyPage,
  screenshotOptions,
} from './visual-helpers'

const taskChunkPattern = /\/assets\/TaskPage-[^/]+\.js$/
const errorFixtureKey = 'project-os:e2e-fixture'

test.use({ reducedMotion: 'reduce' })
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'Representative state visuals run once in the desktop project.',
  )
  await page.setViewportSize({ width: 1280, height: 800 })
  await freezeVisualTime(page)
})

test('task inspector matches its visual baseline', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1024 })
  await openReadyPage(page, '/tasks?selected=task-051')
  await expect(
    page.getByRole('dialog', { name: 'MCP 权限校验' }),
  ).toBeVisible()

  await expect(page).toHaveScreenshot(
    'state-task-inspector.png',
    screenshotOptions,
  )
})

test('loading state matches its visual baseline', async ({ page }) => {
  let releaseChunk = () => {}
  let markChunkHandled = () => {}
  let markChunkStarted = () => {}
  const chunkGate = new Promise<void>((resolve) => {
    releaseChunk = resolve
  })
  const chunkHandled = new Promise<void>((resolve) => {
    markChunkHandled = resolve
  })
  const chunkStarted = new Promise<void>((resolve) => {
    markChunkStarted = resolve
  })
  const holdTaskChunk = async (route: Route) => {
    markChunkStarted()
    await chunkGate
    try {
      await route.continue()
    } finally {
      markChunkHandled()
    }
  }
  await page.route(taskChunkPattern, holdTaskChunk)

  try {
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' })
    await chunkStarted
    await expect(
      page.getByRole('status', { name: '正在加载任务…' }),
    ).toBeVisible()
    await expect(page).toHaveScreenshot(
      'state-loading.png',
      screenshotOptions,
    )
  } finally {
    releaseChunk()
    await chunkHandled
    await page.unroute(taskChunkPattern, holdTaskChunk)
  }
})

test('empty task filter matches its visual baseline', async ({ page }) => {
  await openReadyPage(
    page,
    '/tasks?status=overdue&assignee=human-lin',
  )
  await expect(page.getByText('没有符合筛选条件的任务。')).toBeVisible()

  await expect(page).toHaveScreenshot(
    'state-empty.png',
    screenshotOptions,
  )
})

test('task error state matches its visual baseline', async ({ page }) => {
  await page.addInitScript(
    ({ key }) => sessionStorage.setItem(key, 'tasks-error'),
    { key: errorFixtureKey },
  )
  await page.goto('/tasks')

  const errorState = page.getByRole('alert', {
    name: '无法读取本地项目数据',
  })
  await expect(errorState).toBeVisible()
  await expect(errorState).toContainText('任务数据加载失败，请重试。')
  await expect(page).toHaveScreenshot(
    'state-error.png',
    screenshotOptions,
  )
})
