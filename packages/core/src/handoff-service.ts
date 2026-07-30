import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import {
  actorSchema,
  handoffSchema,
  paginationSchema,
  sessionCheckinInputSchema,
} from '@project-os/contracts'
import type {
  Handoff,
  HandoffRef,
  PersistedActor,
} from '@project-os/contracts'
import {
  recordActivity,
  withImmediateTransaction,
} from './activity-service.js'
import { DomainError } from './errors.js'
import { generateHandoffId } from './ids.js'

type HandoffRow = {
  id: string
  project_id: string
  session_id: string | null
  author_id: string
  summary: string
  done_json: string
  blockers_json: string
  next_steps_json: string
  gotchas_json: string
  refs_json: string
  created_at: string
  author_name: string
  author_kind: 'human' | 'agent'
  author_role: PersistedActor['role']
  author_status: PersistedActor['status']
  author_client: string | null
  author_capabilities_json: string
  author_registered_at: string
  author_last_active_at: string | null
  author_version: number
}

export type CreateHandoffInput = {
  projectId: string
  sessionId?: string | null
  authorId: string
  summary: string
  done: string[]
  blockers: string[]
  nextSteps: string[]
  gotchas: string[]
  refs: HandoffRef[]
}

export type HandoffListFilter = {
  projectId: string
  limit?: number
}

const createHandoffInputSchema = handoffSchema.pick({
  projectId: true,
  sessionId: true,
  summary: true,
  done: true,
  blockers: true,
  nextSteps: true,
  gotchas: true,
  refs: true,
}).extend({
  sessionId: handoffSchema.shape.sessionId.optional(),
  authorId: sessionCheckinInputSchema.shape.agentId,
})

const handoffSelect = `
  SELECT
    handoffs.id,
    handoffs.project_id,
    handoffs.session_id,
    handoffs.author_id,
    handoffs.summary,
    handoffs.done_json,
    handoffs.blockers_json,
    handoffs.next_steps_json,
    handoffs.gotchas_json,
    handoffs.refs_json,
    handoffs.created_at,
    actors.name AS author_name,
    actors.kind AS author_kind,
    actors.role AS author_role,
    actors.status AS author_status,
    actors.client AS author_client,
    actors.capabilities_json AS author_capabilities_json,
    actors.registered_at AS author_registered_at,
    actors.last_active_at AS author_last_active_at,
    actors.version AS author_version
  FROM handoffs
  JOIN actors ON actors.id = handoffs.author_id
`

function mapHandoff(row: HandoffRow): Handoff {
  const author = actorSchema.parse({
    id: row.author_id,
    name: row.author_name,
    kind: row.author_kind,
    role: row.author_role,
    status: row.author_status,
    client: row.author_client,
    capabilities: JSON.parse(row.author_capabilities_json),
    registeredAt: row.author_registered_at,
    lastActiveAt: row.author_last_active_at,
    version: row.author_version,
  })
  return handoffSchema.parse({
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    author,
    summary: row.summary,
    done: JSON.parse(row.done_json),
    blockers: JSON.parse(row.blockers_json),
    nextSteps: JSON.parse(row.next_steps_json),
    gotchas: JSON.parse(row.gotchas_json),
    refs: JSON.parse(row.refs_json),
    createdAt: row.created_at,
  })
}

export class HandoffService {
  constructor(private readonly database: DatabaseSync) {}

  create(input: CreateHandoffInput): Handoff {
    const parsed = createHandoffInputSchema.parse(input)

    return withImmediateTransaction(this.database, () => {
      this.assertProject(parsed.projectId)
      this.assertAuthor(parsed.authorId)
      const sessionId = parsed.sessionId ?? null
      if (sessionId !== null) {
        this.assertSession(
          sessionId,
          parsed.projectId,
          parsed.authorId,
        )
      }

      const id = generateHandoffId()
      const timestamp = new Date().toISOString()
      this.database.prepare(`
        INSERT INTO handoffs (
          id,
          project_id,
          session_id,
          author_id,
          summary,
          done_json,
          blockers_json,
          next_steps_json,
          gotchas_json,
          refs_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        parsed.projectId,
        sessionId,
        parsed.authorId,
        parsed.summary,
        JSON.stringify(parsed.done),
        JSON.stringify(parsed.blockers),
        JSON.stringify(parsed.nextSteps),
        JSON.stringify(parsed.gotchas),
        JSON.stringify(parsed.refs),
        timestamp,
      )
      recordActivity(this.database, {
        actorId: parsed.authorId,
        projectId: parsed.projectId,
        source: 'mcp',
        operation: 'handoff.update',
        entityType: 'handoff',
        entityId: id,
        action: `Created handoff for ${parsed.projectId}`,
        createdAt: timestamp,
      })
      return this.get(id)
    })
  }

  latestForProject(projectId: string): Handoff | null {
    const validatedProjectId =
      sessionCheckinInputSchema.shape.projectId.parse(projectId)
    const row = this.database.prepare(`
      ${handoffSelect}
      WHERE handoffs.project_id = ?
      ORDER BY handoffs.created_at DESC, handoffs.rowid DESC
      LIMIT 1
    `).get(validatedProjectId) as unknown as HandoffRow | undefined
    return row === undefined ? null : mapHandoff(row)
  }

  listForProject(filter: HandoffListFilter): Handoff[] {
    const projectId =
      sessionCheckinInputSchema.shape.projectId.parse(filter.projectId)
    const { limit } = paginationSchema.parse({ limit: filter.limit })
    const values: SQLInputValue[] = [projectId, limit]
    const result = this.database.prepare(`
      ${handoffSelect}
      WHERE handoffs.project_id = ?
      ORDER BY handoffs.created_at DESC, handoffs.rowid DESC
      LIMIT ?
    `).all(...values) as unknown as HandoffRow[]
    return result.map(mapHandoff)
  }

  private get(id: string): Handoff {
    const row = this.database.prepare(`
      ${handoffSelect}
      WHERE handoffs.id = ?
    `).get(id) as unknown as HandoffRow | undefined
    if (row === undefined) {
      throw new DomainError(
        'HANDOFF_NOT_FOUND',
        'Handoff does not exist',
        { handoffId: id },
      )
    }
    return mapHandoff(row)
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

  private assertAuthor(authorId: string): void {
    if (this.database.prepare(`
      SELECT 1 FROM actors WHERE id = ?
    `).get(authorId) === undefined) {
      throw new DomainError(
        'ACTOR_NOT_FOUND',
        'Actor does not exist',
        { actorId: authorId },
      )
    }
  }

  private assertSession(
    sessionId: string,
    projectId: string,
    authorId: string,
  ): void {
    const session = this.database.prepare(`
      SELECT project_id, agent_id
      FROM sessions
      WHERE id = ?
    `).get(sessionId) as {
      project_id: string
      agent_id: string
    } | undefined
    if (session === undefined) {
      throw new DomainError(
        'SESSION_NOT_FOUND',
        'Session does not exist',
        { sessionId },
      )
    }
    if (session.project_id !== projectId) {
      throw new DomainError(
        'HANDOFF_SESSION_INVALID',
        'Handoff session belongs to another project',
        { sessionId, projectId },
      )
    }
    if (session.agent_id !== authorId) {
      throw new DomainError(
        'SESSION_FORBIDDEN',
        'Only the session owner can author its handoff',
        { sessionId, agentId: authorId },
      )
    }
  }
}
