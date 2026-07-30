import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ExportDocument } from './export-service.js'
import {
  ExportService,
  replacePrimaryData,
  validateExportDocument,
} from './export-service.js'
import { createTestDatabase } from './database.js'

const timestamp = '2026-07-30T01:00:00.000Z'
const closedTimestamp = '2026-07-30T02:00:00.000Z'

function relayDocument(): ExportDocument {
  const owner = {
    id: 'actor_owner',
    name: 'Owner',
    kind: 'human' as const,
    role: 'owner' as const,
    status: 'active' as const,
    client: null,
    capabilities: [],
    registeredAt: timestamp,
    lastActiveAt: null,
    lastBriefingActivityId: null,
    version: 1,
  }
  const agent = {
    id: 'actor_agent',
    name: 'Builder',
    kind: 'agent' as const,
    role: 'dev-agent' as const,
    status: 'active' as const,
    client: 'codex',
    capabilities: ['typescript'],
    registeredAt: timestamp,
    lastActiveAt: closedTimestamp,
    lastBriefingActivityId: 'activity_cursor',
    version: 2,
  }
  const embeddedAgent = {
    id: agent.id,
    name: agent.name,
    kind: agent.kind,
    role: agent.role,
    status: agent.status,
    client: agent.client,
    capabilities: agent.capabilities,
    registeredAt: agent.registeredAt,
    lastActiveAt: agent.lastActiveAt,
    version: agent.version,
  }
  return {
    schemaVersion: 1 as const,
    exportedAt: closedTimestamp,
    actors: [owner, agent],
    projects: [{
      id: 'project_one',
      code: 'ONE',
      name: 'One',
      description: '',
      ownerId: owner.id,
      startDate: null,
      dueDate: null,
      status: 'in_progress' as const,
      progress: 50,
      createdAt: timestamp,
      updatedAt: closedTimestamp,
      version: 1,
    }, {
      id: 'project_two',
      code: 'TWO',
      name: 'Two',
      description: '',
      ownerId: owner.id,
      startDate: null,
      dueDate: null,
      status: 'in_progress' as const,
      progress: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    }],
    projectMembers: [{
      projectId: 'project_one',
      actorId: owner.id,
      membershipRole: 'owner' as const,
      joinedAt: timestamp,
    }, {
      projectId: 'project_one',
      actorId: agent.id,
      membershipRole: 'member' as const,
      joinedAt: timestamp,
    }, {
      projectId: 'project_two',
      actorId: owner.id,
      membershipRole: 'owner' as const,
      joinedAt: timestamp,
    }, {
      projectId: 'project_two',
      actorId: agent.id,
      membershipRole: 'member' as const,
      joinedAt: timestamp,
    }],
    tasks: [{
      id: 'task_one',
      code: 'TASK-1',
      projectId: 'project_one',
      title: 'Build relay',
      description: '',
      assigneeId: agent.id,
      assignee: embeddedAgent,
      startDate: '2026-07-30',
      dueDate: '2026-07-31',
      priority: 'P1' as const,
      status: 'done' as const,
      progress: 100,
      milestoneId: '',
      dependencyIds: [],
      createdAt: timestamp,
      updatedAt: closedTimestamp,
      version: 2,
    }, {
      id: 'task_two',
      code: 'TASK-1',
      projectId: 'project_two',
      title: 'Other work',
      description: '',
      assigneeId: agent.id,
      assignee: embeddedAgent,
      startDate: '2026-07-30',
      dueDate: '2026-07-31',
      priority: 'P2' as const,
      status: 'not_started' as const,
      progress: 0,
      milestoneId: '',
      dependencyIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    }],
    requirements: [{
      id: 'requirement_one',
      code: 'REQ-1',
      projectId: 'project_one',
      title: 'Relay survives',
      description: '',
      priority: 'P1' as const,
      status: 'accepted' as const,
      linkedTaskIds: ['task_one'],
      completedTaskCount: 1,
      acceptanceCriteria: ['Roundtrip'],
      createdAt: timestamp,
      updatedAt: closedTimestamp,
      version: 2,
    }, {
      id: 'requirement_two',
      code: 'REQ-1',
      projectId: 'project_two',
      title: 'Other requirement',
      description: '',
      priority: 'P2' as const,
      status: 'draft' as const,
      linkedTaskIds: [],
      completedTaskCount: 0,
      acceptanceCriteria: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    }],
    defects: [],
    sessions: [{
      id: 'session_one',
      projectId: 'project_one',
      agentId: agent.id,
      agent: embeddedAgent,
      intent: 'Finish relay support',
      taskIds: ['task_one'],
      status: 'closed' as const,
      summary: 'Relay support finished',
      createdAt: timestamp,
      lastActiveAt: closedTimestamp,
      closedAt: closedTimestamp,
    }],
    handoffs: [{
      id: 'handoff_one',
      projectId: 'project_one',
      sessionId: 'session_one',
      author: embeddedAgent,
      summary: 'Ready for review',
      done: ['Exported sessions'],
      blockers: [],
      nextSteps: ['Run the suite'],
      gotchas: ['Snapshots omit cursors'],
      refs: [{
        kind: 'commit' as const,
        ref: 'abc123',
        note: 'Implementation',
      }, {
        kind: 'url' as const,
        ref: 'https://example.test/review',
      }],
      createdAt: closedTimestamp,
    }],
    deliverables: [{
      id: 'deliverable_one',
      projectId: 'project_one',
      requirementId: 'requirement_one',
      taskId: 'task_one',
      title: 'Relay implementation',
      kind: 'commit' as const,
      ref: 'abc123',
      note: null,
      createdBy: embeddedAgent,
      sessionId: 'session_one',
      createdAt: closedTimestamp,
    }],
    settings: {
      theme: 'system' as const,
      background: 'soft' as const,
      accent: 'blue' as const,
      density: 'comfortable' as const,
      updatedAt: timestamp,
      version: 1,
    },
  }
}

