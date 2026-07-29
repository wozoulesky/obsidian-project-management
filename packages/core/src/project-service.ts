import type {
  DatabaseSync,
  SQLInputValue,
  StatementSync,
} from 'node:sqlite'
import {
  activitySourceSchema,
  createProjectInputSchema,
  persistedProjectMemberSchema,
  persistedProjectSchema,
  projectSchema,
  projectStatusSchema,
} from '@project-os/contracts'
import type {
  ActivitySource,
  PersistedProject,
  PersistedProjectMember,
  ProjectStatus,
} from '@project-os/contracts'
import {
  recordActivity,
  withImmediateTransaction,
} from './activity-service.js'
import { DomainError } from './errors.js'
import { generateProjectId } from './ids.js'

type ProjectRow = {
  id: string
  code: string
  name: string
  description: string
  owner_id: string
  start_date: string | null
  due_date: string | null
  status: ProjectStatus
  progress: number
  created_at: string
  updated_at: string
  version: number
}

type ProjectMemberRow = {
  project_id: string
  actor_id: string
  membership_role: 'owner' | 'member'
  joined_at: string
}

export type CreateProjectServiceInput = {
  name: string
  description?: string
  ownerId: string
  startDate?: string | null
  dueDate?: string | null
}

export type UpdateProjectInput = {
  name?: string
  description?: string
  ownerId?: string
  startDate?: string | null
  dueDate?: string | null
  status?: ProjectStatus
  progress?: number
  version: number
}

export type ProjectListFilter = {
  ownerId?: string
  status?: ProjectStatus
}

function mapProject(row: ProjectRow): PersistedProject {
  return persistedProjectSchema.parse({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    startDate: row.start_date,
    dueDate: row.due_date,
    status: row.status,
    progress: row.progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  })
}

function mapProjectMember(row: ProjectMemberRow): PersistedProjectMember {
  return persistedProjectMemberSchema.parse({
    projectId: row.project_id,
    actorId: row.actor_id,
    membershipRole: row.membership_role,
    joinedAt: row.joined_at,
  })
}

function projectNotFound(id: string): DomainError {
  return new DomainError(
    'PROJECT_NOT_FOUND',
    'Project does not exist',
    { projectId: id },
  )
}

function assertDateOrder(
  startDate: string | null,
  dueDate: string | null,
): void {
  if (
    startDate !== null
    && dueDate !== null
    && startDate > dueDate
  ) {
    throw new DomainError(
      'PROJECT_DATE_RANGE_INVALID',
      'Project start date must not be after its due date',
      { startDate, dueDate },
    )
  }
}

function hasSameProjectValues(
  left: PersistedProject,
  right: PersistedProject,
): boolean {
  return left.name === right.name
    && left.description === right.description
    && left.ownerId === right.ownerId
    && left.startDate === right.startDate
    && left.dueDate === right.dueDate
    && left.status === right.status
    && left.progress === right.progress
}

export class ProjectService {
  private readonly selectById: StatementSync

  constructor(
    private readonly database: DatabaseSync,
  ) {
    this.selectById = database.prepare(`
      SELECT
        id,
        code,
        name,
        description,
        owner_id,
        start_date,
        due_date,
        status,
        progress,
        created_at,
        updated_at,
        version
      FROM projects
      WHERE id = ?
    `)
  }

  create(
    input: CreateProjectServiceInput,
    actorId: string,
    source: ActivitySource,
  ): PersistedProject {
    const validatedSource = activitySourceSchema.parse(source)
    const validated = createProjectInputSchema.parse({
      name: input.name,
      description: input.description ?? '',
      ownerId: input.ownerId,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
    })
    assertDateOrder(validated.startDate, validated.dueDate)

    return withImmediateTransaction(this.database, () => {
      this.assertActiveActor(validated.ownerId)
      const sequence = this.database.prepare(`
        SELECT COALESCE(
          MAX(
            CASE
              WHEN code GLOB 'PRJ-[0-9]*'
              THEN CAST(substr(code, 5) AS INTEGER)
            END
          ),
          0
        ) + 1 AS next
        FROM projects
      `).get() as { next: number }
      const id = generateProjectId()
      const code = `PRJ-${sequence.next.toString().padStart(4, '0')}`
      const timestamp = new Date().toISOString()

      this.database.prepare(`
        INSERT INTO projects (
          id,
          code,
          name,
          description,
          owner_id,
          start_date,
          due_date,
          status,
          progress,
          created_at,
          updated_at,
          version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'not_started', 0, ?, ?, 1)
      `).run(
        id,
        code,
        validated.name,
        validated.description,
        validated.ownerId,
        validated.startDate,
        validated.dueDate,
        timestamp,
        timestamp,
      )
      this.database.prepare(`
        INSERT INTO project_members (
          project_id,
          actor_id,
          membership_role,
          joined_at
        ) VALUES (?, ?, 'owner', ?)
      `).run(id, validated.ownerId, timestamp)

      recordActivity(this.database, {
        actorId,
        projectId: id,
        source: validatedSource,
        operation: 'project.create',
        entityType: 'project',
        entityId: id,
        action: `Created project ${validated.name}`,
        createdAt: timestamp,
      })

      return this.get(id)
    })
  }

