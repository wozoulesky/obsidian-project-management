import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  ActivityService,
  ActorService,
  createTestDatabase,
  DashboardService,
  DefectService,
  ProjectService,
  RequirementService,
  TaskService,
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
    activities: new ActivityService(database),
    actors: new ActorService(database),
    dashboard: new DashboardService(database),
    defects: new DefectService(database),
    projects: new ProjectService(database),
    requirements: new RequirementService(database),
    tasks: new TaskService(database),
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
        'task_create',
        'task_get',
        'task_list',
        'task_update',
        'progress_submit',
        'requirement_create',
        'requirement_get',
        'requirement_list',
        'requirement_update',
        'defect_create',
        'defect_get',
        'defect_list',
        'defect_update',
        'defect_to_task',
        'dashboard_snapshot',
        'list_overdue',
        'activity_log',
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
      code: 'AGENT_PERMISSION_DENIED',
      message: 'Actor is not permitted to perform this operation',
      details: {
        role: 'dev-agent',
        operation: 'project.write',
      },
    })
  })

  it('rejects unknown registration keys before identity creation', async () => {
    const invalid = await harness.call('agent_register', {
      name: 'typo-agent',
      role: 'dev-agent',
      client: 'codex',
      capabilities_typo: ['write'],
    })

    expect(invalid.isError).toBe(true)
    expect(new ActorService(database).list({ kind: 'agent' })).toEqual([])
  })

  it('rejects unknown project update keys before the handler executes', async () => {
    const registered = await register()
    const agentId = registered.agent_id as string
    const created = await harness.call('project_create', {
      agent_id: agentId,
      name: 'Strict Project',
      owner_id: agentId,
    })
    const project = structured(created).project as Record<string, unknown>
    const projectId = project.id as string
    const actorBefore = new ActorService(database).get(agentId)

    const invalid = await harness.call('project_update', {
      agent_id: agentId,
      project_id: projectId,
      statsu: 'completed',
      version: project.version,
    })

    expect(invalid.isError).toBe(true)
    expect(new ProjectService(database).get(projectId)).toMatchObject({
      status: 'not_started',
      version: 1,
    })
    expect(new ActorService(database).get(agentId).version).toBe(
      actorBefore.version,
    )
  })

  it('rejects a partial project list cursor before the handler executes', async () => {
    const registered = await register()
    const agentId = registered.agent_id as string
    const actorBefore = new ActorService(database).get(agentId)

    const invalid = await harness.call('project_list', {
      agent_id: agentId,
      after_code: 'PRJ-0001',
    })

    expect(invalid.isError).toBe(true)
    expect(new ActorService(database).get(agentId).version).toBe(
      actorBefore.version,
    )
  })

  it('submits progress and exposes it in MCP activity', async () => {
    const pm = await register()
    const dev = await register('dev-agent')
    const pmId = pm.agent_id as string
    const devId = dev.agent_id as string
    const createdProject = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Delivery Project',
      owner_id: pmId,
    })
    const project = structured(createdProject).project as Record<
      string,
      unknown
    >
    const projectId = project.id as string
    new ProjectService(database).addMember(projectId, devId, pmId, 'mcp')

    const createdTask = await harness.call('task_create', {
      agent_id: pmId,
      project_id: projectId,
      title: 'Ship MCP',
      assignee_id: devId,
      start_date: '2026-07-01',
      due_date: '2026-07-31',
      priority: 'P1',
    })
    const task = structured(createdTask).task as Record<string, unknown>

    const progress = await harness.call('progress_submit', {
      agent_id: devId,
      task_id: task.id,
      progress: 80,
      status: 'in_progress',
      note: 'MCP complete',
      version: task.version,
    })
    const activities = await harness.call('activity_log', {
      agent_id: devId,
      entity_id: task.id,
      limit: 10,
    })

    expect(structured(progress).task).toMatchObject({
      id: task.id,
      progress: 80,
      status: 'in_progress',
      version: 2,
    })
    expect(structured(activities).items).toEqual([
      expect.objectContaining({
        source: 'mcp',
        operation: 'task.progress',
        note: 'MCP complete',
      }),
      expect.objectContaining({
        source: 'mcp',
        operation: 'task.create',
      }),
    ])
  })

  it('returns AGENT_PERMISSION_DENIED for a dev requirement write', async () => {
    const pm = await register()
    const dev = await register('dev-agent')
    const pmId = pm.agent_id as string
    const createdProject = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Requirements Project',
      owner_id: pmId,
    })
    const project = structured(createdProject).project as Record<
      string,
      unknown
    >
    const createdRequirement = await harness.call('requirement_create', {
      agent_id: pmId,
      project_id: project.id,
      title: 'Approved scope',
      priority: 'P1',
    })
    const requirement = structured(createdRequirement)
      .requirement as Record<string, unknown>

    const denied = await harness.call('requirement_update', {
      agent_id: dev.agent_id,
      requirement_id: requirement.id,
      status: 'accepted',
      version: requirement.version,
    })

    expect(denied.isError).toBe(true)
    expect(structured(denied).code).toBe('AGENT_PERMISSION_DENIED')
    expect(new RequirementService(database).get(
      requirement.id as string,
    )).toMatchObject({
      status: 'draft',
      version: 1,
    })
  })

  it('enforces task versions, strict keys and composite pagination', async () => {
    const pm = await register()
    const pmId = pm.agent_id as string
    const createdProject = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Task Project',
      owner_id: pmId,
    })
    const project = structured(createdProject).project as Record<
      string,
      unknown
    >
    const first = await harness.call('task_create', {
      agent_id: pmId,
      project_id: project.id,
      title: 'First task',
      assignee_id: pmId,
      start_date: '2026-07-01',
      due_date: '2026-07-20',
      priority: 'P2',
    })
    await harness.call('task_create', {
      agent_id: pmId,
      project_id: project.id,
      title: 'Second task',
      assignee_id: pmId,
      start_date: '2026-07-02',
      due_date: '2026-07-21',
      priority: 'P2',
    })
    const firstTask = structured(first).task as Record<string, unknown>
    const pageOne = await harness.call('task_list', {
      agent_id: pmId,
      project_id: project.id,
      limit: 1,
    })
    const firstPageItems = structured(pageOne).items as Array<
      Record<string, unknown>
    >
    const pageTwo = await harness.call('task_list', {
      agent_id: pmId,
      project_id: project.id,
      after_project_id: firstPageItems[0]?.projectId,
      after_code: firstPageItems[0]?.code,
      after_id: firstPageItems[0]?.id,
      limit: 1,
    })
    const partialCursor = await harness.call('task_list', {
      agent_id: pmId,
      after_code: firstPageItems[0]?.code,
    })
    const typo = await harness.call('task_update', {
      agent_id: pmId,
      task_id: firstTask.id,
      statsu: 'done',
      version: firstTask.version,
    })
    const updated = await harness.call('task_update', {
      agent_id: pmId,
      task_id: firstTask.id,
      title: 'Updated first task',
      version: firstTask.version,
    })
    const stale = await harness.call('task_update', {
      agent_id: pmId,
      task_id: firstTask.id,
      title: 'Stale update',
      version: firstTask.version,
    })

    expect(firstPageItems).toHaveLength(1)
    expect(structured(pageTwo).items).toEqual([
      expect.objectContaining({ title: 'Second task' }),
    ])
    expect(partialCursor.isError).toBe(true)
    expect(typo.isError).toBe(true)
    expect(structured(updated).task).toMatchObject({
      title: 'Updated first task',
      version: 2,
    })
    expect(stale.isError).toBe(true)
    expect(structured(stale).code).toBe('TASK_VERSION_CONFLICT')
  })

  it('supports requirement, defect and report workflows', async () => {
    const pm = await register()
    const qa = await register('qa-agent')
    const pmId = pm.agent_id as string
    const qaId = qa.agent_id as string
    const createdProject = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Quality Project',
      owner_id: pmId,
    })
    const project = structured(createdProject).project as Record<
      string,
      unknown
    >
    const projectId = project.id as string
    new ProjectService(database).addMember(projectId, qaId, pmId, 'mcp')

    const createdRequirement = await harness.call('requirement_create', {
      agent_id: pmId,
      project_id: projectId,
      title: 'Quality gate',
      priority: 'P0',
      acceptance_criteria: ['No critical defects'],
    })
    const requirement = structured(createdRequirement)
      .requirement as Record<string, unknown>
    const fetchedRequirement = await harness.call('requirement_get', {
      agent_id: pmId,
      requirement_id: requirement.id,
    })
    const listedRequirements = await harness.call('requirement_list', {
      agent_id: pmId,
      project_id: projectId,
      limit: 1,
    })
    const updatedRequirement = await harness.call('requirement_update', {
      agent_id: pmId,
      requirement_id: requirement.id,
      status: 'reviewed',
      version: requirement.version,
    })

    const createdDefect = await harness.call('defect_create', {
      agent_id: qaId,
      project_id: projectId,
      title: 'Broken gate',
      severity: 'serious',
      assignee_id: qaId,
      reproduction_steps: ['Open the gate'],
      linked_requirement_id: requirement.id,
    })
    const defect = structured(createdDefect).defect as Record<
      string,
      unknown
    >
    const fetchedDefect = await harness.call('defect_get', {
      agent_id: qaId,
      defect_id: defect.id,
    })
    const listedDefects = await harness.call('defect_list', {
      agent_id: qaId,
      project_id: projectId,
      limit: 1,
    })
    const updatedDefect = await harness.call('defect_update', {
      agent_id: qaId,
      defect_id: defect.id,
      description: 'Confirmed by QA',
      version: defect.version,
    })
    const converted = await harness.call('defect_to_task', {
      agent_id: pmId,
      defect_id: defect.id,
      start_date: '2026-07-01',
      due_date: '2026-07-02',
      version: (structured(updatedDefect).defect as Record<string, unknown>)
        .version,
    })
    const dashboard = await harness.call('dashboard_snapshot', {
      agent_id: pmId,
      project_id: projectId,
      today: '2026-07-29',
      activity_limit: 10,
    })
    const overdue = await harness.call('list_overdue', {
      agent_id: pmId,
      project_id: projectId,
      today: '2026-07-29',
    })

    expect(structured(fetchedRequirement).requirement).toMatchObject({
      id: requirement.id,
    })
    expect(structured(listedRequirements).items).toHaveLength(1)
    expect(structured(updatedRequirement).requirement).toMatchObject({
      status: 'reviewed',
      version: 2,
    })
    expect(structured(fetchedDefect).defect).toMatchObject({ id: defect.id })
    expect(structured(listedDefects).items).toHaveLength(1)
    expect(structured(updatedDefect).defect).toMatchObject({
      description: 'Confirmed by QA',
      version: 2,
    })
    expect(structured(converted).task).toMatchObject({
      projectId,
      assigneeId: qaId,
    })
    expect(structured(dashboard).snapshot).toMatchObject({
      metrics: expect.objectContaining({
        totalTasks: 1,
        totalRequirements: 1,
        activeDefects: 1,
      }),
    })
    expect(structured(overdue).items).toEqual([
      expect.objectContaining({
        id: (structured(converted).task as Record<string, unknown>).id,
        status: 'overdue',
      }),
    ])
  })
})
