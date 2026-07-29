import type { DatabaseSync } from 'node:sqlite'
import {
  activitySourceSchema,
  persistedActorSchema,
  persistedAppSettingsSchema,
  persistedDefectSchema,
  persistedProjectMemberSchema,
  persistedProjectSchema,
  persistedRequirementSchema,
  persistedTaskSchema,
} from '@project-os/contracts'
import type {
  ActivitySource,
  PersistedActor,
  PersistedAppSettings,
  PersistedDefect,
  PersistedProject,
  PersistedProjectMember,
  PersistedRequirement,
  PersistedTask,
} from '@project-os/contracts'
import {
  recordActivity,
  withImmediateTransaction,
} from './activity-service.js'
import { DomainError } from './errors.js'
import { SettingsService } from './settings-service.js'

const exportSchemaVersion = 1 as const

export type ExportDocument = {
  schemaVersion: typeof exportSchemaVersion
  exportedAt: string
  actors: PersistedActor[]
  projects: PersistedProject[]
  projectMembers: PersistedProjectMember[]
  tasks: PersistedTask[]
  requirements: PersistedRequirement[]
  defects: PersistedDefect[]
  settings: PersistedAppSettings
}

const documentKeys = [
  'schemaVersion',
  'exportedAt',
  'actors',
  'projects',
  'projectMembers',
  'tasks',
  'requirements',
  'defects',
  'settings',
] as const

const actorKeys = [
  'id', 'name', 'kind', 'role', 'status', 'client', 'capabilities',
  'registeredAt', 'lastActiveAt', 'version',
] as const
const projectKeys = [
  'id', 'code', 'name', 'description', 'ownerId', 'startDate', 'dueDate',
  'status', 'progress', 'createdAt', 'updatedAt', 'version',
] as const
const memberKeys = [
  'projectId', 'actorId', 'membershipRole', 'joinedAt',
] as const
const taskKeys = [
  'id', 'code', 'title', 'description', 'assignee', 'startDate', 'dueDate',
  'priority', 'status', 'progress', 'milestoneId', 'parentId',
  'dependencyIds', 'projectId', 'assigneeId', 'createdAt', 'updatedAt',
  'version',
] as const
const requirementKeys = [
  'id', 'code', 'title', 'priority', 'status', 'linkedTaskIds',
  'completedTaskCount', 'acceptanceCriteria', 'projectId', 'description',
  'createdAt', 'updatedAt', 'version',
] as const
const defectKeys = [
  'id', 'code', 'title', 'severity', 'status', 'assignee', 'updatedAt',
  'reproductionSteps', 'linkedTaskId', 'linkedRequirementId', 'projectId',
  'assigneeId', 'description', 'createdAt', 'version',
] as const
const settingsKeys = [
  'theme', 'background', 'accent', 'density', 'updatedAt', 'version',
] as const

function importInvalid(): DomainError {
  return new DomainError('IMPORT_INVALID', 'Import document is invalid')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyKeys(
  value: unknown,
  allowed: readonly string[],
): value is Record<string, unknown> {
  return isPlainObject(value)
    && Object.keys(value).every((key) => allowed.includes(key))
}

function parseRows<T>(
  value: unknown,
  allowed: readonly string[],
  parse: (row: unknown) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw importInvalid()
  }
  return value.map((row) => {
    if (!hasOnlyKeys(row, allowed)) {
      throw importInvalid()
    }
    try {
      return parse(row)
    } catch {
      throw importInvalid()
    }
  })
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw importInvalid()
  }
}

function sameActor(left: PersistedActor, right: unknown): boolean {
  try {
    return JSON.stringify(left)
      === JSON.stringify(persistedActorSchema.parse(right))
  } catch {
    return false
  }
}