  get(id: string): PersistedProject {
    const row = this.selectById.get(id) as unknown as ProjectRow | undefined
    if (row === undefined) {
      throw projectNotFound(id)
    }
    return mapProject(row)
  }

  list(filter: ProjectListFilter = {}): PersistedProject[] {
    const clauses: string[] = []
    const values: SQLInputValue[] = []

    if (filter.ownerId !== undefined) {
      clauses.push('owner_id = ?')
      values.push(filter.ownerId)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      values.push(projectStatusSchema.parse(filter.status))
    }

    const where = clauses.length === 0
      ? ''
      : `WHERE ${clauses.join(' AND ')}`
    const rows = this.database.prepare(`
      SELECT
        id,
        code,
        name,
        description,
        owner_id,
        start_date,
        due_date,
        status,
        progress,
        created_at,
        updated_at,
        version
      FROM projects
      ${where}
      ORDER BY code, id
    `).all(...values) as unknown as ProjectRow[]

    return rows.map(mapProject)
  }

  update(
    id: string,
    input: UpdateProjectInput,
    actorId: string,
    source: ActivitySource,
  ): PersistedProject {
    const validatedSource = activitySourceSchema.parse(source)

    return withImmediateTransaction(this.database, () => {
      const current = this.get(id)
      if (current.version !== input.version) {
        throw new DomainError(
          'PROJECT_VERSION_CONFLICT',
          'Project version is stale',
          {
            projectId: id,
            expectedVersion: input.version,
            currentVersion: current.version,
          },
        )
      }

      const candidate = projectSchema.parse({
        ...current,
        ...input,
        version: current.version,
        updatedAt: current.updatedAt,
      })
      assertDateOrder(candidate.startDate, candidate.dueDate)
      this.assertActiveActor(candidate.ownerId)

      if (hasSameProjectValues(candidate, current)) {
        return current
      }

      const next = projectSchema.parse({
        ...candidate,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      })

      this.database.prepare(`
        UPDATE projects
        SET
          name = ?,
          description = ?,
          owner_id = ?,
          start_date = ?,
          due_date = ?,
          status = ?,
          progress = ?,
          updated_at = ?,
          version = version + 1
        WHERE id = ? AND version = ?
      `).run(
        next.name,
        next.description,
        next.ownerId,
        next.startDate,
        next.dueDate,
        next.status,
        next.progress,
        next.updatedAt,
        id,
        input.version,
      )

      if (next.ownerId !== current.ownerId) {
        this.database.prepare(`
          DELETE FROM project_members
          WHERE project_id = ? AND membership_role = 'owner'
        `).run(id)
        this.database.prepare(`
          INSERT INTO project_members (
            project_id,
            actor_id,
            membership_role,
            joined_at
          ) VALUES (?, ?, 'owner', ?)
          ON CONFLICT (project_id, actor_id) DO UPDATE SET
            membership_role = 'owner'
        `).run(id, next.ownerId, next.updatedAt)
      }

      recordActivity(this.database, {
        actorId,
        projectId: id,
        source: validatedSource,
        operation: 'project.update',
        entityType: 'project',
        entityId: id,
        action: `Updated project ${next.name}`,
      })

      return this.get(id)
    })
  }

  addMember(
    projectId: string,
    memberId: string,
    actorId: string,
    source: ActivitySource,
  ): PersistedProjectMember {
    const validatedSource = activitySourceSchema.parse(source)

    return withImmediateTransaction(this.database, () => {
      this.get(projectId)
      this.assertActiveActor(memberId)
      const existing = this.database.prepare(`
        SELECT project_id, actor_id, membership_role, joined_at
        FROM project_members
        WHERE project_id = ? AND actor_id = ?
      `).get(projectId, memberId) as unknown as
        | ProjectMemberRow
        | undefined

      if (existing !== undefined) {
        return mapProjectMember(existing)
      }

      const timestamp = new Date().toISOString()
      this.database.prepare(`
        INSERT INTO project_members (
          project_id,
          actor_id,
          membership_role,
          joined_at
        ) VALUES (?, ?, 'member', ?)
      `).run(projectId, memberId, timestamp)

      recordActivity(this.database, {
        actorId,
        projectId,
        source: validatedSource,
        operation: 'project.member.add',
        entityType: 'actor',
        entityId: memberId,
        action: `Added actor ${memberId} to project ${projectId}`,
        createdAt: timestamp,
      })

      const row = this.database.prepare(`
        SELECT project_id, actor_id, membership_role, joined_at
        FROM project_members
        WHERE project_id = ? AND actor_id = ?
      `).get(projectId, memberId) as unknown as ProjectMemberRow

      return mapProjectMember(row)
    })
  }

  private assertActiveActor(actorId: string): void {
    const row = this.database.prepare(`
      SELECT status
      FROM actors
      WHERE id = ?
    `).get(actorId) as { status: 'active' | 'inactive' } | undefined

    if (row === undefined) {
      throw new DomainError(
        'ACTOR_NOT_FOUND',
        'Actor does not exist',
        { actorId },
      )
    }
    if (row.status !== 'active') {
      throw new DomainError(
        'ACTOR_INACTIVE',
        'Actor is inactive',
        { actorId },
      )
    }
  }
}
