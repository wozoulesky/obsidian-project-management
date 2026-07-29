import type { DatabaseSync } from 'node:sqlite'
import type {
  ActorRole,
  DefectStatus,
  Priority,
  RequirementStatus,
  Severity,
  TaskStatus,
} from '@project-os/contracts'
import { withImmediateTransaction } from './activity-service.js'
import {
  replacePrimaryData,
  validateExportDocument,
} from './export-service.js'
import type { ExportDocument } from './export-service.js'
import { DomainError } from './errors.js'

const seedTimestamp = '2026-07-29T00:00:00.000Z'
const defaultProjectId = 'project_default'

export type LegacyFixtureActor = {
  id: string
  name: string
  kind: 'human' | 'agent'
  role?: ActorRole
  client?: string
}

export type LegacyFixtureTask = {
  id: string
  code: string
  title: string
  description: string
  assignee: LegacyFixtureActor
  startDate: string
  dueDate: string
  priority: Priority
  status: TaskStatus
  progress: number
  milestoneId: string
  parentId?: string
  dependencyIds: string[]
}

export type LegacyFixtureRequirement = {
  id: string
  code: string
  title: string
  description?: string
  priority: Priority
  status: RequirementStatus
  linkedTaskIds: string[]
  completedTaskCount: number
  acceptanceCriteria: string[]
}

export type LegacyFixtureDefect = {
  id: string
  code: string
  title: string
  description?: string
  severity: Severity
  status: DefectStatus
  assignee: LegacyFixtureActor
  updatedAt: string
  reproductionSteps: string[]
  linkedTaskId?: string
  linkedRequirementId?: string
}

export type LegacyFixtureSeed = {
  actors: Record<string, LegacyFixtureActor>
  tasks: LegacyFixtureTask[]
  requirements: LegacyFixtureRequirement[]
  defects: LegacyFixtureDefect[]
}

function canonicalTimestamp(value: string): string {
  return new Date(value).toISOString()
}

export function createLegacyFixtureSeedDocument(
  seed: LegacyFixtureSeed,
): ExportDocument {
  const legacyActors = Object.values(seed.actors)
  if (legacyActors.length === 0) {
    throw new TypeError('A legacy seed needs at least one actor')
  }
  const ownerId = legacyActors.find((actor) => actor.kind === 'human')?.id
    ?? legacyActors[0]!.id
  const actors = legacyActors.map((actor) => {
    const role = actor.kind === 'human'
      ? actor.id === ownerId ? 'owner' as const : 'member' as const
      : actor.role === 'pm-agent'
        || actor.role === 'dev-agent'
        || actor.role === 'qa-agent'
        || actor.role === 'doc-agent'
        ? actor.role
        : 'dev-agent' as const
    return {
      id: actor.id,
      name: actor.name,
      kind: actor.kind,
      role,
      status: 'active' as const,
      client: actor.kind === 'agent' ? actor.client ?? 'fixture' : null,
      capabilities: [],
      registeredAt: seedTimestamp,
      lastActiveAt: null,
      version: 1,
    }
  })
  const actorById = new Map(actors.map((actor) => [actor.id, actor]))
  const taskStatusById = new Map(
    seed.tasks.map((task) => [task.id, task.status]),
  )

  return validateExportDocument({
    schemaVersion: 1,
    exportedAt: seedTimestamp,
    actors,
    projects: [{
      id: defaultProjectId,
      code: 'DEFAULT',
      name: 'Default Project',
      description: 'Imported from the legacy Project OS fixture',
      ownerId,
      startDate: null,
      dueDate: null,
      status: 'in_progress',
      progress: 0,
      createdAt: seedTimestamp,
      updatedAt: seedTimestamp,
      version: 1,
    }],
    projectMembers: actors.map((actor) => ({
      projectId: defaultProjectId,
      actorId: actor.id,
      membershipRole: actor.id === ownerId ? 'owner' : 'member',
      joinedAt: seedTimestamp,
    })),
    tasks: seed.tasks.map((task) => ({
      id: task.id,
      code: task.code,
      projectId: defaultProjectId,
      title: task.title,
      description: task.description,
      assigneeId: task.assignee.id,
      assignee: actorById.get(task.assignee.id),
      startDate: task.startDate,
      dueDate: task.dueDate,
      priority: task.priority,
      status: task.status,
      progress: task.progress,
      milestoneId: task.milestoneId,
      ...(task.parentId === undefined ? {} : { parentId: task.parentId }),
      dependencyIds: task.dependencyIds,
      createdAt: seedTimestamp,
      updatedAt: seedTimestamp,
      version: 1,
    })),
    requirements: seed.requirements.map((requirement) => ({
      id: requirement.id,
      code: requirement.code,
      projectId: defaultProjectId,
      title: requirement.title,
      description: requirement.description ?? '',
      priority: requirement.priority,
      status: requirement.status,
      linkedTaskIds: requirement.linkedTaskIds,
      completedTaskCount: requirement.linkedTaskIds.filter(
        (taskId) => taskStatusById.get(taskId) === 'done',
      ).length,
      acceptanceCriteria: requirement.acceptanceCriteria,
      createdAt: seedTimestamp,
      updatedAt: seedTimestamp,
      version: 1,
    })),
    defects: seed.defects.map((defect) => ({
      id: defect.id,
      code: defect.code,
      projectId: defaultProjectId,
      title: defect.title,
      description: defect.description ?? '',
      severity: defect.severity,
      status: defect.status,
      assigneeId: defect.assignee.id,
      assignee: actorById.get(defect.assignee.id),
      reproductionSteps: defect.reproductionSteps,
      ...(defect.linkedTaskId === undefined
        ? {}
        : { linkedTaskId: defect.linkedTaskId }),
      ...(defect.linkedRequirementId === undefined
        ? {}
        : { linkedRequirementId: defect.linkedRequirementId }),
      createdAt: canonicalTimestamp(defect.updatedAt),
      updatedAt: canonicalTimestamp(defect.updatedAt),
      version: 1,
    })),
    settings: {
      theme: 'system',
      background: 'soft',
      accent: 'blue',
      density: 'comfortable',
      updatedAt: seedTimestamp,
      version: 1,
    },
  })
}

export function seedDatabase(
  database: DatabaseSync,
  input: unknown,
): boolean {
  let document: ExportDocument
  try {
    document = validateExportDocument(input)
  } catch (error) {
    if (
      typeof input !== 'object'
      || input === null
      || Array.isArray(input)
      || !('actors' in input)
      || !('tasks' in input)
      || !('requirements' in input)
      || !('defects' in input)
      || 'schemaVersion' in input
    ) {
      throw error
    }
    try {
      document = createLegacyFixtureSeedDocument(input as LegacyFixtureSeed)
    } catch {
      throw error
    }
  }

  try {
    return withImmediateTransaction(database, () => {
      const counts = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM actors)
        + (SELECT COUNT(*) FROM projects)
        + (SELECT COUNT(*) FROM project_members)
        + (SELECT COUNT(*) FROM tasks)
        + (SELECT COUNT(*) FROM requirements)
        + (SELECT COUNT(*) FROM requirement_tasks)
        + (SELECT COUNT(*) FROM defects) AS count
    `).get() as { count: number }

      if (counts.count !== 0) {
        return false
      }

      replacePrimaryData(database, document)
      return true
    })
  } catch {
    throw new DomainError('IMPORT_INVALID', 'Import document is invalid')
  }
}
