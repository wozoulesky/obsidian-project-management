import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  ActivityService,
  ActorService,
  BriefingService,
  createTestDatabase,
  DashboardService,
  DefectService,
  DeliverableService,
  HandoffService,
  ProjectService,
  RequirementService,
  SessionService,
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
import type { ProjectOsMcpServices } from './create-server.js'

type Harness = {
  call(
    name: string,
    arguments_: Record<string, unknown>,
  ): ReturnType<Client['callTool']>
  client: Client
  services: ProjectOsMcpServices
  close(): Promise<void>
}

async function createInMemoryMcpClient(
  database: DatabaseSync,
): Promise<Harness> {
  const services = {
    activities: new ActivityService(database),
    actors: new ActorService(database),
    briefing: new BriefingService(database),
    dashboard: new DashboardService(database),
    defects: new DefectService(database),
    deliverables: new DeliverableService(database),
    handoffs: new HandoffService(database),
    projects: new ProjectService(database),
    requirements: new RequirementService(database),
    sessions: new SessionService(database),
    tasks: new TaskService(database),
  }
  const server = createProjectOsMcpServer(services)
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
    services,
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

  it('advertises exactly the approved strict MCP tool contract', async () => {
    const tools = await harness.client.listTools()

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'activity_log',
      'agent_list',
      'agent_register',
      'agent_whoami',
      'dashboard_snapshot',
      'defect_create',
      'defect_list',
      'defect_to_task',
      'defect_update',
      'list_overdue',
      'progress_submit',
      'project_briefing',
      'project_create',
      'project_get',
      'project_list',
      'project_update',
      'deliverable_record',
      'requirement_create',
      'requirement_list',
      'requirement_update',
      'session_checkin',
      'session_checkout',
      'session_note',
      'task_create',
      'task_get',
      'task_list',
      'task_update',
    ].sort())
    expect(tools.tools).toHaveLength(27)
    for (const tool of tools.tools) {
      expect(tool.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      })
    }
    for (const name of [
      'session_checkin',
      'project_briefing',
      'session_note',
      'session_checkout',
      'deliverable_record',
    ]) {
      expect(tools.tools.find((tool) => tool.name === name)?.annotations)
        .toMatchObject({
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: name === 'project_briefing',
          openWorldHint: false,
        })
    }
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
    const agentId = registered.agent_id as string

    const whoami = await harness.call('agent_whoami', {
      agent_id: agentId,
    })
    const actorAfterWhoami = new ActorService(database).get(agentId)
    const list = await harness.call('agent_list', {
      agent_id: agentId,
      status: 'active',
    })

    expect(structured(whoami)).toMatchObject({
      agent_id: agentId,
      role: 'dev-agent',
      client: 'codex',
      version: actorAfterWhoami.version,
      last_active_at: actorAfterWhoami.lastActiveAt,
    })
    expect(structured(list).agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent_id: agentId }),
      ]),
    )
  })

  it('returns an MCP error instead of read data when the caller touch fails', async () => {
    const registered = await register()
    const agentId = registered.agent_id as string
    const actorBefore = new ActorService(database).get(agentId)
    database.exec(`
      CREATE TRIGGER fail_read_actor_touch
      BEFORE UPDATE OF last_active_at ON actors
      BEGIN
        SELECT RAISE(ABORT, 'forced read touch failure');
      END
    `)

    const failed = await harness.call('agent_list', {
      agent_id: agentId,
    })

    expect(failed.isError).toBe(true)
    expect(structured(failed)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Tool execution failed',
      details: {},
    })
    expect(JSON.stringify(failed)).not.toMatch(
      /forced read touch failure|sqlite|trigger/i,
    )
    expect(new ActorService(database).get(agentId)).toEqual(actorBefore)
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
    expect(structured(invalid)).toMatchObject({
      code: 'INPUT_INVALID',
      message: 'Tool input failed validation',
      details: {},
    })
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
    expect(structured(invalid)).toMatchObject({
      code: 'INPUT_INVALID',
      message: 'Tool input failed validation',
      details: {},
    })
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
    expect(structured(invalid)).toMatchObject({
      code: 'INPUT_INVALID',
      message: 'Tool input failed validation',
      details: {},
    })
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

  it('takes the activity log snapshot before recording its read touch', async () => {
    const registered = await register()
    const agentId = registered.agent_id as string

    const result = await harness.call('activity_log', {
      agent_id: agentId,
      limit: 200,
    })
    const returned = structured(result).items as Array<{
      id: string
    }>
    const persisted = new ActivityService(database).list({ limit: 200 })
    const returnedIds = new Set(returned.map(({ id }) => id))
    const touchActivities = persisted.filter(({ id }) =>
      !returnedIds.has(id))

    expect(persisted).toHaveLength(returned.length + 1)
    expect(touchActivities).toHaveLength(1)
    expect(touchActivities[0]).toMatchObject({
      actorId: agentId,
      operation: 'actor.update',
      source: 'mcp',
    })
  })

  it('runs every collaboration tool and returns structured content', async () => {
    const pm = await register()
    const dev = await register('dev-agent')
    const pmId = pm.agent_id as string
    const devId = dev.agent_id as string
    const createdProject = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Collaboration Project',
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
      title: 'Implement collaboration tools',
      assignee_id: devId,
      start_date: '2026-07-30',
      due_date: '2026-08-01',
      priority: 'P0',
    })
    const task = structured(createdTask).task as Record<string, unknown>
    const createdRequirement = await harness.call('requirement_create', {
      agent_id: pmId,
      project_id: projectId,
      title: 'Relay Agent context',
      priority: 'P0',
      linked_task_ids: [task.id],
    })
    const requirement = structured(createdRequirement)
      .requirement as Record<string, unknown>

    const checkedIn = await harness.call('session_checkin', {
      agent_id: devId,
      project_id: projectId,
      intent: 'Implement the relay',
      task_ids: [task.id],
    })
    const checkinContent = structured(checkedIn)
    const session = checkinContent.session as Record<string, unknown>
    expect(session).toMatchObject({
      projectId,
      agentId: devId,
      intent: 'Implement the relay',
      taskIds: [task.id],
      status: 'active',
    })
    expect(checkinContent.briefing).toMatchObject({
      project: { id: projectId },
      sessions: [
        expect.objectContaining({ id: session.id, status: 'active' }),
      ],
    })

    const briefing = await harness.call('project_briefing', {
      agent_id: devId,
      project_id: projectId,
    })
    expect(structured(briefing).briefing).toMatchObject({
      project: { id: projectId },
      my_tasks: [expect.objectContaining({ id: task.id })],
    })

    const noted = await harness.call('session_note', {
      agent_id: devId,
      session_id: session.id,
      task_id: task.id,
      note: 'The MCP seam is wired',
    })
    expect(structured(noted).activity).toMatchObject({
      actorId: devId,
      projectId,
      operation: 'session.note',
      entityType: 'task',
      entityId: task.id,
      note: 'The MCP seam is wired',
    })

    const recorded = await harness.call('deliverable_record', {
      agent_id: devId,
      project_id: projectId,
      requirement_id: requirement.id,
      task_id: task.id,
      session_id: session.id,
      title: 'Relay implementation',
      kind: 'commit',
      ref: 'abc123',
      note: 'Ready for QA',
    })
    expect(structured(recorded).deliverable).toMatchObject({
      projectId,
      requirementId: requirement.id,
      taskId: task.id,
      sessionId: session.id,
      title: 'Relay implementation',
      kind: 'commit',
      ref: 'abc123',
      note: 'Ready for QA',
      createdBy: { id: devId },
    })

    const checkedOut = await harness.call('session_checkout', {
      agent_id: devId,
      session_id: session.id,
      summary: 'Relay implementation complete',
      done: ['MCP collaboration tools'],
      blockers: [],
      next_steps: ['QA verification'],
    })
    expect(structured(checkedOut)).toMatchObject({
      session: {
        id: session.id,
        status: 'closed',
        summary: 'Relay implementation complete',
      },
      handoff: {
        projectId,
        sessionId: session.id,
        author: { id: devId },
        summary: 'Relay implementation complete',
        done: ['MCP collaboration tools'],
        blockers: [],
        nextSteps: ['QA verification'],
        gotchas: [],
        refs: [],
      },
    })
  })

  it('rejects collaboration schema errors before mutation or actor touch', async () => {
    const pm = await register()
    const dev = await register('dev-agent')
    const pmId = pm.agent_id as string
    const devId = dev.agent_id as string
    const createdProject = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Strict Collaboration',
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
      title: 'Strict input task',
      assignee_id: devId,
      start_date: '2026-07-30',
      due_date: '2026-08-01',
      priority: 'P1',
    })
    const task = structured(createdTask).task as Record<string, unknown>
    const validCheckin = await harness.call('session_checkin', {
      agent_id: devId,
      project_id: projectId,
      intent: 'Validate strict inputs',
      task_ids: [task.id],
    })
    const session = structured(validCheckin).session as Record<
      string,
      unknown
    >
    const actorBefore = new ActorService(database).get(devId)
    const sessionBefore = new SessionService(database).get(
      session.id as string,
    )
    const invalidInputs = [
      ['session_checkin', {
        agent_id: devId,
        project_id: projectId,
        intent: 'Unknown key',
        task_ids: [],
        task_idz: [],
      }],
      ['project_briefing', {
        agent_id: devId,
        project_id: projectId,
        unexpected: true,
      }],
      ['session_note', {
        agent_id: devId,
        session_id: session.id,
        note: 'Unknown key',
        unexpected: true,
      }],
      ['session_checkout', {
        agent_id: devId,
        session_id: session.id,
        summary: 'Unknown key',
        done: [],
        blockers: [],
        next_steps: [],
        unexpected: true,
      }],
      ['deliverable_record', {
        agent_id: devId,
        project_id: projectId,
        task_id: task.id,
        title: 'Unknown key',
        kind: 'note',
        ref: 'relay',
        unexpected: true,
      }],
      ['session_checkin', {
        agent_id: devId,
        project_id: projectId,
        intent: '',
      }],
      ['session_checkin', {
        agent_id: devId,
        project_id: projectId,
        intent: 'Too many tasks',
        task_ids: Array.from({ length: 21 }, () => task.id),
      }],
      ['session_note', {
        agent_id: devId,
        session_id: session.id,
        note: '',
      }],
      ['deliverable_record', {
        agent_id: devId,
        project_id: projectId,
        title: 'Missing association',
        kind: 'note',
        ref: 'relay',
      }],
      ['deliverable_record', {
        agent_id: devId,
        project_id: projectId,
        task_id: task.id,
        title: '',
        kind: 'note',
        ref: '',
      }],
    ] as const

    for (const [name, input] of invalidInputs) {
      const invalid = await harness.call(name, input)
      expect(invalid.isError, name).toBe(true)
      expect(structured(invalid), name).toEqual({
        code: 'INPUT_INVALID',
        message: 'Tool input failed validation',
        details: {},
      })
    }

    expect(new ActorService(database).get(devId)).toEqual(actorBefore)
    expect(new SessionService(database).get(session.id as string))
      .toEqual(sessionBefore)
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM sessions
    `).get()).toEqual({ count: 1 })
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM deliverables
    `).get()).toEqual({ count: 0 })
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM activities
      WHERE operation = 'session.note'
    `).get()).toEqual({ count: 0 })
  })

  it('denies doc-agent deliverables before mutation or touch', async () => {
    const pm = await register()
    const doc = await register('doc-agent')
    const pmId = pm.agent_id as string
    const docId = doc.agent_id as string
    const createdProject = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Documentation Project',
      owner_id: pmId,
    })
    const project = structured(createdProject).project as Record<
      string,
      unknown
    >
    const createdRequirement = await harness.call('requirement_create', {
      agent_id: pmId,
      project_id: project.id,
      title: 'Record implementation evidence',
      priority: 'P1',
    })
    const requirement = structured(createdRequirement)
      .requirement as Record<string, unknown>
    const actorBefore = new ActorService(database).get(docId)

    const denied = await harness.call('deliverable_record', {
      agent_id: docId,
      project_id: project.id,
      requirement_id: requirement.id,
      title: 'Forbidden evidence',
      kind: 'url',
      ref: 'https://example.invalid/evidence',
    })

    expect(denied.isError).toBe(true)
    expect(structured(denied)).toEqual({
      code: 'AGENT_PERMISSION_DENIED',
      message: 'Actor is not permitted to perform this operation',
      details: {
        role: 'doc-agent',
        operation: 'deliverable.record',
      },
    })
    expect(new ActorService(database).get(docId)).toEqual(actorBefore)
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM deliverables
    `).get()).toEqual({ count: 0 })
  })

  it('enforces session ownership and rejects notes after checkout', async () => {
    const pm = await register()
    const dev = await register('dev-agent')
    const qa = await register('qa-agent')
    const pmId = pm.agent_id as string
    const devId = dev.agent_id as string
    const qaId = qa.agent_id as string
    const createdProject = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Owned Sessions',
      owner_id: pmId,
    })
    const project = structured(createdProject).project as Record<
      string,
      unknown
    >
    const checkedIn = await harness.call('session_checkin', {
      agent_id: devId,
      project_id: project.id,
      intent: 'Own this session',
    })
    const session = structured(checkedIn).session as Record<string, unknown>

    const forbiddenNote = await harness.call('session_note', {
      agent_id: qaId,
      session_id: session.id,
      note: 'Not mine',
    })
    const forbiddenCheckout = await harness.call('session_checkout', {
      agent_id: qaId,
      session_id: session.id,
      summary: 'Not mine',
      done: [],
      blockers: [],
      next_steps: [],
    })
    expect(structured(forbiddenNote).code).toBe('SESSION_FORBIDDEN')
    expect(structured(forbiddenCheckout).code).toBe('SESSION_FORBIDDEN')

    await harness.call('session_checkout', {
      agent_id: devId,
      session_id: session.id,
      summary: 'Owner checked out',
      done: [],
      blockers: [],
      next_steps: [],
    })
    const closedNote = await harness.call('session_note', {
      agent_id: devId,
      session_id: session.id,
      note: 'Too late',
    })
    expect(structured(closedNote).code).toBe('SESSION_CLOSED')
  })

  it('lists activity newer than since in ASC order and rejects cursor conflicts', async () => {
    const pm = await register()
    const dev = await register('dev-agent')
    const pmId = pm.agent_id as string
    const devId = dev.agent_id as string
    const createdProject = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Incremental Activity',
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
      title: 'Incremental task',
      assignee_id: devId,
      start_date: '2026-07-30',
      due_date: '2026-08-01',
      priority: 'P1',
    })
    const task = structured(createdTask).task as Record<string, unknown>
    const cursor = new ActivityService(database).latestCursor({ projectId })
    expect(cursor).toBeTypeOf('string')
    await harness.call('progress_submit', {
      agent_id: devId,
      task_id: task.id,
      progress: 25,
      status: 'in_progress',
      note: 'First incremental event',
      version: task.version,
    })
    await harness.call('requirement_create', {
      agent_id: pmId,
      project_id: projectId,
      title: 'Second incremental event',
      priority: 'P1',
      linked_task_ids: [task.id],
    })

    const newer = await harness.call('activity_log', {
      agent_id: devId,
      project_id: projectId,
      since: cursor,
      limit: 20,
    })
    const items = structured(newer).items as Array<Record<string, unknown>>
    expect(items.map(({ operation }) => operation)).toEqual([
      'task.progress',
      'requirement.create',
    ])
    expect(items.map(({ id }) => id)).toEqual(
      new ActivityService(database).listNewer({
        after: cursor as string,
        projectId,
        limit: 20,
      }).slice(0, 2).map(({ id }) => id),
    )

    const actorBefore = new ActorService(database).get(devId)
    const conflict = await harness.call('activity_log', {
      agent_id: devId,
      project_id: projectId,
      after: cursor,
      since: cursor,
    })
    expect(conflict.isError).toBe(true)
    expect(structured(conflict).code).toBe('INPUT_INVALID')
    expect(new ActorService(database).get(devId)).toEqual(actorBefore)
  })

  it('rolls back collaboration writes when the actor touch fails', async () => {
    const pm = await register()
    const dev = await register('dev-agent')
    const pmId = pm.agent_id as string
    const devId = dev.agent_id as string
    const createdProject = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Atomic Collaboration',
      owner_id: pmId,
    })
    const project = structured(createdProject).project as Record<
      string,
      unknown
    >
    const actorBefore = new ActorService(database).get(devId)
    database.exec(`
      CREATE TRIGGER fail_collaboration_actor_touch
      BEFORE UPDATE OF last_active_at ON actors
      WHEN OLD.id = '${devId}'
      BEGIN
        SELECT RAISE(ABORT, 'forced collaboration touch failure');
      END
    `)

    const failed = await harness.call('session_checkin', {
      agent_id: devId,
      project_id: project.id,
      intent: 'Must roll back',
    })

    expect(failed.isError).toBe(true)
    expect(structured(failed)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Tool execution failed',
      details: {},
    })
    expect(new ActorService(database).get(devId)).toEqual(actorBefore)
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM sessions
    `).get()).toEqual({ count: 0 })
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM activities
      WHERE operation = 'session.checkin'
    `).get()).toEqual({ count: 0 })
  })

  it("relays Agent A's structured checkout and activity trail to Agent B's first session briefing", async () => {
    const pm = await register()
    const agentA = await register('dev-agent')
    const agentB = await register('qa-agent')
    const pmId = pm.agent_id as string
    const agentAId = agentA.agent_id as string
    const agentBId = agentB.agent_id as string
    const createdProject = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Double-Agent Relay',
      owner_id: pmId,
    })
    const project = structured(createdProject).project as Record<
      string,
      unknown
    >
    const projectId = project.id as string
    const projects = new ProjectService(database)
    projects.addMember(projectId, agentAId, pmId, 'mcp')
    projects.addMember(projectId, agentBId, pmId, 'mcp')
    const createdTask = await harness.call('task_create', {
      agent_id: pmId,
      project_id: projectId,
      title: 'Build relay contract',
      assignee_id: agentAId,
      start_date: '2026-07-30',
      due_date: '2026-08-02',
      priority: 'P0',
    })
    const task = structured(createdTask).task as Record<string, unknown>
    const createdRequirement = await harness.call('requirement_create', {
      agent_id: pmId,
      project_id: projectId,
      title: 'Preserve structured Agent context',
      description: 'Agent B receives Agent A relay state',
      priority: 'P0',
      acceptance_criteria: ['Briefing contains the structured handoff'],
      linked_task_ids: [task.id],
    })
    const requirement = structured(createdRequirement)
      .requirement as Record<string, unknown>

    const agentACheckin = await harness.call('session_checkin', {
      agent_id: agentAId,
      project_id: projectId,
      intent: 'Implement relay contract',
      task_ids: [task.id],
    })
    const agentASession = structured(agentACheckin)
      .session as Record<string, unknown>
    await harness.call('progress_submit', {
      agent_id: agentAId,
      task_id: task.id,
      progress: 80,
      status: 'in_progress',
      note: 'Relay implementation ready for QA',
      version: task.version,
    })
    await harness.call('session_note', {
      agent_id: agentAId,
      session_id: agentASession.id,
      task_id: task.id,
      note: 'Briefing activity ordering verified',
    })
    const delivered = await harness.call('deliverable_record', {
      agent_id: agentAId,
      project_id: projectId,
      requirement_id: requirement.id,
      task_id: task.id,
      session_id: agentASession.id,
      title: 'Double-Agent relay implementation',
      kind: 'commit',
      ref: 'relay-commit-abc123',
      note: 'Includes MCP tools and incremental activity',
    })
    const deliverable = structured(delivered)
      .deliverable as Record<string, unknown>
    await harness.call('session_checkout', {
      agent_id: agentAId,
      session_id: agentASession.id,
      summary: 'Relay MCP tools implemented and ready for QA',
      done: [
        'Implemented collaboration tools',
        'Added incremental activity cursor',
      ],
      blockers: ['No external blockers'],
      next_steps: ['Run QA acceptance suite'],
      gotchas: ['Briefing cursors advance transactionally'],
      refs: [{
        kind: 'commit',
        ref: 'relay-commit-abc123',
        note: 'Implementation commit',
      }],
    })

    const agentBCheckin = await harness.call('session_checkin', {
      agent_id: agentBId,
      project_id: projectId,
      intent: 'Verify Agent A relay',
      task_ids: [task.id],
    })
    const agentBContent = structured(agentBCheckin)
    const agentBSession = agentBContent.session as Record<string, unknown>
    const briefing = agentBContent.briefing as Record<string, any>

    expect(briefing.latest_handoff).toMatchObject({
      projectId,
      sessionId: agentASession.id,
      author: { id: agentAId },
      summary: 'Relay MCP tools implemented and ready for QA',
      done: [
        'Implemented collaboration tools',
        'Added incremental activity cursor',
      ],
      blockers: ['No external blockers'],
      nextSteps: ['Run QA acceptance suite'],
      gotchas: ['Briefing cursors advance transactionally'],
      refs: [{
        kind: 'commit',
        ref: 'relay-commit-abc123',
        note: 'Implementation commit',
      }],
    })
    expect(briefing.new_activities.map(
      ({ operation }: { operation: string }) => operation,
    )).toEqual(expect.arrayContaining([
      'task.progress',
      'session.note',
      'deliverable.record',
      'handoff.update',
      'session.checkout',
    ]))
    expect(briefing.recent_deliverables).toEqual([
      expect.objectContaining({
        id: deliverable.id,
        requirementId: requirement.id,
        taskId: task.id,
        sessionId: agentASession.id,
        createdBy: expect.objectContaining({ id: agentAId }),
      }),
    ])
    expect(briefing.sessions).toEqual([
      expect.objectContaining({
        id: agentBSession.id,
        agentId: agentBId,
        taskIds: [task.id],
        status: 'active',
      }),
    ])
    expect(briefing.sessions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: agentASession.id }),
      ]),
    )
    expect(briefing.in_progress_tasks).toEqual([
      expect.objectContaining({
        task: expect.objectContaining({
          id: task.id,
          assigneeId: agentAId,
          progress: 80,
          status: 'in_progress',
        }),
        latest_progress: {
          note: 'Relay implementation ready for QA',
          actor_name: 'test-dev-agent',
          created_at: expect.any(String),
        },
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
    expect(structured(partialCursor)).toMatchObject({
      code: 'INPUT_INVALID',
      message: 'Tool input failed validation',
      details: {},
    })
    expect(typo.isError).toBe(true)
    expect(structured(typo)).toMatchObject({
      code: 'INPUT_INVALID',
      message: 'Tool input failed validation',
      details: {},
    })
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

    expect(structured(listedRequirements).items).toHaveLength(1)
    expect(structured(updatedRequirement).requirement).toMatchObject({
      status: 'reviewed',
      version: 2,
    })
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

  it('rolls back an MCP business write when the atomic actor touch fails', async () => {
    const pm = await register()
    const pmId = pm.agent_id as string
    const actorBefore = new ActorService(database).get(pmId)
    database.exec(`
      CREATE TRIGGER fail_actor_touch
      BEFORE UPDATE OF last_active_at ON actors
      BEGIN
        SELECT RAISE(ABORT, 'forced actor touch failure');
      END
    `)

    const failed = await harness.call('project_create', {
      agent_id: pmId,
      name: 'Must roll back',
      owner_id: pmId,
    })

    expect(failed.isError).toBe(true)
    expect(new ProjectService(database).list()).toEqual([])
    expect(new ActorService(database).get(pmId)).toEqual(actorBefore)
    expect(database.prepare(`
      SELECT operation
      FROM activities
      WHERE operation = 'project.create'
    `).all()).toEqual([])
  })
})
