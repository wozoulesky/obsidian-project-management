import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  apiErrorEnvelopeSchema,
  apiSuccessEnvelopeSchema,
  deleteProjectResultSchema,
  persistedActorSchema,
  persistedProjectMemberSchema,
  persistedProjectSchema,
  persistedTaskSchema,
} from '@project-os/contracts'
import {
  ActorService,
  ProjectService,
  seedDatabase,
  TaskService,
} from '@project-os/core'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApp } from '../app.js'
import {
  createAppContext,
  defaultSeedDocument,
  type AppContext,
} from '../context.js'

const contexts: AppContext[] = []
const directories: string[] = []

function createContext(
  seed = true,
  localActorId?: string,
): AppContext {
  const directory = mkdtempSync(join(tmpdir(), 'project-os-work-routes-'))
  const context = createAppContext({
    databasePath: join(directory, 'test.db'),
    backupRoot: join(directory, 'backups'),
    ...(localActorId === undefined ? {} : { localActorId }),
  })
  directories.push(directory)
  contexts.push(context)
  if (seed) {
    seedDatabase(context.database, defaultSeedDocument)
  }
  return context
}

function createApi(context = createContext()) {
  return {
    context,
    api: request(createApp({ context })),
  }
}

function expectRequestEnvelope(response: request.Response): void {
  expect(response.headers['x-request-id']).toBeTypeOf('string')
  expect(response.body.meta.request_id)
    .toBe(response.headers['x-request-id'])
}

async function createHuman(
  api: ReturnType<typeof request>,
  name: string,
  role: 'owner' | 'member' = 'member',
) {
  const response = await api.post('/api/v1/actors').send({
    name,
    role,
    capabilities: ['web'],
  }).expect(201)
  return persistedActorSchema.parse(response.body.data)
}

async function createProject(
  api: ReturnType<typeof request>,
  ownerId: string,
  name = 'Atlas',
) {
  const response = await api.post('/api/v1/projects').send({
    name,
    description: '',
    ownerId,
    startDate: '2026-07-29',
    dueDate: '2026-08-31',
  }).expect(201)
  return persistedProjectSchema.parse(response.body.data)
}