function seedDocument(database: DatabaseSync, document = relayDocument()): void {
  replacePrimaryData(database, document)
}

function expectImportInvalid(input: unknown): void {
  expect(() => validateExportDocument(input)).toThrowError(
    expect.objectContaining({ code: 'IMPORT_INVALID' }),
  )
}

describe('relay export and import', () => {
  let source: DatabaseSync
  let target: DatabaseSync

  beforeEach(() => {
    source = createTestDatabase()
    target = createTestDatabase()
  })

  afterEach(() => {
    source.close()
    target.close()
  })

  it('exports persisted actor cursors while embedded actor snapshots omit them', () => {
    seedDocument(source)

    const exported = new ExportService(source).exportJson()

    expect(Object.fromEntries(exported.actors.map((actor) => [
      actor.id,
      actor.lastBriefingActivityId,
    ]))).toEqual({
      actor_agent: 'activity_cursor',
      actor_owner: null,
    })
    expect(exported.tasks[0]!.assignee)
      .not.toHaveProperty('lastBriefingActivityId')
    expect(exported.sessions[0]!.agent)
      .not.toHaveProperty('lastBriefingActivityId')
    expect(exported.handoffs[0]!.author)
      .not.toHaveProperty('lastBriefingActivityId')
    expect(exported.deliverables[0]!.createdBy)
      .not.toHaveProperty('lastBriefingActivityId')
  })

  it('round-trips sessions, handoffs, deliverables, and actor cursors losslessly', () => {
    seedDocument(source)
    const exported = new ExportService(source).exportJson()

    new ExportService(target).importJson(exported)
    const roundTripped = new ExportService(target).exportJson()

    expect(roundTripped.actors).toEqual(exported.actors)
    expect(roundTripped.sessions).toEqual(exported.sessions)
    expect(roundTripped.handoffs).toEqual(exported.handoffs)
    expect(roundTripped.deliverables).toEqual(exported.deliverables)
  })

  it('accepts a valid relay graph before checking relay-specific failures', () => {
    expect(validateExportDocument(relayDocument())).toMatchObject({
      sessions: [{ id: 'session_one' }],
      handoffs: [{ id: 'handoff_one' }],
      deliverables: [{ id: 'deliverable_one' }],
    })
  })

  it('rejects duplicate IDs and broken relay graph ownership before writing', () => {
    const cases: [string, (value: ReturnType<typeof relayDocument>) => void][] = [
      ['duplicate session', (value) => value.sessions.push(value.sessions[0]!)],
      ['session project', (value) => {
        value.sessions[0]!.projectId = 'missing'
      }],
      ['session agent kind', (value) => {
        value.sessions[0]!.agentId = 'actor_owner'
        value.sessions[0]!.agent = {
          ...value.sessions[0]!.agent,
          id: 'actor_owner',
          name: 'Owner',
          kind: 'human',
          role: 'owner',
          client: null,
          lastActiveAt: null,
          version: 1,
        }
      }],
      ['session snapshot', (value) => {
        value.sessions[0]!.agent.name = 'Wrong'
      }],
      ['session embedded cursor', (value) => {
        Object.assign(value.sessions[0]!.agent, {
          lastBriefingActivityId: 'activity_cursor',
        })
      }],
      ['session unknown key', (value) => {
        Object.assign(value.sessions[0]!, { surprise: true })
      }],
      ['session task project', (value) => {
        value.sessions[0]!.taskIds = ['task_two']
      }],
      ['abandoned stored session', (value) => {
        value.sessions[0]!.status = 'abandoned'
      }],
      ['closed session summary', (value) => {
        value.sessions[0]!.summary = null
      }],
      ['closed session timestamp', (value) => {
        value.sessions[0]!.closedAt = null
      }],
      ['active session closed state', (value) => {
        value.sessions[0]!.status = 'active'
      }],
      ['duplicate handoff', (value) => value.handoffs.push(value.handoffs[0]!)],
      ['handoff project', (value) => {
        value.handoffs[0]!.projectId = 'project_two'
      }],
      ['handoff author', (value) => {
        value.handoffs[0]!.author = {
          ...value.handoffs[0]!.author,
          id: 'actor_owner',
          name: 'Owner',
          kind: 'human',
          role: 'owner',
          client: null,
          lastActiveAt: null,
          version: 1,
        }
      }],
      ['handoff snapshot', (value) => {
        value.handoffs[0]!.author.name = 'Wrong'
      }],
      ['handoff session', (value) => {
        value.handoffs[0]!.sessionId = 'missing'
      }],
      ['duplicate deliverable', (value) =>
        value.deliverables.push(value.deliverables[0]!)],
      ['deliverable project', (value) => {
        value.deliverables[0]!.projectId = 'project_two'
      }],
      ['deliverable creator', (value) => {
        value.deliverables[0]!.createdBy = {
          ...value.deliverables[0]!.createdBy,
          id: 'actor_owner',
          name: 'Owner',
          kind: 'human',
          role: 'owner',
          client: null,
          lastActiveAt: null,
          version: 1,
        }
      }],
      ['deliverable snapshot', (value) => {
        value.deliverables[0]!.createdBy.name = 'Wrong'
      }],
      ['deliverable requirement project', (value) => {
        value.deliverables[0]!.requirementId = 'requirement_two'
      }],
      ['deliverable task project', (value) => {
        value.deliverables[0]!.taskId = 'task_two'
      }],
      ['deliverable association', (value) => {
        value.deliverables[0]!.requirementId = null
        value.deliverables[0]!.taskId = null
      }],
      ['deliverable session', (value) => {
        value.deliverables[0]!.sessionId = 'missing'
      }],
    ]

    for (const [, mutate] of cases) {
      const invalid = structuredClone(relayDocument())
      mutate(invalid)
      expectImportInvalid(invalid)
    }

    seedDocument(target)
    const service = new ExportService(target)
    const before = service.exportJson()
    const invalid = structuredClone(relayDocument())
    invalid.sessions[0]!.taskIds = ['task_two']

    expect(() => service.importJson(invalid)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_INVALID' }),
    )
    expect({
      ...service.exportJson(),
      exportedAt: before.exportedAt,
    }).toEqual(before)
  })

  it('replaces stale relay rows while preserving activities and access tokens', () => {
    seedDocument(source)
    const incoming = new ExportService(source).exportJson()
    const stale = structuredClone(relayDocument())
    stale.sessions[0]!.id = 'session_stale'
    stale.handoffs[0]!.id = 'handoff_stale'
    stale.handoffs[0]!.sessionId = 'session_stale'
    stale.deliverables[0]!.id = 'deliverable_stale'
    stale.deliverables[0]!.sessionId = 'session_stale'
    seedDocument(target, stale)
    target.prepare(`
      INSERT INTO activities (
        id, actor_id, project_id, source, operation, entity_type,
        entity_id, action, note, details_json, created_at
      ) VALUES (
        'activity_cursor', 'actor_agent', 'project_one', 'mcp',
        'session.note', 'session', 'session_stale', 'Preserved',
        NULL, '{}', ?
      )
    `).run(timestamp)
    target.prepare(`
      INSERT INTO access_tokens (
        id, name, token_hash, created_at, last_used_at, revoked_at, version
      ) VALUES ('token_one', 'one', 'digest', ?, NULL, NULL, 1)
    `).run(timestamp)

    new ExportService(target).importJson(incoming)

    expect(target.prepare('SELECT id FROM sessions ORDER BY id').all())
      .toEqual([{ id: 'session_one' }])
    expect(target.prepare('SELECT id FROM handoffs ORDER BY id').all())
      .toEqual([{ id: 'handoff_one' }])
    expect(target.prepare('SELECT id FROM deliverables ORDER BY id').all())
      .toEqual([{ id: 'deliverable_one' }])
    expect(target.prepare('SELECT id FROM activities').all())
      .toEqual([{ id: 'activity_cursor' }])
    expect(target.prepare('SELECT id FROM access_tokens').all())
      .toEqual([{ id: 'token_one' }])
  })

  it('rolls back every replacement when relay insertion fails', () => {
    seedDocument(source)
    seedDocument(target)
    const service = new ExportService(target)
    const before = service.exportJson()
    target.exec(`
      CREATE TRIGGER reject_imported_session
      BEFORE INSERT ON sessions
      BEGIN
        SELECT RAISE(ABORT, 'relay insertion failed');
      END;
    `)

    expect(() => service.importJson(new ExportService(source).exportJson()))
      .toThrowError(expect.objectContaining({ code: 'IMPORT_INVALID' }))
    expect({
      ...service.exportJson(),
      exportedAt: before.exportedAt,
    }).toEqual(before)
  })
})
