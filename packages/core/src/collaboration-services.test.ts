import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityService } from './activity-service.js'
import { ActorService } from './actor-service.js'
import { createTestDatabase } from './database.js'
import * as publicApi from './index.js'

type CollaborationServiceName =
  | 'SessionService'
  | 'HandoffService'
  | 'DeliverableService'

function requiredService(name: CollaborationServiceName) {
  expect(publicApi).toHaveProperty(name)
  return (publicApi as unknown as Record<
    CollaborationServiceName,
    new (database: DatabaseSync) => any
  >)[name]
}

const fixtureTimestamp = '2026-07-30T01:00:00.000Z'

function insertActor(
  database: DatabaseSync,
  {
    id,
    name,
    kind,
  }: {
    id: string
    name: string
    kind: 'human' | 'agent'
  },
): void {
  database.prepare(`
    INSERT INTO actors (
      id, name, kind, role, status, client, capabilities_json,
      registered_at, last_active_at, last_briefing_activity_id, version
    ) VALUES (?, ?, ?, ?, 'active', ?, '[]', ?, ?, NULL, 1)
  `).run(
    id,
    name,
    kind,
    kind === 'human' ? 'owner' : 'dev-agent',
    kind === 'human' ? null : 'codex',
    fixtureTimestamp,
    kind === 'human' ? null : fixtureTimestamp,
  )
}

function insertProject(
  database: DatabaseSync,
  id: string,
  code: string,
  ownerId = 'actor_owner',
): void {
  database.prepare(`
    INSERT INTO projects (
      id, code, name, description, owner_id, start_date, due_date,
      status, progress, created_at, updated_at, version
    ) VALUES (?, ?, ?, '', ?, NULL, NULL, 'in_progress', 0, ?, ?, 1)
  `).run(id, code, code, ownerId, fixtureTimestamp, fixtureTimestamp)
}

function insertTask(
  database: DatabaseSync,
  id: string,
  projectId: string,
  code: string,
): void {
  database.prepare(`
    INSERT INTO tasks (
      id, code, project_id, title, description, assignee_id,
      start_date, due_date, priority, status, progress, milestone_id,
      parent_id, dependency_ids_json, created_at, updated_at, version
    ) VALUES (
      ?, ?, ?, ?, '', 'actor_agent', '2026-07-01', '2026-07-31',
      'P1', 'in_progress', 25, '', NULL, '[]', ?, ?, 1
    )
  `).run(
    id,
    code,
    projectId,
    code,
    fixtureTimestamp,
    fixtureTimestamp,
  )
}

function insertRequirement(
  database: DatabaseSync,
  id: string,
  projectId: string,
  code: string,
): void {
  database.prepare(`
    INSERT INTO requirements (
      id, code, project_id, title, description, priority, status,
      acceptance_criteria_json, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, '', 'P1', 'developing', '[]', ?, ?, 1)
  `).run(
    id,
    code,
    projectId,
    code,
    fixtureTimestamp,
    fixtureTimestamp,
  )
}

function seedCollaboration(database: DatabaseSync) {
  insertActor(database, {
    id: 'actor_owner',
    name: 'Owner',
    kind: 'human',
  })
  insertActor(database, {
    id: 'actor_agent',
    name: 'Builder',
    kind: 'agent',
  })
  insertActor(database, {
    id: 'actor_other_agent',
    name: 'Other builder',
    kind: 'agent',
  })
  insertProject(database, 'project_one', 'ONE')
  insertProject(database, 'project_two', 'TWO')
  insertTask(database, 'task_one', 'project_one', 'TASK-0001')
  insertTask(database, 'task_two', 'project_two', 'TASK-0001')
  insertRequirement(
    database,
    'requirement_one',
    'project_one',
    'REQ-0001',
  )
  insertRequirement(
    database,
    'requirement_two',
    'project_two',
    'REQ-0001',
  )
  return {
    projectId: 'project_one',
    otherProjectId: 'project_two',
    agentId: 'actor_agent',
    otherAgentId: 'actor_other_agent',
    humanId: 'actor_owner',
    taskId: 'task_one',
    otherTaskId: 'task_two',
    requirementId: 'requirement_one',
    otherRequirementId: 'requirement_two',
  }
}

