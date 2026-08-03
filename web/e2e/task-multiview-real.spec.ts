import { randomUUID } from 'node:crypto'
import type {
  APIRequestContext,
  APIResponse,
  Page,
  Route,
} from '@playwright/test'

import { expect, test as realTest } from './real-runtime'

type ApiEnvelope<Data> = {
  data: Data
  error: null
  meta: { request_id: string }
}

type SeedActor = {
  id: string
  name: string
  status: 'active'
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
  seed: {
    ownerId: string
  }
}

type DisposableWorkspace = {
  actorId: string
  cleanup: ProjectCleanupRegistry
  project: CreatedProject
}

type ProjectCleanupCandidate = {
  id?: string
  name: string
}

type ProjectCleanupRegistry = {
  candidates: ProjectCleanupCandidate[]
  register: (name: string) => ProjectCleanupCandidate
}

type WorkspaceFixtures = {
  disposableWorkspace: DisposableWorkspace
}

type CreateProjectOptions = {
  name?: string
  validate?: (project: CreatedProject) => void
}

type CleanupOptions = {
  deleteRequest?: (
    projectURL: string,
    version: number,
  ) => Promise<APIResponse>
}

function uniqueLabel(label: string): string {
  return `${label} ${randomUUID().slice(0, 8)}`
}

function createProjectCleanupRegistry(): ProjectCleanupRegistry {
  const candidates: ProjectCleanupCandidate[] = []
  return {
    candidates,
    register(name) {
      const candidate = { name }
      candidates.push(candidate)
      return candidate
    },
  }
}

async function getSeedOwner(
  request: APIRequestContext,
  runtime: Runtime,
): Promise<SeedActor> {
  const response = await request.get(
    `${runtime.apiURL}/api/v1/actors/${encodeURIComponent(runtime.seed.ownerId)}`,
  )
  expect(response.status()).toBe(200)
  const envelope = await response.json() as ApiEnvelope<SeedActor>
  expect(envelope.error).toBeNull()
  expect(envelope.data).toMatchObject({
    id: runtime.seed.ownerId,
    status: 'active',
  })
  return envelope.data
}

async function createProject(
  request: APIRequestContext,
  runtime: Runtime,
  ownerId: string,
  cleanup: ProjectCleanupRegistry,
  options: CreateProjectOptions = {},
): Promise<CreatedProject> {
  const name = options.name ?? uniqueLabel('Task multiview')
  const candidate = cleanup.register(name)
  const response = await request.post(`${runtime.apiURL}/api/v1/projects`, {
    data: {
      name,
      description: 'Disposable real browser task multiview workspace',
      ownerId,
      startDate: '2026-08-03',
      dueDate: '2026-08-31',
    },
  })
  const envelope = await response.json() as ApiEnvelope<CreatedProject>
  if (typeof envelope.data?.id === 'string') {
    candidate.id = envelope.data.id
  }
  expect(response.status()).toBe(201)
  expect(envelope.error).toBeNull()
  expect(envelope.data).toMatchObject({ name, ownerId })
  options.validate?.(envelope.data)
  return envelope.data
}

async function findProjectIdsByName(
  request: APIRequestContext,
  runtime: Runtime,
  name: string,
): Promise<string[]> {
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const projectsURL = new URL('/api/v1/projects', runtime.apiURL)
    projectsURL.searchParams.set('limit', '200')
    if (cursor !== null) projectsURL.searchParams.set('cursor', cursor)
    const response = await request.get(projectsURL.href)
    if (response.status() !== 200) {
      throw new Error(
        `Project cleanup discovery failed with ${response.status()} for ${name}`,
      )
    }
    const envelope = await response.json() as ApiEnvelope<{
      items: CreatedProject[]
      next_cursor: string | null
    }>
    for (const project of envelope.data.items) {
      if (project.name === name) ids.push(project.id)
    }
    cursor = envelope.data.next_cursor
  } while (cursor !== null)
  return ids
}

