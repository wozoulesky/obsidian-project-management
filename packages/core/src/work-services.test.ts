import { spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { dashboardSnapshotSchema, persistedTaskSchema } from '@project-os/contracts'
import {
  ActivityService,
  recordActivity,
} from './activity-service.js'
import { ActorService } from './actor-service.js'
import { createTestDatabase, openDatabase } from './database.js'
import { DefectService } from './defect-service.js'
import { DashboardService } from './dashboard-service.js'
import { canPerform } from './permissions.js'
import { ProjectService } from './project-service.js'
import { RequirementService } from './requirement-service.js'
import { TaskService } from './task-service.js'

function setup() {
  const database = createTestDatabase()
  const actors = new ActorService(database)
  const projects = new ProjectService(database)
  const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
  const member = actors.createHuman(
    { name: 'Ming', role: 'member' },
    owner.id,
    'web',
  )
  const pm = actors.registerAgent(
    { name: 'planner', role: 'pm-agent', client: 'codex' },
    owner.id,
    'mcp',
  )
  const dev = actors.registerAgent(
    { name: 'builder', role: 'dev-agent', client: 'codex' },
    owner.id,
    'mcp',
  )
  const otherDev = actors.registerAgent(
    { name: 'builder-2', role: 'dev-agent', client: 'codex' },
    owner.id,
    'mcp',
  )
  const qa = actors.registerAgent(
    { name: 'tester', role: 'qa-agent', client: 'codex' },
    owner.id,
    'mcp',
  )
  const doc = actors.registerAgent(
    { name: 'writer', role: 'doc-agent', client: 'codex' },
    owner.id,
    'mcp',
  )
  const project = projects.create(
    {
      name: 'Atlas',
      ownerId: owner.id,
      description: '',
      startDate: '2026-07-01',
      dueDate: '2026-09-30',
    },
    owner.id,
    'web',
  )
  const otherProject = projects.create(
    { name: 'Borealis', ownerId: owner.id, description: '' },
    owner.id,
    'web',
  )
  return {
    database,
    actors,
    projects,
    owner,
    member,
    pm,
    dev,
    otherDev,
    qa,
    doc,
    project,
    otherProject,
    tasks: new TaskService(database),
    requirements: new RequirementService(database),
    defects: new DefectService(database),
    dashboard: new DashboardService(database),
    activities: new ActivityService(database),
  }
}

function taskInput(
  projectId: string,
  assigneeId: string,
  title = 'Build API',
) {
  return {
    projectId,
    title,
    description: 'Implement the endpoint',
    assigneeId,
    startDate: '2026-07-01',
    dueDate: '2026-07-31',
    priority: 'P1' as const,
    milestoneId: '',
    dependencyIds: [],
  }
}

describe('work service permissions', () => {
  const operations = [
    'project.read',
    'project.write',
    'project.delete',
    'task.read',
    'task.write',
    'task.progress',
    'requirement.read',
    'requirement.write',
    'defect.read',
    'defect.write',
    'defect.verify',
    'report.read',
    'report.write',
    'activity.read',
    'activity.note',
    'description.write',
  ] as const

  it('defines the complete role by operation matrix', () => {
    const expected = {
      owner: operations,
      member: operations,
      'pm-agent': [
        'project.read', 'project.write', 'task.read', 'task.write',
        'task.progress', 'requirement.read', 'requirement.write',
        'defect.read', 'report.read', 'report.write', 'activity.read',
      ],
      'dev-agent': [
        'project.read', 'task.read', 'task.progress', 'requirement.read',
        'defect.read', 'defect.write', 'report.read', 'activity.read',
      ],
      'qa-agent': [
        'project.read', 'task.read', 'requirement.read', 'defect.read',
        'defect.write', 'defect.verify', 'report.read', 'activity.read',
      ],
      'doc-agent': [
        'project.read', 'task.read', 'requirement.read', 'defect.read',
        'report.read', 'activity.read', 'activity.note',
        'description.write',
      ],
    } as const

    for (const [role, allowed] of Object.entries(expected)) {
      for (const operation of operations) {
        expect(
          canPerform(role as keyof typeof expected, operation),
          `${role} ${operation}`,
        ).toBe((allowed as readonly string[]).includes(operation))
      }
    }
  })
})

describe('TaskService', () => {
  it.each([
    ['description', { description: null }],
    ['milestoneId', { milestoneId: null }],
    ['dependencyIds', { dependencyIds: null }],
    ['parentId', { parentId: null }],
  ])('rejects null task create %s before applying defaults', (_name, patch) => {
    const context = setup()
    const activityCount = context.activities.list().length

    expect(() => context.tasks.create(
      {
        ...taskInput(context.project.id, context.dev.id),
        ...patch,
      } as never,
      context.pm.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ name: 'ZodError' }))
    expect(context.tasks.list({ projectId: context.project.id })).toEqual([])
    expect(context.activities.list()).toHaveLength(activityCount)
  })

  it('creates, gets, lists, and updates valid project tasks', () => {
    const context = setup()
    const first = context.tasks.create(
      taskInput(context.project.id, context.dev.id),
      context.pm.id,
      'mcp',
    )
    const second = context.tasks.create(
      taskInput(context.project.id, context.dev.id, 'Write tests'),
      context.pm.id,
      'mcp',
    )

    expect(first.code).toBe('TASK-0001')
    expect(second.code).toBe('TASK-0002')
    expect(context.tasks.get(first.id)).toEqual(first)
    expect(context.tasks.list({ projectId: context.project.id }))
      .toEqual([first, second])

    const updated = context.tasks.update(
      first.id,
      {
        title: 'Build stable API',
        dependencyIds: [second.id],
        version: first.version,
      },
      context.pm.id,
      'mcp',
    )
    expect(updated).toMatchObject({
      title: 'Build stable API',
      dependencyIds: [second.id],
      version: 2,
    })
    expect(persistedTaskSchema.parse(updated)).toEqual(updated)
  })

  it('validates runtime input, active assignees, date order, and same-project references', () => {
    const context = setup()
    const otherTask = context.tasks.create(
      taskInput(context.otherProject.id, context.dev.id),
      context.pm.id,
      'mcp',
    )
    context.actors.deactivate(context.otherDev.id, context.owner.id, 'web')

    expect(() => context.tasks.create(
      { ...taskInput(context.project.id, context.dev.id), title: null } as never,
      context.pm.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ name: 'ZodError' }))
    expect(() => context.tasks.create(
      {
        ...taskInput(context.project.id, context.dev.id),
        startDate: '2026-08-01',
        dueDate: '2026-07-01',
      },
      context.pm.id,
      'mcp',
    )).toThrowError(expect.objectContaining({
      code: 'TASK_DATE_RANGE_INVALID',
    }))
    expect(() => context.tasks.create(
      taskInput('project_missing', context.dev.id),
      context.pm.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }))
    expect(() => context.tasks.create(
      taskInput(context.project.id, context.otherDev.id),
      context.pm.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'ACTOR_INACTIVE' }))
    expect(() => context.tasks.create(
      {
        ...taskInput(context.project.id, context.dev.id),
        parentId: otherTask.id,
      },
      context.pm.id,
      'mcp',
    )).toThrowError(expect.objectContaining({
      code: 'TASK_PROJECT_MISMATCH',
    }))
  })

  it('updates progress and activity atomically with stable stale-version errors', () => {
    const context = setup()
    const task = context.tasks.create(
      taskInput(context.project.id, context.dev.id),
      context.pm.id,
      'mcp',
    )
    const progressed = context.tasks.submitProgress(
      task.id,
      {
        progress: 50,
        status: 'in_progress',
        note: 'API is half complete',
        version: task.version,
      },
      context.dev.id,
      'mcp',
    )

    expect(progressed).toMatchObject({
      progress: 50,
      status: 'in_progress',
      version: 2,
    })
    expect(context.activities.list({ entityId: task.id }).find(
      (activity) => activity.operation === 'task.progress',
    )).toMatchObject({
      actorId: context.dev.id,
      source: 'mcp',
      operation: 'task.progress',
      note: 'API is half complete',
    })
    expect(() => context.tasks.submitProgress(
      task.id,
      {
        progress: 75,
        status: 'in_progress',
        note: 'stale',
        version: task.version,
      },
      context.dev.id,
      'mcp',
    )).toThrowError(expect.objectContaining({
      code: 'TASK_VERSION_CONFLICT',
    }))
  })

  it.each([
    ['missing', {}],
    ['null', { version: null }],
    ['zero', { version: 0 }],
  ])(
    'rejects %s progress version before no-op or persistence',
    (_name, versionPatch) => {
      const context = setup()
      const task = context.tasks.create(
        taskInput(context.project.id, context.dev.id),
        context.pm.id,
        'mcp',
      )
      const activityCount = context.activities.list({
        entityId: task.id,
      }).length

      expect(() => context.tasks.submitProgress(
        task.id,
        {
          progress: task.progress,
          status: task.status,
          note: 'must not be accepted',
          ...versionPatch,
        } as never,
        context.dev.id,
        'mcp',
      )).toThrowError(expect.objectContaining({ name: 'ZodError' }))
      expect(context.tasks.get(task.id)).toEqual(task)
      expect(context.activities.list({ entityId: task.id }))
        .toHaveLength(activityCount)
    },
  )

  it('enforces active actors and assigned-only dev progress and defect work', () => {
    const context = setup()
    const task = context.tasks.create(
      taskInput(context.project.id, context.dev.id),
      context.pm.id,
      'mcp',
    )

    expect(() => context.tasks.submitProgress(
      task.id,
      {
        progress: 10,
        status: 'in_progress',
        note: 'unauthorized',
        version: task.version,
      },
      context.otherDev.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
    context.actors.deactivate(context.dev.id, context.owner.id, 'web')
    expect(() => context.tasks.submitProgress(
      task.id,
      {
        progress: 10,
        status: 'in_progress',
        note: 'inactive',
        version: task.version,
      },
      context.dev.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'ACTOR_INACTIVE' }))
  })

  it('does not version, timestamp, or record semantic no-op updates', () => {
    const context = setup()
    const task = context.tasks.create(
      taskInput(context.project.id, context.dev.id),
      context.pm.id,
      'mcp',
    )
    const count = context.activities.list({ entityId: task.id }).length
    const result = context.tasks.update(
      task.id,
      {
        title: task.title,
        dependencyIds: [...task.dependencyIds],
        version: task.version,
      },
      context.pm.id,
      'mcp',
    )

    expect(result).toEqual(task)
    expect(context.activities.list({ entityId: task.id })).toHaveLength(count)
  })

  it('composes task domain-write and description-only permissions', () => {
    const context = setup()
    const task = context.tasks.create(
      taskInput(context.project.id, context.dev.id),
      context.pm.id,
      'mcp',
    )

    const byPm = context.tasks.update(
      task.id,
      { description: 'PM edit', version: task.version },
      context.pm.id,
      'mcp',
    )
    const byDoc = context.tasks.update(
      task.id,
      { description: 'Doc edit', version: byPm.version },
      context.doc.id,
      'mcp',
    )
    expect(byDoc.description).toBe('Doc edit')

    expect(() => context.tasks.update(
      task.id,
      {
        description: 'Smuggled edit',
        title: byDoc.title,
        version: byDoc.version,
      },
      context.doc.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
    expect(() => context.tasks.update(
      task.id,
      {
        description: 'Unauthorized',
        title: byDoc.title,
        version: byDoc.version,
      },
      context.qa.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
    expect(context.tasks.get(task.id)).toEqual(byDoc)
  })

  it.each([
    ['description', { description: null }],
    ['milestoneId', { milestoneId: null }],
    ['dependencyIds', { dependencyIds: null }],
    ['parentId', { parentId: null }],
    ['status', { status: null }],
  ])('rejects null task update %s before no-op detection', (_name, patch) => {
    const context = setup()
    const task = context.tasks.create(
      taskInput(context.project.id, context.dev.id),
      context.pm.id,
      'mcp',
    )
    const activityCount = context.activities.list({
      entityId: task.id,
    }).length

    expect(() => context.tasks.update(
      task.id,
      { ...patch, version: task.version } as never,
      context.pm.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ name: 'ZodError' }))
    expect(context.tasks.get(task.id)).toEqual(task)
    expect(context.activities.list({ entityId: task.id }))
      .toHaveLength(activityCount)
  })

  it('rolls back task changes when activity insertion fails', () => {
    const context = setup()
    const task = context.tasks.create(
      taskInput(context.project.id, context.dev.id),
      context.pm.id,
      'mcp',
    )
    context.database.exec(`
      CREATE TRIGGER fail_work_activity
      BEFORE INSERT ON activities
      WHEN NEW.operation = 'task.progress'
      BEGIN
        SELECT RAISE(ABORT, 'forced work activity failure');
      END;
    `)

    expect(() => context.tasks.submitProgress(
      task.id,
      {
        progress: 50,
        status: 'in_progress',
        note: 'must roll back',
        version: task.version,
      },
      context.dev.id,
      'mcp',
    )).toThrow(/forced work activity failure/)
    expect(context.tasks.get(task.id)).toEqual(task)
  })
})

describe('RequirementService', () => {
  it.each([
    ['description', { description: null }],
    ['status', { status: null }],
    ['acceptanceCriteria', { acceptanceCriteria: null }],
    ['linkedTaskIds', { linkedTaskIds: null }],
  ])(
    'rejects null requirement create %s before applying defaults',
    (_name, patch) => {
      const context = setup()
      const activityCount = context.activities.list().length

      expect(() => context.requirements.create(
        {
          projectId: context.project.id,
          title: 'Invalid',
          priority: 'P1',
          ...patch,
        } as never,
        context.pm.id,
        'mcp',
      )).toThrowError(expect.objectContaining({ name: 'ZodError' }))
      expect(context.requirements.list({
        projectId: context.project.id,
      })).toEqual([])
      expect(context.activities.list()).toHaveLength(activityCount)
    },
  )

  it('manages same-project task links and dynamically aggregates completion', () => {
    const context = setup()
    const first = context.tasks.create(
      taskInput(context.project.id, context.dev.id),
      context.pm.id,
      'mcp',
    )
    const second = context.tasks.create(
      taskInput(context.project.id, context.dev.id, 'Test API'),
      context.pm.id,
      'mcp',
    )
    const requirement = context.requirements.create(
      {
        projectId: context.project.id,
        title: 'API delivery',
        description: '',
        priority: 'P1',
        acceptanceCriteria: ['API passes tests'],
        linkedTaskIds: [first.id, second.id],
      },
      context.pm.id,
      'mcp',
    )
    expect(requirement).toMatchObject({
      code: 'REQ-0001',
      linkedTaskIds: [first.id, second.id],
      completedTaskCount: 0,
    })

    context.tasks.submitProgress(
      first.id,
      {
        progress: 100,
        status: 'done',
        note: 'done',
        version: first.version,
      },
      context.dev.id,
      'mcp',
    )
    expect(context.requirements.get(requirement.id).completedTaskCount).toBe(1)
    expect(context.requirements.list({ projectId: context.project.id }))
      .toHaveLength(1)
  })

  it('rejects cross-project links and treats identical links as a no-op', () => {
    const context = setup()
    const task = context.tasks.create(
      taskInput(context.project.id, context.dev.id),
      context.pm.id,
      'mcp',
    )
    const otherTask = context.tasks.create(
      taskInput(context.otherProject.id, context.dev.id),
      context.pm.id,
      'mcp',
    )
    expect(() => context.requirements.create(
      {
        projectId: context.project.id,
        title: 'Invalid',
        priority: 'P2',
        acceptanceCriteria: [],
        linkedTaskIds: [otherTask.id],
      },
      context.pm.id,
      'mcp',
    )).toThrowError(expect.objectContaining({
      code: 'TASK_PROJECT_MISMATCH',
    }))

    const requirement = context.requirements.create(
      {
        projectId: context.project.id,
        title: 'Valid',
        priority: 'P2',
        acceptanceCriteria: [],
        linkedTaskIds: [task.id],
      },
      context.pm.id,
      'mcp',
    )
    const activityCount = context.activities.list({
      entityId: requirement.id,
    }).length
    expect(context.requirements.update(
      requirement.id,
      {
        linkedTaskIds: [task.id],
        version: requirement.version,
      },
      context.pm.id,
      'mcp',
    )).toEqual(requirement)
    expect(context.activities.list({ entityId: requirement.id }))
      .toHaveLength(activityCount)
  })

  it('treats reordered and duplicate linked task IDs as one canonical set', () => {
    const context = setup()
    const first = context.tasks.create(
      taskInput(context.project.id, context.dev.id, 'First'),
      context.pm.id,
      'mcp',
    )
    const second = context.tasks.create(
      taskInput(context.project.id, context.dev.id, 'Second'),
      context.pm.id,
      'mcp',
    )
    const requirement = context.requirements.create(
      {
        projectId: context.project.id,
        title: 'Canonical links',
        priority: 'P1',
        linkedTaskIds: [second.id, first.id, second.id],
      },
      context.pm.id,
      'mcp',
    )
    expect(requirement.linkedTaskIds).toEqual([first.id, second.id])
    const activityCount = context.activities.list({
      entityId: requirement.id,
    }).length

    const result = context.requirements.update(
      requirement.id,
      {
        linkedTaskIds: [second.id, first.id, first.id],
        version: requirement.version,
      },
      context.pm.id,
      'mcp',
    )

    expect(result).toEqual(requirement)
    expect(context.requirements.get(requirement.id)).toEqual(requirement)
    expect(context.activities.list({ entityId: requirement.id }))
      .toHaveLength(activityCount)
  })

  it('composes requirement domain-write and description-only permissions', () => {
    const context = setup()
    const requirement = context.requirements.create(
      {
        projectId: context.project.id,
        title: 'Editable',
        priority: 'P1',
      },
      context.pm.id,
      'mcp',
    )

    const byPm = context.requirements.update(
      requirement.id,
      { description: 'PM edit', version: requirement.version },
      context.pm.id,
      'mcp',
    )
    const byDoc = context.requirements.update(
      requirement.id,
      { description: 'Doc edit', version: byPm.version },
      context.doc.id,
      'mcp',
    )
    expect(byDoc.description).toBe('Doc edit')

    expect(() => context.requirements.update(
      requirement.id,
      {
        description: 'Smuggled edit',
        priority: byDoc.priority,
        version: byDoc.version,
      },
      context.doc.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
    expect(context.requirements.get(requirement.id)).toEqual(byDoc)
  })

  it.each([
    ['description', { description: null }],
    ['status', { status: null }],
    ['acceptanceCriteria', { acceptanceCriteria: null }],
    ['linkedTaskIds', { linkedTaskIds: null }],
  ])(
    'rejects null requirement update %s before no-op detection',
    (_name, patch) => {
      const context = setup()
      const requirement = context.requirements.create(
        {
          projectId: context.project.id,
          title: 'Valid',
          priority: 'P1',
        },
        context.pm.id,
        'mcp',
      )
      const activityCount = context.activities.list({
        entityId: requirement.id,
      }).length

      expect(() => context.requirements.update(
        requirement.id,
        { ...patch, version: requirement.version } as never,
        context.pm.id,
        'mcp',
      )).toThrowError(expect.objectContaining({ name: 'ZodError' }))
      expect(context.requirements.get(requirement.id)).toEqual(requirement)
      expect(context.activities.list({ entityId: requirement.id }))
        .toHaveLength(activityCount)
    },
  )
})

describe('DefectService', () => {
  it.each([
    ['description', { description: null }],
    ['status', { status: null }],
    ['reproductionSteps', { reproductionSteps: null }],
    ['linkedRequirementId', { linkedRequirementId: null }],
    ['linkedTaskId', { linkedTaskId: null }],
  ])('rejects null defect create %s before defaults', (_name, patch) => {
    const context = setup()
    const activityCount = context.activities.list().length

    expect(() => context.defects.create(
      {
        projectId: context.project.id,
        title: 'Invalid',
        severity: 'normal',
        assigneeId: context.dev.id,
        ...patch,
      } as never,
      context.qa.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ name: 'ZodError' }))
    expect(context.defects.list({ projectId: context.project.id })).toEqual([])
    expect(context.activities.list()).toHaveLength(activityCount)
  })

  it('creates linked defects and atomically converts one defect to one task', () => {
    const context = setup()
    const requirement = context.requirements.create(
      {
        projectId: context.project.id,
        title: 'Delivery',
        priority: 'P0',
        acceptanceCriteria: [],
        linkedTaskIds: [],
      },
      context.pm.id,
      'mcp',
    )
    const defect = context.defects.create(
      {
        projectId: context.project.id,
        title: 'Crash on save',
        description: 'The app exits',
        severity: 'fatal',
        assigneeId: context.dev.id,
        reproductionSteps: ['Open editor', 'Save'],
        linkedRequirementId: requirement.id,
      },
      context.qa.id,
      'mcp',
    )
    expect(defect.code).toBe('BUG-0001')

    const first = context.defects.toTask(
      defect.id,
      {
        startDate: '2026-07-02',
        dueDate: '2026-07-10',
        priority: 'P0',
        version: defect.version,
      },
      context.owner.id,
      'web',
    )
    const second = context.defects.toTask(
      defect.id,
      {
        startDate: '2026-07-02',
        dueDate: '2026-07-10',
        priority: 'P0',
        version: defect.version,
      },
      context.owner.id,
      'web',
    )

    expect(second).toEqual(first)
    expect(context.defects.get(defect.id).linkedTaskId).toBe(first.id)
    expect(context.tasks.list({ projectId: context.project.id }))
      .toEqual([first])
    expect(context.activities.list({ entityId: defect.id }).filter(
      (activity) => activity.operation === 'defect.to_task',
    )).toHaveLength(1)
  })

  it('validates linked entities and assigned-only dev updates', () => {
    const context = setup()
    const otherTask = context.tasks.create(
      taskInput(context.otherProject.id, context.dev.id),
      context.pm.id,
      'mcp',
    )
    expect(() => context.defects.create(
      {
        projectId: context.project.id,
        title: 'Bad link',
        severity: 'normal',
        assigneeId: context.dev.id,
        reproductionSteps: [],
        linkedTaskId: otherTask.id,
      },
      context.qa.id,
      'mcp',
    )).toThrowError(expect.objectContaining({
      code: 'TASK_PROJECT_MISMATCH',
    }))

    const defect = context.defects.create(
      {
        projectId: context.project.id,
        title: 'Assigned issue',
        severity: 'normal',
        assigneeId: context.dev.id,
        reproductionSteps: [],
      },
      context.qa.id,
      'mcp',
    )
    expect(() => context.defects.update(
      defect.id,
      { status: 'fixing', version: defect.version },
      context.otherDev.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
    expect(context.defects.update(
      defect.id,
      { status: 'fixing', version: defect.version },
      context.dev.id,
      'mcp',
    ).status).toBe('fixing')
  })

  it('requires dev agents to create and retain only their own assignments', () => {
    const context = setup()

    expect(() => context.defects.create(
      {
        projectId: context.project.id,
        title: 'Wrong assignee',
        severity: 'normal',
        assigneeId: context.otherDev.id,
      },
      context.dev.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))

    const defect = context.defects.create(
      {
        projectId: context.project.id,
        title: 'Own assignment',
        severity: 'normal',
        assigneeId: context.dev.id,
      },
      context.dev.id,
      'mcp',
    )
    expect(() => context.defects.update(
      defect.id,
      {
        assigneeId: context.otherDev.id,
        version: defect.version,
      },
      context.dev.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
    expect(context.defects.get(defect.id)).toEqual(defect)
  })

  it('composes defect domain-write and description-only permissions', () => {
    const context = setup()
    const defect = context.defects.create(
      {
        projectId: context.project.id,
        title: 'Editable',
        severity: 'normal',
        assigneeId: context.dev.id,
      },
      context.qa.id,
      'mcp',
    )

    const byQa = context.defects.update(
      defect.id,
      { description: 'QA edit', version: defect.version },
      context.qa.id,
      'mcp',
    )
    const byDev = context.defects.update(
      defect.id,
      { description: 'Dev edit', version: byQa.version },
      context.dev.id,
      'mcp',
    )
    const byDoc = context.defects.update(
      defect.id,
      { description: 'Doc edit', version: byDev.version },
      context.doc.id,
      'mcp',
    )
    expect(byDoc.description).toBe('Doc edit')

    expect(() => context.defects.update(
      defect.id,
      {
        description: 'Smuggled edit',
        status: byDoc.status,
        version: byDoc.version,
      },
      context.doc.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
    expect(() => context.defects.update(
      defect.id,
      {
        description: 'Unauthorized',
        status: byDoc.status,
        version: byDoc.version,
      },
      context.pm.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
    expect(context.defects.get(defect.id)).toEqual(byDoc)
  })

  it.each([
    'verifying',
    'closed',
    'rejected',
    'not_a_defect',
  ] as const)(
    'denies assigned dev transition from open to %s',
    (status) => {
      const context = setup()
      const defect = context.defects.create(
        {
          projectId: context.project.id,
          title: 'Verification guarded',
          severity: 'normal',
          assigneeId: context.dev.id,
        },
        context.qa.id,
        'mcp',
      )
      const activityCount = context.activities.list({
        entityId: defect.id,
      }).length

      expect(() => context.defects.update(
        defect.id,
        { status, version: defect.version },
        context.dev.id,
        'mcp',
      )).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
      expect(context.defects.get(defect.id)).toEqual(defect)
      expect(context.activities.list({ entityId: defect.id }))
        .toHaveLength(activityCount)
    },
  )

  it('denies assigned dev exit from verifying but allows development state work', () => {
    const context = setup()
    const defect = context.defects.create(
      {
        projectId: context.project.id,
        title: 'Verification guarded',
        severity: 'normal',
        assigneeId: context.dev.id,
      },
      context.qa.id,
      'mcp',
    )
    const fixing = context.defects.update(
      defect.id,
      { status: 'fixing', version: defect.version },
      context.dev.id,
      'mcp',
    )
    expect(fixing.status).toBe('fixing')
    const verifying = context.defects.update(
      defect.id,
      { status: 'verifying', version: fixing.version },
      context.qa.id,
      'mcp',
    )

    expect(() => context.defects.update(
      defect.id,
      { status: 'fixing', version: verifying.version },
      context.dev.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
    expect(context.defects.get(defect.id)).toEqual(verifying)
  })

  it('allows QA and human actors to perform verification transitions', () => {
    const context = setup()
    const defect = context.defects.create(
      {
        projectId: context.project.id,
        title: 'Verification permitted',
        severity: 'normal',
        assigneeId: context.dev.id,
      },
      context.qa.id,
      'mcp',
    )
    const verifying = context.defects.update(
      defect.id,
      { status: 'verifying', version: defect.version },
      context.qa.id,
      'mcp',
    )
    const closed = context.defects.update(
      defect.id,
      { status: 'closed', version: verifying.version },
      context.owner.id,
      'web',
    )
    const reopened = context.defects.update(
      defect.id,
      { status: 'fixing', version: closed.version },
      context.member.id,
      'web',
    )

    expect(reopened.status).toBe('fixing')
  })

  it.each([
    ['description', { description: null }],
    ['status', { status: null }],
    ['reproductionSteps', { reproductionSteps: null }],
    ['linkedRequirementId', { linkedRequirementId: null }],
    ['linkedTaskId', { linkedTaskId: null }],
  ])('rejects null defect update %s before no-op', (_name, patch) => {
    const context = setup()
    const defect = context.defects.create(
      {
        projectId: context.project.id,
        title: 'Valid',
        severity: 'normal',
        assigneeId: context.dev.id,
      },
      context.qa.id,
      'mcp',
    )
    const activityCount = context.activities.list({
      entityId: defect.id,
    }).length

    expect(() => context.defects.update(
      defect.id,
      { ...patch, version: defect.version } as never,
      context.qa.id,
      'mcp',
    )).toThrowError(expect.objectContaining({ name: 'ZodError' }))
    expect(context.defects.get(defect.id)).toEqual(defect)
    expect(context.activities.list({ entityId: defect.id }))
      .toHaveLength(activityCount)
  })
})

describe('DashboardService', () => {
  it('returns a contract-valid snapshot with complete status keys', () => {
    const context = setup()
    const overdue = context.tasks.create(
      {
        ...taskInput(context.project.id, context.dev.id, 'Late work'),
        dueDate: '2026-07-28',
      },
      context.pm.id,
      'mcp',
    )
    const dueToday = context.tasks.create(
      {
        ...taskInput(context.project.id, context.dev.id, 'Due today'),
        dueDate: '2026-07-29',
      },
      context.pm.id,
      'mcp',
    )
    context.tasks.submitProgress(
      dueToday.id,
      {
        progress: 100,
        status: 'done',
        note: 'complete',
        version: dueToday.version,
      },
      context.dev.id,
      'mcp',
    )
    context.requirements.create(
      {
        projectId: context.project.id,
        title: 'Delivered requirement',
        priority: 'P1',
        status: 'delivered',
        acceptanceCriteria: [],
        linkedTaskIds: [dueToday.id],
      },
      context.pm.id,
      'mcp',
    )
    context.defects.create(
      {
        projectId: context.project.id,
        title: 'Serious issue',
        severity: 'serious',
        assigneeId: context.dev.id,
        reproductionSteps: [],
      },
      context.qa.id,
      'mcp',
    )

    const snapshot = context.dashboard.snapshot({
      projectId: context.project.id,
      today: '2026-07-29',
    })
    expect(dashboardSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(snapshot.metrics).toMatchObject({
      totalTasks: 2,
      completedTasks: 1,
      deliveredRequirements: 1,
      totalRequirements: 1,
      activeDefects: 1,
      seriousDefects: 1,
    })
    expect(snapshot.taskStatusCounts).toEqual({
      not_started: 0,
      in_progress: 0,
      done: 1,
      overdue: 1,
    })
    expect(snapshot.risks[0]).toMatchObject({
      entityId: overdue.id,
      level: 'critical',
    })
  })

  it('uses a strict overdue boundary without silently persisting overdue', () => {
    const context = setup()
    const late = context.tasks.create(
      {
        ...taskInput(context.project.id, context.dev.id, 'Yesterday'),
        dueDate: '2026-07-28',
      },
      context.pm.id,
      'mcp',
    )
    context.tasks.create(
      {
        ...taskInput(context.project.id, context.dev.id, 'Today'),
        dueDate: '2026-07-29',
      },
      context.pm.id,
      'mcp',
    )

    expect(context.dashboard.listOverdue({
      projectId: context.project.id,
      today: '2026-07-29',
    })).toEqual([{ ...late, status: 'overdue' }])
    expect(context.tasks.get(late.id).status).toBe('not_started')
  })

  it('filters project activities before applying the dashboard limit', () => {
    const context = setup()
    const target = context.tasks.create(
      taskInput(context.project.id, context.dev.id),
      context.pm.id,
      'mcp',
    )
    for (let index = 0; index < 205; index += 1) {
      recordActivity(context.database, {
        actorId: context.owner.id,
        projectId: context.otherProject.id,
        source: 'web',
        operation: 'project.update',
        entityType: 'project',
        entityId: context.otherProject.id,
        action: `Unrelated activity ${index}`,
        createdAt: new Date(
          Date.UTC(2026, 6, 30, 0, 0, index),
        ).toISOString(),
      })
    }

    const snapshot = context.dashboard.snapshot({
      projectId: context.project.id,
      today: '2026-07-30',
      activityLimit: 5,
    })

    expect(snapshot.activities.length).toBeGreaterThan(0)
    expect(snapshot.activities.every(
      (activity) => activity.projectId === context.project.id,
    )).toBe(true)
    expect(snapshot.activities.some(
      (activity) => activity.entityId === target.id,
    )).toBe(true)
  })

  it('builds date-sorted cumulative planned and actual task trends', () => {
    const context = setup()
    const completed = context.tasks.create(
      {
        ...taskInput(context.project.id, context.dev.id, 'Completed'),
        startDate: '2026-07-27',
        dueDate: '2026-07-28',
      },
      context.pm.id,
      'mcp',
    )
    context.tasks.create(
      {
        ...taskInput(context.project.id, context.dev.id, 'Planned today'),
        startDate: '2026-07-28',
        dueDate: '2026-07-29',
      },
      context.pm.id,
      'mcp',
    )
    context.tasks.create(
      {
        ...taskInput(context.otherProject.id, context.dev.id, 'Other project'),
        startDate: '2026-07-01',
        dueDate: '2026-07-02',
      },
      context.pm.id,
      'mcp',
    )
    context.tasks.submitProgress(
      completed.id,
      {
        progress: 100,
        status: 'done',
        note: 'done today',
        version: completed.version,
      },
      context.dev.id,
      'mcp',
    )

    const snapshot = context.dashboard.snapshot({
      projectId: context.project.id,
      today: '2026-07-29',
    })

    expect(snapshot.trend.length).toBeGreaterThan(0)
    expect(snapshot.trend.map((point) => point.date)).toEqual(
      [...snapshot.trend.map((point) => point.date)].sort(),
    )
    expect(snapshot.trend.at(-1)).toEqual({
      date: '2026-07-29',
      planned: 2,
      actual: 1,
    })
    expect(snapshot.trend.every(
      (point) => point.planned <= 2 && point.actual <= 1,
    )).toBe(true)
  })
})

const concurrencyPath = process.env.PROJECT_OS_WORK_DATABASE
const concurrencyMode = process.env.PROJECT_OS_WORK_MODE
const concurrencyEnabled = concurrencyPath !== undefined
  && concurrencyMode !== undefined
const concurrencyDatabase = concurrencyEnabled
  ? openDatabase(concurrencyPath)
  : undefined
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4))

function waitForConcurrencyClients(): void {
  const barrier = process.env.PROJECT_OS_WORK_BARRIER
  if (barrier === undefined) {
    throw new Error('Work concurrency barrier is required')
  }
  writeFileSync(join(barrier, `${process.pid}.ready`), '')
  const deadline = Date.now() + 10_000
  while (
    readdirSync(barrier).filter((file) => file.endsWith('.ready')).length < 2
  ) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for work concurrency client')
    }
    Atomics.wait(sleepBuffer, 0, 0, 20)
  }
}

afterAll(() => {
  concurrencyDatabase?.close()
})

const concurrencyClientDescribe = concurrencyEnabled
  ? describe
  : describe.skip

concurrencyClientDescribe('work service concurrency client', () => {
  it('performs one work mutation against the shared database', () => {
    expect(concurrencyDatabase).toBeDefined()
    if (concurrencyDatabase === undefined) {
      return
    }
    waitForConcurrencyClients()
    const actorId = process.env.PROJECT_OS_WORK_ACTOR
    expect(actorId).toBeDefined()
    if (actorId === undefined) {
      return
    }

    if (concurrencyMode === 'task') {
      const projectId = process.env.PROJECT_OS_WORK_PROJECT
      const assigneeId = process.env.PROJECT_OS_WORK_ASSIGNEE
      expect(projectId).toBeDefined()
      expect(assigneeId).toBeDefined()
      if (projectId === undefined || assigneeId === undefined) {
        return
      }
      const task = new TaskService(concurrencyDatabase).create(
        taskInput(projectId, assigneeId, `Concurrent ${process.pid}`),
        actorId,
        'mcp',
      )
      expect(task.code).toMatch(/^TASK-\d{4}$/)
      return
    }

    if (concurrencyMode === 'defect') {
      const defectId = process.env.PROJECT_OS_WORK_DEFECT
      const version = Number(process.env.PROJECT_OS_WORK_VERSION)
      expect(defectId).toBeDefined()
      if (defectId === undefined) {
        return
      }
      const task = new DefectService(concurrencyDatabase).toTask(
        defectId,
        {
          startDate: '2026-07-02',
          dueDate: '2026-07-10',
          version,
        },
        actorId,
        'web',
      )
      expect(task.id).toMatch(/^task_/)
      return
    }

    throw new Error(`Unknown work concurrency mode: ${concurrencyMode}`)
  })
})

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const vitestEntry = join(
  repositoryRoot,
  'node_modules',
  'vitest',
  'vitest.mjs',
)
const workConcurrencyClient = join(
  repositoryRoot,
  'packages',
  'core',
  'src',
  'work-services.test.ts',
)

function runWorkConcurrencyClient(
  environment: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [vitestEntry, 'run', workConcurrencyClient],
      {
        cwd: repositoryRoot,
        env: { ...process.env, ...environment },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(
          `Work concurrency client exited ${code}\n${stdout}\n${stderr}`,
        ))
      }
    })
  })
}

const parentConcurrencyDescribe = concurrencyEnabled
  ? describe.skip
  : describe

parentConcurrencyDescribe('work service file concurrency', () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    temporaryDirectories.splice(0).forEach((directory) => {
      rmSync(directory, { recursive: true, force: true })
    })
  })

  function createDatabasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'project-os-work-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'project-os.db')
    const database = openDatabase(path)
    database.close()
    return path
  }

  it('allocates consecutive project task codes across processes', async () => {
    const path = createDatabasePath()
    const setupDatabase = openDatabase(path)
    const actors = new ActorService(setupDatabase)
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const pm = actors.registerAgent(
      { name: 'planner', role: 'pm-agent', client: 'codex' },
      owner.id,
      'mcp',
    )
    const dev = actors.registerAgent(
      { name: 'builder', role: 'dev-agent', client: 'codex' },
      owner.id,
      'mcp',
    )
    const project = new ProjectService(setupDatabase).create(
      { name: 'Concurrent', ownerId: owner.id, description: '' },
      owner.id,
      'web',
    )
    setupDatabase.close()
    const barrier = `${path}.task-barrier`
    mkdirSync(barrier)
    const environment = {
      PROJECT_OS_WORK_ACTOR: pm.id,
      PROJECT_OS_WORK_ASSIGNEE: dev.id,
      PROJECT_OS_WORK_BARRIER: barrier,
      PROJECT_OS_WORK_DATABASE: path,
      PROJECT_OS_WORK_MODE: 'task',
      PROJECT_OS_WORK_PROJECT: project.id,
    }

    await Promise.all([
      runWorkConcurrencyClient(environment),
      runWorkConcurrencyClient(environment),
    ])

    const database = openDatabase(path)
    try {
      expect(database.prepare(`
        SELECT code FROM tasks ORDER BY code
      `).all()).toEqual([
        { code: 'TASK-0001' },
        { code: 'TASK-0002' },
      ])
    } finally {
      database.close()
    }
  }, 20_000)

  it('converts one defect to one task across processes', async () => {
    const path = createDatabasePath()
    const setupDatabase = openDatabase(path)
    const actors = new ActorService(setupDatabase)
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const qa = actors.registerAgent(
      { name: 'tester', role: 'qa-agent', client: 'codex' },
      owner.id,
      'mcp',
    )
    const dev = actors.registerAgent(
      { name: 'builder', role: 'dev-agent', client: 'codex' },
      owner.id,
      'mcp',
    )
    const project = new ProjectService(setupDatabase).create(
      { name: 'Concurrent', ownerId: owner.id, description: '' },
      owner.id,
      'web',
    )
    const defect = new DefectService(setupDatabase).create(
      {
        projectId: project.id,
        title: 'Concurrent conversion',
        severity: 'serious',
        assigneeId: dev.id,
        reproductionSteps: [],
      },
      qa.id,
      'mcp',
    )
    setupDatabase.close()
    const barrier = `${path}.defect-barrier`
    mkdirSync(barrier)
    const environment = {
      PROJECT_OS_WORK_ACTOR: owner.id,
      PROJECT_OS_WORK_BARRIER: barrier,
      PROJECT_OS_WORK_DATABASE: path,
      PROJECT_OS_WORK_DEFECT: defect.id,
      PROJECT_OS_WORK_MODE: 'defect',
      PROJECT_OS_WORK_VERSION: String(defect.version),
    }

    await Promise.all([
      runWorkConcurrencyClient(environment),
      runWorkConcurrencyClient(environment),
    ])

    const database = openDatabase(path)
    try {
      expect(database.prepare(`
        SELECT COUNT(*) AS count FROM tasks
      `).get()).toEqual({ count: 1 })
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM activities
        WHERE operation = 'defect.to_task'
      `).get()).toEqual({ count: 1 })
    } finally {
      database.close()
    }
  }, 20_000)
})
