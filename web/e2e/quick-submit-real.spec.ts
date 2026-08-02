import { test, expect } from './real-runtime'

test('quick submit writes to SQLite and remains visible after reload', async ({
  page,
  runtime,
}) => {
  await page.goto(new URL('/dashboard', runtime.baseURL).href)
  const workspaceSelector = page.getByRole('combobox', {
    name: '选择当前工作区',
  })
  await workspaceSelector.selectOption(runtime.seed.defaultProjectId)
  await expect(workspaceSelector).toHaveValue(runtime.seed.defaultProjectId)
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
  const successStatus = page.getByRole('status').filter({
    hasText: '已更新至 80%',
  })
  await expect(successStatus).toHaveCount(1)
  await expect(successStatus).toContainText('已更新至 80%')

  await page.reload()
  await page.goto(new URL('/tasks', runtime.baseURL).href)
  await expect(workspaceSelector).toHaveValue(runtime.seed.defaultProjectId)
  await page.getByRole('button', {
    name: `查看 ${runtime.seed.taskTitle}`,
  }).click()
  const taskContext = page.getByRole('region', { name: '智能任务上下文' })
  await expect(
    taskContext.getByRole('heading', { name: runtime.seed.taskTitle }),
  ).toBeVisible()
  await expect(
    taskContext.getByRole('spinbutton', { name: '任务进度' }),
  ).toHaveValue('80')
})