export function validateExportDocument(input: unknown): ExportDocument {
  if (
    !hasOnlyKeys(input, documentKeys)
    || Object.keys(input).length !== documentKeys.length
    || input.schemaVersion !== exportSchemaVersion
  ) {
    throw importInvalid()
  }

  const actors = parseRows(input.actors, actorKeys, (row) =>
    persistedActorSchema.parse(row))
  const projects = parseRows(input.projects, projectKeys, (row) =>
    persistedProjectSchema.parse(row))
  const projectMembers = parseRows(input.projectMembers, memberKeys, (row) =>
    persistedProjectMemberSchema.parse(row))
  const tasks = parseRows(input.tasks, taskKeys, (row) => {
    if (
      !hasOnlyKeys(row, taskKeys)
      || !hasOnlyKeys(row.assignee, actorKeys)
    ) {
      throw importInvalid()
    }
    const parsed = persistedTaskSchema.parse(row)
    persistedActorSchema.parse(parsed.assignee)
    return parsed
  })
  const requirements = parseRows(
    input.requirements,
    requirementKeys,
    (row) => persistedRequirementSchema.parse(row),
  )
  const defects = parseRows(input.defects, defectKeys, (row) => {
    if (
      !hasOnlyKeys(row, defectKeys)
      || !hasOnlyKeys(row.assignee, actorKeys)
    ) {
      throw importInvalid()
    }
    const parsed = persistedDefectSchema.parse(row)
    persistedActorSchema.parse(parsed.assignee)
    return parsed
  })
  let settings: PersistedAppSettings
  try {
    if (!hasOnlyKeys(input.settings, settingsKeys)) {
      throw importInvalid()
    }
    settings = persistedAppSettingsSchema.parse(input.settings)
    persistedAppSettingsSchema.shape.updatedAt.parse(input.exportedAt)
  } catch {
    throw importInvalid()
  }

  assertUnique(actors.map(({ id }) => id))
  assertUnique(
    actors
      .filter((actor) => actor.kind === 'agent')
      .map((actor) => `${actor.client ?? ''}\0${actor.name}`),
  )
  assertUnique(projects.map(({ id }) => id))
  assertUnique(projects.map(({ code }) => code))
  assertUnique(projectMembers.map(({ projectId, actorId }) =>
    `${projectId}\0${actorId}`))
  assertUnique(tasks.map(({ id }) => id))
  assertUnique(tasks.map(({ projectId, code }) => `${projectId}\0${code}`))
  assertUnique(requirements.map(({ id }) => id))
  assertUnique(requirements.map(({ projectId, code }) =>
    `${projectId}\0${code}`))
  assertUnique(defects.map(({ id }) => id))
  assertUnique(defects.map(({ projectId, code }) => `${projectId}\0${code}`))

  const actorById = new Map(actors.map((actor) => [actor.id, actor]))
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const memberKeysSet = new Set(projectMembers.map(({ projectId, actorId }) =>
    `${projectId}\0${actorId}`))
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const requirementById = new Map(
    requirements.map((requirement) => [requirement.id, requirement]),
  )

  for (const actor of actors) {
    if (
      (actor.kind === 'human' && actor.client !== null)
      || (
        actor.kind === 'agent'
        && (typeof actor.client !== 'string' || actor.client.length === 0)
      )
    ) {
      throw importInvalid()
    }
  }
  for (const project of projects) {
    const ownerMembership = projectMembers.find((member) =>
      member.projectId === project.id && member.actorId === project.ownerId)
    if (
      !actorById.has(project.ownerId)
      || ownerMembership?.membershipRole !== 'owner'
      || (
        project.startDate !== null
        && project.dueDate !== null
        && project.startDate > project.dueDate
      )
    ) {
      throw importInvalid()
    }
  }
  for (const member of projectMembers) {
    if (
      !projectById.has(member.projectId)
      || !actorById.has(member.actorId)
    ) {
      throw importInvalid()
    }
  }
  for (const task of tasks) {
    const actor = actorById.get(task.assigneeId)
    if (
      actor === undefined
      || !sameActor(actor, task.assignee)
      || !projectById.has(task.projectId)
      || !memberKeysSet.has(`${task.projectId}\0${task.assigneeId}`)
      || task.startDate > task.dueDate
    ) {
      throw importInvalid()
    }
    const references = [
      ...(task.parentId === undefined ? [] : [task.parentId]),
      ...task.dependencyIds,
    ]
    if (new Set(task.dependencyIds).size !== task.dependencyIds.length) {
      throw importInvalid()
    }
    for (const referenceId of references) {
      const reference = taskById.get(referenceId)
      if (
        reference === undefined
        || reference.projectId !== task.projectId
        || reference.id === task.id
      ) {
        throw importInvalid()
      }
    }
  }
  for (const requirement of requirements) {
    if (
      !projectById.has(requirement.projectId)
      || new Set(requirement.linkedTaskIds).size
        !== requirement.linkedTaskIds.length
    ) {
      throw importInvalid()
    }
    let completed = 0
    for (const taskId of requirement.linkedTaskIds) {
      const task = taskById.get(taskId)
      if (task === undefined || task.projectId !== requirement.projectId) {
        throw importInvalid()
      }
      if (task.status === 'done') {
        completed += 1
      }
    }
    if (completed !== requirement.completedTaskCount) {
      throw importInvalid()
    }
  }
  for (const defect of defects) {
    const actor = actorById.get(defect.assigneeId)
    if (
      actor === undefined
      || !sameActor(actor, defect.assignee)
      || !projectById.has(defect.projectId)
      || !memberKeysSet.has(`${defect.projectId}\0${defect.assigneeId}`)
    ) {
      throw importInvalid()
    }
    if (defect.linkedTaskId !== undefined) {
      const task = taskById.get(defect.linkedTaskId)
      if (task === undefined || task.projectId !== defect.projectId) {
        throw importInvalid()
      }
    }
    if (defect.linkedRequirementId !== undefined) {
      const requirement = requirementById.get(defect.linkedRequirementId)
      if (
        requirement === undefined
        || requirement.projectId !== defect.projectId
      ) {
        throw importInvalid()
      }
    }
  }

  return {
    schemaVersion: exportSchemaVersion,
    exportedAt: input.exportedAt as string,
    actors,
    projects,
    projectMembers,
    tasks,
    requirements,
    defects,
    settings,
  }
}

