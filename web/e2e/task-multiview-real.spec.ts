import { randomUUID } from 'node:crypto'
import type {
  APIRequestContext,
  Page,
  Route,
} from '@playwright/test'

import { expect, test as realTest } from './real-runtime'

type ApiEnvelope<Data> = {
  data: Data
  error: null
  meta: { request_id: string }
}

type CreatedActor = {
  id: string
  name: string
  status: 'active' | 'inactive'
  version: number
}

type CreatedProject = {
  id: string
  name: string
  version: number
}

type CreatedTask = {
  code: string
  id: string
  progress: number
  projectId: string
  status: 'not_started' | 'in_progress' | 'done' | 'overdue'
  title: string
  version: number
}

type Runtime = {
  apiURL: string
  baseURL: string
}

type DisposableWorkspace = {
  actor: CreatedActor
  project: CreatedProject
}

type WorkspaceFixtures = {
  disposableWorkspace: DisposableWorkspace
}

function uniqueLabel(label: string): string {
  return `${label} ${randomUUID().slice(0, 8)}`
}

async function createActor(
  request: APIRequestContext,
  runtime: Runtime,
): Promise<CreatedActor> {
  const response = await request.post(`${runtime.apiURL}/api/v1/actors`, {
    data: {
      name: uniqueLabel('Task E2E owner'),
      role: 'owner',
      capabilities: ['planning', 'delivery'],
    },
  })
  expect(response.status()).toBe(201)
  const envelope = await response.json() as ApiEnvelope<CreatedActor>
  expect(envelope.error).toBeNull()
  return envelope.data
}

async function createProject(
  request: APIRequestContext,
  runtime: Runtime,
  actor: CreatedActor,
): Promise<CreatedProject> {
  const response = await request.post(`${runtime.apiURL}/api/v1/projects`, {
    data: {
      name: uniqueLabel('Task multiview'),
      description: 'Disposable real browser task multiview workspace',
      ownerId: actor.id,
      startDate: '2026-08-03',
      dueDate: '2026-08-31',
    },
  })
  expect(response.status()).toBe(201)
  const envelope = await response.json() as ApiEnvelope<CreatedProject>
  expect(envelope.error).toBeNull()
  return envelope.data
}

async function deactivateActor(
  request: APIRequestContext,
  runtime: Runtime,
  actor: CreatedActor,
): Promise<void> {
  const actorURL = `${runtime.apiURL}/api/v1/actors/${encodeURIComponent(actor.id)}`
  const current = await request.get(actorURL)
  expect(current.status()).toBe(200)
  const currentEnvelope = await current.json() as ApiEnvelope<CreatedActor>
  if (currentEnvelope.data.status === 'inactive') return

  const response = await request.post(`${actorURL}/deactivate`, {
    data: { version: currentEnvelope.data.version },
  })
  expect(response.status()).toBe(200)
  const envelope = await response.json() as ApiEnvelope<CreatedActor>
  expect(envelope.data.status).toBe('inactive')
}

async function permanentlyDeleteProject(
  request: APIRequestContext,
  runtime: Runtime,
  project: CreatedProject,
): Promise<void> {
  const projectURL = `${runtime.apiURL}/api/v1/projects/${encodeURIComponent(project.id)}`
  const current = await request.get(projectURL)
  if (current.status() === 404) return
  expect(current.status()).toBe(200)
  const currentEnvelope = await current.json() as ApiEnvelope<CreatedProject>

  const deletion = await request.delete(projectURL, {
    data: { version: currentEnvelope.data.version },
  })
  expect(deletion.status()).toBe(200)
  const deletionEnvelope = await deletion.json() as ApiEnvelope<{
    id: string
    name: string
  }>
  expect(deletionEnvelope.data).toMatchObject({
    id: project.id,
    name: project.name,
  })
  expect((await request.get(projectURL)).status()).toBe(404)
}