async function deleteProjectWithRetry(
  request: APIRequestContext,
  runtime: Runtime,
  projectId: string,
  deleteRequest: NonNullable<CleanupOptions['deleteRequest']>,
): Promise<void> {
  const projectURL = `${runtime.apiURL}/api/v1/projects/${encodeURIComponent(projectId)}`
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const current = await request.get(projectURL)
      if (current.status() === 404) return
      if (current.status() !== 200) {
        throw new Error(
          `Project cleanup read failed with ${current.status()} for ${projectId}`,
        )
      }
      const currentEnvelope = await current.json() as ApiEnvelope<CreatedProject>
      const deletion = await deleteRequest(
        projectURL,
        currentEnvelope.data.version,
      )
      if (deletion.status() !== 200 && deletion.status() !== 404) {
        throw new Error(
          `Project cleanup delete failed with ${deletion.status()} for ${projectId}`,
        )
      }
      const verification = await request.get(projectURL)
      if (verification.status() !== 404) {
        throw new Error(
          `Project cleanup verification returned ${verification.status()} for ${projectId}`,
        )
      }
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function cleanupRegisteredProjects(
  request: APIRequestContext,
  runtime: Runtime,
  registry: ProjectCleanupRegistry,
  options: CleanupOptions = {},
): Promise<void> {
  const failures: unknown[] = []
  const deleteRequest = options.deleteRequest ?? (
    (projectURL: string, version: number) => request.delete(projectURL, {
      data: { version },
    })
  )
  for (const candidate of registry.candidates) {
    const projectIds = new Set<string>()
    if (candidate.id !== undefined) projectIds.add(candidate.id)
    try {
      for (const projectId of await findProjectIdsByName(
        request,
        runtime,
        candidate.name,
      )) {
        projectIds.add(projectId)
      }
    } catch (error) {
      failures.push(error)
    }
    for (const projectId of projectIds) {
      try {
        await deleteProjectWithRetry(
          request,
          runtime,
          projectId,
          deleteRequest,
        )
      } catch (error) {
        failures.push(error)
      }
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Task E2E project cleanup failed')
  }
}

const test = realTest.extend<WorkspaceFixtures>({
  disposableWorkspace: async ({ request, runtime }, provide) => {
    const registry = createProjectCleanupRegistry()
    let journeyError: unknown
    let cleanupError: unknown
    try {
      const actor = await getSeedOwner(request, runtime)
      const project = await createProject(
        request,
        runtime,
        actor.id,
        registry,
      )
      await provide({ actorId: actor.id, cleanup: registry, project })
    } catch (error) {
      journeyError = error
    } finally {
      try {
        await cleanupRegisteredProjects(request, runtime, registry)
      } catch (error) {
        cleanupError = error
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
        assigneeId: workspace.actorId,
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

async function updateTaskState(
  request: APIRequestContext,
  runtime: Runtime,
  task: CreatedTask,
  status: CreatedTask['status'],
  progress: number,
): Promise<CreatedTask> {
  const response = await request.patch(
    `${runtime.apiURL}/api/v1/tasks/${encodeURIComponent(task.id)}`,
    {
      data: {
        progress,
        status,
        version: task.version,
      },
    },
  )
  expect(response.status()).toBe(200)
  const envelope = await response.json() as ApiEnvelope<CreatedTask>
  expect(envelope.data).toMatchObject({
    id: task.id,
    progress,
    status,
  })
  expect(envelope.data.version).toBeGreaterThan(task.version)
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
  const queryNegative = await createInProgressTask(
    request,
    runtime,
    disposableWorkspace,
    'Different query control',
    46,
  )
  const statusNegative = await updateTaskState(
    request,
    runtime,
    await createInProgressTask(
      request,
      runtime,
      disposableWorkspace,
      `Status control ${keyword}`,
      82,
    ),
    'done',
    100,
  )
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
  const assertFilteredStage = async () => {
    const stage = page.getByTestId('task-view-stage')
    await expect(
      stage.getByText(task.title, { exact: true }).first(),
    ).toBeVisible()
    await expect(
      stage.getByText(queryNegative.title, { exact: true }),
    ).toHaveCount(0)
    await expect(
      stage.getByText(statusNegative.title, { exact: true }),
    ).toHaveCount(0)
  }
  await assertFilteredStage()
  await assertSharedContext()

  const viewSwitch = page.getByRole('group', { name: '任务视图' })
  await viewSwitch.getByRole('button', { name: '看板' }).click()
  await expectTaskURLState(page, {
    q: keyword,
    status: 'in_progress',
    selected: task.id,
    view: 'board',
  })
  await assertFilteredStage()
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
  await assertFilteredStage()
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

test('compensates when client validation fails after project creation', async ({
  disposableWorkspace,
  request,
  runtime,
}) => {
  const projectCleanup = disposableWorkspace.cleanup
  let createdId: string | undefined
  const partialName = uniqueLabel('Partial project')
  await expect(createProject(
    request,
    runtime,
    disposableWorkspace.actorId,
    projectCleanup,
    {
      name: partialName,
      validate(project: CreatedProject) {
        createdId = project.id
        throw new Error('Injected client validation failure')
      },
    },
  )).rejects.toThrow('Injected client validation failure')
  expect(createdId).toBeDefined()
  const partialCandidate = projectCleanup.candidates.find(
    ({ name }) => name === partialName,
  )
  expect(partialCandidate?.id).toBe(createdId)
  delete partialCandidate!.id
  let injectedFailure = false
  let partialDeleteAttempts = 0
  let blockedCandidateAttempts = 0
  await expect(cleanupRegisteredProjects(request, runtime, projectCleanup, {
    deleteRequest: async (projectURL, version) => {
      if (projectURL.endsWith(
        `/${encodeURIComponent(disposableWorkspace.project.id)}`,
      )) {
        blockedCandidateAttempts += 1
        throw new Error('Injected permanent cleanup transport failure')
      }
      if (projectURL.endsWith(`/${encodeURIComponent(createdId!)}`)) {
        partialDeleteAttempts += 1
        if (!injectedFailure) {
          injectedFailure = true
          throw new Error('Injected cleanup transport failure')
        }
      }
      return request.delete(projectURL, { data: { version } })
    },
  })).rejects.toThrow('Task E2E project cleanup failed')
  expect(injectedFailure).toBe(true)
  expect(partialDeleteAttempts).toBe(2)
  expect(blockedCandidateAttempts).toBe(2)
  expect((await request.get(
    `${runtime.apiURL}/api/v1/projects/${encodeURIComponent(createdId!)}`,
  )).status()).toBe(404)
  expect((await request.get(
    `${runtime.apiURL}/api/v1/projects/${encodeURIComponent(disposableWorkspace.project.id)}`,
  )).status()).toBe(200)

  await cleanupRegisteredProjects(request, runtime, projectCleanup)
  expect((await request.get(
    `${runtime.apiURL}/api/v1/projects/${encodeURIComponent(disposableWorkspace.project.id)}`,
  )).status()).toBe(404)
})
