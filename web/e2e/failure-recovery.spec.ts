import AxeBuilder from '@axe-core/playwright'
import type { Page, Route } from '@playwright/test'

import { expect, test } from './real-runtime'

function errorEnvelope(code: string, message: string) {
  return {
    data: null,
    error: { code, message, details: {} },
    meta: { request_id: `e2e-${code.toLocaleLowerCase()}` },
  }
}

async function fulfillError(
  route: Route,
  status: number,
  code: string,
  message: string,
) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(errorEnvelope(code, message)),
  })
}

async function expectFocusedAlert(page: Page, message: string) {
  const alert = page.getByRole('alert').filter({ hasText: message })
  await expect(alert).toBeVisible()
  await expect(alert).toBeFocused()
}

async function expectNoSeriousOrCriticalViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(
    results.violations
      .filter(({ impact }) => impact === 'serious' || impact === 'critical')
      .map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target.join(' ')),
      })),
  ).toEqual([])
}

test('dark create project refocuses the same 503 on every attempt', async ({
  page,
  runtime,
}) => {
  let attempts = 0
  await page.route('**/api/v1/projects', async (route) => {
    if (route.request().method() === 'POST') {
      attempts += 1
      await fulfillError(
        route,
        503,
        'SERVICE_UNAVAILABLE',
        '项目服务暂时不可用',
      )
      return
    }
    await route.continue()
  })

  await page.goto(new URL('/settings', runtime.baseURL).href)
  await page.getByLabel('深色').check()
  await page.getByRole('link', { name: '项目' }).click()
  await page.getByRole('button', { name: '新建项目' }).click()
  const dialog = page.getByRole('dialog', { name: '新建项目' })
  await dialog.getByLabel('项目名称').fill('保留失败草稿')
  await dialog
    .getByLabel('主要负责人')
    .selectOption({ label: runtime.seed.ownerName })
  await dialog.getByLabel('项目描述').fill('503 后仍可继续编辑')
  await dialog.getByRole('button', { name: '创建项目' }).click()

  await expectFocusedAlert(page, '项目服务暂时不可用')
  await expectNoSeriousOrCriticalViolations(page)
  await expect(dialog.getByLabel('项目名称')).toHaveValue('保留失败草稿')
  await expect(dialog.getByLabel('主要负责人')).toHaveValue(
    runtime.seed.ownerId,
  )
  await expect(dialog.getByLabel('项目描述')).toHaveValue(
    '503 后仍可继续编辑',
  )
  await expect(
    page.getByRole('article', { name: '保留失败草稿' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('status').filter({ hasText: '创建成功' }),
  ).toHaveCount(0)

  await dialog.getByLabel('项目名称').focus()
  await dialog.getByRole('button', { name: '创建项目' }).click()
  await expectFocusedAlert(page, '项目服务暂时不可用')
  expect(attempts).toBe(2)
  await expect(dialog.getByLabel('项目名称')).toHaveValue('保留失败草稿')
  await expect(dialog.getByLabel('主要负责人')).toHaveValue(
    runtime.seed.ownerId,
  )
  await expect(dialog.getByLabel('项目描述')).toHaveValue(
    '503 后仍可继续编辑',
  )
  await expect(
    page.getByRole('article', { name: '保留失败草稿' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('status').filter({ hasText: '创建成功' }),
  ).toHaveCount(0)
})

test('quick submit keeps values after 409 and retries the frozen version', async ({
  page,
  runtime,
}) => {
  const submittedVersions: number[] = []
  let rejectFirst = true
  await page.route('**/api/v1/tasks/*/progress', async (route) => {
    const body = route.request().postDataJSON() as { version: number }
    submittedVersions.push(body.version)
    if (rejectFirst) {
      rejectFirst = false
      await fulfillError(
        route,
        409,
        'TASK_VERSION_CONFLICT',
        '任务版本已过期',
      )
      return
    }
    await route.continue()
  })

  await page.goto(new URL('/dashboard', runtime.baseURL).href)
  await page.getByRole('button', { name: '快速提交' }).click()
  const dialog = page.getByRole('dialog', { name: '快速提交' })
  await dialog
    .getByLabel('负责人')
    .selectOption({ label: runtime.seed.agentName })
  await dialog
    .getByLabel('任务')
    .selectOption({ label: runtime.seed.taskTitle })
  await dialog.getByRole('spinbutton', { name: '进度' }).fill('79')
  await dialog.getByLabel('状态').selectOption('in_progress')
  await dialog.getByLabel('进度备注').fill('冲突后重试')
  await dialog.getByRole('button', { name: '提交进度' }).click()

  await expectFocusedAlert(page, '任务版本已过期')
  await expect(dialog.getByRole('spinbutton', { name: '进度' })).toHaveValue(
    '79',
  )
  await expect(dialog.getByLabel('进度备注')).toHaveValue('冲突后重试')
  await expect(
    page.getByRole('status').filter({ hasText: '已更新至 79%' }),
  ).toHaveCount(0)

  await dialog.getByRole('button', { name: '提交进度' }).click()
  await expect(page.getByRole('status')).toContainText('已更新至 79%')
  expect(submittedVersions).toHaveLength(2)
  expect(submittedVersions[1]).toBe(submittedVersions[0])
})

test('settings preserves its draft, refetches a 409 version, and retries', async ({
  page,
  request,
  runtime,
}) => {
  await page.goto(new URL('/settings', runtime.baseURL).href)
  await expect(page.getByLabel('浅色')).toBeVisible()
  const submittedVersions: number[] = []
  await page.route('**/api/v1/settings', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { version: number }
      submittedVersions.push(body.version)
    }
    await route.continue()
  })

  const concurrent = await request.patch(`${runtime.apiURL}/api/v1/settings`, {
    data: {
      theme: 'system',
      background: 'solid',
      accent: 'teal',
      density: 'comfortable',
      version: 1,
    },
  })
  expect(concurrent.ok()).toBe(true)

  await page.getByLabel('深色').check()
  await page.getByLabel('渐变').check()
  await page.getByLabel('紫色').check()
  await page.getByRole('button', { name: '保存外观设置' }).click()

  await expectFocusedAlert(page, 'Settings changed since they were read')
  await expect(page.getByLabel('深色')).toBeChecked()
  await expect(page.getByLabel('渐变')).toBeChecked()
  await expect(page.getByLabel('紫色')).toBeChecked()
  await expect(
    page.getByRole('status').filter({ hasText: '外观设置已保存' }),
  ).toHaveCount(0)

  await page.getByRole('button', { name: '保存外观设置' }).click()
  await expect(page.getByRole('status')).toContainText('外观设置已保存')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(submittedVersions).toEqual([1, 2])
})
