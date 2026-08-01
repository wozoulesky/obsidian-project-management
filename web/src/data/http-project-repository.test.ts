import {
  apiSuccessEnvelopeSchema,
  persistedActorSchema,
  persistedAppSettingsSchema,
  persistedTaskSchema,
} from '@project-os/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ApiClient, ApiError } from './api-client'
import { createHttpProjectRepository } from './http-project-repository'

const requestId = 'request-1'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function success(data: unknown) {
  return { data, error: null, meta: { request_id: requestId } }
}

const task = {
  id: 'task-1',
  code: 'TASK-001',
  title: 'Connect the Web client',
  description: '',
  assignee: {
    id: 'actor-1',
    name: 'Owner',
    kind: 'human' as const,
    role: 'owner' as const,
    status: 'active' as const,
    client: null,
    capabilities: [],
    registeredAt: '2026-07-29T00:00:00.000Z',
    lastActiveAt: null,
    version: 1,
  },
  assigneeId: 'actor-1',
  projectId: 'project/one',
  startDate: '2026-07-29',
  dueDate: '2026-07-30',
  priority: 'P1' as const,
  status: 'in_progress' as const,
  progress: 40,
  milestoneId: '',
  dependencyIds: [],
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
  version: 3,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ApiClient', () => {
  it('returns data only after validating the strict success envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(success({ value: 'ok' })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = new ApiClient('/api')

    await expect(
      client.request('/probe', z.object({ value: z.literal('ok') }).strict()),
    ).resolves.toEqual({ value: 'ok' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/probe',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    )
  })

  it('throws a structured ApiError from a server error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            data: null,
            error: {
              code: 'TASK_VERSION_CONFLICT',
              message: 'Task version is stale',
              details: { currentVersion: 4 },
            },
            meta: { request_id: 'request-conflict' },
          },
          409,
        ),
      ),
    )

    const error = await new ApiClient('/api')
      .request('/tasks/task-1', persistedTaskSchema)
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      code: 'TASK_VERSION_CONFLICT',
      status: 409,
      requestId: 'request-conflict',
      details: { currentVersion: 4 },
    })
  })

  it('rejects malformed or non-strict success envelopes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ...success({ value: 'ok' }),
          unexpected: true,
        }),
      ),
    )

    await expect(
      new ApiClient('/api').request(
        '/probe',
        apiSuccessEnvelopeSchema(z.unknown()),
      ),
    ).rejects.toMatchObject({
      code: 'API_RESPONSE_INVALID',
      status: 200,
      requestId,
    })
  })
})

