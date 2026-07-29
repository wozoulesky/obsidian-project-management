import { test, expect } from './real-runtime'

test('quick submit writes to SQLite and remains visible after reload', async ({
  page,
  runtime,
}) => {
  await page.goto(new URL('/dashboard', runtime.baseURL).href)
  await page.getByRole('button', { name: '快速提交' }).click()
  const dialog = page.getByRole('dialog', { name: '快速提交' })
  await dialog
    .getByLabel('负责人')
    .selectOption({ label: runtime.seed.agentName })
  await dialog
    .getByLabel('任务')
    .selectOption({ label: runtime.seed.taskTitle })
  await dialog.getByRole('spinbutton', { name: '进度', exact: true }).fill('80')
  await dialog.getByLabel('状态').selectOption('in_progress')
  await dialog.getByLabel('进度备注').fill('真实 E2E 持久化验证')
  await dialog.getByRole('button', { name: '提交进度' }).click()
  await expect(page.getByRole('status')).toContainText('已更新至 80%')

  await page.reload()
  await page.goto(new URL('/tasks', runtime.baseURL).href)
  await expect(
    page.getByRole('progressbar', {
      name: `${runtime.seed.taskTitle}进度 80%`,
    }),
  ).toHaveAttribute('aria-valuenow', '80')
})
