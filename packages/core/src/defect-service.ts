import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import {
  activitySourceSchema,
  defectSchema,
  defectStatusSchema,
  persistedActorSchema,
  persistedDefectSchema,
  persistedTaskSchema,
} from '@project-os/contracts'
import type {
  ActivitySource,
  ActorRole,
  DefectStatus,
  PersistedActor,
  PersistedDefect,
  PersistedTask,
  Priority,
  Severity,
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
import { TaskService } from './task-service.js'

type DefectRow = {
  id: string
  code: string
  project_id: string
  title: string
  description: string
  severity: Severity
  status: DefectStatus
  assignee_id: string
  reproduction_steps_json: string
  linked_requirement_id: string | null
  linked_task_id: string | null
  created_at: string
  updated_at: string
  version: number
}

type ActorAccessRow = {
  role: ActorRole
  status: 'active' | 'inactive'
}

export type CreateDefectInput = {
  projectId: string
  title: string
  description?: string
  severity: Severity
  status?: DefectStatus
  assigneeId: string
  reproductionSteps?: string[]
  linkedRequirementId?: string
  linkedTaskId?: string
}

export type UpdateDefectInput = {
  title?: string
  description?: string
  severity?: Severity
  status?: DefectStatus
  assigneeId?: string
  reproductionSteps?: string[]
  linkedRequirementId?: string
  linkedTaskId?: string
  version: number
}

export type DefectToTaskInput = {
  startDate: string
  dueDate: string
  priority?: Priority
  version: number
}

export type DefectListFilter = {
  projectId?: string
  assigneeId?: string
  status?: DefectStatus
}

const createDefectInputSchema = persistedDefectSchema.pick({
  projectId: true,
  title: true,
  description: true,
  severity: true,
  status: true,
  assigneeId: true,
  reproductionSteps: true,
  linkedRequirementId: true,
  linkedTaskId: true,
}).extend({
  description: defectSchema.shape.description.optional(),
  status: defectSchema.shape.status.optional(),
  reproductionSteps: defectSchema.shape.reproductionSteps.optional(),
  linkedRequirementId: defectSchema.shape.linkedRequirementId.optional(),
  linkedTaskId: defectSchema.shape.linkedTaskId.optional(),
})

const updateDefectInputSchema = defectSchema.pick({
  title: true,
  description: true,
  severity: true,
  status: true,
  assigneeId: true,
  reproductionSteps: true,
  linkedRequirementId: true,
  linkedTaskId: true,
}).partial().extend({
  version: persistedDefectSchema.shape.version,
})

const defectToTaskInputSchema = persistedTaskSchema.pick({
  startDate: true,
  dueDate: true,
  priority: true,
  version: true,
}).partial({
  priority: true,
}).required({
  startDate: true,
  dueDate: true,
  version: true,
})

const defectSelect = `
  SELECT
    id,
    code,
    project_id,
    title,
    description,
    severity,
    status,
    assignee_id,
    reproduction_steps_json,
    linked_requirement_id,
    linked_task_id,
    created_at,
    updated_at,
    version
  FROM defects
`

function defectNotFound(id: string): DomainError {
  return new DomainError(
    'DEFECT_NOT_FOUND',
    'Defect does not exist',
    { defectId: id },
  )
}

function assertTaskDateOrder(startDate: string, dueDate: string): void {
  if (startDate > dueDate) {
    throw new DomainError(
      'TASK_DATE_RANGE_INVALID',
      'Task start date must not be after its due date',
      { startDate, dueDate },
    )
  }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function sameDefect(left: PersistedDefect, right: PersistedDefect): boolean {
  return left.title === right.title
    && left.description === right.description
    && left.severity === right.severity
    && left.status === right.status
    && left.assigneeId === right.assigneeId
    && left.linkedRequirementId === right.linkedRequirementId
    && left.linkedTaskId === right.linkedTaskId
    && sameValues(left.reproductionSteps, right.reproductionSteps)
}

function priorityForSeverity(severity: Severity): Priority {
  switch (severity) {
    case 'fatal':
      return 'P0'
    case 'serious':
      return 'P1'
    case 'normal':
      return 'P2'
    case 'suggestion':
      return 'P3'
  }
}

export class DefectService {
  constructor(private readonly database: DatabaseSync) {}

  create(
    input: CreateDefectInput,
    actorId: string,
    source: ActivitySource,
  ): PersistedDefect {
    const validatedSource = activitySourceSchema.parse(source)
    const validated = createDefectInputSchema.parse({
      ...input,
      description: input.description === undefined
        ? ''
        : input.description,
      status: input.status === undefined ? 'open' : input.status,
      reproductionSteps: input.reproductionSteps === undefined
        ? []
        : input.reproductionSteps,
    })

    return withImmediateTransaction(this.database, () => {
      const actor = this.assertActiveActor(actorId)
      assertPermission(actor.role, 'defect.write')
      if (
        actor.role === 'dev-agent'
        && validated.assigneeId !== actorId
      ) {
        throw new DomainError(
          'PERMISSION_DENIED',
          'Developer agents may create only defects assigned to themselves',
          { actorId, assigneeId: validated.assigneeId },
        )
      }
      this.assertProject(validated.projectId)
      this.assertActiveActor(validated.assigneeId)
      this.assertLinks(
        validated.projectId,
        validated.linkedRequirementId,
        validated.linkedTaskId,
      )
      const id = `defect_${randomUUID()}`
      const code = this.nextCode(validated.projectId)
      const timestamp = new Date().toISOString()
      this.database.prepare(`
        INSERT INTO defects (
          id, code, project_id, title, description, severity, status,
          assignee_id, reproduction_steps_json, linked_requirement_id,
          linked_task_id, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        id,
        code,
        validated.projectId,
        validated.title,
        validated.description ?? '',
        validated.severity,
        validated.status ?? 'open',
        validated.assigneeId,
        JSON.stringify(validated.reproductionSteps ?? []),
        validated.linkedRequirementId ?? null,
        validated.linkedTaskId ?? null,
        timestamp,
        timestamp,
      )
      recordActivity(this.database, {
        actorId,
        projectId: validated.projectId,
        source: validatedSource,
        operation: 'defect.create',
        entityType: 'defect',
        entityId: id,
        action: `Created defect ${validated.title}`,
        createdAt: timestamp,
      })
      return this.get(id)
    })
  }

  get(id: string): PersistedDefect {
    const row = this.database.prepare(`
      ${defectSelect}
      WHERE id = ?
    `).get(id) as unknown as DefectRow | undefined
    if (row === undefined) {
      throw defectNotFound(id)
    }
    return this.mapDefect(row)
  }

  list(filter: DefectListFilter = {}): PersistedDefect[] {
    const clauses: string[] = []
    const values: SQLInputValue[] = []
    if (filter.projectId !== undefined) {
      clauses.push('project_id = ?')
      values.push(filter.projectId)
    }
    if (filter.assigneeId !== undefined) {
      clauses.push('assignee_id = ?')
      values.push(filter.assigneeId)
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?')
      values.push(defectStatusSchema.parse(filter.status))
    }
    const where = clauses.length === 0
      ? ''
      : `WHERE ${clauses.join(' AND ')}`
    const rows = this.database.prepare(`
      ${defectSelect}
      ${where}
      ORDER BY project_id, code, id
    `).all(...values) as unknown as DefectRow[]
    return rows.map((row) => this.mapDefect(row))
  }

  update(
    id: string,
    input: UpdateDefectInput,
    actorId: string,
    source: ActivitySource,
  ): PersistedDefect {
    const validatedSource = activitySourceSchema.parse(source)
    const validated = updateDefectInputSchema.parse(input)

    return withImmediateTransaction(this.database, () => {
      const actor = this.assertActiveActor(actorId)
      const suppliedKeys = Object.entries(input)
        .filter(([key, value]) => key !== 'version' && value !== undefined)
        .map(([key]) => key)
      const descriptionOnly = suppliedKeys.length > 0
        && suppliedKeys.every((key) => key === 'description')
      if (!canPerform(actor.role, 'defect.write')) {
        assertPermission(
          actor.role,
          descriptionOnly ? 'description.write' : 'defect.write',
        )
      }
      const current = this.get(id)
      if (actor.role === 'dev-agent' && current.assigneeId !== actorId) {
        throw new DomainError(
          'PERMISSION_DENIED',
          'Developer agents may update only assigned defects',
          { actorId, defectId: id },
        )
      }
      if (validated.version !== current.version) {
        throw new DomainError(
          'DEFECT_VERSION_CONFLICT',
          'Defect version is stale',
          {
            defectId: id,
            expectedVersion: validated.version,
            currentVersion: current.version,
          },
        )
      }
      const candidate = persistedDefectSchema.parse({
        ...current,
        ...validated,
        version: current.version,
        updatedAt: current.updatedAt,
      })
      if (
        actor.role === 'dev-agent'
        && candidate.assigneeId !== actorId
      ) {
        throw new DomainError(
          'PERMISSION_DENIED',
          'Developer agents may retain only their own defect assignments',
          { actorId, defectId: id, assigneeId: candidate.assigneeId },
        )
      }
      this.assertActiveActor(candidate.assigneeId)
      this.assertLinks(
        current.projectId,
        candidate.linkedRequirementId,
        candidate.linkedTaskId,
      )
      if (sameDefect(candidate, current)) {
        return current
      }

      const timestamp = new Date().toISOString()
      this.database.prepare(`
        UPDATE defects
        SET title = ?, description = ?, severity = ?, status = ?,
          assignee_id = ?, reproduction_steps_json = ?,
          linked_requirement_id = ?, linked_task_id = ?,
          updated_at = ?, version = version + 1
        WHERE id = ? AND version = ?
      `).run(
        candidate.title,
        candidate.description ?? '',
        candidate.severity,
        candidate.status,
        candidate.assigneeId,
        JSON.stringify(candidate.reproductionSteps),
        candidate.linkedRequirementId ?? null,
        candidate.linkedTaskId ?? null,
        timestamp,
        id,
        validated.version,
      )
      recordActivity(this.database, {
        actorId,
        projectId: current.projectId,
        source: validatedSource,
        operation: 'defect.update',
        entityType: 'defect',
        entityId: id,
        action: `Updated defect ${candidate.title}`,
        createdAt: timestamp,
      })
      return this.get(id)
    })
  }

  toTask(
    id: string,
    input: DefectToTaskInput,
    actorId: string,
    source: ActivitySource,
  ): PersistedTask {
    const validatedSource = activitySourceSchema.parse(source)
    const validated = defectToTaskInputSchema.parse(input)
    assertTaskDateOrder(validated.startDate, validated.dueDate)

    return withImmediateTransaction(this.database, () => {
      const actor = this.assertActiveActor(actorId)
      assertPermission(actor.role, 'task.write')
      const current = this.get(id)
      if (current.linkedTaskId !== undefined) {
        return new TaskService(this.database).get(current.linkedTaskId)
      }
      if (validated.version !== current.version) {
        throw new DomainError(
          'DEFECT_VERSION_CONFLICT',
          'Defect version is stale',
          {
            defectId: id,
            expectedVersion: validated.version,
            currentVersion: current.version,
          },
        )
      }
      this.assertActiveActor(current.assigneeId)
      const taskId = `task_${randomUUID()}`
      const taskCode = this.nextTaskCode(current.projectId)
      const priority = validated.priority
        ?? priorityForSeverity(current.severity)
      const timestamp = new Date().toISOString()
      const description = [
        `Created from defect ${current.code}.`,
        current.description ?? '',
        current.reproductionSteps.length === 0
          ? ''
          : `Reproduction:\n${current.reproductionSteps
              .map((step, index) => `${index + 1}. ${step}`)
              .join('\n')}`,
      ].filter((part) => part !== undefined && part.length > 0).join('\n\n')

      this.database.prepare(`
        INSERT INTO tasks (
          id, code, project_id, title, description, assignee_id,
          start_date, due_date, priority, status, progress, milestone_id,
          parent_id, dependency_ids_json, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', 0, '', NULL, '[]', ?, ?, 1)
      `).run(
        taskId,
        taskCode,
        current.projectId,
        `[${current.code}] ${current.title}`,
        description,
        current.assigneeId,
        validated.startDate,
        validated.dueDate,
        priority,
        timestamp,
        timestamp,
      )
      this.database.prepare(`
        UPDATE defects
        SET linked_task_id = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND linked_task_id IS NULL AND version = ?
      `).run(taskId, timestamp, id, current.version)
      recordActivity(this.database, {
        actorId,
        projectId: current.projectId,
        source: validatedSource,
        operation: 'defect.to_task',
        entityType: 'defect',
        entityId: id,
        action: `Converted defect ${current.code} to task ${taskCode}`,
        createdAt: timestamp,
        details: { taskId },
      })
      return new TaskService(this.database).get(taskId)
    })
  }

  private nextCode(projectId: string): string {
    const row = this.database.prepare(`
      SELECT COALESCE(
        MAX(
          CASE
            WHEN code GLOB 'BUG-[0-9]*'
            THEN CAST(substr(code, 5) AS INTEGER)
          END
        ),
        0
      ) + 1 AS next
      FROM defects
      WHERE project_id = ?
    `).get(projectId) as { next: number }
    return `BUG-${row.next.toString().padStart(4, '0')}`
  }

  private nextTaskCode(projectId: string): string {
    const row = this.database.prepare(`
      SELECT COALESCE(
        MAX(
          CASE
            WHEN code GLOB 'TASK-[0-9]*'
            THEN CAST(substr(code, 6) AS INTEGER)
          END
        ),
        0
      ) + 1 AS next
      FROM tasks
      WHERE project_id = ?
    `).get(projectId) as { next: number }
    return `TASK-${row.next.toString().padStart(4, '0')}`
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

  private assertLinks(
    projectId: string,
    requirementId: string | undefined,
    taskId: string | undefined,
  ): void {
    if (requirementId !== undefined) {
      const requirement = this.database.prepare(`
        SELECT project_id FROM requirements WHERE id = ?
      `).get(requirementId) as { project_id: string } | undefined
      if (requirement === undefined) {
        throw new DomainError(
          'REQUIREMENT_NOT_FOUND',
          'Requirement does not exist',
          { requirementId },
        )
      }
      if (requirement.project_id !== projectId) {
        throw new DomainError(
          'REQUIREMENT_PROJECT_MISMATCH',
          'Linked requirement belongs to another project',
          { requirementId, projectId },
        )
      }
    }
    if (taskId !== undefined) {
      const task = this.database.prepare(`
        SELECT project_id FROM tasks WHERE id = ?
      `).get(taskId) as { project_id: string } | undefined
      if (task === undefined) {
        throw new DomainError(
          'TASK_NOT_FOUND',
          'Task does not exist',
          { taskId },
        )
      }
      if (task.project_id !== projectId) {
        throw new DomainError(
          'TASK_PROJECT_MISMATCH',
          'Linked task belongs to another project',
          { taskId, projectId },
        )
      }
    }
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

  private mapDefect(row: DefectRow): PersistedDefect {
    const actorRow = this.database.prepare(`
      SELECT
        id, name, kind, role, status, client, capabilities_json,
        registered_at, last_active_at, version
      FROM actors
      WHERE id = ?
    `).get(row.assignee_id) as {
      id: string
      name: string
      kind: 'human' | 'agent'
      role: PersistedActor['role']
      status: PersistedActor['status']
      client: string | null
      capabilities_json: string
      registered_at: string
      last_active_at: string | null
      version: number
    }
    const assignee = persistedActorSchema.parse({
      id: actorRow.id,
      name: actorRow.name,
      kind: actorRow.kind,
      role: actorRow.role,
      status: actorRow.status,
      client: actorRow.client,
      capabilities: JSON.parse(actorRow.capabilities_json),
      registeredAt: actorRow.registered_at,
      lastActiveAt: actorRow.last_active_at,
      version: actorRow.version,
    })
    return persistedDefectSchema.parse({
      id: row.id,
      code: row.code,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      assignee,
      assigneeId: row.assignee_id,
      updatedAt: row.updated_at,
      reproductionSteps: JSON.parse(row.reproduction_steps_json),
      ...(row.linked_task_id === null
        ? {}
        : { linkedTaskId: row.linked_task_id }),
      ...(row.linked_requirement_id === null
        ? {}
        : { linkedRequirementId: row.linked_requirement_id }),
      createdAt: row.created_at,
      version: row.version,
    })
  }
}