describe('HTTP project repository', () => {
  it('loads and strictly parses the current actor endpoint', async () => {
    const currentActor = persistedActorSchema.parse({
      ...task.assignee,
      lastBriefingActivityId: null,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(success(currentActor)),
    )
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await expect(repository.getCurrentActor()).resolves.toEqual(currentActor)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/actors/current',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    )
  })

  it('rejects a malformed current actor response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(success({
          ...task.assignee,
          lastBriefingActivityId: null,
          version: 0,
        })),
      ),
    )

    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await expect(repository.getCurrentActor()).rejects.toMatchObject({
      code: 'API_RESPONSE_INVALID',
    })
  })

  it('loads relay sessions, handoffs, and deliverables from project-scoped endpoints', async () => {
    const agent = {
      ...task.assignee,
      id: 'agent-1',
      name: 'dev-agent',
      kind: 'agent' as const,
      role: 'dev-agent' as const,
      client: 'codex' as const,
    }
    const session = {
      id: 'session-1',
      projectId: 'project/one',
      agentId: agent.id,
      agent,
      intent: 'Finish the relay dashboard',
      taskIds: ['task-1'],
      status: 'active' as const,
      summary: null,
      createdAt: '2026-07-29T01:00:00.000Z',
      lastActiveAt: '2026-07-29T02:00:00.000Z',
      closedAt: null,
    }
    const handoff = {
      id: 'handoff-1',
      projectId: 'project/one',
      sessionId: session.id,
      author: agent,
      summary: 'Repository wiring is complete.',
      done: ['Added the read paths'],
      blockers: [],
      nextSteps: ['Render the dashboard panels'],
      gotchas: [],
      refs: [{ kind: 'commit' as const, ref: 'abc123' }],
      createdAt: '2026-07-29T03:00:00.000Z',
    }
    const deliverable = {
      id: 'deliverable-1',
      projectId: 'project/one',
      requirementId: null,
      taskId: 'task-1',
      title: 'Relay repository',
      kind: 'file' as const,
      ref: 'web/src/data/http-project-repository.ts',
      note: null,
      createdBy: agent,
      sessionId: session.id,
      createdAt: '2026-07-29T03:05:00.000Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(success({ items: [session] })))
      .mockResolvedValueOnce(jsonResponse(success({ items: [handoff] })))
      .mockResolvedValueOnce(jsonResponse(success({ items: [deliverable] })))
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await expect(repository.listProjectSessions('project/one')).resolves
      .toEqual([session])
    await expect(repository.listProjectHandoffs('project/one')).resolves
      .toEqual([handoff])
    await expect(repository.listProjectDeliverables('project/one')).resolves
      .toEqual([deliverable])
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/projects/project%2Fone/sessions',
      '/api/projects/project%2Fone/handoffs',
      '/api/projects/project%2Fone/deliverables',
    ])
  })

  it('rejects a malformed relay collection response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(success({
          items: [{
            id: 'session-1',
            status: 'active',
          }],
        })),
      ),
    )

    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await expect(repository.listProjectSessions('project-1')).rejects
      .toMatchObject({ code: 'API_RESPONSE_INVALID' })
  })

  it('loads every task once through the global cursor endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(success({ items: [task], next_cursor: 'next page' })),
      )
      .mockResolvedValueOnce(
        jsonResponse(success({
          items: [{ ...task, id: 'task-2' }],
          next_cursor: null,
        })),
      )
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))
    await expect(repository.listAllTasks()).resolves.toHaveLength(2)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/tasks?limit=200',
      '/api/tasks?limit=200&cursor=next+page',
    ])
  })

  it('creates a project through the strict project endpoint contract', async () => {
    const project = {
      id: 'project-1',
      code: 'PRJ-001',
      name: 'Atlas',
      description: '',
      ownerId: 'actor-1',
      startDate: null,
      dueDate: null,
      status: 'not_started',
      progress: 0,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
      version: 1,
    }
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(success(project), 201),
    )
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))
    await expect(repository.createProject({
      name: 'Atlas',
      description: '',
      ownerId: 'actor-1',
      startDate: null,
      dueDate: null,
    })).resolves.toEqual(project)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/projects')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body,
    ))).toEqual({
      name: 'Atlas',
      description: '',
      ownerId: 'actor-1',
      startDate: null,
      dueDate: null,
    })
  })

  it('loads project detail and members through URL-encoded endpoints', async () => {
    const project = {
      id: 'project/one',
      code: 'PRJ-001',
      name: 'Atlas',
      description: '',
      ownerId: 'actor-1',
      startDate: null,
      dueDate: null,
      status: 'not_started',
      progress: 0,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
      version: 1,
    }
    const member = {
      projectId: project.id,
      actorId: project.ownerId,
      membershipRole: 'owner',
      joinedAt: '2026-07-29T00:00:00.000Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(success(project)))
      .mockResolvedValueOnce(jsonResponse(success({ items: [member] })))
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await expect(repository.getProject(project.id)).resolves.toEqual(project)
    await expect(repository.listProjectMembers(project.id)).resolves.toEqual([
      member,
    ])
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/projects/project%2Fone',
      '/api/projects/project%2Fone/members',
    ])
  })

  it('creates a task through the strict project-scoped endpoint contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(success(task), 201),
    )
    vi.stubGlobal('fetch', fetchMock)
    const repository = createHttpProjectRepository(new ApiClient('/api'))
    const input = {
      title: task.title,
      description: task.description,
      assigneeId: task.assigneeId,
      startDate: task.startDate,
      dueDate: task.dueDate,
      priority: task.priority,
      milestoneId: task.milestoneId,
    }

    await expect(repository.createTask('project/one', input)).resolves.toEqual(
      task,
    )
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/projects/project%2Fone/tasks',
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body,
    ))).toEqual(input)
  })

  it('rejects invalid and extra task creation fields before transport', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const repository = createHttpProjectRepository(new ApiClient('/api'))
    const base = {
      title: task.title,
      assigneeId: task.assigneeId,
      startDate: task.startDate,
      dueDate: task.dueDate,
      priority: task.priority,
    }

    await expect(repository.createTask('project-1', {
      ...base,
      startDate: '2026-07-31',
      dueDate: '2026-07-30',
    })).rejects.toThrow('Task start date must not be after its due date')
    await expect(repository.createTask('project-1', {
      ...base,
      projectId: 'must-not-be-in-body',
    } as typeof base)).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('follows cursor pages and URL-encodes a project-scoped task list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(success({ items: [task], next_cursor: 'cursor 1' })),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          success({
            items: [{ ...task, id: 'task-2', code: 'TASK-002' }],
            next_cursor: null,
          }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))
    const result = await repository.listTasks('project/one')

    expect(result.map(({ id }) => id)).toEqual(['task-1', 'task-2'])
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/projects/project%2Fone/tasks?limit=200',
    )
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/api/projects/project%2Fone/tasks?limit=200&cursor=cursor+1',
    )
  })

  it('rejects a repeated pagination cursor instead of requesting forever', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(success({ items: [task], next_cursor: 'repeated' })),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          success({
            items: [{ ...task, id: 'task-2', code: 'TASK-002' }],
            next_cursor: 'repeated',
          }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await expect(repository.listTasks('project/one')).rejects.toMatchObject({
      code: 'API_PAGINATION_CURSOR_REPEATED',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loads the current version before submitting legacy progress input', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(success(task)))
      .mockResolvedValueOnce(
        jsonResponse(success({ ...task, progress: 70, version: 4 })),
      )
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))
    await repository.updateTaskProgress('task-1', {
      progress: 70,
      status: 'in_progress',
      note: 'Connected',
    })

    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/tasks/task-1/progress')
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      progress: 70,
      status: 'in_progress',
      note: 'Connected',
      version: 3,
    })
  })

  it('submits a supplied progress version unchanged without prefetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(success({ ...task, progress: 70, version: 4 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))
    await repository.updateTaskProgress('task-1', {
      progress: 70,
      status: 'in_progress',
      note: 'Connected',
      version: 2,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tasks/task-1/progress')
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({ version: 2 })
  })

  it('submits supplied task dates unchanged without prefetching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(success({ ...task, startDate: '2026-08-01', version: 4 })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))
    await repository.updateTaskDates('task-1', {
      startDate: '2026-08-01',
      dueDate: '2026-08-03',
      version: 2,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tasks/task-1')
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      startDate: '2026-08-01',
      dueDate: '2026-08-03',
      version: 2,
    })
  })

  it('loads the current version for legacy task date input', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(success(task)))
      .mockResolvedValueOnce(
        jsonResponse(success({ ...task, startDate: '2026-08-01', version: 4 })),
      )
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))
    await repository.updateTaskDates('task-1', {
      startDate: '2026-08-01',
      dueDate: '2026-08-03',
    })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tasks/task-1')
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({ version: 3 })
  })

  it('validates settings and reads activity cursors through the repository', async () => {
    const settings = {
      theme: 'system',
      background: 'soft',
      accent: 'blue',
      density: 'comfortable',
      updatedAt: '2026-07-29T00:00:00.000Z',
      version: 1,
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(success(settings)))
      .mockResolvedValueOnce(
        jsonResponse(success({ items: [], next_cursor: 'activity-9' })),
      )
    vi.stubGlobal('fetch', fetchMock)

    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await expect(repository.getSettings()).resolves.toEqual(
      persistedAppSettingsSchema.parse(settings),
    )
    await expect(
      repository.listActivities({ after: 'activity 8', projectId: 'p/1' }),
    ).resolves.toEqual({ items: [], nextCursor: 'activity-9' })
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/api/activities?limit=200&after=activity+8&project_id=p%2F1',
    )
  })
})
