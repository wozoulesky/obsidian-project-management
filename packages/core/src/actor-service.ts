import type {
  DatabaseSync,
  SQLInputValue,
  StatementSync,
} from 'node:sqlite'
import {
  actorSchema,
  actorStatusSchema,
  activitySourceSchema,
  agentActorRoleSchema,
  humanActorRoleSchema,
  persistedActorSchema,
} from '@project-os/contracts'
import type {
  ActorRole,
  ActorStatus,
  ActivitySource,
  PersistedActor,
} from '@project-os/contracts'
import {
  recordActivity,
  withImmediateTransaction,
} from './activity-service.js'
import { DomainError } from './errors.js'
import { generateActorId } from './ids.js'

type ActorRow = {
  id: string
  name: string
  kind: 'human' | 'agent'
  role: PersistedActor['role']
  status: ActorStatus
  client: string | null
  capabilities_json: string
  registered_at: string
  last_active_at: string | null
  last_briefing_activity_id: string | null
  version: number
}

type HumanActorRole = Extract<ActorRole, 'owner' | 'member'>
type AgentActorRole = Exclude<ActorRole, HumanActorRole>

export type CreateHumanInput = {
  name: string
  role: HumanActorRole
  capabilities?: string[]
}

export type RegisterAgentInput = {
  name: string
  role: AgentActorRole
  client: string
  capabilities?: string[]
}

export type UpdateActorInput = {
  name?: string
  role?: PersistedActor['role']
  capabilities?: string[]
  version: number
}

export type ActorListFilter = {
  kind?: PersistedActor['kind']
  status?: ActorStatus
  after?: {
    name: string
    id: string
  }
  limit?: number
}

function mapActor(row: ActorRow): PersistedActor {
  return persistedActorSchema.parse({
    id: row.id,
    name: row.name,
    kind: row.kind,
    role: row.role,
    status: row.status,
    client: row.client,
    capabilities: JSON.parse(row.capabilities_json),
    registeredAt: row.registered_at,
    lastActiveAt: row.last_active_at,
    lastBriefingActivityId: row.last_briefing_activity_id,
    version: row.version,
  })
}

function actorNotFound(id: string): DomainError {
  return new DomainError(
    'ACTOR_NOT_FOUND',
    'Actor does not exist',
    { actorId: id },
  )
}

function actorInactive(id: string): DomainError {
  return new DomainError(
    'ACTOR_INACTIVE',
    'Actor is inactive',
    { actorId: id },
  )
}

function actorVersionConflict(
  id: string,
  expectedVersion: number,
  currentVersion: number,
): DomainError {
  return new DomainError(
    'ACTOR_VERSION_CONFLICT',
    'Actor version is stale',
    {
      actorId: id,
      expectedVersion,
      currentVersion,
    },
  )
}

function validateActorData(input: {
  name: string
  kind: 'human' | 'agent'
  role: PersistedActor['role']
  client: string | null
  capabilities: string[]
}): void {
  actorSchema.parse({
    id: 'actor_validation',
    ...input,
  })
}

function sameCapabilities(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((capability, index) => capability === right[index])
}

export class ActorService {
  private readonly selectById: StatementSync

  constructor(
    private readonly database: DatabaseSync,
  ) {
    this.selectById = database.prepare(`
      SELECT
        id,
        name,
        kind,
        role,
        status,
        client,
        capabilities_json,
        registered_at,
        last_active_at,
        last_briefing_activity_id,
        version
      FROM actors
      WHERE id = ?
    `)
  }

  runAtomic<T>(work: () => T): T {
    return withImmediateTransaction(this.database, work)
  }