function actorRows(database: DatabaseSync): PersistedActor[] {
  const rows = database.prepare(`
    SELECT
      id, name, kind, role, status, client, capabilities_json,
      registered_at, last_active_at, version
    FROM actors
    ORDER BY id
  `).all() as Record<string, unknown>[]
  return rows.map((row) => persistedActorSchema.parse({
    id: row.id,
    name: row.name,
    kind: row.kind,
    role: row.role,
    status: row.status,
    client: row.client,
    capabilities: JSON.parse(row.capabilities_json as string),
    registeredAt: row.registered_at,
    lastActiveAt: row.last_active_at,
    version: row.version,
  }))
}

function projectRows(database: DatabaseSync): PersistedProject[] {
  return (database.prepare(`
    SELECT *
    FROM projects
    ORDER BY id
  `).all() as Record<string, unknown>[]).map((row) =>
    persistedProjectSchema.parse({
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
    }))
}

function memberRows(database: DatabaseSync): PersistedProjectMember[] {
  return (database.prepare(`
    SELECT *
    FROM project_members
    ORDER BY project_id, actor_id
  `).all() as Record<string, unknown>[]).map((row) =>
    persistedProjectMemberSchema.parse({
      projectId: row.project_id,
      actorId: row.actor_id,
      membershipRole: row.membership_role,
      joinedAt: row.joined_at,
    }))
}

function taskRows(
  database: DatabaseSync,
  actorById: ReadonlyMap<string, PersistedActor>,
): PersistedTask[] {
  return (database.prepare(`
    SELECT *
    FROM tasks
    ORDER BY id
  `).all() as Record<string, unknown>[]).map((row) =>
    persistedTaskSchema.parse({
      id: row.id,
      code: row.code,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      assigneeId: row.assignee_id,
      assignee: actorById.get(row.assignee_id as string),
      startDate: row.start_date,
      dueDate: row.due_date,
      priority: row.priority,
      status: row.status,
      progress: row.progress,
      milestoneId: row.milestone_id,
      ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
      dependencyIds: JSON.parse(row.dependency_ids_json as string),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    }))
}

function requirementRows(database: DatabaseSync): PersistedRequirement[] {
  const links = database.prepare(`
    SELECT requirement_id, task_id
    FROM requirement_tasks
    ORDER BY requirement_id, task_id
  `).all() as { requirement_id: string; task_id: string }[]
  const linkedByRequirement = new Map<string, string[]>()
  for (const link of links) {
    const values = linkedByRequirement.get(link.requirement_id) ?? []
    values.push(link.task_id)
    linkedByRequirement.set(link.requirement_id, values)
  }
  const completed = database.prepare(`
    SELECT requirement_tasks.requirement_id, COUNT(*) AS count
    FROM requirement_tasks
    JOIN tasks ON tasks.id = requirement_tasks.task_id
    WHERE tasks.status = 'done'
    GROUP BY requirement_tasks.requirement_id
  `).all() as { requirement_id: string; count: number }[]
  const completedByRequirement = new Map(completed.map((row) =>
    [row.requirement_id, row.count]))

  return (database.prepare(`
    SELECT *
    FROM requirements
    ORDER BY id
  `).all() as Record<string, unknown>[]).map((row) =>
    persistedRequirementSchema.parse({
      id: row.id,
      code: row.code,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      priority: row.priority,
      status: row.status,
      acceptanceCriteria: JSON.parse(row.acceptance_criteria_json as string),
      linkedTaskIds: linkedByRequirement.get(row.id as string) ?? [],
      completedTaskCount: completedByRequirement.get(row.id as string) ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    }))
}