function rows(
  database: DatabaseSync,
  sql: string,
  ...values: (string | number | null)[]
): Record<string, unknown>[] {
  return database.prepare(sql).all(...values) as Record<string, unknown>[]
}

describe('collaboration actor snapshots', () => {
  let database: DatabaseSync

  beforeEach(() => {
    database = createTestDatabase()
  })

  afterEach(() => {
    database.close()
  })

  it('preserves nullable and non-null briefing cursors on actor reads', () => {
    const timestamp = '2026-07-30T01:00:00.000Z'
    const insertActor = database.prepare(`
      INSERT INTO actors (
        id, name, kind, role, status, client, capabilities_json,
        registered_at, last_active_at, last_briefing_activity_id, version
      ) VALUES (?, ?, 'agent', 'dev-agent', 'active', 'codex', '[]',
        ?, ?, ?, 1)
    `)
    insertActor.run(
      'actor_null_cursor',
      'No cursor',
      timestamp,
      timestamp,
      null,
    )
    insertActor.run(
      'actor_with_cursor',
      'With cursor',
      timestamp,
      timestamp,
      'activity_cursor',
    )

    const actors = new ActorService(database)

    expect(actors.get('actor_null_cursor').lastBriefingActivityId).toBeNull()
    expect(actors.get('actor_with_cursor').lastBriefingActivityId)
      .toBe('activity_cursor')
    expect(
      actors.list({ kind: 'agent' })
        .map(({ lastBriefingActivityId }) => lastBriefingActivityId),
    ).toEqual([null, 'activity_cursor'])
  })

  it('preserves the actor briefing cursor in activity mapper inputs', () => {
    const timestamp = '2026-07-30T01:00:00.000Z'
    database.prepare(`
      INSERT INTO actors (
        id, name, kind, role, status, client, capabilities_json,
        registered_at, last_active_at, last_briefing_activity_id, version
      ) VALUES (
        'actor_agent', 'Builder', 'agent', 'dev-agent', 'active',
        'codex', '[]', ?, ?, 'activity_cursor', 1
      )
    `).run(timestamp, timestamp)
    database.prepare(`
      INSERT INTO activities (
        id, actor_id, project_id, source, operation, entity_type,
        entity_id, action, note, details_json, created_at
      ) VALUES (
        'activity_cursor', 'actor_agent', NULL, 'mcp', 'session.note',
        'session', 'session_one', 'Noted session', NULL, '{}', ?
      )
    `).run(timestamp)

    const [activity] = new ActivityService(database).list()

    expect(activity?.actor).toMatchObject({ id: 'actor_agent' })
    expect(activity?.actor).not.toHaveProperty('lastBriefingActivityId')
  })
})