async function createTask(
  api: ReturnType<typeof request>,
  projectId: string,
  assigneeId: string,
  title = 'Expose API',
) {
  const response = await api
    .post(`/api/v1/projects/${projectId}/tasks`)
    .send({
      title,
      description: '',
      assigneeId,
      startDate: '2026-07-29',
      dueDate: '2026-08-01',
      priority: 'P1',
    })
    .expect(201)
  return persistedTaskSchema.parse(response.body.data)
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

describe('actor routes', () => {
  it('returns the configured local actor from the literal current route', async () => {
    const local = defaultSeedDocument.actors[0]!
    const { api } = createApi(createContext(true, local.id))

    const response = await api
      .get('/api/v1/actors/current')
      .set('X-Request-Id', 'actor-current-1')
      .expect(200)

    expect(
      apiSuccessEnvelopeSchema(persistedActorSchema).parse(response.body),
    ).toEqual(response.body)
    expect(response.body.data.id).toBe(local.id)
    expect(response.body.data).toEqual(
      persistedActorSchema.parse(response.body.data),
    )
    expectRequestEnvelope(response)
  })

  it('creates only human actors and returns persisted output in the envelope', async () => {
    const { api } = createApi()

    const first = await api.post('/api/v1/actors')
      .set('X-Request-Id', 'actor-create-1')
      .send({
        name: 'Lin',
        role: 'owner',
        capabilities: ['planning'],
      })
      .expect(201)
    const second = await api.post('/api/v1/actors').send({
      name: 'Qiao',
      role: 'member',
    }).expect(201)

    expect(
      apiSuccessEnvelopeSchema(persistedActorSchema).parse(first.body),
    ).toEqual(first.body)
    expect(first.body.data).toMatchObject({
      name: 'Lin',
      kind: 'human',
      role: 'owner',
      status: 'active',
      client: null,
      capabilities: ['planning'],
      version: 1,
    })
    expect(second.body.data.id).not.toBe(first.body.data.id)
    expectRequestEnvelope(first)
  })

  it('lists, gets, updates, and deactivates actors with version semantics', async () => {
    const { api, context } = createApi()
    const actor = await createHuman(api, 'Lin')

    const listed = await api
      .get('/api/v1/actors?kind=human&status=active&limit=50')
      .expect(200)
    const fetched = await api.get(`/api/v1/actors/${actor.id}`).expect(200)
    const updated = await api.patch(`/api/v1/actors/${actor.id}`).send({
      name: 'Lin Updated',
      capabilities: ['planning'],
      version: actor.version,
    }).expect(200)
    const activityCountBeforeStale = context.services.activities.list({
      entityId: actor.id,
    }).length
    const staleDeactivate = await api
      .post(`/api/v1/actors/${actor.id}/deactivate`)
      .send({ version: actor.version })
      .expect(409)
    expect(context.services.actors.get(actor.id)).toEqual(updated.body.data)
    expect(context.services.activities.list({ entityId: actor.id }))
      .toHaveLength(activityCountBeforeStale)
    const missingDeactivateVersion = await api
      .post(`/api/v1/actors/${actor.id}/deactivate`)
      .send({})
      .expect(400)
    const deactivated = await api
      .post(`/api/v1/actors/${actor.id}/deactivate`)
      .send({ version: updated.body.data.version })
      .expect(200)

    expect(listed.body.data.items.some(
      ({ id }: { id: string }) => id === actor.id,
    )).toBe(true)
    expect(listed.body.data.next_cursor).toBeNull()
    expect(fetched.body.data.id).toBe(actor.id)
    expect(updated.body.data).toMatchObject({
      name: 'Lin Updated',
      version: 2,
    })
    expect(staleDeactivate.body.error.code)
      .toBe('ACTOR_VERSION_CONFLICT')
    expect(missingDeactivateVersion.body.error.code).toBe('VALIDATION_ERROR')
    expect(deactivated.body.data).toMatchObject({
      status: 'inactive',
      version: 3,
    })
  })

  it('rejects direct Web edits to Agent profiles without mutation', async () => {
    const { api, context } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const agent = context.services.actors.registerAgent(
      {
        name: 'builder',
        role: 'dev-agent',
        client: 'codex',
        capabilities: ['typescript'],
      },
      owner.id,
      'mcp',
    )
    const activityCount = context.services.activities.list({
      entityId: agent.id,
    }).length

    const response = await api.patch(`/api/v1/actors/${agent.id}`).send({
      name: 'renamed-builder',
      capabilities: ['web-edited'],
      version: agent.version,
    }).expect(400)

    expect(apiErrorEnvelopeSchema.parse(response.body)).toEqual(response.body)
    expect(response.body.error.code).toBe('ACTOR_KIND_INVALID')
    expect(context.services.actors.get(agent.id)).toEqual(agent)
    expect(context.services.activities.list({ entityId: agent.id }))
      .toHaveLength(activityCount)
  })

  it('rejects agent registration, impersonation fields, nulls, and unknown fields', async () => {
    const { api } = createApi()
    const cases = [
      {
        name: 'Agent',
        kind: 'agent',
        role: 'dev-agent',
        client: 'fake-client',
      },
      {
        name: 'Impersonator',
        role: 'member',
        actorId: 'agent_spoofed',
      },
      {
        name: 'Source spoof',
        role: 'member',
        source: 'mcp',
      },
      { name: null, role: 'member' },
      { name: 'Unknown', role: 'member', unknown: true },
    ]

    for (const body of cases) {
      const response = await api.post('/api/v1/actors')
        .send(body)
        .expect(400)
      expect(apiErrorEnvelopeSchema.parse(response.body)).toEqual(response.body)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('uses opaque, filter-bound pagination and rejects invalid or expired cursors', async () => {
    const { api, context } = createApi()
    const firstActor = await createHuman(api, 'A Actor')
    await createHuman(api, 'B Actor')

    const firstPage = await api
      .get('/api/v1/actors?kind=human&status=active&limit=1')
      .expect(200)
    const cursor = firstPage.body.data.next_cursor as string
    const secondPage = await api
      .get(`/api/v1/actors?kind=human&status=active&limit=1&cursor=${cursor}`)
      .expect(200)
    const thirdPage = await api
      .get(
        `/api/v1/actors?kind=human&status=active&limit=1&cursor=${secondPage.body.data.next_cursor}`,
      )
      .expect(200)
    const allActors = await api
      .get('/api/v1/actors?kind=human&status=active&limit=200')
      .expect(200)
    const wrongFilter = await api
      .get(`/api/v1/actors?kind=human&status=inactive&cursor=${cursor}`)
      .expect(400)
    const invalid = await api
      .get('/api/v1/actors?cursor=not-a-cursor')
      .expect(400)

    expect(firstPage.body.data.items).toHaveLength(1)
    expect(firstPage.body.data.items[0].id).toBe(firstActor.id)
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(secondPage.body.data.items[0].name).toBe('B Actor')
    const pagedIds = [
      ...firstPage.body.data.items,
      ...secondPage.body.data.items,
      ...thirdPage.body.data.items,
    ].map(({ id }: { id: string }) => id)
    expect(pagedIds).toEqual(allActors.body.data.items.map(
      ({ id }: { id: string }) => id,
    ))
    expect(new Set(pagedIds).size).toBe(pagedIds.length)
    expect(wrongFilter.body.error.code).toBe('PAGINATION_CURSOR_INVALID')
    expect(invalid.body.error.code).toBe('PAGINATION_CURSOR_INVALID')

    context.database.prepare(`
      DELETE FROM activities
      WHERE entity_type = 'actor' AND entity_id = ?
    `).run(firstActor.id)
    context.database.prepare('DELETE FROM actors WHERE id = ?')
      .run(firstActor.id)
    const expired = await api
      .get(`/api/v1/actors?kind=human&status=active&cursor=${cursor}`)
      .expect(400)
    expect(expired.body.error.code).toBe('PAGINATION_CURSOR_INVALID')
  })

  it('pushes limit plus one into SQLite instead of reading ten thousand actors', async () => {
    const context = createContext(false)
    const insert = context.database.prepare(`
      INSERT INTO actors (
        id, name, kind, role, status, client, capabilities_json,
        registered_at, last_active_at, version
      ) VALUES (?, ?, 'human', 'member', 'active', NULL, '[]', ?, NULL, 1)
    `)
    context.database.exec('BEGIN')
    try {
      for (let index = 0; index < 10_000; index += 1) {
        const suffix = index.toString().padStart(5, '0')
        insert.run(
          `actor_bulk_${suffix}`,
          `Actor ${suffix}`,
          '2026-07-29T00:00:00.000Z',
        )
      }
      context.database.exec('COMMIT')
    } catch (error) {
      context.database.exec('ROLLBACK')
      throw error
    }
    const list = vi.spyOn(ActorService.prototype, 'list')

    const response = await request(createApp({ context }))
      .get('/api/v1/actors?limit=1')
      .expect(200)

    expect(response.body.data.items).toHaveLength(1)
    expect(response.body.data.next_cursor).toBeTypeOf('string')
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }))
    expect(list.mock.results.at(-1)?.value).toHaveLength(2)
  })
})

describe('project routes', () => {
  it('creates a human, creates projects, and filters them by primary owner', async () => {
    const { api } = createApi()
    const owner = await createHuman(api, 'Lin', 'owner')
    const first = await createProject(api, owner.id, 'Atlas')
    const second = await createProject(api, owner.id, 'Borealis')

    const result = await api
      .get(`/api/v1/projects?owner_id=${owner.id}&limit=50`)
      .expect(200)

    expect(result.body.data.items.map(
      ({ id }: { id: string }) => id,
    )).toEqual([first.id, second.id])
    expect(first.code).not.toBe(second.code)
    expect(result.body.data.next_cursor).toBeNull()
    expect(
      apiSuccessEnvelopeSchema(z.object({
        items: z.array(persistedProjectSchema),
        next_cursor: z.string().nullable(),
      }).strict()).parse(result.body),
    ).toEqual(result.body)
  })

  it('gets and updates a project with optimistic versioning', async () => {
    const { api } = createApi()
    const owner = await createHuman(api, 'Lin', 'owner')
    const project = await createProject(api, owner.id)

    const fetched = await api.get(`/api/v1/projects/${project.id}`).expect(200)
    const updated = await api.patch(`/api/v1/projects/${project.id}`).send({
      name: 'Atlas 2',
      status: 'in_progress',
      progress: 20,
      version: project.version,
    }).expect(200)
    const stale = await api.patch(`/api/v1/projects/${project.id}`).send({
      progress: 40,
      version: project.version,
    }).expect(409)

    expect(fetched.body.data.id).toBe(project.id)
    expect(updated.body.data).toMatchObject({
      name: 'Atlas 2',
      status: 'in_progress',
      progress: 20,
      version: 2,
    })
    expect(stale.body.error.code).toBe('PROJECT_VERSION_CONFLICT')
  })

  it('adds and lists only member memberships', async () => {
    const { api } = createApi()
    const owner = await createHuman(api, 'Lin', 'owner')
    const member = await createHuman(api, 'Qiao')
    const project = await createProject(api, owner.id)

    const added = await api.post(`/api/v1/projects/${project.id}/members`)
      .send({ actorId: member.id })
      .expect(201)
    const listed = await api
      .get(`/api/v1/projects/${project.id}/members`)
      .expect(200)

    expect(persistedProjectMemberSchema.parse(added.body.data)).toMatchObject({
      projectId: project.id,
      actorId: member.id,
      membershipRole: 'member',
    })
    expect(listed.body.data.items.map(
      ({ membershipRole }: { membershipRole: string }) => membershipRole,
    ).sort()).toEqual(['member', 'owner'])
    expect(listed.body.data.items.every(
      (item: unknown) => persistedProjectMemberSchema.safeParse(item).success,
    )).toBe(true)
  })

  it('maps missing and inactive owners to stable client errors', async () => {
    const { api } = createApi()
    const inactive = await createHuman(api, 'Inactive')
    await api.post(`/api/v1/actors/${inactive.id}/deactivate`)
      .send({ version: inactive.version })
      .expect(200)

    const missing = await api.post('/api/v1/projects').send({
      name: 'Missing owner',
      ownerId: 'actor_missing',
    }).expect(404)
    const deactivated = await api.post('/api/v1/projects').send({
      name: 'Inactive owner',
      ownerId: inactive.id,
    }).expect(400)

    expect(missing.body.error.code).toBe('ACTOR_NOT_FOUND')
    expect(deactivated.body.error.code).toBe('ACTOR_INACTIVE')
  })

  it('deletes a project and returns strict counts while retaining its audit', async () => {
    const { api, context } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const project = await createProject(api, owner.id)
    await createTask(api, project.id, owner.id)

    const response = await api
      .delete(`/api/v1/projects/${project.id}`)
      .send({ version: project.version })
      .expect(200)

    expect(
      apiSuccessEnvelopeSchema(deleteProjectResultSchema).parse(response.body),
    ).toEqual(response.body)
    expect(response.body.data).toEqual({
      id: project.id,
      name: project.name,
      deletedAt: expect.any(String),
      deletedCounts: {
        project_members: 1,
        tasks: 1,
        requirements: 0,
        defects: 0,
        sessions: 0,
        handoffs: 0,
        deliverables: 0,
      },
    })
    expect(new Date(response.body.data.deletedAt).toISOString())
      .toBe(response.body.data.deletedAt)
    await api.get(`/api/v1/projects/${project.id}`).expect(404)
    expect(context.services.activities.list({ entityId: project.id }))
      .toContainEqual(expect.objectContaining({
        operation: 'project.delete',
        entityId: project.id,
        projectId: null,
        source: 'web',
      }))
  })

  it.each([
    ['missing version', {}],
    ['zero version', { version: 0 }],
    ['unknown field', { version: 1, unexpected: true }],
  ])('rejects deletion with %s', async (_name, body) => {
    const { api } = createApi()
    const project = defaultSeedDocument.projects[0]!

    const response = await api
      .delete(`/api/v1/projects/${project.id}`)
      .send(body)
      .expect(400)

    expect(apiErrorEnvelopeSchema.parse(response.body)).toEqual(response.body)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns not found when deleting a missing project', async () => {
    const { api } = createApi()

    const response = await api
      .delete('/api/v1/projects/project_missing')
      .send({ version: 1 })
      .expect(404)

    expect(response.body.error.code).toBe('PROJECT_NOT_FOUND')
  })

  it('forbids an unrelated active human member from deleting a project', async () => {
    const outsiderId = 'actor_unrelated_member'
    const context = createContext(true, outsiderId)
    const owner = defaultSeedDocument.actors[0]!
    const timestamp = '2026-08-02T00:00:00.000Z'
    context.database.prepare(`
      INSERT INTO actors (
        id, name, kind, role, status, client, capabilities_json,
        registered_at, last_active_at, version
      ) VALUES (?, 'Unrelated member', 'human', 'member', 'active', NULL,
        '[]', ?, NULL, 1)
    `).run(outsiderId, timestamp)
    const project = context.services.projects.create({
      name: 'Owner project',
      description: '',
      ownerId: owner.id,
      startDate: null,
      dueDate: null,
    }, owner.id, 'web')
    const api = request(createApp({ context }))

    const response = await api
      .delete(`/api/v1/projects/${project.id}`)
      .send({ version: project.version })
      .expect(403)

    expect(response.body.error.code).toBe('PROJECT_DELETE_FORBIDDEN')
    expect(context.services.projects.get(project.id)).toEqual(project)
  })

  it('protects the default project from deletion', async () => {
    const { api } = createApi()
    const project = defaultSeedDocument.projects[0]!

    const response = await api
      .delete(`/api/v1/projects/${project.id}`)
      .send({ version: project.version })
      .expect(409)

    expect(response.body.error.code).toBe('DEFAULT_PROJECT_PROTECTED')
  })

  it('rejects stale deletion without changing the project', async () => {
    const { api } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const project = await createProject(api, owner.id)
    const updated = await api.patch(`/api/v1/projects/${project.id}`).send({
      description: 'Current description',
      version: project.version,
    }).expect(200)

    const response = await api
      .delete(`/api/v1/projects/${project.id}`)
      .send({ version: project.version })
      .expect(409)

    expect(response.body.error.code).toBe('PROJECT_VERSION_CONFLICT')
    const fetched = await api.get(`/api/v1/projects/${project.id}`).expect(200)
    expect(fetched.body.data).toEqual(updated.body.data)
  })

  it('sanitizes an unexpected project deletion failure', async () => {
    const { api, context } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const project = await createProject(api, owner.id)
    context.database.exec(`
      CREATE TRIGGER fail_project_delete_route
      BEFORE DELETE ON projects
      BEGIN
        SELECT RAISE(ABORT, 'forced project deletion failure');
      END;
    `)

    const response = await api
      .delete(`/api/v1/projects/${project.id}`)
      .send({ version: project.version })
      .expect(500)

    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    })
    expect(JSON.stringify(response.body))
      .not.toMatch(/forced project deletion failure|sqlite|trigger/i)
    expect(context.services.projects.get(project.id)).toEqual(project)
  })
})

