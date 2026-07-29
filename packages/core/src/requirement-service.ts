import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import {
  activitySourceSchema,
  persistedRequirementSchema,
  requirementSchema,
  requirementStatusSchema,
} from '@project-os/contracts'
import type {
  ActivitySource,
  ActorRole,
  PersistedRequirement,
  Priority,
  RequirementStatus,
} from '@project-os/contracts'
import {
  recordActivity,
  withImmediateTransaction,
} from './activity-service.js'
import { DomainError } from './errors.js'
import {
  assertPermission,
  canPerform,
} from './permissions.js'

type RequirementRow = {
  id: string
  code: string
  project_id: string
  title: string
  description: string
  priority: Priority
  status: RequirementStatus
  acceptance_criteria_json: string
  created_at: string
  updated_at: string
  version: number
}

type ActorAccessRow = {
  role: ActorRole
  status: 'active' | 'inactive'
}

export type CreateRequirementInput = {
  projectId: string
  title: string
  description?: string
  priority: Priority
  status?: RequirementStatus
  acceptanceCriteria?: string[]
  linkedTaskIds?: string[]
}

export type UpdateRequirementInput = {
  title?: string
  description?: string
  priority?: Priority
  status?: RequirementStatus
  acceptanceCriteria?: string[]
  linkedTaskIds?: string[]
  version: number
}

export type RequirementListFilter = {
  projectId?: string
  status?: RequirementStatus
}

const createRequirementInputSchema = persistedRequirementSchema.pick({
  projectId: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  acceptanceCriteria: true,
  linkedTaskIds: true,
}).extend({
  description: requirementSchema.shape.description.optional(),
  status: requirementSchema.shape.status.optional(),
  acceptanceCriteria: requirementSchema.shape.acceptanceCriteria.optional(),
  linkedTaskIds: requirementSchema.shape.linkedTaskIds.optional(),
})

const updateRequirementInputSchema = requirementSchema.pick({
  title: true,
  description: true,
  priority: true,
  status: true,
  acceptanceCriteria: true,
  linkedTaskIds: true,
}).partial().extend({
  version: persistedRequirementSchema.shape.version,
})

const requirementSelect = `
  SELECT
    id,
    code,
    project_id,
    title,
    description,
    priority,
    status,
    acceptance_criteria_json,
    created_at,
    updated_at,
    version
  FROM requirements
`

