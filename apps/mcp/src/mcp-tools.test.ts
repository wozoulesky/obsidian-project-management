import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  ActorService,
  createTestDatabase,
  ProjectService,
} from '@project-os/core'
import type { DatabaseSync } from 'node:sqlite'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import { createProjectOsMcpServer } from './create-server.js'

type Harness = {
  call(
    name: string,
    arguments_: Record<string, unknown>,
  ): ReturnType<Client['callTool']>
  client: Client
  close(): Promise<void>
}

async function createInMemoryMcpClient(
  database: DatabaseSync,
): Promise<Harness> {
  const server = createProjectOsMcpServer({
    actors: new ActorService(database),
    projects: new ProjectService(database),
  })
  const client = new Client({
    name: 'project-os-mcp-test',
    version: '0.0.0',
  })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()

  await server.connect(serverTransport)
  await client.connect(clientTransport)

  return {
    client,
    call(name, arguments_) {
      return client.callTool({
        name,
        arguments: arguments_,
      })
    },
    async close() {
      await client.close()
      await server.close()
    },
  }
}

function structured(
  result: Awaited<ReturnType<Client['callTool']>>,
): Record<string, unknown> {
  expect(result.structuredContent).toBeDefined()
  return result.structuredContent as Record<string, unknown>
}

describe('Project OS MCP identity and project tools', () => {
  let database: DatabaseSync
  let harness: Harness

  beforeEach(async () => {
    database = createTestDatabase()
    harness = await createInMemoryMcpClient(database)
  })

  afterEach(async () => {
    await harness.close()
    database.close()
  })

  async function register(role = 'pm-agent') {
    const result = await harness.call('agent_register', {
      name: `test-${role}`,
      role,
      client: 'codex',
    })
    return structured(result)
  }

  it('discovers identity and project tools', async () => {
    const tools = await harness.client.listTools()

    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'agent_register',
        'agent_whoami',
        'agent_list',
        'project_create',
        'project_get',
        'project_list',
        'project_update',
      ]),
    )
  })

  it('registers idempotently and returns structured content', async () => {
    const input = {
      name: 'dev-agent',
      role: 'dev-agent',
      client: 'codex',
    }

    const first = await harness.call('agent_register', input)
    const second = await harness.call('agent_register', input)

    expect(structured(second).agent_id).toBe(structured(first).agent_id)
    expect(first.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('dev-agent'),
      }),
    ])
  })

  it('resumes an active identity and lists registered agents', async () => {
    const registered = await register('dev-agent')
    const agentId = registered.agent_id

    const whoami = await harness.call('agent_whoami', {
      agent_id: agentId,
    })
    const list = await harness.call('agent_list', {
      agent_id: agentId,
      status: 'active',
    })

    expect(structured(whoami)).toMatchObject({
      agent_id: agentId,
      role: 'dev-agent',
      client: 'codex',
    })
    expect(structured(list).agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent_id: agentId }),
      ]),
    )
  })

  it('creates, reads, lists and updates projects through shared services', async () => {
    const registered = await register()
    const agentId = registered.agent_id as string

    const created = await harness.call('project_create', {
      agent_id: agentId,
      name: 'MCP Project',
      description: 'Created through MCP',
      owner_id: agentId,
      due_date: '2026-08-31',
    })
    const createdProject = structured(created).project as Record<
      string,
      unknown
    >
    const projectId = createdProject.id as string

    const fetched = await harness.call('project_get', {
      agent_id: agentId,
      project_id: projectId,
    })
    const listed = await harness.call('project_list', {
      agent_id: agentId,
      owner_id: agentId,
    })
    const updated = await harness.call('project_update', {
      agent_id: agentId,
      project_id: projectId,
      name: 'Renamed MCP Project',
      version: createdProject.version,
    })

    expect(structured(fetched).project).toMatchObject({
      id: projectId,
      name: 'MCP Project',
    })
    expect(structured(listed).projects).toEqual([
      expect.objectContaining({ id: projectId }),
    ])
    expect(structured(updated).project).toMatchObject({
      id: projectId,
      name: 'Renamed MCP Project',
      version: 2,
    })
  })

  it('returns stable structured DomainError results', async () => {
    const registered = await register('dev-agent')

    const denied = await harness.call('project_create', {
      agent_id: registered.agent_id,
      name: 'Forbidden',
      owner_id: registered.agent_id,
    })

    expect(denied.isError).toBe(true)
    expect(structured(denied)).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'Actor is not permitted to perform this operation',
      details: {
        role: 'dev-agent',
        operation: 'project.write',
      },
    })
  })
})
