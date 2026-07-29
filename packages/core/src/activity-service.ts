import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import {
  activitySourceSchema,
  paginationSchema,
  persistedActivitySchema,
  persistedActorSchema,
} from '@project-os/contracts'
import type {
  ActivityOperation,
  ActivitySource,
  PersistedActivity,
  PersistedActor,
} from '@project-os/contracts'
import { DomainError } from './errors.js'
import { generateActivityId } from './ids.js'

type ActivityRow = {
  id: string
  actor_id: string
  project_id: string | null
  source: ActivitySource
  operation: ActivityOperation
  entity_type: string
  entity_id: string
  action: string
  note: string | null
  created_at: string
  actor_name: string
  actor_kind: 'human' | 'agent'
  actor_role: PersistedActor['role']
  actor_status: PersistedActor['status']
  actor_client: string | null
  actor_capabilities_json: string
  actor_registered_at: string
  actor_last_active_at: string | null
  actor_version: number
}

export type ActivityListFilter = {
  entityId?: string
  actorId?: string
  projectId?: string
  source?: ActivitySource
  after?: string
  limit?: number
}

export type NewerActivityListFilter = Omit<ActivityListFilter, 'after'> & {
  after: string
}

type ActivityInsert = {
  actorId: string
  projectId?: string | null
  source: ActivitySource
  operation: ActivityOperation
  entityType: string
  entityId: string
  action: string
  note?: string | null
  details?: Record<string, unknown>
  createdAt?: string
}

export function withImmediateTransaction<T>(
  database: DatabaseSync,
  work: () => T,
): T {
  database.exec('BEGIN IMMEDIATE')

  try {
    const result = work()
    database.exec('COMMIT')
    return result
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // Preserve the mutation error if SQLite already ended the transaction.
    }
    throw error
  }
}

function mapActor(row: ActivityRow): PersistedActor {
  return persistedActorSchema.parse({
    id: row.actor_id,
    name: row.actor_name,
    kind: row.actor_kind,
    role: row.actor_role,
    status: row.actor_status,
    client: row.actor_client,
    capabilities: JSON.parse(row.actor_capabilities_json),
    registeredAt: row.actor_registered_at,
    lastActiveAt: row.actor_last_active_at,
    version: row.actor_version,
  })
}

function mapActivity(row: ActivityRow): PersistedActivity {
  const activity = {
    id: row.id,
    actor: mapActor(row),
    actorId: row.actor_id,
    projectId: row.project_id,
    source: row.source,
    operation: row.operation,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    createdAt: row.created_at,
    ...(row.note === null ? {} : { note: row.note }),
  }

  return persistedActivitySchema.parse(activity)
}

const activitySelect = `
  SELECT
    activities.id,
    activities.actor_id,
    activities.project_id,
    activities.source,
    activities.operation,
    activities.entity_type,
    activities.entity_id,
    activities.action,
    activities.note,
    activities.created_at,
    actors.name AS actor_name,
    actors.kind AS actor_kind,
    actors.role AS actor_role,
    actors.status AS actor_status,
    actors.client AS actor_client,
    actors.capabilities_json AS actor_capabilities_json,
    actors.registered_at AS actor_registered_at,
    actors.last_active_at AS actor_last_active_at,
    actors.version AS actor_version
  FROM activities
  JOIN actors ON actors.id = activities.actor_id
`

export class ActivityService {
  constructor(private readonly database: DatabaseSync) {}