  createHuman(
    input: CreateHumanInput,
    actorId?: string,
    source: ActivitySource = 'web',
  ): PersistedActor {
    const id = generateActorId()
    const role = humanActorRoleSchema.parse(input.role)
    const capabilities = input.capabilities ?? []
    const validatedSource = activitySourceSchema.parse(source)
    validateActorData({
      name: input.name,
      kind: 'human',
      role,
      client: null,
      capabilities,
    })

    return withImmediateTransaction(this.database, () => {
      const timestamp = new Date().toISOString()
      this.database.prepare(`
        INSERT INTO actors (
          id,
          name,
          kind,
          role,
          status,
          client,
          capabilities_json,
          registered_at,
          last_active_at,
          version
        ) VALUES (?, ?, 'human', ?, 'active', NULL, ?, ?, NULL, 1)
      `).run(
        id,
        input.name,
        role,
        JSON.stringify(capabilities),
        timestamp,
      )

      recordActivity(this.database, {
        actorId: actorId ?? id,
        source: validatedSource,
        operation: 'actor.create',
        entityType: 'actor',
        entityId: id,
        action: `Created human actor ${input.name}`,
        createdAt: timestamp,
      })

      return this.get(id)
    })
  }

  registerAgent(
    input: RegisterAgentInput,
    actorId?: string,
    source: ActivitySource = 'mcp',
  ): PersistedActor {
    const role = agentActorRoleSchema.parse(input.role)
    const capabilities = input.capabilities ?? []
    const validatedSource = activitySourceSchema.parse(source)
    validateActorData({
      name: input.name,
      kind: 'agent',
      role,
      client: input.client,
      capabilities,
    })

    return withImmediateTransaction(this.database, () => {
      const existing = this.database.prepare(`
        SELECT
          id,
          name,
          kind,
          role,
          status,
          client,
          capabilities_json,
          registered_at,
          last_active_at,
          last_briefing_activity_id,
          version
        FROM actors
        WHERE kind = 'agent' AND client = ? AND name = ?
      `).get(input.client, input.name) as unknown as ActorRow | undefined

      if (existing !== undefined) {
        return mapActor(existing)
      }

      const id = generateActorId()
      const timestamp = new Date().toISOString()
      this.database.prepare(`
        INSERT INTO actors (
          id,
          name,
          kind,
          role,
          status,
          client,
          capabilities_json,
          registered_at,
          last_active_at,
          version
        ) VALUES (?, ?, 'agent', ?, 'active', ?, ?, ?, ?, 1)
      `).run(
        id,
        input.name,
        role,
        input.client,
        JSON.stringify(capabilities),
        timestamp,
        timestamp,
      )

      recordActivity(this.database, {
        actorId: actorId ?? id,
        source: validatedSource,
        operation: 'actor.register',
        entityType: 'actor',
        entityId: id,
        action: `Registered agent ${input.name}`,
        createdAt: timestamp,
      })

      return this.get(id)
    })
  }

  list(filter: ActorListFilter = {}): PersistedActor[] {
    const clauses: string[] = []
    const values: SQLInputValue[] = []

    if (filter.kind !== undefined) {
      if (filter.kind !== 'human' && filter.kind !== 'agent') {
        throw new DomainError('ACTOR_KIND_INVALID', 'Actor kind is invalid')
      }
      clauses.push('kind = ?')
      values.push(filter.kind)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      values.push(actorStatusSchema.parse(filter.status))
    }
    if (filter.after !== undefined) {
      if (filter.after.name.length === 0 || filter.after.id.length === 0) {
        throw new DomainError(
          'INPUT_INVALID',
          'Actor list keyset is invalid',
        )
      }
      clauses.push('(name > ? OR (name = ? AND id > ?))')
      values.push(
        filter.after.name,
        filter.after.name,
        filter.after.id,
      )
    }
    if (
      filter.limit !== undefined
      && (!Number.isInteger(filter.limit) || filter.limit < 1)
    ) {
      throw new DomainError('INPUT_INVALID', 'Actor list limit is invalid')
    }

    const where = clauses.length === 0
      ? ''
      : `WHERE ${clauses.join(' AND ')}`
    const limit = filter.limit === undefined ? '' : 'LIMIT ?'
    if (filter.limit !== undefined) {
      values.push(filter.limit)
    }
    const rows = this.database.prepare(`
      SELECT
        id,
        name,
        kind,
        role,
        status,
        client,
        capabilities_json,
        registered_at,
        last_active_at,
        last_briefing_activity_id,
        version
      FROM actors
      ${where}
      ORDER BY name, id
      ${limit}
    `).all(...values) as unknown as ActorRow[]

    return rows.map(mapActor)
  }

  get(id: string): PersistedActor {
    const row = this.selectById.get(id) as unknown as ActorRow | undefined
    if (row === undefined) {
      throw actorNotFound(id)
    }
    return mapActor(row)
  }