const test = realTest.extend<WorkspaceFixtures>({
  disposableWorkspace: async ({ request, runtime }, provide) => {
    const actor = await createActor(request, runtime)
    let project: CreatedProject | undefined
    let journeyError: unknown
    let cleanupError: unknown
    try {
      project = await createProject(request, runtime, actor)
      await provide({ actor, project })
    } catch (error) {
      journeyError = error
    } finally {
      if (project !== undefined) {
        try {
          await permanentlyDeleteProject(request, runtime, project)
        } catch (error) {
          cleanupError = error
        }
      }
      try {
        await deactivateActor(request, runtime, actor)
      } catch (error) {
        cleanupError ??= error
      }
    }

    if (journeyError !== undefined) {
      if (journeyError instanceof Error && cleanupError !== undefined) {
        Object.assign(journeyError, { cleanupError })
      }
      throw journeyError
    }
    if (cleanupError !== undefined) throw cleanupError
  },
})

async function createInProgressTask(
  request: APIRequestContext,
  runtime: Runtime,
  workspace: DisposableWorkspace,
  label: string,
  progress = 37,
): Promise<CreatedTask> {
  const title = uniqueLabel(label)
  const response = await request.post(
    `${runtime.apiURL}/api/v1/projects/${encodeURIComponent(workspace.project.id)}/tasks`,
    {
      data: {
        title,
        description: `Real task workflow for ${title}`,
        assigneeId: workspace.actor.id,
        startDate: '2026-08-03',
        dueDate: '2026-08-28',
        priority: 'P1',
      },
    },
  )
  expect(response.status()).toBe(201)
  const createdEnvelope = await response.json() as ApiEnvelope<CreatedTask>
  expect(createdEnvelope.error).toBeNull()

  const taskURL = `${runtime.apiURL}/api/v1/tasks/${encodeURIComponent(createdEnvelope.data.id)}`
  const update = await request.patch(taskURL, {
    data: {
      status: 'in_progress',
      progress,
      version: createdEnvelope.data.version,
    },
  })
  expect(update.status()).toBe(200)
  const updatedEnvelope = await update.json() as ApiEnvelope<CreatedTask>
  expect(updatedEnvelope.data).toMatchObject({
    id: createdEnvelope.data.id,
    progress,
    projectId: workspace.project.id,
    status: 'in_progress',
    title,
  })
  expect(updatedEnvelope.data.version).toBeGreaterThan(
    createdEnvelope.data.version,
  )
  return updatedEnvelope.data
}

async function getTask(
  request: APIRequestContext,
  runtime: Runtime,
  taskId: string,
): Promise<CreatedTask> {
  const response = await request.get(
    `${runtime.apiURL}/api/v1/tasks/${encodeURIComponent(taskId)}`,
  )
  expect(response.status()).toBe(200)
  const envelope = await response.json() as ApiEnvelope<CreatedTask>
  expect(envelope.error).toBeNull()
  return envelope.data
}

async function openTaskWorkspace(
  page: Page,
  runtime: Runtime,
  project: CreatedProject,
  search = '',
): Promise<void> {
  await page.goto(new URL(`/tasks${search}`, runtime.baseURL).href)
  const workspaceSelector = page.getByRole('combobox', {
    name: '选择当前工作区',
  })
  await expect(
    workspaceSelector.getByRole('option', { name: project.name }),
  ).toBeAttached()
  await workspaceSelector.selectOption(project.id)
  await expect(workspaceSelector).toHaveValue(project.id)
}

function progressResponseFor(page: Page, taskId: string) {
  const expectedPath = `/api/v1/tasks/${encodeURIComponent(taskId)}/progress`
  return page.waitForResponse((response) => {
    const request = response.request()
    return request.method() === 'POST'
      && new URL(request.url()).pathname === expectedPath
  })
}

