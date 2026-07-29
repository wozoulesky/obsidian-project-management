import {
  apiSuccessEnvelopeSchema,
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