  update(
    id: string,
    input: UpdateActorInput,
    actorId: string,
    source: ActivitySource,
  ): PersistedActor {
    const validatedSource = activitySourceSchema.parse(source)

    return withImmediateTransaction(this.database, () => {
      const current = this.get(id)
      if (current.status !== 'active') {
        throw actorInactive(id)
      }
      if (current.version !== input.version) {
        throw actorVersionConflict(id, input.version, current.version)
      }

      const name = input.name === undefined ? current.name : input.name
      const capabilities = input.capabilities === undefined
        ? current.capabilities
        : input.capabilities
      const requestedRole = input.role === undefined
        ? current.role
        : input.role
      const role = current.kind === 'human'
        ? humanActorRoleSchema.parse(requestedRole)
        : agentActorRoleSchema.parse(requestedRole)
      validateActorData({
        name,
        kind: current.kind,
        role,
        client: current.client ?? null,
        capabilities,
      })

      if (
        name === current.name
        && role === current.role
        && sameCapabilities(capabilities, current.capabilities)
      ) {
        return current
      }

      if (current.kind === 'agent') {
        const client = current.client
        if (client === null || client === undefined) {
          throw new DomainError(
            'ACTOR_CLIENT_INVALID',
            'Agent actor has no client identity',
            { actorId: id },
          )
        }
        const conflict = this.database.prepare(`
          SELECT id
          FROM actors
          WHERE kind = 'agent'
            AND client = ?
            AND name = ?
            AND id <> ?
        `).get(client, name, id)

        if (conflict !== undefined) {
          throw new DomainError(
            'ACTOR_NAME_CONFLICT',
            'Agent name already exists for this client',
            { actorId: id, client, name },
          )
        }
      }

      this.database.prepare(`
        UPDATE actors
        SET
          name = ?,
          role = ?,
          capabilities_json = ?,
          version = version + 1
        WHERE id = ? AND version = ?
      `).run(
        name,
        role,
        JSON.stringify(capabilities),
        id,
        input.version,
      )

      recordActivity(this.database, {
        actorId,
        source: validatedSource,
        operation: 'actor.update',
        entityType: 'actor',
        entityId: id,
        action: `Updated actor ${name}`,
      })

      return this.get(id)
    })
  }

  deactivate(
    id: string,
    expectedVersion: number,
    actorId: string = id,
    source: ActivitySource = 'web',
  ): PersistedActor {
    const validatedSource = activitySourceSchema.parse(source)

    return withImmediateTransaction(this.database, () => {
      const current = this.get(id)
      if (current.version !== expectedVersion) {
        throw actorVersionConflict(id, expectedVersion, current.version)
      }
      if (current.status === 'inactive') {
        return current
      }

      const result = this.database.prepare(`
        UPDATE actors
        SET status = 'inactive', version = version + 1
        WHERE id = ? AND version = ?
      `).run(id, expectedVersion)
      if (Number(result.changes) !== 1) {
        const latest = this.get(id)
        throw actorVersionConflict(id, expectedVersion, latest.version)
      }

      recordActivity(this.database, {
        actorId,
        source: validatedSource,
        operation: 'actor.deactivate',
        entityType: 'actor',
        entityId: id,
        action: `Deactivated actor ${current.name}`,
      })

      return this.get(id)
    })
  }

  touch(
    id: string,
    actorId: string = id,
    source: ActivitySource = 'mcp',
  ): PersistedActor {
    const validatedSource = activitySourceSchema.parse(source)

    return withImmediateTransaction(this.database, () => {
      const current = this.get(id)
      if (current.status !== 'active') {
        throw actorInactive(id)
      }

      const timestamp = new Date().toISOString()
      this.database.prepare(`
        UPDATE actors
        SET last_active_at = ?, version = version + 1
        WHERE id = ?
      `).run(timestamp, id)

      recordActivity(this.database, {
        actorId,
        source: validatedSource,
        operation: 'actor.update',
        entityType: 'actor',
        entityId: id,
        action: `Touched actor ${current.name}`,
        createdAt: timestamp,
      })

      return this.get(id)
    })
  }
}