async function dragTaskToDone(page: Page, task: CreatedTask): Promise<void> {
  const dragHandle = page.getByRole('button', {
    name: `拖拽 ${task.title}`,
  })
  const doneColumn = page.getByRole('region', { name: '已完成任务列' })
  await dragHandle.scrollIntoViewIfNeeded()
  const handleBox = await dragHandle.boundingBox()
  const columnBox = await doneColumn.boundingBox()
  expect(handleBox).not.toBeNull()
  expect(columnBox).not.toBeNull()
  if (handleBox === null || columnBox === null) return

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 8,
    handleBox.y + handleBox.height / 2 + 8,
    { steps: 3 },
  )
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + Math.min(120, columnBox.height / 2),
    { steps: 12 },
  )
  await page.mouse.up()
}

function expectTaskURLState(
  page: Page,
  expected: Record<string, string>,
) {
  return expect.poll(() => {
    const params = new URL(page.url()).searchParams
    return Object.fromEntries(
      Object.keys(expected).map((key) => [key, params.get(key)]),
    )
  }).toEqual(expected)
}

test('persists a pointer drag into the completed column', async ({
  disposableWorkspace,
  page,
  request,
  runtime,
}) => {
  const first = await createInProgressTask(
    request,
    runtime,
    disposableWorkspace,
    'Drag first',
    42,
  )
  await createInProgressTask(
    request,
    runtime,
    disposableWorkspace,
    'Drag second',
    18,
  )
  await openTaskWorkspace(
    page,
    runtime,
    disposableWorkspace.project,
    '?view=board',
  )
  await expect(page.getByTestId(`task-board-card-${first.id}`)).toBeVisible()
  await expect(
    page.locator('.task-metric--done').getByTestId('metric-value'),
  ).toHaveText('0')

  const progressResponse = progressResponseFor(page, first.id)
  await dragTaskToDone(page, first)
  expect((await progressResponse).status()).toBe(200)

  const doneColumn = page.getByRole('region', { name: '已完成任务列' })
  const movedCard = doneColumn.getByTestId(`task-board-card-${first.id}`)
  await expect(movedCard).toContainText('100%')
  await expect(
    page.locator('.task-metric--done').getByTestId('metric-value'),
  ).toHaveText('1')
  const persisted = await getTask(request, runtime, first.id)
  expect(persisted).toMatchObject({ status: 'done', progress: 100 })
  expect(persisted.version).toBeGreaterThan(first.version)

  await page.reload()
  await expect(
    page.getByRole('region', { name: '已完成任务列' })
      .getByTestId(`task-board-card-${first.id}`),
  ).toContainText('100%')
})

test('persists the second task through its keyboard move control', async ({
  disposableWorkspace,
  page,
  request,
  runtime,
}) => {
  await createInProgressTask(
    request,
    runtime,
    disposableWorkspace,
    'Keyboard first',
    24,
  )
  const second = await createInProgressTask(
    request,
    runtime,
    disposableWorkspace,
    'Keyboard second',
    63,
  )
  await openTaskWorkspace(
    page,
    runtime,
    disposableWorkspace.project,
    '?view=board',
  )
  const moveControl = page.getByRole('combobox', {
    name: `移动 ${second.title} 到`,
  })
  await expect(moveControl).toHaveValue('in_progress')

  const progressResponse = progressResponseFor(page, second.id)
  await moveControl.focus()
  await moveControl.press('ArrowDown')
  expect((await progressResponse).status()).toBe(200)

  await expect(
    page.getByRole('region', { name: '已完成任务列' })
      .getByTestId(`task-board-card-${second.id}`),
  ).toContainText('100%')
  const persisted = await getTask(request, runtime, second.id)
  expect(persisted).toMatchObject({ status: 'done', progress: 100 })
  expect(persisted.version).toBeGreaterThan(second.version)
})

