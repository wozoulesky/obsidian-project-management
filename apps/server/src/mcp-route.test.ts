import {
  createServer,
  request as httpRequest,
} from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest'
import { createApp } from './app.js'
import {
  createAppContext,
} from './context.js'
import type { AppContext } from './context.js'

const contexts: AppContext[] = []
const directories: string[] = []
const runtimes: Array<{
  app: ReturnType<typeof createApp>
  server: Server
}> = []

function testContext(): AppContext {
  const directory = mkdtempSync(join(tmpdir(), 'project-os-mcp-http-'))
  directories.push(directory)
  const context = createAppContext({
    databasePath: join(directory, 'http.db'),
    backupRoot: join(directory, 'backups'),
  })
  contexts.push(context)
  return context
}

async function listen(
  app: ReturnType<typeof createApp>,
  host = '127.0.0.1',
) {
  const server = createServer(app)
  runtimes.push({ app, server })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('HTTP test server has no TCP address')
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  }
}

async function postInitialize(
  baseUrl: string,
  options: {
    headers?: Record<string, string>
    id: number
    name: string
  },
): Promise<{
  headers: Record<string, string | string[] | undefined>
  status: number
}> {
  const target = new URL(`${baseUrl}/mcp`)
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: options.id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: options.name, version: '0.0.0' },
    },
  })
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(body),
        'Content-Type': 'application/json',
        ...options.headers,
      },
    }, (response) => {
      response.resume()
      response.once('end', () => {
        resolve({
          headers: response.headers,
          status: response.statusCode ?? 0,
        })
      })
    })
    request.once('error', reject)
    request.end(body)
  })
}

afterEach(async () => {
  for (const { app, server } of runtimes.splice(0)) {
    await app.mcp.close()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }
  for (const context of contexts.splice(0)) {
    context.close()
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Streamable HTTP MCP route', () => {
  it('lists and calls tools through the single loopback endpoint', async () => {
    const context = testContext()
    const { baseUrl } = await listen(createApp({
      context,
      mcpBindingHost: '127.0.0.1',
    }))
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
    )
    const client = new Client({
      name: 'project-os-http-test',
      version: '0.0.0',
    })

    try {
      await client.connect(
        transport as Parameters<typeof client.connect>[0],
      )
      const tools = await client.listTools()
      const registered = await client.callTool({
        name: 'agent_register',
        arguments: {
          name: 'http-agent',
          role: 'pm-agent',
          client: 'codex',
        },
      })

      expect(tools.tools.map((tool) => tool.name)).toContain('project_list')
      expect(registered.structuredContent).toMatchObject({
        name: 'http-agent',
      })
      const sessionId = transport.sessionId
      expect(sessionId).toBeTypeOf('string')
      await transport.terminateSession()
      const deleted = await fetch(`${baseUrl}/mcp`, {
        headers: { 'Mcp-Session-Id': sessionId! },
      })
      expect(deleted.status).toBe(404)
    } finally {
      await client.close()
    }
  })

  it('rejects invalid sessions and unsupported methods', async () => {
    const { baseUrl } = await listen(createApp({
      context: testContext(),
      mcpBindingHost: '127.0.0.1',
    }))

    const missingSession = await fetch(`${baseUrl}/mcp`)
    const invalidSession = await fetch(`${baseUrl}/mcp`, {
      headers: { 'Mcp-Session-Id': 'missing-session' },
    })
    const invalidMethod = await fetch(`${baseUrl}/mcp`, {
      method: 'PUT',
    })

    expect(missingSession.status).toBe(400)
    expect(invalidSession.status).toBe(404)
    expect(invalidMethod.status).toBe(405)
    expect(invalidMethod.headers.get('allow')).toBe('POST, GET, DELETE')
  })

  it('requires and verifies bearer tokens for non-loopback binding', async () => {
    const context = testContext()
    const issued = context.services.tokens.issue('remote-mcp')
    const app = createApp({
      context,
      mcpBindingHost: '0.0.0.0',
      allowedHosts: ['project-os.test'],
      allowedOrigins: ['https://console.project-os.test'],
    })
    const { baseUrl } = await listen(app, '0.0.0.0')
    const missing = await postInitialize(baseUrl, {
      headers: {
        Host: 'project-os.test',
      },
      id: 1,
      name: 'unauthenticated',
    })
    const invalid = await postInitialize(baseUrl, {
      headers: {
        Authorization: 'Bearer pos_invalid',
        Host: 'project-os.test',
      },
      id: 2,
      name: 'invalid-token',
    })
    const dnsRebind = await postInitialize(baseUrl, {
      headers: {
        Authorization: `Bearer ${issued.token}`,
        Host: 'evil.example',
      },
      id: 3,
      name: 'dns-rebind',
    })
    const hostileOrigin = await postInitialize(baseUrl, {
      headers: {
        Authorization: `Bearer ${issued.token}`,
        Host: 'project-os.test',
        Origin: 'https://evil.example',
      },
      id: 4,
      name: 'hostile-origin',
    })
    const valid = await postInitialize(baseUrl, {
      headers: {
        Authorization: `Bearer ${issued.token}`,
        Host: 'project-os.test',
        Origin: 'https://console.project-os.test',
      },
      id: 5,
      name: 'authenticated',
    })

    expect(missing.status).toBe(401)
    expect(invalid.status).toBe(401)
    expect(dnsRebind.status).toBe(403)
    expect(hostileOrigin.status).toBe(403)
    expect(valid.status).toBe(200)
    expect(context.services.tokens.list()[0]?.lastUsedAt).not.toBeNull()
  })

  it('bounds sessions and reclaims abandoned sessions after sliding idle TTL', async () => {
    const app = createApp({
      context: testContext(),
      mcpOptions: {
        cleanupIntervalMs: 5,
        maxSessions: 1,
        sessionIdleTtlMs: 80,
      },
    })
    const { baseUrl } = await listen(app)
    const first = await postInitialize(baseUrl, {
      id: 10,
      name: 'capacity-owner',
    })
    const sessionId = first.headers['mcp-session-id']
    expect(sessionId).toBeTypeOf('string')
    expect(app.mcp.sessionCount).toBe(1)
    const second = await postInitialize(baseUrl, {
      id: 11,
      name: 'capacity-rejected',
    })
    expect(second.status).toBe(503)

    await delay(45)
    const touched = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId as string,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    })
    expect(touched.status).toBe(202)
    await delay(45)
    expect(app.mcp.sessionCount).toBe(1)

    const deadline = Date.now() + 1_000
    while (app.mcp.sessionCount !== 0 && Date.now() < deadline) {
      await delay(10)
    }
    expect(app.mcp.sessionCount).toBe(0)
    const abandoned = await fetch(`${baseUrl}/mcp`, {
      headers: {
        'Mcp-Session-Id': sessionId as string,
      },
    })
    expect(abandoned.status).toBe(404)
  })
})
