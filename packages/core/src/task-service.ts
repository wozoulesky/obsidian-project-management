import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import {
  activitySourceSchema,
  persistedActorSchema,
  persistedTaskProgressInputSchema,
  persistedTaskSchema,
  taskSchema,
  taskStatusSchema,
} from '@project-os/contracts'
import type {
  ActivitySource,
  ActorRole,
  PersistedActor,
  PersistedTask,
  PersistedTaskProgressInput,
  Priority,
  TaskStatus,
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

type TaskRow = {
  id: string
  code: string
  project_id: string
  title: string
  description: string
  assignee_id: string
  start_date: string
  due_date: string
  priority: Priority
  status: TaskStatus
  progress: number
  milestone_id: string
  parent_id: string | null
  dependency_ids_json: string
  created_at: string
  updated_at: string
  version: number
}

type ActorAccessRow = {
  role: ActorRole
  status: 'active' | 'inactive'
}

export type CreateTaskInput = {
  projectId: string
  title: string
  description?: string
  assigneeId: string
  startDate: string
  dueDate: string
  priority: Priority
  milestoneId?: string
  parentId?: string
  dependencyIds?: string[]
}

export type UpdateTaskInput = {
  title?: string
  description?: string
  assigneeId?: string
  startDate?: string
  dueDate?: string
  priority?: Priority
  status?: TaskStatus
  progress?: number
  milestoneId?: string
  parentId?: string
  dependencyIds?: string[]
  version: number
}

export type TaskListFilter = {
  projectId?: string
  assigneeId?: string
  status?: TaskStatus
  after?: {
    projectId: string
    code: string
    id: string
  }
  limit?: number
}

const createTaskInputSchema = persistedTaskSchema.pick({
  projectId: true,
  title: true,
  description: true,
  assigneeId: true,
  startDate: true,
  dueDate: true,
  priority: true,
  milestoneId: true,
  dependencyIds: true,
}).extend({
  description: taskSchema.shape.description.optional(),
  milestoneId: taskSchema.shape.milestoneId.optional(),
  parentId: taskSchema.shape.parentId.optional(),
  dependencyIds: taskSchema.shape.dependencyIds.optional(),
})

const updateTaskInputSchema = taskSchema.pick({
  title: true,
  description: true,
  assigneeId: true,
  startDate: true,
  dueDate: true,
  priority: true,
  status: true,
  progress: true,
  milestoneId: true,
  parentId: true,
  dependencyIds: true,
}).partial().extend({
  version: persistedTaskSchema.shape.version,
})

const taskSelect = `
  SELECT
    id,
    code,
    project_id,
    title,
    description,
    assignee_id,
    start_date,
    due_date,
    priority,
    status,
    progress,
    milestone_id,
    parent_id,
    dependency_ids_json,
    created_at,
    updated_at,
    version
  FROM tasks
`

function taskNotFound(id: string): DomainError {
  return new DomainError(
    'TASK_NOT_FOUND',
    'Task does not exist',
    { taskId: id },
  )
}

function assertDateOrder(startDate: string, dueDate: string): void {
  if (startDate > dueDate) {
    throw new DomainError(
      'TASK_DATE_RANGE_INVALID',
      'Task start date must not be after its due date',
      { startDate, dueDate },
    )
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function sameTask(left: PersistedTask, right: PersistedTask): boolean {
  return left.title === right.title
    && left.description === right.description
    && left.assigneeId === right.assigneeId
    && left.startDate === right.startDate
    && left.dueDate === right.dueDate
    && left.priority === right.priority
    && left.status === right.status
    && left.progress === right.progress
    && left.milestoneId === right.milestoneId
    && left.parentId === right.parentId
    && sameIds(left.dependencyIds, right.dependencyIds)
}

export class TaskService {
  constructor(private readonly database: DatabaseSync) {}

  create(
    input: CreateTaskInput,
    actorId: string,
    source: ActivitySource,
  ): PersistedTask {
    const validatedSource = activitySourceSchema.parse(source)
    const validated = createTaskInputSchema.parse({
      ...input,
      description: input.description === undefined
        ? ''
        : input.description,
      milestoneId: input.milestoneId === undefined
        ? ''
        : input.milestoneId,
      dependencyIds: input.dependencyIds === undefined
        ? []
        : input.dependencyIds,
    })
    assertDateOrder(validated.startDate, validated.dueDate)

    return withImmediateTransaction(this.database, () => {
      const actor = this.assertActiveActor(actorId)
      assertPermission(actor.role, 'task.write')
      this.assertProject(validated.projectId)
      this.assertActiveActor(validated.assigneeId)
      this.assertTaskReferences(
        validated.projectId,
        validated.parentId,
        validated.dependencyIds ?? [],
      )
      const code = this.nextCode(validated.projectId)
      const id = `task_${randomUUID()}`
      const timestamp = new Date().toISOString()

      this.database.prepare(`
        INSERT INTO tasks (
          id, code, project_id, title, description, assignee_id,
          start_date, due_date, priority, status, progress, milestone_id,
          parent_id, dependency_ids_json, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', 0, ?, ?, ?, ?, ?, 1)
      `).run(
        id,
        code,
        validated.projectId,
        validated.title,
        validated.description ?? '',
        validated.assigneeId,
        validated.startDate,
        validated.dueDate,
        validated.priority,
        validated.milestoneId ?? '',
        validated.parentId ?? null,
        JSON.stringify(validated.dependencyIds ?? []),
        timestamp,
        timestamp,
      )
      recordActivity(this.database, {
        actorId,
        projectId: validated.projectId,
        source: validatedSource,
        operation: 'task.create',
        entityType: 'task',
        entityId: id,
        action: `Created task ${validated.title}`,
        createdAt: timestamp,
      })
      return this.get(id)
    })
  }

  get(id: string): PersistedTask {
    const row = this.database.prepare(`
      ${taskSelect}
      WHERE id = ?
    `).get(id) as unknown as TaskRow | undefined
    if (row === undefined) {
      throw taskNotFound(id)
    }
    return this.mapTask(row)
  }

  list(filter: TaskListFilter = {}): PersistedTask[] {
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
      values.push(taskStatusSchema.parse(filter.status))
    }
    if (filter.after !== undefined) {
      if (
        filter.after.projectId.length === 0
        || filter.after.code.length === 0
        || filter.after.id.length === 0
      ) {
        throw new DomainError(
          'INPUT_INVALID',
          'Task list keyset is invalid',
        )
      }
      clauses.push(`
        (
          project_id > ?
          OR (
            project_id = ?
            AND (
              code > ?
              OR (code = ? AND id > ?)
            )
          )
        )
      `)
      values.push(
        filter.after.projectId,
        filter.after.projectId,
        filter.after.code,
        filter.after.code,
        filter.after.id,
      )
    }
    if (
      filter.limit !== undefined
      && (!Number.isInteger(filter.limit) || filter.limit < 1)
    ) {
      throw new DomainError('INPUT_INVALID', 'Task list limit is invalid')
    }
    const where = clauses.length === 0
      ? ''
      : `WHERE ${clauses.join(' AND ')}`
    const limit = filter.limit === undefined ? '' : 'LIMIT ?'
    if (filter.limit !== undefined) {
      values.push(filter.limit)
    }
    const rows = this.database.prepare(`
      ${taskSelect}
      ${where}
      ORDER BY project_id, code, id
      ${limit}
    `).all(...values) as unknown as TaskRow[]
    return rows.map((row) => this.mapTask(row))
  }

  update(
    id: string,
    input: UpdateTaskInput,
    actorId: string,
    source: ActivitySource,
  ): PersistedTask {
    const validatedSource = activitySourceSchema.parse(source)
    const validated = updateTaskInputSchema.parse(input)

    return withImmediateTransaction(this.database, () => {
      const actor = this.assertActiveActor(actorId)
      const suppliedKeys = Object.entries(input)
        .filter(([key, value]) => key !== 'version' && value !== undefined)
        .map(([key]) => key)
      const descriptionOnly = suppliedKeys.length > 0
        && suppliedKeys.every((key) => key === 'description')
      if (!canPerform(actor.role, 'task.write')) {
        assertPermission(
          actor.role,
          descriptionOnly ? 'description.write' : 'task.write',
        )
      }
      const current = this.get(id)
      this.assertVersion(id, validated.version, current.version)
      const candidate = persistedTaskSchema.parse({
        ...current,
        ...validated,
        version: current.version,
        updatedAt: current.updatedAt,
      })
      assertDateOrder(candidate.startDate, candidate.dueDate)
      this.assertActiveActor(candidate.assigneeId)
      this.assertTaskReferences(
        current.projectId,
        candidate.parentId,
        candidate.dependencyIds,
        id,
      )
      if (sameTask(candidate, current)) {
        return current
      }

      const timestamp = new Date().toISOString()
      this.database.prepare(`
        UPDATE tasks
        SET title = ?, description = ?, assignee_id = ?, start_date = ?,
          due_date = ?, priority = ?, status = ?, progress = ?,
          milestone_id = ?, parent_id = ?, dependency_ids_json = ?,
          updated_at = ?, version = version + 1
        WHERE id = ? AND version = ?
      `).run(
        candidate.title,
        candidate.description,
        candidate.assigneeId,
        candidate.startDate,
        candidate.dueDate,
        candidate.priority,
        candidate.status,
        candidate.progress,
        candidate.milestoneId,
        candidate.parentId ?? null,
        JSON.stringify(candidate.dependencyIds),
        timestamp,
        id,
        validated.version,
      )
      recordActivity(this.database, {
        actorId,
        projectId: current.projectId,
        source: validatedSource,
        operation: 'task.update',
        entityType: 'task',
        entityId: id,
        action: `Updated task ${candidate.title}`,
        createdAt: timestamp,
      })
      return this.get(id)
    })
  }

  submitProgress(
    id: string,
    input: PersistedTaskProgressInput,
    actorId: string,
    source: ActivitySource,
  ): PersistedTask {
    const validatedSource = activitySourceSchema.parse(source)
    const validated = persistedTaskProgressInputSchema.parse(input)

    return withImmediateTransaction(this.database, () => {
      const actor = this.assertActiveActor(actorId)
      assertPermission(actor.role, 'task.progress')
      const current = this.get(id)
      if (actor.role === 'dev-agent' && current.assigneeId !== actorId) {
        throw new DomainError(
          'PERMISSION_DENIED',
          'Developer agents may update only assigned tasks',
          { actorId, taskId: id },
        )
      }
      this.assertVersion(id, validated.version, current.version)
      if (
        current.progress === validated.progress
        && current.status === validated.status
      ) {
        return current
      }

      const timestamp = new Date().toISOString()
      this.database.prepare(`
        UPDATE tasks
        SET progress = ?, status = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND version = ?
      `).run(
        validated.progress,
        validated.status,
        timestamp,
        id,
        current.version,
      )
      recordActivity(this.database, {
        actorId,
        projectId: current.projectId,
        source: validatedSource,
        operation: 'task.progress',
        entityType: 'task',
        entityId: id,
        action: `Updated progress for task ${current.title}`,
        note: validated.note,
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
    const row = this.database.prepare(`
      SELECT id FROM projects WHERE id = ?
    `).get(projectId)
    if (row === undefined) {
      throw new DomainError(
        'PROJECT_NOT_FOUND',
        'Project does not exist',
        { projectId },
      )
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

  private assertTaskReferences(
    projectId: string,
    parentId: string | undefined,
    dependencyIds: readonly string[],
    selfId?: string,
  ): void {
    const ids = [
      ...(parentId === undefined ? [] : [parentId]),
      ...dependencyIds,
    ]
    for (const referenceId of new Set(ids)) {
      if (referenceId === selfId) {
        throw new DomainError(
          'TASK_REFERENCE_INVALID',
          'Task cannot reference itself',
          { taskId: selfId },
        )
      }
      const row = this.database.prepare(`
        SELECT project_id FROM tasks WHERE id = ?
      `).get(referenceId) as { project_id: string } | undefined
      if (row === undefined) {
        throw taskNotFound(referenceId)
      }
      if (row.project_id !== projectId) {
        throw new DomainError(
          'TASK_PROJECT_MISMATCH',
          'Referenced task belongs to another project',
          { taskId: referenceId, projectId },
        )
      }
    }
  }

  private assertVersion(
    id: string,
    expected: number,
    current: number,
  ): void {
    if (expected !== current) {
      throw new DomainError(
        'TASK_VERSION_CONFLICT',
        'Task version is stale',
        { taskId: id, expectedVersion: expected, currentVersion: current },
      )
    }
  }

  private mapTask(row: TaskRow): PersistedTask {
    const actorRow = this.database.prepare(`
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
        version
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
    return persistedTaskSchema.parse({
      id: row.id,
      code: row.code,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      assignee,
      assigneeId: row.assignee_id,
      startDate: row.start_date,
      dueDate: row.due_date,
      priority: row.priority,
      status: row.status,
      progress: row.progress,
      milestoneId: row.milestone_id,
      ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
      dependencyIds: JSON.parse(row.dependency_ids_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    })
  }
}
