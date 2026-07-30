import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import {
  actorSchema,
  deliverableRecordInputSchema,
  deliverableSchema,
  paginationSchema,
  sessionCheckinInputSchema,
} from '@project-os/contracts'
import type {
  Deliverable,
  DeliverableRecordInput,
  PersistedActor,
} from '@project-os/contracts'
import {
  recordActivity,
  withImmediateTransaction,
} from './activity-service.js'
import { DomainError } from './errors.js'
import { generateDeliverableId } from './ids.js'

type DeliverableRow = {
  id: string
  project_id: string
  requirement_id: string | null
  task_id: string | null
  title: string
  kind: Deliverable['kind']
  ref: string
  note: string | null
  created_by: string
  session_id: string | null
  created_at: string
  creator_name: string
  creator_kind: 'human' | 'agent'
  creator_role: PersistedActor['role']
  creator_status: PersistedActor['status']
  creator_client: string | null
  creator_capabilities_json: string
  creator_registered_at: string
  creator_last_active_at: string | null
  creator_version: number
}

export type DeliverableListFilter = {
  projectId: string
  requirementId?: string
  limit?: number
}

const deliverableSelect = `
  SELECT
    deliverables.id,
    deliverables.project_id,
    deliverables.requirement_id,
    deliverables.task_id,
    deliverables.title,
    deliverables.kind,
    deliverables.ref,
    deliverables.note,
    deliverables.created_by,
    deliverables.session_id,
    deliverables.created_at,
    actors.name AS creator_name,
    actors.kind AS creator_kind,
    actors.role AS creator_role,
    actors.status AS creator_status,
    actors.client AS creator_client,
    actors.capabilities_json AS creator_capabilities_json,
    actors.registered_at AS creator_registered_at,
    actors.last_active_at AS creator_last_active_at,
    actors.version AS creator_version
  FROM deliverables
  JOIN actors ON actors.id = deliverables.created_by
`

function mapDeliverable(row: DeliverableRow): Deliverable {
  const createdBy = actorSchema.parse({
    id: row.created_by,
    name: row.creator_name,
    kind: row.creator_kind,
    role: row.creator_role,
    status: row.creator_status,
    client: row.creator_client,
    capabilities: JSON.parse(row.creator_capabilities_json),
    registeredAt: row.creator_registered_at,
    lastActiveAt: row.creator_last_active_at,
    version: row.creator_version,
  })
  return deliverableSchema.parse({
    id: row.id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    taskId: row.task_id,
    title: row.title,
    kind: row.kind,
    ref: row.ref,
    note: row.note,
    createdBy,
    sessionId: row.session_id,
    createdAt: row.created_at,
  })
}

export class DeliverableService {
  constructor(private readonly database: DatabaseSync) {}

  record(input: DeliverableRecordInput): Deliverable {
    const parsed = deliverableRecordInputSchema.parse(input)
    if (
      parsed.requirementId === undefined
      && parsed.taskId === undefined
    ) {
      throw new DomainError(
        'DELIVERABLE_ASSOCIATION_REQUIRED',
        'Deliverable must reference a requirement or task',
      )
    }

    return withImmediateTransaction(this.database, () => {
      this.assertProject(parsed.projectId)
      this.assertAgent(parsed.agentId)
      if (parsed.requirementId !== undefined) {
        this.assertRequirement(parsed.requirementId, parsed.projectId)
      }
      if (parsed.taskId !== undefined) {
        this.assertTask(parsed.taskId, parsed.projectId)
      }
      if (parsed.sessionId !== undefined) {
        this.assertSession(
          parsed.sessionId,
          parsed.projectId,
          parsed.agentId,
        )
      }

      const id = generateDeliverableId()
      const timestamp = new Date().toISOString()
      this.database.prepare(`
        INSERT INTO deliverables (
          id,
          project_id,
          requirement_id,
          task_id,
          title,
          kind,
          ref,
          note,
          created_by,
          session_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        parsed.projectId,
        parsed.requirementId ?? null,
        parsed.taskId ?? null,
        parsed.title,
        parsed.kind,
        parsed.ref,
        parsed.note ?? null,
        parsed.agentId,
        parsed.sessionId ?? null,
        timestamp,
      )
      recordActivity(this.database, {
        actorId: parsed.agentId,
        projectId: parsed.projectId,
        source: 'mcp',
        operation: 'deliverable.record',
        entityType: 'deliverable',
        entityId: id,
        action: `Recorded deliverable ${parsed.title}`,
        note: parsed.note ?? null,
        createdAt: timestamp,
      })
      return this.get(id)
    })
  }

  listForProject(filter: DeliverableListFilter): Deliverable[] {
    const projectId =
      sessionCheckinInputSchema.shape.projectId.parse(filter.projectId)
    const requirementId = filter.requirementId === undefined
      ? undefined
      : sessionCheckinInputSchema.shape.projectId.parse(
        filter.requirementId,
      )
    const { limit } = paginationSchema.parse({ limit: filter.limit })
    const clauses = ['deliverables.project_id = ?']
    const values: SQLInputValue[] = [projectId]
    if (requirementId !== undefined) {
      clauses.push('deliverables.requirement_id = ?')
      values.push(requirementId)
    }
    values.push(limit)
    const result = this.database.prepare(`
      ${deliverableSelect}
      WHERE ${clauses.join(' AND ')}
      ORDER BY deliverables.created_at DESC, deliverables.rowid DESC
      LIMIT ?
    `).all(...values) as unknown as DeliverableRow[]
    return result.map(mapDeliverable)
  }

  private get(id: string): Deliverable {
    const row = this.database.prepare(`
      ${deliverableSelect}
      WHERE deliverables.id = ?
    `).get(id) as unknown as DeliverableRow | undefined
    if (row === undefined) {
      throw new DomainError(
        'DELIVERABLE_NOT_FOUND',
        'Deliverable does not exist',
        { deliverableId: id },
      )
    }
    return mapDeliverable(row)
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
        'Deliverables must be recorded by an agent',
        { actorId: agentId },
      )
    }
  }

  private assertRequirement(
    requirementId: string,
    projectId: string,
  ): void {
    const requirement = this.database.prepare(`
      SELECT project_id FROM requirements WHERE id = ?
    `).get(requirementId) as { project_id: string } | undefined
    if (
      requirement === undefined
      || requirement.project_id !== projectId
    ) {
      throw new DomainError(
        'DELIVERABLE_REQUIREMENT_INVALID',
        'Deliverable requirement does not belong to the project',
        { requirementId, projectId },
      )
    }
  }

  private assertTask(taskId: string, projectId: string): void {
    const task = this.database.prepare(`
      SELECT project_id FROM tasks WHERE id = ?
    `).get(taskId) as { project_id: string } | undefined
    if (task === undefined || task.project_id !== projectId) {
      throw new DomainError(
        'DELIVERABLE_TASK_INVALID',
        'Deliverable task does not belong to the project',
        { taskId, projectId },
      )
    }
  }

  private assertSession(
    sessionId: string,
    projectId: string,
    agentId: string,
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
        'DELIVERABLE_SESSION_INVALID',
        'Deliverable session belongs to another project',
        { sessionId, projectId },
      )
    }
    if (session.agent_id !== agentId) {
      throw new DomainError(
        'SESSION_FORBIDDEN',
        'Deliverable agent does not own the session',
        { sessionId, agentId },
      )
    }
  }
}
