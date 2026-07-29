import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClient } from './api-client'
import { createHttpProjectRepository } from './http-project-repository'

const actor = {
  id: 'human-lin',
  name: 'Lin',
  kind: 'human' as const,
  role: 'owner' as const,
  status: 'active' as const,
  client: null,
  capabilities: ['planning'],
  registeredAt: '2026-07-29T00:00:00.000Z',
  lastActiveAt: null,
  version: 3,
}

const success = (data: unknown) => ({
  data,
  error: null,
  meta: { request_id: 'request-1' },
})

const response = (data: unknown) => new Response(JSON.stringify(success(data)), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('actor repository', () => {
  it('posts strict human input and validates persisted output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(actor))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await expect(repository.createHuman({
      name: 'Lin',
      role: 'owner',
      capabilities: ['planning'],
    })).resolves.toEqual(actor)

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/actors')
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Lin',
      role: 'owner',
      capabilities: ['planning'],
    })
  })

  it('passes optimistic versions through edit and deactivate requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ...actor, name: 'Lin Q.', version: 4 }))
      .mockResolvedValueOnce(response({
        ...actor,
        name: 'Lin Q.',
        status: 'inactive',
        version: 5,
      }))
    vi.stubGlobal('fetch', fetchMock)
    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await repository.updateActor('human-lin', {
      name: 'Lin Q.',
      version: 3,
    })
    await repository.deactivateActor('human-lin', 4)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/actors/human-lin',
      '/api/actors/human-lin/deactivate',
    ])
    expect(JSON.parse(String(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body,
    ))).toEqual({ name: 'Lin Q.', version: 3 })
    expect(JSON.parse(String(
      (fetchMock.mock.calls[1]?.[1] as RequestInit).body,
    ))).toEqual({ version: 4 })
  })
})