describe('task routes', () => {
  it('rejects active non-members until they join the target project', async () => {
    const { api } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const assignee = await createHuman(api, 'Project outsider')
    const project = await createProject(api, owner.id)
    const input = {
      title: 'Join before assignment',
      assigneeId: assignee.id,
      startDate: '2026-07-29',
      dueDate: '2026-08-01',
      priority: 'P1',
    }

    const rejected = await api
      .post(`/api/v1/projects/${project.id}/tasks`)
      .send(input)
      .expect(400)
    expect(rejected.body.error).toMatchObject({
      code: 'TASK_ASSIGNEE_MISMATCH',
      details: {
        projectId: project.id,
        assigneeId: assignee.id,
      },
    })
    const beforeMembership = await api
      .get(`/api/v1/projects/${project.id}/tasks`)
      .expect(200)
    expect(beforeMembership.body.data.items).toEqual([])

    await api.post(`/api/v1/projects/${project.id}/members`)
      .send({ actorId: assignee.id })
      .expect(201)
    const created = await api
      .post(`/api/v1/projects/${project.id}/tasks`)
      .send(input)
      .expect(201)
    expect(created.body.data).toMatchObject({
      projectId: project.id,
      assigneeId: assignee.id,
    })
  })

  it('creates tasks from the project path and returns unique task codes', async () => {
    const { api } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const project = await createProject(api, owner.id)
    const first = await createTask(api, project.id, owner.id, 'First task')
    const second = await createTask(api, project.id, owner.id, 'Second task')

    expect(first.projectId).toBe(project.id)
    expect(first.code).not.toBe(second.code)
    expect(first.version).toBe(1)
  })

  it('lists project tasks and global tasks without slicing before filters', async () => {
    const { api } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const firstProject = await createProject(api, owner.id, 'First')
    const secondProject = await createProject(api, owner.id, 'Second')
    const first = await createTask(api, firstProject.id, owner.id, 'First task')
    const second = await createTask(api, secondProject.id, owner.id, 'Second task')

    const projectTasks = await api
      .get(`/api/v1/projects/${secondProject.id}/tasks?limit=1`)
      .expect(200)
    const globalTasks = await api
      .get(`/api/v1/tasks?project_id=${firstProject.id}&assignee_id=${owner.id}&status=not_started&limit=1`)
      .expect(200)

    expect(projectTasks.body.data.items.map(
      ({ id }: { id: string }) => id,
    )).toEqual([second.id])
    expect(globalTasks.body.data.items.map(
      ({ id }: { id: string }) => id,
    )).toEqual([first.id])
  })

  it('gets and updates a task with strict version validation', async () => {
    const { api } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const project = await createProject(api, owner.id)
    const task = await createTask(api, project.id, owner.id)

    const fetched = await api.get(`/api/v1/tasks/${task.id}`).expect(200)
    const updated = await api.patch(`/api/v1/tasks/${task.id}`).send({
      description: 'REST route complete',
      version: task.version,
    }).expect(200)
    const missingVersion = await api.patch(`/api/v1/tasks/${task.id}`).send({
      description: 'No version',
    }).expect(400)

    expect(fetched.body.data.id).toBe(task.id)
    expect(updated.body.data).toMatchObject({
      description: 'REST route complete',
      version: 2,
    })
    expect(missingVersion.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('submits progress only through submitProgress and rejects stale or missing versions', async () => {
    const { api } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const project = await createProject(api, owner.id)
    const task = await createTask(api, project.id, owner.id)

    const updated = await api.post(`/api/v1/tasks/${task.id}/progress`).send({
      progress: 80,
      status: 'in_progress',
      note: 'API complete',
      version: task.version,
    }).expect(200)
    const stale = await api.post(`/api/v1/tasks/${task.id}/progress`).send({
      progress: 100,
      status: 'done',
      note: 'stale',
      version: task.version,
    }).expect(409)
    const missing = await api.post(`/api/v1/tasks/${task.id}/progress`).send({
      progress: 100,
      status: 'done',
      note: 'missing version',
    }).expect(400)
    const impersonated = await api
      .post(`/api/v1/tasks/${task.id}/progress`)
      .send({
        progress: 100,
        status: 'done',
        note: 'spoofed agent',
        version: updated.body.data.version,
        actorId: 'agent_spoofed',
      })
      .expect(400)
    const tasks = await api
      .get(`/api/v1/tasks?project_id=${project.id}`)
      .expect(200)

    expect(updated.body.data).toMatchObject({
      id: task.id,
      progress: 80,
      status: 'in_progress',
      version: 2,
    })
    expect(stale.body.error.code).toBe('TASK_VERSION_CONFLICT')
    expect(missing.body.error.code).toBe('VALIDATION_ERROR')
    expect(impersonated.body.error.code).toBe('VALIDATION_ERROR')
    expect(tasks.body.data.items).toHaveLength(1)
  })

  it('rejects path project overrides and actor/source impersonation', async () => {
    const { api } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const project = await createProject(api, owner.id)
    const cases = [
      { projectId: 'project_spoofed' },
      { actorId: 'agent_spoofed' },
      { source: 'mcp' },
    ]

    for (const extra of cases) {
      const response = await api
        .post(`/api/v1/projects/${project.id}/tasks`)
        .send({
          title: 'Spoofed',
          assigneeId: owner.id,
          startDate: '2026-07-29',
          dueDate: '2026-08-01',
          priority: 'P1',
          ...extra,
        })
        .expect(400)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('maps inactive assignees to a stable client error', async () => {
    const { api } = createApi()
    const owner = defaultSeedDocument.actors[0]!
    const assignee = await createHuman(api, 'Inactive assignee')
    const project = await createProject(api, owner.id)
    await api.post(`/api/v1/actors/${assignee.id}/deactivate`)
      .send({ version: assignee.version })
      .expect(200)

    const response = await api
      .post(`/api/v1/projects/${project.id}/tasks`)
      .send({
        title: 'Cannot assign',
        assigneeId: assignee.id,
        startDate: '2026-07-29',
        dueDate: '2026-08-01',
        priority: 'P1',
      })
      .expect(400)

    expect(response.body.error.code).toBe('ACTOR_INACTIVE')
  })
})

describe('strict request boundaries and live context', () => {
  it.each([
    [
      'actor list',
      () => vi.spyOn(ActorService.prototype, 'list'),
      (api: ReturnType<typeof request>) => api.get('/api/v1/actors'),
    ],
    [
      'actor get',
      () => vi.spyOn(ActorService.prototype, 'get'),
      (api: ReturnType<typeof request>) =>
        api.get('/api/v1/actors/actor_broken'),
    ],
    [
      'actor write',
      () => vi.spyOn(ActorService.prototype, 'createHuman'),
      (api: ReturnType<typeof request>) => api.post('/api/v1/actors').send({
        name: 'Broken actor',
        role: 'member',
      }),
    ],
    [
      'project list',
      () => vi.spyOn(ProjectService.prototype, 'list'),
      (api: ReturnType<typeof request>) => api.get('/api/v1/projects'),
    ],
    [
      'project get',
      () => vi.spyOn(ProjectService.prototype, 'get'),
      (api: ReturnType<typeof request>) =>
        api.get('/api/v1/projects/project_broken'),
    ],
    [
      'project write',
      () => vi.spyOn(ProjectService.prototype, 'create'),
      (api: ReturnType<typeof request>) => api.post('/api/v1/projects').send({
        name: 'Broken project',
        ownerId: defaultSeedDocument.actors[0]!.id,
      }),
    ],
    [
      'task list',
      () => vi.spyOn(TaskService.prototype, 'list'),
      (api: ReturnType<typeof request>) => api.get('/api/v1/tasks'),
    ],
    [
      'task get',
      () => vi.spyOn(TaskService.prototype, 'get'),
      (api: ReturnType<typeof request>) =>
        api.get('/api/v1/tasks/task_broken'),
    ],
    [
      'task write',
      () => vi.spyOn(TaskService.prototype, 'create'),
      (api: ReturnType<typeof request>) => api
        .post(`/api/v1/projects/${defaultSeedDocument.projects[0]!.id}/tasks`)
        .send({
          title: 'Broken task',
          assigneeId: defaultSeedDocument.actors[0]!.id,
          startDate: '2026-07-29',
          dueDate: '2026-08-01',
          priority: 'P1',
        }),
    ],
  ])('maps a direct %s service ZodError to a sanitized 500', async (
    _name,
    installSpy,
    makeRequest,
  ) => {
    const { api } = createApi()
    installSpy().mockImplementation((() => {
      z.object({ secret_field: z.string() }).parse({ secret_field: 42 })
    }) as never)

    const response = await makeRequest(api).expect(500)

    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    })
    expect(JSON.stringify(response.body))
      .not.toMatch(/issues|path|secret_field/i)
  })

  it('still maps request body ZodError to a detailed 400', async () => {
    const { api } = createApi()

    const response = await api.post('/api/v1/actors')
      .send({ name: null, role: 'member' })
      .expect(400)

    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.details.issues).toBeInstanceOf(Array)
  })

  it('maps a malformed percent-encoded path to a sanitized client error', async () => {
    const { api } = createApi()

    const response = await api
      .get('/api/v1/actors/%E0%A4%A')
      .expect(400)

    expect(response.body.error).toEqual({
      code: 'INVALID_URL',
      message: 'Request URL is invalid',
      details: {},
    })
  })

  it('maps invalid service output to a sanitized internal error', async () => {
    const { api } = createApi()
    vi.spyOn(ActorService.prototype, 'list').mockReturnValue([{
      id: 'actor_broken',
      name: null,
    }] as never)

    const response = await api.get('/api/v1/actors').expect(500)

    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    })
    expect(JSON.stringify(response.body))
      .not.toMatch(/issues|path|actor_broken/i)
  })

  it('rejects unknown, repeated, null, invalid limit, and oversized id inputs', async () => {
    const { api } = createApi()
    const cases = [
      '/api/v1/actors?unknown=value',
      '/api/v1/actors?status=active&status=inactive',
      '/api/v1/actors?kind=unknown',
      '/api/v1/actors?limit=0',
      '/api/v1/actors?limit=201',
      '/api/v1/actors?limit=1.5',
      `/api/v1/actors/${'x'.repeat(257)}`,
    ]

    for (const path of cases) {
      const response = await api.get(path).expect(400)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    }

    const maximum = await api.get('/api/v1/actors?limit=200').expect(200)
    expect(maximum.body.data.next_cursor).toBeNull()

    const nullBody = await api.post('/api/v1/projects')
      .send({ name: 'Null dates', ownerId: null })
      .expect(400)
    expect(nullBody.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns a stable client error when the configured local actor is missing', async () => {
    const { api } = createApi(createContext(false))

    const response = await api.post('/api/v1/actors').send({
      name: 'Cannot write',
      role: 'member',
    }).expect(404)

    expect(response.body.error.code).toBe('ACTOR_NOT_FOUND')
  })

  it('returns a stable client error when the configured local actor is inactive', async () => {
    const { api } = createApi()
    const localActor = defaultSeedDocument.actors[0]!
    await api.post(`/api/v1/actors/${localActor.id}/deactivate`)
      .send({ version: localActor.version })
      .expect(200)

    const response = await api.post('/api/v1/actors').send({
      name: 'Cannot write',
      role: 'member',
    }).expect(400)

    expect(response.body.error.code).toBe('ACTOR_INACTIVE')
  })

  it('rejects an active agent configured as the local Web actor before any write', async () => {
    const agentId = 'actor_configured_agent'
    const context = createContext(true, agentId)
    context.database.prepare(`
      INSERT INTO actors (
        id, name, kind, role, status, client, capabilities_json,
        registered_at, last_active_at, version
      ) VALUES (?, ?, 'agent', 'dev-agent', 'active', ?, '[]', ?, ?, 1)
    `).run(
      agentId,
      'Configured Agent',
      'test-client',
      '2026-07-29T00:00:00.000Z',
      '2026-07-29T00:00:00.000Z',
    )
    const api = request(createApp({ context }))
    const owner = defaultSeedDocument.actors[0]!
    const project = defaultSeedDocument.projects[0]!
    const task = context.services.tasks.create({
      projectId: project.id,
      title: 'Existing task',
      assigneeId: owner.id,
      startDate: '2026-07-29',
      dueDate: '2026-08-01',
      priority: 'P1',
    }, owner.id, 'web')
    const countsBefore = {
      actors: context.database.prepare(
        'SELECT COUNT(*) AS count FROM actors',
      ).get(),
      projects: context.database.prepare(
        'SELECT COUNT(*) AS count FROM projects',
      ).get(),
      tasks: context.database.prepare(
        'SELECT COUNT(*) AS count FROM tasks',
      ).get(),
      activities: context.database.prepare(
        'SELECT COUNT(*) AS count FROM activities',
      ).get(),
    }

    const responses = await Promise.all([
      api.post('/api/v1/actors').send({
        name: 'Blocked actor',
        role: 'member',
      }),
      api.post('/api/v1/projects').send({
        name: 'Blocked project',
        ownerId: owner.id,
      }),
      api.post(`/api/v1/projects/${project.id}/tasks`).send({
        title: 'Blocked task',
        assigneeId: owner.id,
        startDate: '2026-07-29',
        dueDate: '2026-08-01',
        priority: 'P1',
      }),
      api.post(`/api/v1/tasks/${task.id}/progress`).send({
        progress: 50,
        status: 'in_progress',
        note: 'Blocked progress',
        version: task.version,
      }),
    ])

    for (const response of responses) {
      expect(response.status).toBe(400)
      expect(response.body.error).toEqual({
        code: 'LOCAL_ACTOR_INVALID',
        message: 'Configured local actor must be an active human',
        details: { actorId: agentId },
      })
    }
    expect({
      actors: context.database.prepare(
        'SELECT COUNT(*) AS count FROM actors',
      ).get(),
      projects: context.database.prepare(
        'SELECT COUNT(*) AS count FROM projects',
      ).get(),
      tasks: context.database.prepare(
        'SELECT COUNT(*) AS count FROM tasks',
      ).get(),
      activities: context.database.prepare(
        'SELECT COUNT(*) AS count FROM activities',
      ).get(),
    }).toEqual(countsBefore)
    expect(context.services.tasks.get(task.id)).toMatchObject({
      progress: 0,
      status: 'not_started',
      version: task.version,
    })
  })

  it('uses the restored database for subsequent route requests', async () => {
    const { api, context } = createApi()
    const backupPath = await context.services.backups.create('routes.sqlite')
    const discarded = await createHuman(api, 'Discarded after backup')

    const beforeRestore = await api.get('/api/v1/actors').expect(200)
    context.services.backups.restore(backupPath)
    const afterRestore = await api.get('/api/v1/actors').expect(200)

    expect(beforeRestore.body.data.items.some(
      ({ id }: { id: string }) => id === discarded.id,
    )).toBe(true)
    expect(afterRestore.body.data.items.some(
      ({ id }: { id: string }) => id === discarded.id,
    )).toBe(false)
    expect(afterRestore.body.data.items).toHaveLength(1)
  })
})
