import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectBriefingSchema } from '@project-os/contracts'
import { BriefingService } from './briefing-service.js'
import { createTestDatabase } from './database.js'
import { DefectService } from './defect-service.js'
import { BriefingService as ExportedBriefingService } from './index.js'
import { TaskService } from './task-service.js'

const fixtureTimestamp = '2026-07-30T01:00:00.000Z'

function insertActor(
  database: DatabaseSync,
  {
    id,
    name = id,
    kind = 'agent',
    cursor = null,
  }: {
    id: string
    name?: string
    kind?: 'human' | 'agent'
    cursor?: string | null
  },
): void {
  database.prepare(`
    INSERT INTO actors (
      id, name, kind, role, status, client, capabilities_json,
      registered_at, last_active_at, last_briefing_activity_id, version
    ) VALUES (?, ?, ?, ?, 'active', ?, '[]',
      ?, ?, ?, 1)
  `).run(
    id,
    name,
    kind,
    kind === 'human' ? 'owner' : 'dev-agent',
    kind === 'human' ? null : 'codex',
    fixtureTimestamp,
    kind === 'human' ? null : fixtureTimestamp,
    cursor,
  )
}

function insertProject(
  database: DatabaseSync,
  id: string,
  ownerId: string,
): void {
  database.prepare(`
    INSERT INTO projects (
      id, code, name, description, owner_id, start_date, due_date,
      status, progress, created_at, updated_at, version
    ) VALUES (?, ?, ?, '', ?, NULL, NULL, 'in_progress', 0, ?, ?, 1)
  `).run(
    id,
    id.toUpperCase(),
    id,
    ownerId,
    fixtureTimestamp,
    fixtureTimestamp,
  )
}

function insertTaskAndDefect(
  database: DatabaseSync,
  projectId: string,
  assigneeId: string,
): void {
  database.prepare(`
    INSERT INTO tasks (
      id, code, project_id, title, description, assignee_id,
      start_date, due_date, priority, status, progress, milestone_id,
      parent_id, dependency_ids_json, created_at, updated_at, version
    ) VALUES (
      'task_snapshot', 'TASK-0001', ?, 'Snapshot task', '', ?,
      '2026-07-01', '2026-07-31', 'P1', 'not_started', 0, '',
      NULL, '[]', ?, ?, 1
    )
  `).run(projectId, assigneeId, fixtureTimestamp, fixtureTimestamp)
  database.prepare(`
    INSERT INTO defects (
      id, code, project_id, title, description, severity, status,
      assignee_id, reproduction_steps_json, linked_requirement_id,
      linked_task_id, created_at, updated_at, version
    ) VALUES (
      'defect_snapshot', 'DEF-0001', ?, 'Snapshot defect', '',
      'normal', 'open', ?, '[]', NULL, NULL, ?, ?, 1
    )
  `).run(projectId, assigneeId, fixtureTimestamp, fixtureTimestamp)
}

function timestampAt(index: number): string {
  return new Date(
    Date.parse('2026-07-30T02:00:00.000Z') + index * 1_000,
  ).toISOString()
}

function insertTask(
  database: DatabaseSync,
  {
    id,
    projectId = 'project_briefing',
    assigneeId = 'actor_agent',
    priority = 'P2',
    status = 'not_started',
    progress = status === 'done' ? 100 : 0,
    code = id.toUpperCase(),
  }: {
    id: string
    projectId?: string
    assigneeId?: string
    priority?: 'P0' | 'P1' | 'P2' | 'P3'
    status?: 'not_started' | 'in_progress' | 'done'
    progress?: number
    code?: string
  },
): void {
  database.prepare(`
    INSERT INTO tasks (
      id, code, project_id, title, description, assignee_id,
      start_date, due_date, priority, status, progress, milestone_id,
      parent_id, dependency_ids_json, created_at, updated_at, version
    ) VALUES (
      ?, ?, ?, ?, '', ?, '2026-07-01', '2026-07-31', ?, ?, ?, '',
      NULL, '[]', ?, ?, 1
    )
  `).run(
    id,
    code,
    projectId,
    id,
    assigneeId,
    priority,
    status,
    progress,
    fixtureTimestamp,
    fixtureTimestamp,
  )
}

