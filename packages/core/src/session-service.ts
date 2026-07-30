import type { DatabaseSync } from 'node:sqlite'
import {
  actorSchema,
  persistedSessionSchema,
  sessionCheckinInputSchema,
  sessionCheckoutInputSchema,
  sessionNoteInputSchema,
} from '@project-os/contracts'
import type {
  Handoff,
  PersistedActivity,
  PersistedActor,
  Session,
  SessionCheckinInput,
  SessionCheckoutInput,
  SessionNoteInput,
} from '@project-os/contracts'
import {
  recordActivity,
  withImmediateTransaction,
} from './activity-service.js'
import { DomainError } from './errors.js'
import { HandoffService } from './handoff-service.js'
import { generateSessionId } from './ids.js'

export const SESSION_STALE_AFTER_MS = 4 * 60 * 60 * 1000

type StoredSessionStatus = 'active' | 'closed'

type SessionRow = {
  id: string
  project_id: string
  agent_id: string
  intent: string
  task_ids_json: string
  status: StoredSessionStatus
  summary: string | null
  created_at: string
  last_active_at: string
  closed_at: string | null
  agent_name: string
  agent_kind: 'human' | 'agent'
  agent_role: PersistedActor['role']
  agent_status: PersistedActor['status']
  agent_client: string | null
  agent_capabilities_json: string
  agent_registered_at: string
  agent_last_active_at: string | null
  agent_version: number
}

type SessionAccessRow = {
  project_id: string
  agent_id: string
  status: StoredSessionStatus
}

export type SessionListFilter = {
  projectId: string
  includeClosed?: boolean
}

export type SessionCheckoutResult = {
  session: Session
  handoff: Handoff
}

const sessionSelect = `
  SELECT
    sessions.id,
    sessions.project_id,
    sessions.agent_id,
    sessions.intent,
    sessions.task_ids_json,
    sessions.status,
    sessions.summary,
    sessions.created_at,
    sessions.last_active_at,
    sessions.closed_at,
    actors.name AS agent_name,
    actors.kind AS agent_kind,
    actors.role AS agent_role,
    actors.status AS agent_status,
    actors.client AS agent_client,
    actors.capabilities_json AS agent_capabilities_json,
    actors.registered_at AS agent_registered_at,
    actors.last_active_at AS agent_last_active_at,
    actors.version AS agent_version
  FROM sessions
  JOIN actors ON actors.id = sessions.agent_id
`

function mapSession(row: SessionRow, now = Date.now()): Session {
  const agent = actorSchema.parse({
    id: row.agent_id,
    name: row.agent_name,
    kind: row.agent_kind,
    role: row.agent_role,
    status: row.agent_status,
    client: row.agent_client,
    capabilities: JSON.parse(row.agent_capabilities_json),
    registeredAt: row.agent_registered_at,
    lastActiveAt: row.agent_last_active_at,
    version: row.agent_version,
  })
  const status = row.status === 'active'
    && now - Date.parse(row.last_active_at) > SESSION_STALE_AFTER_MS
    ? 'abandoned'
    : row.status
  return persistedSessionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    agentId: row.agent_id,
    agent,
    intent: row.intent,
    taskIds: JSON.parse(row.task_ids_json),
    status,
    summary: row.summary,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    closedAt: row.closed_at,
  })
}

export class SessionService {
  private readonly handoffs: HandoffService

  constructor(private readonly database: DatabaseSync) {
    this.handoffs = new HandoffService(database)
  }

  checkin(input: SessionCheckinInput): Session {
    const parsed = sessionCheckinInputSchema.parse(input)

    return withImmediateTransaction(this.database, () => {
      this.assertProject(parsed.projectId)
      this.assertAgent(parsed.agentId)
      for (const taskId of parsed.taskIds) {
        this.assertTask(taskId, parsed.projectId)
      }

      const id = generateSessionId()
      const timestamp = new Date().toISOString()
      this.database.prepare(`
        INSERT INTO sessions (
          id,
          project_id,
          agent_id,
          intent,
          task_ids_json,
          status,
          summary,
          created_at,
          last_active_at,
          closed_at
        ) VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, NULL)
      `).run(
        id,
        parsed.projectId,
        parsed.agentId,
        parsed.intent,
        JSON.stringify(parsed.taskIds),
        timestamp,
        timestamp,
      )
      recordActivity(this.database, {
        actorId: parsed.agentId,
        projectId: parsed.projectId,
        source: 'mcp',
        operation: 'session.checkin',
        entityType: 'session',
        entityId: id,
        action: `Checked into session for ${parsed.intent}`,
        createdAt: timestamp,
      })
      return this.get(id)
    })
  }

  note(input: SessionNoteInput): PersistedActivity {
    const parsed = sessionNoteInputSchema.parse(input)

    return withImmediateTransaction(this.database, () => {
      const session = this.sessionAccess(parsed.sessionId)
      this.assertOwnership(
        parsed.sessionId,
        session.agent_id,
        parsed.agentId,
      )
      this.assertOpen(parsed.sessionId, session.status)
      if (parsed.taskId !== undefined) {
        this.assertTask(parsed.taskId, session.project_id)
      }

      const timestamp = new Date().toISOString()
      this.database.prepare(`
        UPDATE sessions
        SET last_active_at = ?
        WHERE id = ?
      `).run(timestamp, parsed.sessionId)
      return recordActivity(this.database, {
        actorId: parsed.agentId,
        projectId: session.project_id,
        source: 'mcp',
        operation: 'session.note',
        entityType: parsed.taskId === undefined ? 'session' : 'task',
        entityId: parsed.taskId ?? parsed.sessionId,
        action: 'Added session note',
        note: parsed.note,
        createdAt: timestamp,
      })
    })
  }