describe('SessionService', () => {
  let database: DatabaseSync
  let fixture: ReturnType<typeof seedCollaboration>

  beforeEach(() => {
    database = createTestDatabase()
    fixture = seedCollaboration(database)
  })

  afterEach(() => {
    database.close()
  })

  function sessions() {
    const SessionService = requiredService('SessionService')
    return new SessionService(database)
  }

  it('checks an agent into valid project tasks and records one activity', () => {
    const session = sessions().checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Implement relay services',
      taskIds: [fixture.taskId],
    })

    expect(session).toMatchObject({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Implement relay services',
      taskIds: [fixture.taskId],
      status: 'active',
      summary: null,
      closedAt: null,
      agent: {
        id: fixture.agentId,
        kind: 'agent',
      },
    })
    expect(session.agent).not.toHaveProperty('lastBriefingActivityId')
    expect(rows(database, `
      SELECT operation, entity_type, entity_id, source
      FROM activities
    `)).toEqual([{
      operation: 'session.checkin',
      entity_type: 'session',
      entity_id: session.id,
      source: 'mcp',
    }])
  })

  it('rejects missing and cross-project tasks with SESSION_TASK_INVALID', () => {
    const service = sessions()
    for (const taskId of ['task_missing', fixture.otherTaskId]) {
      expect(() => service.checkin({
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        intent: 'Invalid task',
        taskIds: [taskId],
      })).toThrowError(expect.objectContaining({
        code: 'SESSION_TASK_INVALID',
        details: expect.objectContaining({ taskId }),
      }))
    }
    expect(rows(database, 'SELECT id FROM sessions')).toEqual([])
    expect(rows(database, 'SELECT id FROM activities')).toEqual([])
  })

  it('requires an existing project and an agent actor at checkin', () => {
    const service = sessions()
    expect(() => service.checkin({
      projectId: 'project_missing',
      agentId: fixture.agentId,
      intent: 'Missing project',
      taskIds: [],
    })).toThrowError(expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }))
    expect(() => service.checkin({
      projectId: fixture.projectId,
      agentId: 'actor_missing',
      intent: 'Missing actor',
      taskIds: [],
    })).toThrowError(expect.objectContaining({ code: 'ACTOR_NOT_FOUND' }))
    expect(() => service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.humanId,
      intent: 'Human cannot check in',
      taskIds: [],
    })).toThrowError(expect.objectContaining({
      code: 'ACTOR_AGENT_REQUIRED',
    }))
  })

  it('rejects an inactive agent at checkin', () => {
    database.prepare(`
      UPDATE actors SET status = 'inactive' WHERE id = ?
    `).run(fixture.agentId)

    expect(() => sessions().checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Inactive checkin',
      taskIds: [fixture.taskId],
    })).toThrowError(expect.objectContaining({
      code: 'ACTOR_INACTIVE',
      details: { actorId: fixture.agentId },
    }))
    expect(rows(database, 'SELECT id FROM sessions')).toEqual([])
    expect(rows(database, 'SELECT id FROM activities')).toEqual([])
  })

  it('rolls checkin back if recording its activity fails', () => {
    database.exec(`
      CREATE TRIGGER fail_session_checkin_activity
      BEFORE INSERT ON activities
      WHEN NEW.operation = 'session.checkin'
      BEGIN
        SELECT RAISE(FAIL, 'forced session checkin activity failure');
      END;
    `)

    expect(() => sessions().checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Atomic checkin',
      taskIds: [fixture.taskId],
    })).toThrow(/forced session checkin activity failure/)

    expect(rows(database, 'SELECT id FROM sessions')).toEqual([])
    expect(rows(database, 'SELECT id FROM activities')).toEqual([])
  })

  it('adds task and session notes, touches activity time, and returns activity', () => {
    const service = sessions()
    const session = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Take notes',
      taskIds: [fixture.taskId],
    })
    database.prepare(`
      UPDATE sessions SET last_active_at = ? WHERE id = ?
    `).run('2026-07-01T00:00:00.000Z', session.id)

    const taskNote = service.note({
      sessionId: session.id,
      agentId: fixture.agentId,
      note: 'Implemented transaction boundary',
      taskId: fixture.taskId,
    })
    expect(taskNote).toMatchObject({
      actorId: fixture.agentId,
      projectId: fixture.projectId,
      operation: 'session.note',
      entityType: 'task',
      entityId: fixture.taskId,
      source: 'mcp',
      note: 'Implemented transaction boundary',
    })
    expect(service.get(session.id).lastActiveAt)
      .not.toBe('2026-07-01T00:00:00.000Z')

    const sessionNote = service.note({
      sessionId: session.id,
      agentId: fixture.agentId,
      note: 'No task context',
    })
    expect(sessionNote).toMatchObject({
      entityType: 'session',
      entityId: session.id,
      note: 'No task context',
    })
  })

  it('enforces note ownership, active persisted status, and project task', () => {
    const service = sessions()
    const session = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Validate notes',
      taskIds: [],
    })

    expect(() => service.note({
      sessionId: session.id,
      agentId: fixture.otherAgentId,
      note: 'Wrong owner',
    })).toThrowError(expect.objectContaining({ code: 'SESSION_FORBIDDEN' }))
    for (const taskId of ['task_missing', fixture.otherTaskId]) {
      expect(() => service.note({
        sessionId: session.id,
        agentId: fixture.agentId,
        note: 'Wrong task',
        taskId,
      })).toThrowError(expect.objectContaining({
        code: 'SESSION_TASK_INVALID',
      }))
    }

    database.prepare(`
      UPDATE sessions SET status = 'closed', closed_at = ? WHERE id = ?
    `).run(fixtureTimestamp, session.id)
    expect(() => service.note({
      sessionId: session.id,
      agentId: fixture.agentId,
      note: 'Too late',
    })).toThrowError(expect.objectContaining({ code: 'SESSION_CLOSED' }))
  })

  it('re-checks that the owning agent is active before adding a note', () => {
    const service = sessions()
    const session = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Inactive note',
      taskIds: [],
    })
    const oldTimestamp = '2026-07-01T00:00:00.000Z'
    database.prepare(`
      UPDATE sessions SET last_active_at = ? WHERE id = ?
    `).run(oldTimestamp, session.id)
    database.prepare(`
      UPDATE actors SET status = 'inactive' WHERE id = ?
    `).run(fixture.agentId)

    expect(() => service.note({
      sessionId: session.id,
      agentId: fixture.agentId,
      note: 'Must not be written',
    })).toThrowError(expect.objectContaining({
      code: 'ACTOR_INACTIVE',
      details: { actorId: fixture.agentId },
    }))
    expect(rows(database, `
      SELECT last_active_at FROM sessions WHERE id = ?
    `, session.id)).toEqual([{ last_active_at: oldTimestamp }])
    expect(rows(database, `
      SELECT id FROM activities WHERE operation = 'session.note'
    `)).toEqual([])
  })

  it('rolls the last-active touch back if note activity insertion fails', () => {
    const service = sessions()
    const session = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Atomic note',
      taskIds: [],
    })
    const oldTimestamp = '2026-07-01T00:00:00.000Z'
    database.prepare(`
      UPDATE sessions SET last_active_at = ? WHERE id = ?
    `).run(oldTimestamp, session.id)
    database.exec(`
      CREATE TRIGGER fail_session_note_activity
      BEFORE INSERT ON activities
      WHEN NEW.operation = 'session.note'
      BEGIN
        SELECT RAISE(FAIL, 'forced session note activity failure');
      END;
    `)

    expect(() => service.note({
      sessionId: session.id,
      agentId: fixture.agentId,
      note: 'Must roll back',
    })).toThrow(/forced session note activity failure/)
    expect(rows(database, `
      SELECT last_active_at FROM sessions WHERE id = ?
    `, session.id)).toEqual([{ last_active_at: oldTimestamp }])
    expect(rows(database, `
      SELECT id FROM activities WHERE operation = 'session.note'
    `)).toEqual([])
  })

  it('computes abandoned sessions without persisting abandoned status', () => {
    const service = sessions()
    const abandoned = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Went silent',
      taskIds: [],
    })
    database.prepare(`
      UPDATE sessions SET last_active_at = ? WHERE id = ?
    `).run('2026-07-01T00:00:00.000Z', abandoned.id)

    expect(service.get(abandoned.id).status).toBe('abandoned')
    expect(service.listForProject({
      projectId: fixture.projectId,
    }).map(({ status }: { status: string }) => status))
      .toEqual(['abandoned'])
    expect(rows(database, `
      SELECT status FROM sessions WHERE id = ?
    `, abandoned.id)).toEqual([{ status: 'active' }])
  })

  it('lists sessions deterministically and excludes only closed by default', () => {
    const service = sessions()
    const first = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'First',
      taskIds: [],
    })
    const second = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Second',
      taskIds: [],
    })
    const closed = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Closed',
      taskIds: [],
    })
    database.prepare(`
      UPDATE sessions SET created_at = ? WHERE id IN (?, ?, ?)
    `).run(fixtureTimestamp, first.id, second.id, closed.id)
    database.prepare(`
      UPDATE sessions
      SET status = 'closed', summary = 'Done', closed_at = ?
      WHERE id = ?
    `).run(fixtureTimestamp, closed.id)

    expect(service.listForProject({
      projectId: fixture.projectId,
    }).map(({ id }: { id: string }) => id)).toEqual([second.id, first.id])
    expect(service.listForProject({
      projectId: fixture.projectId,
      includeClosed: true,
    }).map(({ id }: { id: string }) => id))
      .toEqual([closed.id, second.id, first.id])
  })

  it('checks out atomically with one handoff and exactly two activities', () => {
    const service = sessions()
    const session = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Ship collaboration services',
      taskIds: [fixture.taskId],
    })

    const result = service.checkout({
      sessionId: session.id,
      agentId: fixture.agentId,
      summary: 'Implemented collaboration services',
      done: ['Session service', 'Handoff service'],
      blockers: ['None'],
      nextSteps: ['Wire MCP'],
      gotchas: ['SQLite triggers can abort writes'],
      refs: [{
        kind: 'commit',
        ref: 'abc123',
        note: 'Implementation commit',
      }],
    })

    expect(result.session).toMatchObject({
      id: session.id,
      status: 'closed',
      summary: 'Implemented collaboration services',
    })
    expect(result.session.closedAt).toBeTypeOf('string')
    expect(result.handoff).toMatchObject({
      projectId: fixture.projectId,
      sessionId: session.id,
      author: { id: fixture.agentId },
      summary: 'Implemented collaboration services',
      done: ['Session service', 'Handoff service'],
      blockers: ['None'],
      nextSteps: ['Wire MCP'],
      gotchas: ['SQLite triggers can abort writes'],
      refs: [{
        kind: 'commit',
        ref: 'abc123',
        note: 'Implementation commit',
      }],
    })
    expect(rows(database, `
      SELECT operation
      FROM activities
      WHERE operation IN ('handoff.update', 'session.checkout')
      ORDER BY rowid
    `)).toEqual([
      { operation: 'handoff.update' },
      { operation: 'session.checkout' },
    ])
  })

  it('enforces checkout ownership and persisted active status', () => {
    const service = sessions()
    const session = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Validate checkout',
      taskIds: [],
    })
    const input = {
      sessionId: session.id,
      agentId: fixture.otherAgentId,
      summary: 'Summary',
      done: [],
      blockers: [],
      nextSteps: [],
      gotchas: [],
      refs: [],
    }
    expect(() => service.checkout(input)).toThrowError(
      expect.objectContaining({ code: 'SESSION_FORBIDDEN' }),
    )
    database.prepare(`
      UPDATE sessions SET status = 'closed', closed_at = ? WHERE id = ?
    `).run(fixtureTimestamp, session.id)
    expect(() => service.checkout({
      ...input,
      agentId: fixture.agentId,
    })).toThrowError(expect.objectContaining({ code: 'SESSION_CLOSED' }))
  })

  it('re-checks that the owning agent is active before checkout', () => {
    const service = sessions()
    const session = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Inactive checkout',
      taskIds: [],
    })
    database.prepare(`
      UPDATE actors SET status = 'inactive' WHERE id = ?
    `).run(fixture.agentId)

    expect(() => service.checkout({
      sessionId: session.id,
      agentId: fixture.agentId,
      summary: 'Must not close',
      done: [],
      blockers: [],
      nextSteps: [],
      gotchas: [],
      refs: [],
    })).toThrowError(expect.objectContaining({
      code: 'ACTOR_INACTIVE',
      details: { actorId: fixture.agentId },
    }))
    expect(rows(database, `
      SELECT status, summary, closed_at FROM sessions WHERE id = ?
    `, session.id)).toEqual([{
      status: 'active',
      summary: null,
      closed_at: null,
    }])
    expect(rows(database, 'SELECT id FROM handoffs')).toEqual([])
    expect(rows(database, `
      SELECT operation FROM activities ORDER BY rowid
    `)).toEqual([{ operation: 'session.checkin' }])
  })

  it('rolls back session close, handoff, and activities on checkout failure', () => {
    const service = sessions()
    const session = service.checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Atomic checkout',
      taskIds: [],
    })
    database.exec(`
      CREATE TRIGGER fail_session_checkout_activity
      BEFORE INSERT ON activities
      WHEN NEW.operation = 'session.checkout'
      BEGIN
        SELECT RAISE(FAIL, 'forced session checkout activity failure');
      END;
    `)

    expect(() => service.checkout({
      sessionId: session.id,
      agentId: fixture.agentId,
      summary: 'Must roll back',
      done: ['Nested handoff'],
      blockers: [],
      nextSteps: [],
      gotchas: [],
      refs: [],
    })).toThrow(/forced session checkout activity failure/)

    expect(rows(database, `
      SELECT status, summary, closed_at FROM sessions WHERE id = ?
    `, session.id)).toEqual([{
      status: 'active',
      summary: null,
      closed_at: null,
    }])
    expect(rows(database, 'SELECT id FROM handoffs')).toEqual([])
    expect(rows(database, `
      SELECT operation FROM activities ORDER BY rowid
    `)).toEqual([{ operation: 'session.checkin' }])
  })
})