test('preserves filters, selection, and one context across all views', async ({
  disposableWorkspace,
  page,
  request,
  runtime,
}) => {
  const task = await createInProgressTask(
    request,
    runtime,
    disposableWorkspace,
    'Cross view shared',
    55,
  )
  const keyword = task.title.split(' ').at(-1)!
  await openTaskWorkspace(page, runtime, disposableWorkspace.project)

  const filters = page.getByRole('region', { name: '任务筛选' })
  await filters.getByRole('searchbox', { name: '搜索任务' }).fill(keyword)
  await filters.getByRole('combobox', {
    name: '状态',
    exact: true,
  }).selectOption('in_progress')
  await page.getByRole('button', { name: `查看 ${task.title}` }).click()
  await expectTaskURLState(page, {
    q: keyword,
    status: 'in_progress',
    selected: task.id,
  })

  const assertSharedContext = async () => {
    const contexts = page.locator('.task-context')
    await expect(contexts).toHaveCount(1)
    await expect(
      contexts.getByRole('heading', { level: 2, name: task.title }),
    ).toHaveCount(1)
  }
  await assertSharedContext()

  const viewSwitch = page.getByRole('group', { name: '任务视图' })
  await viewSwitch.getByRole('button', { name: '看板' }).click()
  await expectTaskURLState(page, {
    q: keyword,
    status: 'in_progress',
    selected: task.id,
    view: 'board',
  })
  await expect(page.getByTestId(`task-board-card-${task.id}`)).toBeVisible()
  await assertSharedContext()

  await viewSwitch.getByRole('button', { name: '时间线' }).click()
  await expectTaskURLState(page, {
    q: keyword,
    status: 'in_progress',
    selected: task.id,
    view: 'timeline',
  })
  await expect(
    page.getByRole('button', { name: `选择 ${task.code} ${task.title}` }),
  ).toBeVisible()
  await assertSharedContext()
})

test('rolls an optimistic move back after a targeted version conflict', async ({
  disposableWorkspace,
  page,
  request,
  runtime,
}) => {
  const task = await createInProgressTask(
    request,
    runtime,
    disposableWorkspace,
    'Rollback target',
    37,
  )
  await openTaskWorkspace(
    page,
    runtime,
    disposableWorkspace.project,
    '?view=board',
  )

  const progressPath = `/api/v1/tasks/${encodeURIComponent(task.id)}/progress`
  let intercepted = false
  const rejectTargetProgress = async (route: Route) => {
    const request = route.request()
    if (
      intercepted
      || request.method() !== 'POST'
      || new URL(request.url()).pathname !== progressPath
    ) {
      await route.continue()
      return
    }
    intercepted = true
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        error: {
          code: 'TASK_VERSION_CONFLICT',
          message: 'Task version is stale',
          details: { taskId: task.id },
        },
        meta: { request_id: `e2e-task-conflict-${task.id}` },
      }),
    })
  }

  try {
    await page.route('**/api/v1/tasks/*/progress', rejectTargetProgress)
    await page.getByRole('combobox', {
      name: `移动 ${task.title} 到`,
    }).selectOption('done')

    await expect(page.getByRole('status').filter({
      hasText: `移动 ${task.title} 失败，任务已恢复到原状态`,
    })).toContainText(`移动 ${task.title} 失败，任务已恢复到原状态`)
    expect(intercepted).toBe(true)
    const originalColumn = page.getByRole('region', { name: '进行中任务列' })
    const restoredCard = originalColumn.getByTestId(
      `task-board-card-${task.id}`,
    )
    await expect(restoredCard).toContainText('37%')
    await expect(
      page.getByRole('region', { name: '已完成任务列' })
        .getByTestId(`task-board-card-${task.id}`),
    ).toHaveCount(0)

    const persisted = await getTask(request, runtime, task.id)
    expect(persisted).toMatchObject({
      status: 'in_progress',
      progress: 37,
      version: task.version,
    })
  } finally {
    await page.unroute('**/api/v1/tasks/*/progress', rejectTargetProgress)
  }
})
