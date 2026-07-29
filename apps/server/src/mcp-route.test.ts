import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const servers: Server[] = []

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

async function listen(app: ReturnType<typeof createApp>) {
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
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

afterEach(async () => {
  for (const server of servers.splice(0)) {
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
    const { baseUrl } = await listen(createApp({
      context,
      mcpBindingHost: '0.0.0.0',
    }))

    const missing = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'unauthenticated', version: '0.0.0' },
        },
      }),
    })
    const invalid = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer pos_invalid',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'invalid-token', version: '0.0.0' },
        },
      }),
    })
    const hostileOrigin = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.token}`,
        'Content-Type': 'application/json',
        Origin: 'https://example.com',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'hostile-origin', version: '0.0.0' },
        },
      }),
    })
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${issued.token}` },
        },
      },
    )
    const client = new Client({
      name: 'authenticated-http-test',
      version: '0.0.0',
    })

    expect(missing.status).toBe(401)
    expect(invalid.status).toBe(401)
    expect(hostileOrigin.status).toBe(403)
    try {
      await client.connect(
        transport as Parameters<typeof client.connect>[0],
      )
      expect((await client.listTools()).tools.length).toBeGreaterThan(20)
    } finally {
      await client.close()
    }
    expect(context.services.tokens.list()[0]?.lastUsedAt).not.toBeNull()
  })
})
