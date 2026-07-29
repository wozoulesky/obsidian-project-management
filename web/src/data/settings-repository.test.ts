import { persistedAppSettingsSchema } from '@project-os/contracts'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ApiClient } from './api-client'
import { createHttpProjectRepository } from './http-project-repository'

function success(data: unknown) {
  return {
    data,
    error: null,
    meta: { request_id: 'request-settings' },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('settings repository', () => {
  it('does not override the browser multipart boundary for FormData', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(success({ ok: true })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const form = new FormData()
    form.append('file', new File(['{}'], 'data.json', {
      type: 'application/json',
    }))

    await new ApiClient('/api').request(
      '/import',
      z.object({ ok: z.literal(true) }),
      { method: 'POST', body: form },
    )

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).has('Content-Type')).toBe(false)
  })

  it('updates settings with the caller version and validates the response', async () => {
    const updated = {
      theme: 'dark',
      background: 'gradient',
      accent: 'purple',
      density: 'compact',
      updatedAt: '2026-07-29T12:00:00.000Z',
      version: 3,
    }
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(success(updated)),
    )
    vi.stubGlobal('fetch', fetchMock)
    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await expect(repository.updateSettings({
      theme: 'dark',
      background: 'gradient',
      accent: 'purple',
      density: 'compact',
      version: 2,
    })).resolves.toEqual(persistedAppSettingsSchema.parse(updated))

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/settings')
    expect(JSON.parse(String(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body,
    ))).toEqual({
      theme: 'dark',
      background: 'gradient',
      accent: 'purple',
      density: 'compact',
      version: 2,
    })
  })

  it('uses the real health, token, backup, export and multipart import routes', async () => {
    const settings = {
      theme: 'system',
      background: 'soft',
      accent: 'blue',
      density: 'comfortable',
      updatedAt: '2026-07-29T12:00:00.000Z',
      version: 1,
    }
    const token = {
      id: 'token-1',
      name: 'codex',
      createdAt: '2026-07-29T12:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
      version: 1,
    }
    const issued = {
      ...token,
      token: `pos_${'a'.repeat(24)}_${'b'.repeat(43)}`,
    }
    const responses = [
      { status: 'ok', database: 'ok' },
      [token],
      issued,
      { ...token, revokedAt: '2026-07-29T13:00:00.000Z', version: 2 },
      { filename: 'project-os-safe.sqlite', path: 'backups/project-os-safe.sqlite' },
      { filename: 'project-os-safe.sqlite', path: 'backups/project-os-safe.sqlite' },
      {
        schemaVersion: 1,
        exportedAt: '2026-07-29T12:00:00.000Z',
        actors: [],
        projects: [],
        projectMembers: [],
        tasks: [],
        requirements: [],
        defects: [],
        settings,
      },
      {
        ok: true,
        counts: {
          actors: 1,
          projects: 2,
          projectMembers: 3,
          tasks: 4,
          requirements: 5,
          defects: 6,
        },
      },
    ]
    const fetchMock = vi.fn()
    for (const response of responses) {
      fetchMock.mockResolvedValueOnce(jsonResponse(success(response)))
    }
    vi.stubGlobal('fetch', fetchMock)
    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await expect(repository.getHealth()).resolves.toEqual(responses[0])
    await expect(repository.listTokens()).resolves.toEqual([token])
    await expect(repository.issueToken('codex')).resolves.toEqual(issued)
    await repository.revokeToken('token-1', 1)
    await repository.createBackup('project-os-safe.sqlite')
    await repository.restoreBackup('project-os-safe.sqlite')
    await expect(repository.exportData()).resolves.toEqual(responses[6])
    const imported = await repository.importData(new File(
      ['{}'],
      'project-os.json',
      { type: 'application/json' },
    ))
    expect(imported).toEqual(responses[7])

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/health',
      '/api/tokens',
      '/api/tokens',
      '/api/tokens/token-1/revoke',
      '/api/backups',
      '/api/backups/restore',
      '/api/export',
      '/api/import',
    ])
    const importInit = fetchMock.mock.calls[7]?.[1] as RequestInit
    expect(importInit.body).toBeInstanceOf(FormData)
    expect(new Headers(importInit.headers).has('Content-Type')).toBe(false)
  })

  it('loads validated stdio Skill snippets from client-specific routes', async () => {
    const snippets = [
      {
        client: 'codex',
        transport: 'stdio',
        snippet: '[mcp_servers.project-os]',
      },
      {
        client: 'claude-code',
        transport: 'stdio',
        snippet: 'claude mcp add --transport stdio',
      },
      {
        client: 'kimi-code',
        transport: 'stdio',
        snippet: '{"mcpServers":{}}',
      },
    ]
    const fetchMock = vi.fn()
    for (const snippet of snippets) {
      fetchMock.mockResolvedValueOnce(jsonResponse(success(snippet)))
    }
    vi.stubGlobal('fetch', fetchMock)
    const repository = createHttpProjectRepository(new ApiClient('/api'))

    await expect(repository.getSkillConfigSnippet('codex'))
      .resolves.toEqual(snippets[0])
    await expect(repository.getSkillConfigSnippet('claude-code'))
      .resolves.toEqual(snippets[1])
    await expect(repository.getSkillConfigSnippet('kimi-code'))
      .resolves.toEqual(snippets[2])

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/skills/project-os/config-snippets/codex',
      '/api/skills/project-os/config-snippets/claude-code',
      '/api/skills/project-os/config-snippets/kimi-code',
    ])
  })
})