function defectRows(
  database: DatabaseSync,
  actorById: ReadonlyMap<string, PersistedActor>,
): PersistedDefect[] {
  return (database.prepare(`
    SELECT *
    FROM defects
    ORDER BY id
  `).all() as Record<string, unknown>[]).map((row) =>
    persistedDefectSchema.parse({
      id: row.id,
      code: row.code,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      assigneeId: row.assignee_id,
      assignee: actorById.get(row.assignee_id as string),
      reproductionSteps: JSON.parse(row.reproduction_steps_json as string),
      ...(row.linked_requirement_id === null
        ? {}
        : { linkedRequirementId: row.linked_requirement_id }),
      ...(row.linked_task_id === null
        ? {}
        : { linkedTaskId: row.linked_task_id }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    }))
}

export function replacePrimaryData(
  database: DatabaseSync,
  document: ExportDocument,
): void {
  database.prepare(
    'DROP TABLE IF EXISTS temp.project_os_import_actor_ids',
  ).run()
  database.prepare(`
    CREATE TEMP TABLE project_os_import_actor_ids (
      id TEXT PRIMARY KEY
    ) STRICT
  `).run()
  const importedActorIdInsert = database.prepare(`
    INSERT INTO project_os_import_actor_ids (id)
    VALUES (?)
  `)
  for (const actor of document.actors) {
    importedActorIdInsert.run(actor.id)
  }

  database.prepare('DELETE FROM defects').run()
  database.prepare('DELETE FROM requirement_tasks').run()
  database.prepare('DELETE FROM requirements').run()
  database.prepare('DELETE FROM tasks').run()
  database.prepare('DELETE FROM project_members').run()
  database.prepare(`
    DELETE FROM projects
    WHERE id NOT IN (
      SELECT project_id FROM activities WHERE project_id IS NOT NULL
    )
  `).run()
  database.prepare(`
    DELETE FROM actors
    WHERE id NOT IN (SELECT id FROM project_os_import_actor_ids)
      AND id NOT IN (SELECT actor_id FROM activities)
      AND id NOT IN (SELECT owner_id FROM projects)
  `).run()
  database.prepare(`
    UPDATE actors
    SET client = '__project_os_import__' || id
    WHERE kind = 'agent'
  `).run()
  database.prepare(`
    UPDATE projects
    SET code = '__project_os_import__' || id
    WHERE id IN (
      SELECT project_id FROM activities WHERE project_id IS NOT NULL
    )
  `).run()

  const actorInsert = database.prepare(`
    INSERT INTO actors (
      id, name, kind, role, status, client, capabilities_json,
      registered_at, last_active_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      role = excluded.role,
      status = excluded.status,
      client = excluded.client,
      capabilities_json = excluded.capabilities_json,
      registered_at = excluded.registered_at,
      last_active_at = excluded.last_active_at,
      version = excluded.version
  `)
  for (const actor of document.actors) {
    actorInsert.run(
      actor.id,
      actor.name,
      actor.kind,
      actor.role,
      actor.status,
      actor.client ?? null,
      JSON.stringify(actor.capabilities),
      actor.registeredAt,
      actor.lastActiveAt,
      actor.version,
    )
  }

  const projectInsert = database.prepare(`
    INSERT INTO projects (
      id, code, name, description, owner_id, start_date, due_date,
      status, progress, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      code = excluded.code,
      name = excluded.name,
      description = excluded.description,
      owner_id = excluded.owner_id,
      start_date = excluded.start_date,
      due_date = excluded.due_date,
      status = excluded.status,
      progress = excluded.progress,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      version = excluded.version
  `)
  for (const project of document.projects) {
    projectInsert.run(
      project.id,
      project.code,
      project.name,
      project.description,
      project.ownerId,
      project.startDate,
      project.dueDate,
      project.status,
      project.progress,
      project.createdAt,
      project.updatedAt,
      project.version,
    )
  }
  database.prepare(`
    DELETE FROM actors
    WHERE id NOT IN (SELECT id FROM project_os_import_actor_ids)
  `).run()
  database.prepare(
    'DROP TABLE temp.project_os_import_actor_ids',
  ).run()

  const memberInsert = database.prepare(`
    INSERT INTO project_members (
      project_id, actor_id, membership_role, joined_at
    ) VALUES (?, ?, ?, ?)
  `)
  for (const member of document.projectMembers) {
    memberInsert.run(
      member.projectId,
      member.actorId,
      member.membershipRole,
      member.joinedAt,
    )
  }

  const taskInsert = database.prepare(`
    INSERT INTO tasks (
      id, code, project_id, title, description, assignee_id,
      start_date, due_date, priority, status, progress, milestone_id,
      parent_id, dependency_ids_json, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `)
  for (const task of document.tasks) {
    taskInsert.run(
      task.id,
      task.code,
      task.projectId,
      task.title,
      task.description,
      task.assigneeId,
      task.startDate,
      task.dueDate,
      task.priority,
      task.status,
      task.progress,
      task.milestoneId,
      JSON.stringify(task.dependencyIds),
      task.createdAt,
      task.updatedAt,
      task.version,
    )
  }
  const parentUpdate = database.prepare(
    'UPDATE tasks SET parent_id = ? WHERE id = ?',
  )
  for (const task of document.tasks) {
    if (task.parentId !== undefined) {
      parentUpdate.run(task.parentId, task.id)
    }
  }

  const requirementInsert = database.prepare(`
    INSERT INTO requirements (
      id, code, project_id, title, description, priority, status,
      acceptance_criteria_json, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const requirementLinkInsert = database.prepare(`
    INSERT INTO requirement_tasks (requirement_id, task_id)
    VALUES (?, ?)
  `)
  for (const requirement of document.requirements) {
    requirementInsert.run(
      requirement.id,
      requirement.code,
      requirement.projectId,
      requirement.title,
      requirement.description ?? '',
      requirement.priority,
      requirement.status,
      JSON.stringify(requirement.acceptanceCriteria),
      requirement.createdAt,
      requirement.updatedAt,
      requirement.version,
    )
    for (const taskId of requirement.linkedTaskIds) {
      requirementLinkInsert.run(requirement.id, taskId)
    }
  }

  const defectInsert = database.prepare(`
    INSERT INTO defects (
      id, code, project_id, title, description, severity, status,
      assignee_id, reproduction_steps_json, linked_requirement_id,
      linked_task_id, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const defect of document.defects) {
    defectInsert.run(
      defect.id,
      defect.code,
      defect.projectId,
      defect.title,
      defect.description ?? '',
      defect.severity,
      defect.status,
      defect.assigneeId,
      JSON.stringify(defect.reproductionSteps),
      defect.linkedRequirementId ?? null,
      defect.linkedTaskId ?? null,
      defect.createdAt,
      defect.updatedAt,
      defect.version,
    )
  }

  database.prepare(`
    INSERT INTO settings (key, value_json, updated_at, version)
    VALUES ('app', ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at,
      version = excluded.version
  `).run(
    JSON.stringify({
      theme: document.settings.theme,
      background: document.settings.background,
      accent: document.settings.accent,
      density: document.settings.density,
    }),
    document.settings.updatedAt,
    document.settings.version,
  )
}

export class ExportService {
  constructor(private readonly database: DatabaseSync) {}

  exportJson(): ExportDocument {
    const actors = actorRows(this.database)
    const actorById = new Map(actors.map((actor) => [actor.id, actor]))
    return {
      schemaVersion: exportSchemaVersion,
      exportedAt: new Date().toISOString(),
      actors,
      projects: projectRows(this.database),
      projectMembers: memberRows(this.database),
      tasks: taskRows(this.database, actorById),
      requirements: requirementRows(this.database),
      defects: defectRows(this.database, actorById),
      settings: new SettingsService(this.database).get(),
    }
  }

  importJson(
    input: unknown,
    actorId?: string,
    source: ActivitySource = 'web',
  ): void {
    const document = validateExportDocument(input)
    let validatedSource: ActivitySource
    try {
      validatedSource = activitySourceSchema.parse(source)
    } catch {
      throw importInvalid()
    }

    try {
      const actorIds = new Set(document.actors.map(({ id }) => id))
      const projectIds = new Set(document.projects.map(({ id }) => id))
      if (actorId !== undefined && !actorIds.has(actorId)) {
        throw importInvalid()
      }
      const anchors = this.database.prepare(`
        SELECT DISTINCT actor_id, project_id
        FROM activities
      `).all() as {
        actor_id: string
        project_id: string | null
      }[]
      if (anchors.some((anchor) =>
        !actorIds.has(anchor.actor_id)
        || (
          anchor.project_id !== null
          && !projectIds.has(anchor.project_id)
        ))) {
        throw importInvalid()
      }
    } catch {
      throw importInvalid()
    }

    try {
      withImmediateTransaction(this.database, () => {
        replacePrimaryData(this.database, document)
        if (actorId !== undefined) {
          recordActivity(this.database, {
            actorId,
            source: validatedSource,
            operation: 'import.run',
            entityType: 'import',
            entityId: `schema-${document.schemaVersion}`,
            action: 'Imported Project OS data',
            details: {
              schemaVersion: document.schemaVersion,
              projects: document.projects.length,
            },
          })
        }
      })
    } catch {
      throw importInvalid()
    }
  }
}
