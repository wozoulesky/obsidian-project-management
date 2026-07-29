import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  dashboardSnapshotSchema,
  persistedActivitySchema,
  persistedDefectSchema,
  persistedRequirementSchema,
  persistedTaskSchema,
} from '@project-os/contracts'
import {
  ActivityService,
  DashboardService,
  DefectService,
  RequirementService,
  seedDatabase,
} from '@project-os/core'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import {
  createAppContext,
  defaultSeedDocument,
  type AppContext,
} from '../context.js'

const contexts: AppContext[] = []
const directories: string[] = []

function createContext(): AppContext {
  const directory = mkdtempSync(join(tmpdir(), 'project-os-remaining-routes-'))
  const context = createAppContext({
    databasePath: join(directory, 'test.db'),
    backupRoot: join(directory, 'backups'),
  })
  directories.push(directory)
  contexts.push(context)
  seedDatabase(context.database, defaultSeedDocument)
  return context
}

function createApi(context = createContext()) {
  return {
    context,
    api: request(createApp({ context })),
  }
}

async function createRequirement(
  api: ReturnType<typeof request>,
  projectId = defaultSeedDocument.projects[0]!.id,
  title = 'Ship REST',
) {
  const response = await api.post('/api/v1/requirements').send({
    projectId,
    title,
    description: 'Expose requirements',
    priority: 'P1',
    acceptanceCriteria: ['CRUD works'],
  }).expect(201)
  return persistedRequirementSchema.parse(response.body.data)
}