  list(filter: ActivityListFilter = {}): PersistedActivity[] {
    const pagination = paginationSchema.parse({
      cursor: filter.after,
      limit: filter.limit,
    })
    const source = filter.source === undefined
      ? undefined
      : activitySourceSchema.parse(filter.source)
    const clauses: string[] = []
    const values: SQLInputValue[] = []

    if (filter.entityId !== undefined) {
      clauses.push('activities.entity_id = ?')
      values.push(filter.entityId)
    }
    if (filter.actorId !== undefined) {
      clauses.push('activities.actor_id = ?')
      values.push(filter.actorId)
    }
    if (filter.projectId !== undefined) {
      clauses.push('activities.project_id = ?')
      values.push(filter.projectId)
    }
    if (source !== undefined) {
      clauses.push('activities.source = ?')
      values.push(source)
    }
    if (pagination.cursor !== undefined) {
      const cursor = this.database.prepare(`
        SELECT created_at, id
        FROM activities
        WHERE id = ?
      `).get(pagination.cursor) as
        | { created_at: string; id: string }
        | undefined

      if (cursor === undefined) {
        throw new DomainError(
          'ACTIVITY_CURSOR_INVALID',
          'Activity cursor does not exist',
          { cursor: pagination.cursor },
        )
      }

      clauses.push(`
        (
          activities.created_at < ?
          OR (
            activities.created_at = ?
            AND activities.id < ?
          )
        )
      `)
      values.push(cursor.created_at, cursor.created_at, cursor.id)
    }

    const where = clauses.length === 0
      ? ''
      : `WHERE ${clauses.join(' AND ')}`
    const rows = this.database.prepare(`
      ${activitySelect}
      ${where}
      ORDER BY activities.created_at DESC, activities.id DESC
      LIMIT ?
    `).all(...values, pagination.limit) as unknown as ActivityRow[]

    return rows.map(mapActivity)
  }

  listNewer(filter: NewerActivityListFilter): PersistedActivity[] {
    const cursorId = filter.after
    const pagination = paginationSchema.parse({
      cursor: cursorId,
      limit: filter.limit,
    })
    const source = filter.source === undefined
      ? undefined
      : activitySourceSchema.parse(filter.source)
    const cursor = this.database.prepare(`
      SELECT
        id,
        actor_id,
        project_id,
        source,
        entity_id,
        created_at
      FROM activities
      WHERE id = ?
    `).get(cursorId) as {
      id: string
      actor_id: string
      project_id: string | null
      source: ActivitySource
      entity_id: string
      created_at: string
    } | undefined
    if (
      cursor === undefined
      || (
        filter.entityId !== undefined
        && cursor.entity_id !== filter.entityId
      )
      || (
        filter.actorId !== undefined
        && cursor.actor_id !== filter.actorId
      )
      || (
        filter.projectId !== undefined
        && cursor.project_id !== filter.projectId
      )
      || (source !== undefined && cursor.source !== source)
    ) {
      throw new DomainError(
        'ACTIVITY_CURSOR_INVALID',
        'Activity cursor does not exist or match the filters',
        { cursor: cursorId },
      )
    }

    const clauses = [`
      (
        activities.created_at > ?
        OR (
          activities.created_at = ?
          AND activities.id > ?
        )
      )
    `]
    const values: SQLInputValue[] = [
      cursor.created_at,
      cursor.created_at,
      cursor.id,
    ]
    if (filter.entityId !== undefined) {
      clauses.push('activities.entity_id = ?')
      values.push(filter.entityId)
    }
    if (filter.actorId !== undefined) {
      clauses.push('activities.actor_id = ?')
      values.push(filter.actorId)
    }
    if (filter.projectId !== undefined) {
      clauses.push('activities.project_id = ?')
      values.push(filter.projectId)
    }
    if (source !== undefined) {
      clauses.push('activities.source = ?')
      values.push(source)
    }

    const rows = this.database.prepare(`
      ${activitySelect}
      WHERE ${clauses.join(' AND ')}
      ORDER BY activities.created_at, activities.id
      LIMIT ?
    `).all(...values, pagination.limit) as unknown as ActivityRow[]
    return rows.map(mapActivity)
  }

}

/**
 * Internal write primitive for domain services. The package export map exposes
 * only `src/index.ts`, which intentionally does not re-export this function.
 */
export function recordActivity(
  database: DatabaseSync,
  input: ActivityInsert,
): PersistedActivity {
  const source = activitySourceSchema.parse(input.source)
  const id = generateActivityId()
  const createdAt = input.createdAt ?? new Date().toISOString()

  database.prepare(`
    INSERT INTO activities (
      id,
      actor_id,
      project_id,
      source,
      operation,
      entity_type,
      entity_id,
      action,
      note,
      details_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.actorId,
    input.projectId ?? null,
    source,
    input.operation,
    input.entityType,
    input.entityId,
    input.action,
    input.note ?? null,
    JSON.stringify(input.details ?? {}),
    createdAt,
  )

  const row = database.prepare(`
    ${activitySelect}
    WHERE activities.id = ?
  `).get(id) as unknown as ActivityRow

  return mapActivity(row)
}