describe('HandoffService', () => {
  let database: DatabaseSync
  let fixture: ReturnType<typeof seedCollaboration>

  beforeEach(() => {
    database = createTestDatabase()
    fixture = seedCollaboration(database)
  })

  afterEach(() => {
    database.close()
  })

  function handoffs() {
    const HandoffService = requiredService('HandoffService')
    return new HandoffService(database)
  }

  function createInput(summary: string) {
    return {
      projectId: fixture.projectId,
      authorId: fixture.agentId,
      summary,
      done: [summary],
      blockers: [],
      nextSteps: [],
      gotchas: [],
      refs: [{ kind: 'file' as const, ref: `/${summary}.md` }],
    }
  }

  it('creates structured handoffs and records activity atomically', () => {
    const handoff = handoffs().create(createInput('First'))

    expect(handoff).toMatchObject({
      projectId: fixture.projectId,
      sessionId: null,
      author: { id: fixture.agentId },
      summary: 'First',
      done: ['First'],
      refs: [{ kind: 'file', ref: '/First.md' }],
    })
    expect(handoff.author).not.toHaveProperty('lastBriefingActivityId')
    expect(rows(database, `
      SELECT operation, entity_type, entity_id, source
      FROM activities
    `)).toEqual([{
      operation: 'handoff.update',
      entity_type: 'handoff',
      entity_id: handoff.id,
      source: 'mcp',
    }])
  })

  it.each([
    ['agent', 'agentId'],
    ['human', 'humanId'],
  ] as const)('rejects an inactive %s author', (_kind, authorKey) => {
    const authorId = fixture[authorKey]
    database.prepare(`
      UPDATE actors SET status = 'inactive' WHERE id = ?
    `).run(authorId)

    expect(() => handoffs().create({
      ...createInput('Inactive author'),
      authorId,
    })).toThrowError(expect.objectContaining({
      code: 'ACTOR_INACTIVE',
      details: { actorId: authorId },
    }))
    expect(rows(database, 'SELECT id FROM handoffs')).toEqual([])
    expect(rows(database, 'SELECT id FROM activities')).toEqual([])
  })

  it('uses created time and rowid for latest-first tie ordering', () => {
    const service = handoffs()
    const first = service.create(createInput('First'))
    const second = service.create(createInput('Second'))
    database.prepare(`
      UPDATE handoffs SET created_at = ? WHERE id IN (?, ?)
    `).run(fixtureTimestamp, first.id, second.id)

    expect(service.latestForProject(fixture.projectId)?.id).toBe(second.id)
    expect(service.listForProject({
      projectId: fixture.projectId,
      limit: 2,
    }).map(({ id }: { id: string }) => id)).toEqual([second.id, first.id])
  })

  it('validates list limits in the shared 1..200 range', () => {
    for (const limit of [0, 201]) {
      expect(() => handoffs().listForProject({
        projectId: fixture.projectId,
        limit,
      })).toThrowError(expect.objectContaining({ name: 'ZodError' }))
    }
  })

  it('rolls the handoff back if its activity insertion fails', () => {
    database.exec(`
      CREATE TRIGGER fail_handoff_activity
      BEFORE INSERT ON activities
      WHEN NEW.operation = 'handoff.update'
      BEGIN
        SELECT RAISE(FAIL, 'forced handoff activity failure');
      END;
    `)

    expect(() => handoffs().create(createInput('Atomic')))
      .toThrow(/forced handoff activity failure/)
    expect(rows(database, 'SELECT id FROM handoffs')).toEqual([])
    expect(rows(database, 'SELECT id FROM activities')).toEqual([])
  })
})