async function createDefect(
  api: ReturnType<typeof request>,
  projectId = defaultSeedDocument.projects[0]!.id,
  title = 'Broken REST',
) {
  const response = await api.post('/api/v1/defects').send({
    projectId,
    title,
    description: 'Reproduce it',
    severity: 'serious',
    assigneeId: defaultSeedDocument.actors[0]!.id,
    reproductionSteps: ['Call endpoint'],
  }).expect(201)
  return persistedDefectSchema.parse(response.body.data)
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.close()
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

describe('requirement routes', () => {
  it('supports global and project-scoped create/list/get/update contracts', async () => {
    const { api } = createApi()
    const projectId = defaultSeedDocument.projects[0]!.id
    const first = await createRequirement(api, projectId, 'First')
    const scoped = await api.post(`/api/v1/projects/${projectId}/requirements`)
      .send({
        title: 'Second',
        priority: 'P2',
        status: 'reviewed',
        linkedTaskIds: [],
      }).expect(201)
    const listed = await api
      .get(`/api/v1/requirements?project_id=${projectId}&status=draft&limit=1`)
      .expect(200)
    const projectList = await api
      .get(`/api/v1/projects/${projectId}/requirements?limit=50`)
      .expect(200)
    const fetched = await api
      .get(`/api/v1/requirements/${first.id}`)
      .expect(200)
    const updated = await api.patch(`/api/v1/requirements/${first.id}`)
      .send({
        status: 'reviewed',
        acceptanceCriteria: ['Reviewed'],
        version: first.version,
      }).expect(200)

    expect(persistedRequirementSchema.parse(scoped.body.data).projectId)
      .toBe(projectId)
    expect(listed.body.data.items.map(
      ({ id }: { id: string }) => id,
    )).toEqual([first.id])
    expect(projectList.body.data.items).toHaveLength(2)
    expect(fetched.body.data.id).toBe(first.id)
    expect(updated.body.data).toMatchObject({
      status: 'reviewed',
      acceptanceCriteria: ['Reviewed'],
      version: 2,
    })
  })

  it('binds requirement cursors to scope/filter/anchor and rejects stale writes', async () => {
    const { api, context } = createApi()
    const projectId = defaultSeedDocument.projects[0]!.id
    const first = await createRequirement(api, projectId, 'First')
    const second = await createRequirement(api, projectId, 'Second')
    const page = await api
      .get(`/api/v1/requirements?project_id=${projectId}&limit=1`)
      .expect(200)
    const cursor = page.body.data.next_cursor as string
    const next = await api.get(
      `/api/v1/requirements?project_id=${projectId}&limit=1&cursor=${cursor}`,
    ).expect(200)
    expect(next.body.data.items.map(
      ({ id }: { id: string }) => id,
    )).toEqual([second.id])

    await api.get(
      `/api/v1/requirements?project_id=${projectId}&status=draft&limit=1&cursor=${cursor}`,
    ).expect(400)
    context.database.prepare('DELETE FROM requirements WHERE id = ?')
      .run(first.id)
    await api.get(
      `/api/v1/requirements?project_id=${projectId}&limit=1&cursor=${cursor}`,
    ).expect(400)
    await api.patch(`/api/v1/requirements/${second.id}`)
      .send({ title: 'Updated', version: second.version })
      .expect(200)
    const stale = await api.patch(`/api/v1/requirements/${second.id}`)
      .send({ title: 'Stale', version: second.version })
      .expect(409)
    expect(stale.body.error.code).toBe('REQUIREMENT_VERSION_CONFLICT')
  })

  it('rejects null, unknown, spoofed, repeated, and path project inputs', async () => {
    const { api } = createApi()
    const projectId = defaultSeedDocument.projects[0]!.id
    const bodies = [
      { projectId, title: null, priority: 'P1' },
      { projectId, title: 'Spoof', priority: 'P1', actorId: 'actor_fake' },
      { projectId, title: 'Spoof', priority: 'P1', source: 'mcp' },
    ]
    for (const body of bodies) {
      await api.post('/api/v1/requirements').send(body).expect(400)
    }
    await api.post(`/api/v1/projects/${projectId}/requirements`).send({
      projectId: 'project_spoofed',
      title: 'Spoof',
      priority: 'P1',
    }).expect(400)
    await api.get('/api/v1/requirements?status=draft&status=approved')
      .expect(400)
    await api.get('/api/v1/requirements?project_id=').expect(400)
    await api.get('/api/v1/requirements?unknown=1').expect(400)
  })
})

describe('defect routes', () => {
  it('supports CRUD filters and project-scoped routes', async () => {
    const { api } = createApi()
    const projectId = defaultSeedDocument.projects[0]!.id
    const first = await createDefect(api, projectId, 'First')
    await api.post(`/api/v1/projects/${projectId}/defects`).send({
      title: 'Second',
      severity: 'normal',
      assigneeId: defaultSeedDocument.actors[0]!.id,
    }).expect(201)
    const listed = await api.get(
      `/api/v1/defects?project_id=${projectId}&assignee_id=${first.assigneeId}&status=open&limit=1`,
    ).expect(200)
    const scoped = await api
      .get(`/api/v1/projects/${projectId}/defects`)
      .expect(200)
    const fetched = await api.get(`/api/v1/defects/${first.id}`).expect(200)
    const updated = await api.patch(`/api/v1/defects/${first.id}`).send({
      description: 'Fixed reproduction',
      version: first.version,
    }).expect(200)

    expect(listed.body.data.items).toHaveLength(1)
    const next = await api.get(
      `/api/v1/defects?project_id=${projectId}&assignee_id=${first.assigneeId}&status=open&limit=1&cursor=${listed.body.data.next_cursor}`,
    ).expect(200)
    expect(next.body.data.items).toHaveLength(1)
    expect(next.body.data.items[0].id).not.toBe(first.id)
    expect(scoped.body.data.items).toHaveLength(2)
    expect(fetched.body.data.id).toBe(first.id)
    expect(updated.body.data).toMatchObject({
      description: 'Fixed reproduction',
      version: 2,
    })
  })

  it('converts a defect to a task idempotently with a 200 response', async () => {
    const { api } = createApi()
    const defect = await createDefect(api)
    const body = {
      startDate: '2026-07-29',
      dueDate: '2026-08-02',
      priority: 'P0',
      version: defect.version,
    }
    const first = await api.post(`/api/v1/defects/${defect.id}/to-task`)
      .send(body).expect(200)
    const second = await api.post(`/api/v1/defects/${defect.id}/to-task`)
      .send(body).expect(200)

    expect(persistedTaskSchema.parse(first.body.data))
      .toEqual(persistedTaskSchema.parse(second.body.data))
  })

  it('rejects stale, null, impersonated, repeated, and mismatched defect inputs', async () => {
    const { api } = createApi()
    const projectId = defaultSeedDocument.projects[0]!.id
    const defect = await createDefect(api)
    await api.patch(`/api/v1/defects/${defect.id}`)
      .send({ status: 'fixing', version: defect.version })
      .expect(200)
    const stale = await api.patch(`/api/v1/defects/${defect.id}`)
      .send({ description: 'stale', version: defect.version })
      .expect(409)
    expect(stale.body.error.code).toBe('DEFECT_VERSION_CONFLICT')

    await api.post('/api/v1/defects').send({
      projectId,
      title: 'Null',
      severity: 'normal',
      assigneeId: null,
    }).expect(400)
    await api.post('/api/v1/defects').send({
      projectId,
      title: 'Spoof',
      severity: 'normal',
      assigneeId: defaultSeedDocument.actors[0]!.id,
      source: 'mcp',
    }).expect(400)
    await api.post(`/api/v1/projects/${projectId}/defects`).send({
      projectId: 'project_spoofed',
      title: 'Spoof',
      severity: 'normal',
      assigneeId: defaultSeedDocument.actors[0]!.id,
    }).expect(400)
    await api.get('/api/v1/defects?status=open&status=closed').expect(400)
    await api.get('/api/v1/defects?unknown=1').expect(400)
  })
})

describe('dashboard routes', () => {
  it('returns the shared dashboard contract with a sorted requested trend window', async () => {
    const { api, context } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const project = defaultSeedDocument.projects[0]!
    context.services.tasks.create({
      projectId: project.id,
      title: 'Trend task',
      assigneeId: owner.id,
      startDate: '2026-01-01',
      dueDate: '2026-07-29',
      priority: 'P1',
    }, owner.id, 'web')

    const response = await api.get(
      `/api/v1/dashboard?project_id=${project.id}&days=7&today=2026-07-29`,
    ).expect(200)
    const snapshot = dashboardSnapshotSchema.parse(response.body.data)

    expect(snapshot.trend).toHaveLength(7)
    expect(snapshot.trend[0]!.date).toBe('2026-07-23')
    expect(snapshot.trend.at(-1)!.date).toBe('2026-07-29')
    expect(snapshot.trend.map((point) => point.date))
      .toEqual([...snapshot.trend.map((point) => point.date)].sort())
  })

  it('validates days/today and reports missing projects', async () => {
    const { api } = createApi()
    for (const path of [
      '/api/v1/dashboard?days=8',
      '/api/v1/dashboard?days=7&days=30',
      '/api/v1/dashboard?today=2026-02-30',
    ]) {
      await api.get(path).expect(400)
    }
    const missing = await api
      .get('/api/v1/dashboard?project_id=project_missing')
      .expect(404)
    expect(missing.body.error.code).toBe('PROJECT_NOT_FOUND')
  })

  it('paginates overdue tasks with a filter-bound cursor', async () => {
    const { api, context } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const project = defaultSeedDocument.projects[0]!
    for (const title of ['Late one', 'Late two']) {
      context.services.tasks.create({
        projectId: project.id,
        title,
        assigneeId: owner.id,
        startDate: '2026-07-01',
        dueDate: '2026-07-20',
        priority: 'P1',
      }, owner.id, 'web')
    }
    const page = await api.get(
      `/api/v1/dashboard/overdue?project_id=${project.id}&today=2026-07-29&limit=1`,
    ).expect(200)
    expect(page.body.data.items).toHaveLength(1)
    expect(page.body.data.items[0].status).toBe('overdue')
    const cursor = page.body.data.next_cursor as string
    await api.get(
      `/api/v1/dashboard/overdue?project_id=${project.id}&today=2026-07-30&limit=1&cursor=${cursor}`,
    ).expect(400)
    const next = await api.get(
      `/api/v1/dashboard/overdue?project_id=${project.id}&today=2026-07-29&limit=1&cursor=${cursor}`,
    ).expect(200)
    expect(next.body.data.items).toHaveLength(1)
  })
})

describe('activity routes', () => {
  it('returns latest activities descending with no-store caching', async () => {
    const { api } = createApi()
    await createRequirement(api)
    await createDefect(api)
    const response = await api.get('/api/v1/activities?limit=2').expect(200)
    const items = response.body.data.items.map(
      (item: unknown) => persistedActivitySchema.parse(item),
    )

    expect(items).toHaveLength(2)
    expect(items[0]!.createdAt >= items[1]!.createdAt).toBe(true)
    expect(response.body.data.next_cursor).toBe(items.at(-1)!.id)
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('polls only newer MCP activities in ascending order and retains cursor when empty', async () => {
    const { api, context } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const project = defaultSeedDocument.projects[0]!
    context.services.tasks.create({
      projectId: project.id,
      title: 'MCP anchor',
      assigneeId: owner.id,
      startDate: '2026-07-29',
      dueDate: '2026-08-01',
      priority: 'P1',
    }, owner.id, 'mcp')
    const initial = await api.get(
      `/api/v1/activities?project_id=${project.id}&source=mcp&limit=1`,
    ).expect(200)
    const anchor = initial.body.data.items[0].id as string
    const task = context.services.tasks.create({
      projectId: project.id,
      title: 'MCP newer',
      assigneeId: owner.id,
      startDate: '2026-07-29',
      dueDate: '2026-08-01',
      priority: 'P1',
    }, owner.id, 'mcp')
    const polled = await api.get(
      `/api/v1/activities?after=${anchor}&project_id=${project.id}&source=mcp`,
    ).expect(200)
    expect(polled.body.data.items.map(
      ({ entityId }: { entityId: string }) => entityId,
    )).toEqual([task.id])
    const nextCursor = polled.body.data.next_cursor as string
    const empty = await api.get(
      `/api/v1/activities?after=${nextCursor}&project_id=${project.id}&source=mcp`,
    ).expect(200)
    expect(empty.body.data).toEqual({
      items: [],
      next_cursor: nextCursor,
    })
  })

  it('validates activity cursor/filter/limit and rejects spoofing', async () => {
    const { api } = createApi()
    const requirement = await createRequirement(api)
    const initial = await api.get(
      `/api/v1/activities?entity_id=${requirement.id}&limit=1`,
    ).expect(200)
    const anchor = initial.body.data.items[0].id as string
    for (const path of [
      '/api/v1/activities?after=activity_missing',
      `/api/v1/activities?after=${anchor}&source=mcp`,
      '/api/v1/activities?limit=201',
      '/api/v1/activities?limit=1&limit=2',
      '/api/v1/activities?unknown=1',
    ]) {
      await api.get(path).expect(400)
    }
  })
})

describe('remaining route boundaries', () => {
  it.each([
    [
      'requirement',
      () => vi.spyOn(RequirementService.prototype, 'list'),
      '/api/v1/requirements',
    ],
    [
      'defect',
      () => vi.spyOn(DefectService.prototype, 'list'),
      '/api/v1/defects',
    ],
    [
      'activity',
      () => vi.spyOn(ActivityService.prototype, 'list'),
      '/api/v1/activities',
    ],
    [
      'dashboard',
      () => vi.spyOn(DashboardService.prototype, 'snapshot'),
      '/api/v1/dashboard',
    ],
  ])('maps malformed %s service output to a sanitized 500', async (
    _name,
    installSpy,
    path,
  ) => {
    const { api } = createApi()
    installSpy().mockReturnValue([{ id: 'secret_broken' }] as never)
    const response = await api.get(path).expect(500)
    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    })
    expect(JSON.stringify(response.body)).not.toContain('secret_broken')
  })

  it('uses the restored database for requirement, defect, dashboard, and activity requests', async () => {
    const { api, context } = createApi()
    const backupPath = await context.services.backups.create('remaining.sqlite')
    const requirement = await createRequirement(api)
    await createDefect(api)
    context.services.backups.restore(backupPath)

    const requirements = await api.get('/api/v1/requirements').expect(200)
    const defects = await api.get('/api/v1/defects').expect(200)
    const dashboard = await api.get('/api/v1/dashboard').expect(200)
    const activities = await api.get('/api/v1/activities').expect(200)
    expect(requirements.body.data.items).toEqual([])
    expect(defects.body.data.items).toEqual([])
    expect(dashboard.body.data.metrics.totalRequirements).toBe(0)
    expect(activities.body.data.items.some(
      ({ entityId }: { entityId: string }) => entityId === requirement.id,
    )).toBe(false)
  })

  it('pushes limit plus one into SQL for 10k requirement and defect rows', async () => {
    const { api, context } = createApi()
    const projectId = defaultSeedDocument.projects[0]!.id
    const actorId = defaultSeedDocument.actors[0]!.id
    context.database.prepare(`
      WITH RECURSIVE numbers(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM numbers WHERE value < 10000
      )
      INSERT INTO requirements (
        id, code, project_id, title, description, priority, status,
        acceptance_criteria_json, created_at, updated_at, version
      )
      SELECT
        'requirement_bulk_' || value,
        printf('REQ-%05d', value),
        ?, 'Bulk', '', 'P1', 'draft', '[]',
        '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z', 1
      FROM numbers
    `).run(projectId)
    context.database.prepare(`
      WITH RECURSIVE numbers(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM numbers WHERE value < 10000
      )
      INSERT INTO defects (
        id, code, project_id, title, description, severity, status,
        assignee_id, reproduction_steps_json, linked_requirement_id,
        linked_task_id, created_at, updated_at, version
      )
      SELECT
        'defect_bulk_' || value,
        printf('BUG-%05d', value),
        ?, 'Bulk', '', 'normal', 'open', ?, '[]', NULL, NULL,
        '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z', 1
      FROM numbers
    `).run(projectId, actorId)
    const requirements = vi.spyOn(RequirementService.prototype, 'list')
    const defects = vi.spyOn(DefectService.prototype, 'list')

    await api.get('/api/v1/requirements?limit=1').expect(200)
    await api.get('/api/v1/defects?limit=1').expect(200)

    expect(requirements.mock.calls[0]![0]).toMatchObject({ limit: 2 })
    expect(defects.mock.calls[0]![0]).toMatchObject({ limit: 2 })
    expect(requirements.mock.results[0]!.value).toHaveLength(2)
    expect(defects.mock.results[0]!.value).toHaveLength(2)
  })
})