function requirementNotFound(id: string): DomainError {
  return new DomainError(
    'REQUIREMENT_NOT_FOUND',
    'Requirement does not exist',
    { requirementId: id },
  )
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function sameRequirement(
  left: PersistedRequirement,
  right: PersistedRequirement,
): boolean {
  return left.title === right.title
    && left.description === right.description
    && left.priority === right.priority
    && left.status === right.status
    && sameIds(left.acceptanceCriteria, right.acceptanceCriteria)
    && sameIds(left.linkedTaskIds, right.linkedTaskIds)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export class RequirementService {
  constructor(private readonly database: DatabaseSync) {}

  create(
    input: CreateRequirementInput,
    actorId: string,
    source: ActivitySource,
  ): PersistedRequirement {
    const validatedSource = activitySourceSchema.parse(source)
    const parsed = createRequirementInputSchema.parse({
      ...input,
      description: input.description === undefined
        ? ''
        : input.description,
      status: input.status === undefined ? 'draft' : input.status,
      acceptanceCriteria: input.acceptanceCriteria === undefined
        ? []
        : input.acceptanceCriteria,
      linkedTaskIds: input.linkedTaskIds === undefined
        ? []
        : input.linkedTaskIds,
    })
    const validated = {
      ...parsed,
      linkedTaskIds: unique(parsed.linkedTaskIds ?? []),
    }

    return withImmediateTransaction(this.database, () => {
      const actor = this.assertActiveActor(actorId)
      assertPermission(actor.role, 'requirement.write')
      this.assertProject(validated.projectId)
      this.assertLinkedTasks(
        validated.projectId,
        validated.linkedTaskIds,
      )
      const linkedTaskIds = this.canonicalTaskIds(validated.linkedTaskIds)
      const id = `requirement_${randomUUID()}`
      const code = this.nextCode(validated.projectId)
      const timestamp = new Date().toISOString()
      this.database.prepare(`
        INSERT INTO requirements (
          id, code, project_id, title, description, priority, status,
          acceptance_criteria_json, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        id,
        code,
        validated.projectId,
        validated.title,
        validated.description ?? '',
        validated.priority,
        validated.status ?? 'draft',
        JSON.stringify(validated.acceptanceCriteria ?? []),
        timestamp,
        timestamp,
      )
      this.replaceLinks(id, linkedTaskIds)
      recordActivity(this.database, {
        actorId,
        projectId: validated.projectId,
        source: validatedSource,
        operation: 'requirement.create',
        entityType: 'requirement',
        entityId: id,
        action: `Created requirement ${validated.title}`,
        createdAt: timestamp,
      })
      return this.get(id)
    })
  }

  get(id: string): PersistedRequirement {
    const row = this.database.prepare(`
      ${requirementSelect}
      WHERE id = ?
    `).get(id) as unknown as RequirementRow | undefined
    if (row === undefined) {
      throw requirementNotFound(id)
    }
    return this.mapRequirement(row)
  }

  list(filter: RequirementListFilter = {}): PersistedRequirement[] {
    const clauses: string[] = []
    const values: SQLInputValue[] = []
    if (filter.projectId !== undefined) {
      clauses.push('project_id = ?')
      values.push(filter.projectId)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      values.push(requirementStatusSchema.parse(filter.status))
    }
    const where = clauses.length === 0
      ? ''
      : `WHERE ${clauses.join(' AND ')}`
    const rows = this.database.prepare(`
      ${requirementSelect}
      ${where}
      ORDER BY project_id, code, id
    `).all(...values) as unknown as RequirementRow[]
    return rows.map((row) => this.mapRequirement(row))
  }

  update(
    id: string,
    input: UpdateRequirementInput,
    actorId: string,
    source: ActivitySource,
  ): PersistedRequirement {
    const validatedSource = activitySourceSchema.parse(source)
    const parsed = updateRequirementInputSchema.parse(input)
    const validated = {
      ...parsed,
      ...(parsed.linkedTaskIds === undefined
        ? {}
        : { linkedTaskIds: unique(parsed.linkedTaskIds) }),
    }

    return withImmediateTransaction(this.database, () => {
      const actor = this.assertActiveActor(actorId)
      const suppliedKeys = Object.entries(input)
        .filter(([key, value]) => key !== 'version' && value !== undefined)
        .map(([key]) => key)
      const descriptionOnly = suppliedKeys.length > 0
        && suppliedKeys.every((key) => key === 'description')
      if (!canPerform(actor.role, 'requirement.write')) {
        assertPermission(
          actor.role,
          descriptionOnly ? 'description.write' : 'requirement.write',
        )
      }
      const current = this.get(id)
      if (validated.version !== current.version) {
        throw new DomainError(
          'REQUIREMENT_VERSION_CONFLICT',
          'Requirement version is stale',
          {
            requirementId: id,
            expectedVersion: validated.version,
            currentVersion: current.version,
          },
        )
      }
      const candidateInput = persistedRequirementSchema.parse({
        ...current,
        ...validated,
        version: current.version,
        updatedAt: current.updatedAt,
        completedTaskCount: current.completedTaskCount,
      })
      this.assertLinkedTasks(current.projectId, candidateInput.linkedTaskIds)
      const candidate = persistedRequirementSchema.parse({
        ...candidateInput,
        linkedTaskIds: this.canonicalTaskIds(candidateInput.linkedTaskIds),
      })
      if (sameRequirement(candidate, current)) {
        return current
      }

      const timestamp = new Date().toISOString()
      this.database.prepare(`
        UPDATE requirements
        SET title = ?, description = ?, priority = ?, status = ?,
          acceptance_criteria_json = ?, updated_at = ?,
          version = version + 1
        WHERE id = ? AND version = ?
      `).run(
        candidate.title,
        candidate.description ?? '',
        candidate.priority,
        candidate.status,
        JSON.stringify(candidate.acceptanceCriteria),
        timestamp,
        id,
        validated.version,
      )
      this.replaceLinks(id, candidate.linkedTaskIds)
      recordActivity(this.database, {
        actorId,
        projectId: current.projectId,
        source: validatedSource,
        operation: 'requirement.update',
        entityType: 'requirement',
        entityId: id,
        action: `Updated requirement ${candidate.title}`,
        createdAt: timestamp,
      })
      return this.get(id)
    })
  }

  private nextCode(projectId: string): string {
    const row = this.database.prepare(`
      SELECT COALESCE(
        MAX(
          CASE
            WHEN code GLOB 'REQ-[0-9]*'
            THEN CAST(substr(code, 5) AS INTEGER)
          END
        ),
        0
      ) + 1 AS next
      FROM requirements
      WHERE project_id = ?
    `).get(projectId) as { next: number }
    return `REQ-${row.next.toString().padStart(4, '0')}`
  }

  private assertProject(projectId: string): void {
    if (this.database.prepare(`
      SELECT id FROM projects WHERE id = ?
    `).get(projectId) === undefined) {
      throw new DomainError(
        'PROJECT_NOT_FOUND',
        'Project does not exist',
        { projectId },
      )
    }
  }

  private assertLinkedTasks(
    projectId: string,
    taskIds: readonly string[],
  ): void {
    for (const taskId of taskIds) {
      const row = this.database.prepare(`
        SELECT project_id FROM tasks WHERE id = ?
      `).get(taskId) as { project_id: string } | undefined
      if (row === undefined) {
        throw new DomainError(
          'TASK_NOT_FOUND',
          'Task does not exist',
          { taskId },
        )
      }
      if (row.project_id !== projectId) {
        throw new DomainError(
          'TASK_PROJECT_MISMATCH',
          'Linked task belongs to another project',
          { taskId, projectId },
        )
      }
    }
  }

  private replaceLinks(
    requirementId: string,
    taskIds: readonly string[],
  ): void {
    this.database.prepare(`
      DELETE FROM requirement_tasks WHERE requirement_id = ?
    `).run(requirementId)
    const insert = this.database.prepare(`
      INSERT INTO requirement_tasks (requirement_id, task_id)
      VALUES (?, ?)
    `)
    for (const taskId of taskIds) {
      insert.run(requirementId, taskId)
    }
  }

  private canonicalTaskIds(taskIds: readonly string[]): string[] {
    if (taskIds.length === 0) {
      return []
    }
    const codeById = new Map(
      taskIds.map((taskId) => {
        const row = this.database.prepare(`
          SELECT code FROM tasks WHERE id = ?
        `).get(taskId) as { code: string }
        return [taskId, row.code] as const
      }),
    )
    return unique(taskIds).sort((left, right) => (
      codeById.get(left)!.localeCompare(codeById.get(right)!)
      || left.localeCompare(right)
    ))
  }

  private assertActiveActor(actorId: string): ActorAccessRow {
    const row = this.database.prepare(`
      SELECT role, status FROM actors WHERE id = ?
    `).get(actorId) as ActorAccessRow | undefined
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
    return row
  }

  private mapRequirement(row: RequirementRow): PersistedRequirement {
    const links = this.database.prepare(`
      SELECT requirement_tasks.task_id
      FROM requirement_tasks
      JOIN tasks ON tasks.id = requirement_tasks.task_id
      WHERE requirement_tasks.requirement_id = ?
      ORDER BY tasks.code, tasks.id
    `).all(row.id) as unknown as { task_id: string }[]
    const completed = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM requirement_tasks
      JOIN tasks ON tasks.id = requirement_tasks.task_id
      WHERE requirement_tasks.requirement_id = ?
        AND tasks.status = 'done'
    `).get(row.id) as { count: number }
    return persistedRequirementSchema.parse({
      id: row.id,
      code: row.code,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      linkedTaskIds: links.map((link) => link.task_id),
      completedTaskCount: completed.count,
      acceptanceCriteria: JSON.parse(row.acceptance_criteria_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    })
  }
}
