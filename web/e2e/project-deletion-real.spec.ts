import { randomUUID } from 'node:crypto'
import type { APIRequestContext, Route } from '@playwright/test'

import { expect, test } from './real-runtime'

type ApiEnvelope<Data> = {
  data: Data
  error: null
  meta: { request_id: string }
}

type CreatedProject = {
  id: string
  name: string
  version: number
}

type CreatedTask = {
  id: string
}

type Activity = {
  action: string
  entityId: string
  note?: string
  operation: string
  projectId?: string | null
}

type Runtime = {
  apiURL: string
  seed: {
    ownerId: string
  }
}

function uniqueName(label: string): string {
  return `Deletion ${label} ${randomUUID().slice(0, 8)}`
}

async function createProject(
  request: APIRequestContext,
  runtime: Runtime,
  label: string,
): Promise<CreatedProject> {
  const name = uniqueName(label)
  const response = await request.post(`${runtime.apiURL}/api/v1/projects`, {
    data: {
      name,
      description: 'Real browser permanent deletion acceptance project',
      ownerId: runtime.seed.ownerId,
      startDate: '2026-08-03',
      dueDate: '2026-08-31',
    },
  })
  expect(response.status()).toBe(201)
  const envelope = await response.json() as ApiEnvelope<CreatedProject>
  expect(envelope.error).toBeNull()
  return envelope.data
}

async function createProjectTask(
  request: APIRequestContext,
  runtime: Runtime,
  project: CreatedProject,
): Promise<CreatedTask> {
  const response = await request.post(
    `${runtime.apiURL}/api/v1/projects/${encodeURIComponent(project.id)}/tasks`,
    {
      data: {
        title: `Deletion child ${randomUUID().slice(0, 8)}`,
        description: 'Must be removed by project cascade deletion',
        assigneeId: runtime.seed.ownerId,
        startDate: '2026-08-03',
        dueDate: '2026-08-04',
        priority: 'P1',
      },
    },
  )
  expect(response.status()).toBe(201)
  const envelope = await response.json() as ApiEnvelope<CreatedTask>
  expect(envelope.error).toBeNull()
  return envelope.data
}

test('permanently deletes a project and its tasks while retaining the audit', async ({
  page,
  request,
  runtime,
}) => {
  const project = await createProject(request, runtime, 'success')
  const task = await createProjectTask(request, runtime, project)

  await page.goto(
    new URL(`/projects/${encodeURIComponent(project.id)}`, runtime.baseURL).href,
  )
  await expect(
    page.getByRole('heading', { level: 1, name: project.name }),
  ).toBeVisible()
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '删除项目', exact: true }).click()

  const dialog = page.getByRole('dialog', {
    name: `永久删除项目 ${project.name}`,
  })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('此操作永久不可恢复')
  await expect(dialog).toContainText('项目任务、成员关系、交接记录和交付物')
  await dialog.getByLabel(`输入 ${project.name} 以确认`).fill(project.name)
  await dialog.getByRole('button', {
    name: '永久删除项目',
    exact: true,
  }).click()

  await expect(page).toHaveURL(new URL('/projects', runtime.baseURL).href)
  const successStatus = page.getByRole('status').filter({
    hasText: `已永久删除项目 ${project.name}`,
  })
  await expect(successStatus).toHaveCount(1)
  await expect(successStatus).toHaveText(`已永久删除项目 ${project.name}`)

  const deletedProject = await fetch(
    `${runtime.apiURL}/api/v1/projects/${encodeURIComponent(project.id)}`,
  )
  expect(deletedProject.status).toBe(404)
  const deletedTask = await fetch(
    `${runtime.apiURL}/api/v1/tasks/${encodeURIComponent(task.id)}`,
  )
  expect(deletedTask.status).toBe(404)

  const activitiesURL = new URL('/api/v1/activities', runtime.apiURL)
  activitiesURL.searchParams.set('entity_id', project.id)
  activitiesURL.searchParams.set('limit', '200')
  const activitiesResponse = await fetch(activitiesURL)
  expect(activitiesResponse.ok).toBe(true)
  const activitiesEnvelope = await activitiesResponse.json() as ApiEnvelope<{
    items: Activity[]
    next_cursor: string | null
  }>
  const audit = activitiesEnvelope.data.items.find(
    (activity) => activity.operation === 'project.delete',
  )
  expect(audit).toMatchObject({
    operation: 'project.delete',
    projectId: null,
    entityId: project.id,
  })
  expect(audit?.action).toContain(project.name)
  expect(audit?.note).toBeDefined()
  const note = JSON.parse(audit!.note!) as {
    projectId: string
    projectName: string
    counts: Record<string, number>
  }
  expect(note).toMatchObject({
    projectId: project.id,
    projectName: project.name,
  })
  expect(note.counts.tasks).toBeGreaterThanOrEqual(1)
  expect(note.counts.project_members).toBeGreaterThanOrEqual(1)
})

test('protects the default project without opening permanent deletion', async ({
  page,
  runtime,
}) => {
  await page.goto(
    new URL(`/projects/${runtime.seed.defaultProjectId}`, runtime.baseURL).href,
  )
  await expect(
    page.getByRole('heading', { level: 1, name: 'Default Project' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '更多操作' }).click()

  const menu = page.getByRole('menu')
  await expect(
    menu.getByRole('menuitem', { name: '默认项目受保护，无法删除' }),
  ).toBeVisible()
  await expect(
    menu.getByRole('menuitem', { name: '删除项目', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('dialog', { name: /永久删除项目/ }),
  ).toHaveCount(0)
})

test('keeps the dialog open when project deletion reports a version conflict', async ({
  page,
  request,
  runtime,
}) => {
  const project = await createProject(request, runtime, 'conflict')
  await page.goto(
    new URL(`/projects/${encodeURIComponent(project.id)}`, runtime.baseURL).href,
  )
  await expect(
    page.getByRole('heading', { level: 1, name: project.name }),
  ).toBeVisible()
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '删除项目', exact: true }).click()

  const dialog = page.getByRole('dialog', {
    name: `永久删除项目 ${project.name}`,
  })
  const confirmation = dialog.getByLabel(`输入 ${project.name} 以确认`)
  await confirmation.fill(project.name)

  const projectRoute = `**/api/v1/projects/${project.id}`
  let interceptedDelete = false
  const rejectDeleteOnce = async (route: Route) => {
    if (route.request().method() !== 'DELETE' || interceptedDelete) {
      await route.continue()
      return
    }
    interceptedDelete = true
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        data: null,
        error: {
          code: 'PROJECT_VERSION_CONFLICT',
          message: 'Project version is stale',
          details: { projectId: project.id },
        },
        meta: { request_id: `e2e-project-conflict-${project.id}` },
      }),
    })
  }
  await page.route(projectRoute, rejectDeleteOnce)
  await dialog.getByRole('button', {
    name: '永久删除项目',
    exact: true,
  }).click()

  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('alert'),
  ).toHaveText('项目已被修改，请刷新后重新确认。')
  await expect(confirmation).toHaveValue(project.name)
  expect(interceptedDelete).toBe(true)
  await page.unroute(projectRoute, rejectDeleteOnce)

  const retainedProject = await fetch(
    `${runtime.apiURL}/api/v1/projects/${encodeURIComponent(project.id)}`,
  )
  expect(retainedProject.status).toBe(200)
  const retainedEnvelope = await retainedProject.json() as ApiEnvelope<CreatedProject>
  expect(retainedEnvelope.data).toMatchObject({
    id: project.id,
    name: project.name,
  })
})