describe('DeliverableService', () => {
  let database: DatabaseSync
  let fixture: ReturnType<typeof seedCollaboration>

  beforeEach(() => {
    database = createTestDatabase()
    fixture = seedCollaboration(database)
  })

  afterEach(() => {
    database.close()
  })

  function deliverables() {
    const DeliverableService = requiredService('DeliverableService')
    return new DeliverableService(database)
  }

  it('records and maps deliverables with nullable associations', () => {
    const deliverable = deliverables().record({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: 'Service commit',
      kind: 'commit',
      ref: 'abc123',
      requirementId: fixture.requirementId,
    })

    expect(deliverable).toMatchObject({
      projectId: fixture.projectId,
      requirementId: fixture.requirementId,
      taskId: null,
      title: 'Service commit',
      kind: 'commit',
      ref: 'abc123',
      note: null,
      createdBy: { id: fixture.agentId },
      sessionId: null,
    })
    expect(deliverable.createdBy)
      .not.toHaveProperty('lastBriefingActivityId')
    expect(rows(database, `
      SELECT operation, entity_type, entity_id, source
      FROM activities
    `)).toEqual([{
      operation: 'deliverable.record',
      entity_type: 'deliverable',
      entity_id: deliverable.id,
      source: 'mcp',
    }])
  })

  it('requires a requirement or task association', () => {
    expect(() => deliverables().record({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: 'Unassociated',
      kind: 'note',
      ref: 'No association',
    })).toThrowError(expect.objectContaining({ name: 'ZodError' }))
  })

  it('validates requirement and task project associations', () => {
    const service = deliverables()
    for (const requirementId of [
      'requirement_missing',
      fixture.otherRequirementId,
    ]) {
      expect(() => service.record({
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        title: 'Bad requirement',
        kind: 'file',
        ref: '/bad',
        requirementId,
      })).toThrowError(expect.objectContaining({
        code: 'DELIVERABLE_REQUIREMENT_INVALID',
      }))
    }
    for (const taskId of ['task_missing', fixture.otherTaskId]) {
      expect(() => service.record({
        projectId: fixture.projectId,
        agentId: fixture.agentId,
        title: 'Bad task',
        kind: 'file',
        ref: '/bad',
        taskId,
      })).toThrowError(expect.objectContaining({
        code: 'DELIVERABLE_TASK_INVALID',
      }))
    }
  })

  it('validates the recording agent and session project ownership', () => {
    const SessionService = requiredService('SessionService')
    const session = new SessionService(database).checkin({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      intent: 'Create deliverable',
      taskIds: [],
    })
    const service = deliverables()

    expect(() => service.record({
      projectId: fixture.projectId,
      agentId: fixture.humanId,
      title: 'Human authored',
      kind: 'note',
      ref: 'invalid',
      taskId: fixture.taskId,
    })).toThrowError(expect.objectContaining({
      code: 'ACTOR_AGENT_REQUIRED',
    }))
    expect(() => service.record({
      projectId: fixture.projectId,
      agentId: fixture.otherAgentId,
      title: 'Wrong session owner',
      kind: 'note',
      ref: 'invalid',
      taskId: fixture.taskId,
      sessionId: session.id,
    })).toThrowError(expect.objectContaining({ code: 'SESSION_FORBIDDEN' }))
    expect(() => service.record({
      projectId: fixture.otherProjectId,
      agentId: fixture.agentId,
      title: 'Wrong session project',
      kind: 'note',
      ref: 'invalid',
      taskId: fixture.otherTaskId,
      sessionId: session.id,
    })).toThrowError(expect.objectContaining({
      code: 'DELIVERABLE_SESSION_INVALID',
    }))
  })

  it('rejects an inactive agent before recording a deliverable', () => {
    database.prepare(`
      UPDATE actors SET status = 'inactive' WHERE id = ?
    `).run(fixture.agentId)

    expect(() => deliverables().record({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: 'Inactive author',
      kind: 'file',
      ref: '/inactive',
      taskId: fixture.taskId,
    })).toThrowError(expect.objectContaining({
      code: 'ACTOR_INACTIVE',
      details: { actorId: fixture.agentId },
    }))
    expect(rows(database, 'SELECT id FROM deliverables')).toEqual([])
    expect(rows(database, 'SELECT id FROM activities')).toEqual([])
  })

  it('filters requirements and orders ties latest-first by rowid', () => {
    insertRequirement(
      database,
      'requirement_same_project',
      fixture.projectId,
      'REQ-0002',
    )
    const service = deliverables()
    const first = service.record({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: 'First',
      kind: 'commit',
      ref: 'one',
      requirementId: fixture.requirementId,
    })
    service.record({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: 'Other requirement',
      kind: 'commit',
      ref: 'two',
      requirementId: 'requirement_same_project',
    })
    const last = service.record({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: 'Last',
      kind: 'commit',
      ref: 'three',
      requirementId: fixture.requirementId,
      taskId: fixture.taskId,
    })
    database.prepare(`
      UPDATE deliverables SET created_at = ? WHERE project_id = ?
    `).run(fixtureTimestamp, fixture.projectId)

    expect(service.listForProject({
      projectId: fixture.projectId,
      requirementId: fixture.requirementId,
      limit: 10,
    }).map(({ id }: { id: string }) => id)).toEqual([last.id, first.id])
  })

  it('validates list limit and rolls entity back on activity failure', () => {
    for (const limit of [0, 201]) {
      expect(() => deliverables().listForProject({
        projectId: fixture.projectId,
        limit,
      })).toThrowError(expect.objectContaining({ name: 'ZodError' }))
    }
    database.exec(`
      CREATE TRIGGER fail_deliverable_activity
      BEFORE INSERT ON activities
      WHEN NEW.operation = 'deliverable.record'
      BEGIN
        SELECT RAISE(FAIL, 'forced deliverable activity failure');
      END;
    `)

    expect(() => deliverables().record({
      projectId: fixture.projectId,
      agentId: fixture.agentId,
      title: 'Atomic deliverable',
      kind: 'file',
      ref: '/atomic',
      taskId: fixture.taskId,
    })).toThrow(/forced deliverable activity failure/)
    expect(rows(database, 'SELECT id FROM deliverables')).toEqual([])
    expect(rows(database, `
      SELECT id FROM activities WHERE operation = 'deliverable.record'
    `)).toEqual([])
  })
})