  checkout(input: SessionCheckoutInput): SessionCheckoutResult {
    const parsed = sessionCheckoutInputSchema.parse(input)

    return withImmediateTransaction(this.database, () => {
      const current = this.sessionAccess(parsed.sessionId)
      this.assertOwnership(
        parsed.sessionId,
        current.agent_id,
        parsed.agentId,
      )
      this.assertOpen(parsed.sessionId, current.status)

      const timestamp = new Date().toISOString()
      this.database.prepare(`
        UPDATE sessions
        SET
          status = 'closed',
          summary = ?,
          closed_at = ?,
          last_active_at = ?
        WHERE id = ?
      `).run(
        parsed.summary,
        timestamp,
        timestamp,
        parsed.sessionId,
      )
      const handoff = this.handoffs.create({
        projectId: current.project_id,
        sessionId: parsed.sessionId,
        authorId: parsed.agentId,
        summary: parsed.summary,
        done: parsed.done,
        blockers: parsed.blockers,
        nextSteps: parsed.nextSteps,
        gotchas: parsed.gotchas,
        refs: parsed.refs,
      })
      recordActivity(this.database, {
        actorId: parsed.agentId,
        projectId: current.project_id,
        source: 'mcp',
        operation: 'session.checkout',
        entityType: 'session',
        entityId: parsed.sessionId,
        action: 'Checked out of session',
        note: parsed.summary,
        createdAt: timestamp,
      })
      return {
        session: this.get(parsed.sessionId),
        handoff,
      }
    })
  }

  listForProject(filter: SessionListFilter): Session[] {
    const projectId =
      sessionCheckinInputSchema.shape.projectId.parse(filter.projectId)
    if (
      filter.includeClosed !== undefined
      && typeof filter.includeClosed !== 'boolean'
    ) {
      throw new DomainError(
        'INPUT_INVALID',
        'includeClosed must be a boolean',
      )
    }
    const includeClosed = filter.includeClosed ?? false
    const rows = this.database.prepare(`
      ${sessionSelect}
      WHERE sessions.project_id = ?
        ${includeClosed ? '' : "AND sessions.status = 'active'"}
      ORDER BY sessions.created_at DESC, sessions.rowid DESC
    `).all(projectId) as unknown as SessionRow[]
    const now = Date.now()
    return rows.map((row) => mapSession(row, now))
  }

  get(sessionId: string): Session {
    const validatedSessionId =
      sessionCheckinInputSchema.shape.projectId.parse(sessionId)
    const row = this.database.prepare(`
      ${sessionSelect}
      WHERE sessions.id = ?
    `).get(validatedSessionId) as unknown as SessionRow | undefined
    if (row === undefined) {
      throw new DomainError(
        'SESSION_NOT_FOUND',
        'Session does not exist',
        { sessionId: validatedSessionId },
      )
    }
    return mapSession(row)
  }

  private sessionAccess(sessionId: string): SessionAccessRow {
    const row = this.database.prepare(`
      SELECT project_id, agent_id, status
      FROM sessions
      WHERE id = ?
    `).get(sessionId) as SessionAccessRow | undefined
    if (row === undefined) {
      throw new DomainError(
        'SESSION_NOT_FOUND',
        'Session does not exist',
        { sessionId },
      )
    }
    return row
  }

  private assertProject(projectId: string): void {
    if (this.database.prepare(`
      SELECT 1 FROM projects WHERE id = ?
    `).get(projectId) === undefined) {
      throw new DomainError(
        'PROJECT_NOT_FOUND',
        'Project does not exist',
        { projectId },
      )
    }
  }

  private assertAgent(agentId: string): void {
    const actor = this.database.prepare(`
      SELECT kind FROM actors WHERE id = ?
    `).get(agentId) as { kind: 'human' | 'agent' } | undefined
    if (actor === undefined) {
      throw new DomainError(
        'ACTOR_NOT_FOUND',
        'Actor does not exist',
        { actorId: agentId },
      )
    }
    if (actor.kind !== 'agent') {
      throw new DomainError(
        'ACTOR_AGENT_REQUIRED',
        'Sessions can only be owned by agents',
        { actorId: agentId },
      )
    }
  }

  private assertTask(taskId: string, projectId: string): void {
    const task = this.database.prepare(`
      SELECT project_id FROM tasks WHERE id = ?
    `).get(taskId) as { project_id: string } | undefined
    if (task === undefined || task.project_id !== projectId) {
      throw new DomainError(
        'SESSION_TASK_INVALID',
        'Session task does not belong to the project',
        { taskId, projectId },
      )
    }
  }

  private assertOwnership(
    sessionId: string,
    ownerId: string,
    agentId: string,
  ): void {
    if (ownerId !== agentId) {
      throw new DomainError(
        'SESSION_FORBIDDEN',
        'Only the session owner may modify the session',
        { sessionId, agentId },
      )
    }
  }

  private assertOpen(
    sessionId: string,
    status: StoredSessionStatus,
  ): void {
    if (status !== 'active') {
      throw new DomainError(
        'SESSION_CLOSED',
        'Session is already closed',
        { sessionId },
      )
    }
  }
}