function insertSession(
  database: DatabaseSync,
  {
    id,
    taskIds,
    agentId = 'actor_agent',
    status = 'active',
    lastActiveAt = new Date().toISOString(),
  }: {
    id: string
    taskIds: string[]
    agentId?: string
    status?: 'active' | 'closed'
    lastActiveAt?: string
  },
): void {
  database.prepare(`
    INSERT INTO sessions (
      id, project_id, agent_id, intent, task_ids_json, status, summary,
      created_at, last_active_at, closed_at
    ) VALUES (?, 'project_briefing', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    agentId,
    id,
    JSON.stringify(taskIds),
    status,
    status === 'closed' ? 'Finished' : null,
    fixtureTimestamp,
    lastActiveAt,
    status === 'closed' ? lastActiveAt : null,
  )
}

function insertActivity(
  database: DatabaseSync,
  {
    id,
    projectId = 'project_briefing',
    actorId = 'actor_agent',
    operation = 'task.update',
    entityType = 'task',
    entityId = id,
    note = id,
    createdAt,
  }: {
    id: string
    projectId?: string
    actorId?: string
    operation?: 'task.update' | 'task.progress'
    entityType?: string
    entityId?: string
    note?: string | null
    createdAt: string
  },
): void {
  database.prepare(`
    INSERT INTO activities (
      id, actor_id, project_id, source, operation, entity_type,
      entity_id, action, note, details_json, created_at
    ) VALUES (?, ?, ?, 'mcp', ?, ?, ?, ?, ?, '{}', ?)
  `).run(
    id,
    actorId,
    projectId,
    operation,
    entityType,
    entityId,
    `Action ${id}`,
    note,
    createdAt,
  )
}

function insertHandoff(
  database: DatabaseSync,
  id: string,
  createdAt: string,
): void {
  database.prepare(`
    INSERT INTO handoffs (
      id, project_id, session_id, author_id, summary, done_json,
      blockers_json, next_steps_json, gotchas_json, refs_json, created_at
    ) VALUES (
      ?, 'project_briefing', NULL, 'actor_agent', ?, '[]',
      '[]', '[]', '[]', '[]', ?
    )
  `).run(id, id, createdAt)
}

function insertDeliverable(
  database: DatabaseSync,
  id: string,
  createdAt: string,
): void {
  database.prepare(`
    INSERT INTO deliverables (
      id, project_id, requirement_id, task_id, title, kind, ref, note,
      created_by, session_id, created_at
    ) VALUES (
      ?, 'project_briefing', NULL, 'task_progress_a', ?, 'commit', ?,
      NULL, 'actor_agent', NULL, ?
    )
  `).run(id, id, `ref:${id}`, createdAt)
}

describe('embedded assignee snapshots', () => {
  let database: DatabaseSync

  beforeEach(() => {
    database = createTestDatabase()
    insertActor(database, {
      id: 'actor_assignee',
      name: 'Builder',
      cursor: 'activity_private_cursor',
    })
    insertProject(database, 'project_snapshot', 'actor_assignee')
    insertTaskAndDefect(database, 'project_snapshot', 'actor_assignee')
  })

  afterEach(() => {
    database.close()
  })

  it('reads a task assignee as an actor snapshot without a briefing cursor', () => {
    const task = new TaskService(database).get('task_snapshot')

    expect(task.assignee).toMatchObject({
      id: 'actor_assignee',
      name: 'Builder',
      kind: 'agent',
    })
    expect(task.assignee).not.toHaveProperty('lastBriefingActivityId')
  })

  it('reads a defect assignee as an actor snapshot without a briefing cursor', () => {
    const defect = new DefectService(database).get('defect_snapshot')

    expect(defect.assignee).toMatchObject({
      id: 'actor_assignee',
      name: 'Builder',
      kind: 'agent',
    })
    expect(defect.assignee).not.toHaveProperty('lastBriefingActivityId')
  })
})

describe('BriefingService', () => {
  let database: DatabaseSync

  beforeEach(() => {
    database = createTestDatabase()
    insertActor(database, {
      id: 'actor_owner',
      name: 'Owner',
      kind: 'human',
    })
    insertActor(database, { id: 'actor_agent', name: 'Builder' })
    insertActor(database, { id: 'actor_other', name: 'Other builder' })
    insertProject(database, 'project_briefing', 'actor_owner')
    insertProject(database, 'project_other', 'actor_owner')
  })

  afterEach(() => {
    database.close()
  })

  it('is exported from the core package entrypoint', () => {
    expect(ExportedBriefingService).toBe(BriefingService)
  })

  it('composes the complete project briefing from public services', () => {
    insertTask(database, {
      id: 'task_progress_a',
      assigneeId: 'actor_agent',
      status: 'in_progress',
      progress: 35,
      code: 'TASK-0001',
    })
    insertTask(database, {
      id: 'task_progress_b',
      assigneeId: 'actor_other',
      status: 'in_progress',
      progress: 60,
      code: 'TASK-0002',
    })
    insertTask(database, {
      id: 'task_progress_none',
      assigneeId: 'actor_other',
      status: 'in_progress',
      progress: 10,
      code: 'TASK-0008',
    })
    insertTask(database, {
      id: 'task_mine_active_claim',
      assigneeId: 'actor_agent',
      priority: 'P2',
      code: 'TASK-0003',
    })
    insertTask(database, {
      id: 'task_done',
      assigneeId: 'actor_agent',
      status: 'done',
      code: 'TASK-0004',
    })
    insertTask(database, {
      id: 'task_free_p0',
      assigneeId: 'actor_other',
      priority: 'P0',
      code: 'TASK-0005',
    })
    insertTask(database, {
      id: 'task_abandoned_p1',
      assigneeId: 'actor_other',
      priority: 'P1',
      code: 'TASK-0006',
    })
    insertTask(database, {
      id: 'task_closed_p3',
      assigneeId: 'actor_other',
      priority: 'P3',
      code: 'TASK-0007',
    })

    const sameProgressTimestamp = timestampAt(1)
    insertActivity(database, {
      id: 'activity_progress_a_old',
      operation: 'task.progress',
      entityId: 'task_progress_a',
      note: 'old progress',
      createdAt: sameProgressTimestamp,
    })
    insertActivity(database, {
      id: 'activity_progress_a_latest',
      actorId: 'actor_other',
      operation: 'task.progress',
      entityId: 'task_progress_a',
      note: 'latest by rowid',
      createdAt: sameProgressTimestamp,
    })
    insertActivity(database, {
      id: 'activity_progress_b_latest',
      operation: 'task.progress',
      entityId: 'task_progress_b',
      note: 'second task progress',
      createdAt: timestampAt(2),
    })

    insertSession(database, {
      id: 'session_active',
      taskIds: ['task_mine_active_claim'],
    })
    insertSession(database, {
      id: 'session_abandoned',
      agentId: 'actor_other',
      taskIds: ['task_abandoned_p1'],
      lastActiveAt: new Date(
        Date.now() - 5 * 60 * 60 * 1_000,
      ).toISOString(),
    })
    insertSession(database, {
      id: 'session_closed',
      taskIds: ['task_closed_p3'],
      status: 'closed',
    })

    insertHandoff(database, 'handoff_old', timestampAt(3))
    insertHandoff(database, 'handoff_latest', timestampAt(4))
    for (let index = 1; index <= 12; index += 1) {
      insertDeliverable(
        database,
        `deliverable_${String(index).padStart(2, '0')}`,
        timestampAt(10 + index),
      )
    }

    const briefing = new BriefingService(database).getBriefing({
      projectId: 'project_briefing',
      agentId: 'actor_agent',
    })

    expect(briefing.project.id).toBe('project_briefing')
    expect(briefing.my_tasks.map(({ id }) => id)).toEqual([
      'task_progress_a',
      'task_mine_active_claim',
    ])
    expect(briefing.in_progress_tasks).toEqual([
      {
        task: expect.objectContaining({ id: 'task_progress_a' }),
        latest_progress: {
          note: 'latest by rowid',
          actor_name: 'Other builder',
          created_at: sameProgressTimestamp,
        },
      },
      {
        task: expect.objectContaining({ id: 'task_progress_b' }),
        latest_progress: {
          note: 'second task progress',
          actor_name: 'Builder',
          created_at: timestampAt(2),
        },
      },
      {
        task: expect.objectContaining({ id: 'task_progress_none' }),
        latest_progress: null,
      },
    ])
    expect(briefing.sessions.map(({ id, status }) => ({
      id,
      status,
    }))).toEqual([
      { id: 'session_abandoned', status: 'abandoned' },
      { id: 'session_active', status: 'active' },
    ])
    expect(briefing.unclaimed_tasks.map(({ id }) => id)).toEqual([
      'task_free_p0',
      'task_abandoned_p1',
      'task_closed_p3',
    ])
    expect(briefing.latest_handoff?.id).toBe('handoff_latest')
    expect(briefing.recent_deliverables.map(({ id }) => id)).toEqual([
      'deliverable_12',
      'deliverable_11',
      'deliverable_10',
      'deliverable_09',
      'deliverable_08',
      'deliverable_07',
      'deliverable_06',
      'deliverable_05',
      'deliverable_04',
      'deliverable_03',
    ])
    expect(projectBriefingSchema.safeParse(briefing).success).toBe(true)
  })

  it('returns the latest 20 activities in ASC order for a null cursor', () => {
    for (let index = 1; index <= 25; index += 1) {
      insertActivity(database, {
        id: `activity_${String(index).padStart(3, '0')}`,
        createdAt: timestampAt(index),
      })
    }

    const briefing = new BriefingService(database).getBriefing({
      projectId: 'project_briefing',
      agentId: 'actor_agent',
    })

    expect(briefing.new_activities.map(({ id }) => id)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `activity_${String(index + 6).padStart(3, '0')}`,
      ),
    )
    expect(briefing.activities_truncated).toBe(true)
    expect(briefing.activity_cursor).toBe('activity_025')
    expect(database.prepare(`
      SELECT last_briefing_activity_id AS cursor
      FROM actors
      WHERE id = 'actor_agent'
    `).get()).toEqual({ cursor: 'activity_025' })
  })

  it('returns only newer activities for a valid cursor and then no new rows', () => {
    insertActivity(database, {
      id: 'activity_base',
      createdAt: timestampAt(1),
    })
    insertActivity(database, {
      id: 'activity_new_1',
      createdAt: timestampAt(2),
    })
    insertActivity(database, {
      id: 'activity_new_2',
      createdAt: timestampAt(3),
    })
    database.prepare(`
      UPDATE actors
      SET last_briefing_activity_id = 'activity_base'
      WHERE id = 'actor_agent'
    `).run()
    const service = new BriefingService(database)

    const first = service.getBriefing({
      projectId: 'project_briefing',
      agentId: 'actor_agent',
    })
    const second = service.getBriefing({
      projectId: 'project_briefing',
      agentId: 'actor_agent',
    })

    expect(first.new_activities.map(({ id }) => id)).toEqual([
      'activity_new_1',
      'activity_new_2',
    ])
    expect(first.activities_truncated).toBe(false)
    expect(first.activity_cursor).toBe('activity_new_2')
    expect(second.new_activities).toEqual([])
    expect(second.activities_truncated).toBe(false)
    expect(second.activity_cursor).toBe('activity_new_2')
  })

  it.each([
    ['dangling', 'activity_missing'],
    ['cross-project', 'activity_other_project'],
  ])('falls back for a %s cursor without throwing', (_label, cursor) => {
    insertActivity(database, {
      id: 'activity_other_project',
      projectId: 'project_other',
      createdAt: timestampAt(1),
    })
    for (let index = 1; index <= 22; index += 1) {
      insertActivity(database, {
        id: `activity_target_${String(index).padStart(3, '0')}`,
        createdAt: timestampAt(10 + index),
      })
    }
    database.prepare(`
      UPDATE actors
      SET last_briefing_activity_id = ?
      WHERE id = 'actor_agent'
    `).run(cursor)

    const briefing = new BriefingService(database).getBriefing({
      projectId: 'project_briefing',
      agentId: 'actor_agent',
    })

    expect(briefing.new_activities.map(({ id }) => id)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) =>
          `activity_target_${String(index + 3).padStart(3, '0')}`,
      ),
    )
    expect(briefing.activities_truncated).toBe(true)
    expect(briefing.activity_cursor).toBe('activity_target_022')
  })

  it('caps valid incremental activity at 100 and reports truncation', () => {
    insertActivity(database, {
      id: 'activity_base',
      createdAt: timestampAt(1),
    })
    for (let index = 1; index <= 105; index += 1) {
      insertActivity(database, {
        id: `activity_new_${String(index).padStart(3, '0')}`,
        createdAt: timestampAt(index + 1),
      })
    }
    database.prepare(`
      UPDATE actors
      SET last_briefing_activity_id = 'activity_base'
      WHERE id = 'actor_agent'
    `).run()

    const briefing = new BriefingService(database).getBriefing({
      projectId: 'project_briefing',
      agentId: 'actor_agent',
    })

    expect(briefing.new_activities).toHaveLength(100)
    expect(briefing.new_activities[0]?.id).toBe('activity_new_001')
    expect(briefing.new_activities[99]?.id).toBe('activity_new_100')
    expect(briefing.activities_truncated).toBe(true)
    expect(briefing.activity_cursor).toBe('activity_new_105')
  })

  it('does not advance the actor waterline when a later read fails', () => {
    insertTask(database, {
      id: 'task_progress_a',
      status: 'in_progress',
    })
    insertActivity(database, {
      id: 'activity_base',
      createdAt: timestampAt(1),
    })
    insertActivity(database, {
      id: 'activity_invalid_progress',
      operation: 'task.progress',
      entityId: 'task_progress_a',
      note: null,
      createdAt: timestampAt(2),
    })
    database.prepare(`
      UPDATE actors
      SET last_briefing_activity_id = 'activity_base'
      WHERE id = 'actor_agent'
    `).run()

    expect(() => new BriefingService(database).getBriefing({
      projectId: 'project_briefing',
      agentId: 'actor_agent',
    })).toThrow()
    expect(database.prepare(`
      SELECT last_briefing_activity_id AS cursor
      FROM actors
      WHERE id = 'actor_agent'
    `).get()).toEqual({ cursor: 'activity_base' })
  })

  it('validates IDs and requires both the project and actor to exist', () => {
    const service = new BriefingService(database)

    expect(() => service.getBriefing({
      projectId: '',
      agentId: 'actor_agent',
    })).toThrow()
    expect(() => service.getBriefing({
      projectId: 'project_missing',
      agentId: 'actor_agent',
    })).toThrow()
    expect(() => service.getBriefing({
      projectId: 'project_briefing',
      agentId: 'actor_missing',
    })).toThrow()
  })
})
