import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error Activity writes are not part of the package API.
import type { ActivityInsert } from './index.js'
import type { ActivityService as PublicActivityService } from './index.js'
import * as publicApi from './index.js'
import { ActivityService } from './activity-service.js'
import { ActorService } from './actor-service.js'
import { createTestDatabase, openDatabase } from './database.js'
import { DomainError } from './errors.js'
import { ProjectService } from './project-service.js'

const projectChildTables = [
  'project_members',
  'tasks',
  'requirements',
  'defects',
  'sessions',
  'handoffs',
  'deliverables',
] as const

function insertProjectOwnedFixtures(
  database: DatabaseSync,
  projectId: string,
  actorId: string,
): Record<(typeof projectChildTables)[number], number> {
  const timestamp = '2026-08-02T00:00:00.000Z'

  database.prepare(`
    INSERT INTO tasks (
      id, code, project_id, title, description, assignee_id,
      start_date, due_date, priority, status, progress, milestone_id,
      parent_id, dependency_ids_json, created_at, updated_at, version
    ) VALUES (
      'task_delete_fixture', 'TASK-DELETE', ?, 'Delete fixture', '', ?,
      '2026-08-02', '2026-08-03', 'P1', 'not_started', 0, '',
      NULL, '[]', ?, ?, 1
    )
  `).run(projectId, actorId, timestamp, timestamp)
  database.prepare(`
    INSERT INTO requirements (
      id, code, project_id, title, description, priority, status,
      acceptance_criteria_json, created_at, updated_at, version
    ) VALUES (
      'requirement_delete_fixture', 'REQ-DELETE', ?, 'Delete fixture',
      '', 'P1', 'draft', '[]', ?, ?, 1
    )
  `).run(projectId, timestamp, timestamp)
  database.prepare(`
    INSERT INTO defects (
      id, code, project_id, title, description, severity, status,
      assignee_id, reproduction_steps_json, linked_requirement_id,
      linked_task_id, created_at, updated_at, version
    ) VALUES (
      'defect_delete_fixture', 'DEF-DELETE', ?, 'Delete fixture', '',
      'normal', 'open', ?, '[]', 'requirement_delete_fixture',
      'task_delete_fixture', ?, ?, 1
    )
  `).run(projectId, actorId, timestamp, timestamp)
  database.prepare(`
    INSERT INTO sessions (
      id, project_id, agent_id, intent, task_ids_json, status,
      summary, created_at, last_active_at, closed_at
    ) VALUES (
      'session_delete_fixture', ?, ?, 'Delete fixture',
      '["task_delete_fixture"]', 'active', NULL, ?, ?, NULL
    )
  `).run(projectId, actorId, timestamp, timestamp)
  database.prepare(`
    INSERT INTO handoffs (
      id, project_id, session_id, author_id, summary, done_json,
      blockers_json, next_steps_json, gotchas_json, refs_json, created_at
    ) VALUES (
      'handoff_delete_fixture', ?, 'session_delete_fixture', ?,
      'Delete fixture', '[]', '[]', '[]', '[]', '[]', ?
    )
  `).run(projectId, actorId, timestamp)
  database.prepare(`
    INSERT INTO deliverables (
      id, project_id, requirement_id, task_id, title, kind, ref, note,
      created_by, session_id, created_at
    ) VALUES (
      'deliverable_delete_fixture', ?, 'requirement_delete_fixture',
      'task_delete_fixture', 'Delete fixture', 'commit', 'abc123', NULL,
      ?, 'session_delete_fixture', ?
    )
  `).run(projectId, actorId, timestamp)

  return Object.fromEntries(projectChildTables.map((table) => {
    const row = database.prepare(`
      SELECT COUNT(*) AS count
      FROM ${table}
      WHERE project_id = ?
    `).get(projectId) as { count: number }
    return [table, row.count]
  })) as Record<(typeof projectChildTables)[number], number>
}

function insertDefaultProject(database: DatabaseSync, ownerId: string): void {
  const timestamp = '2026-08-02T00:00:00.000Z'
  database.prepare(`
    INSERT INTO projects (
      id, code, name, description, owner_id, start_date, due_date,
      status, progress, created_at, updated_at, version
    ) VALUES (
      'project_default', 'PRJ-DEFAULT', 'Default project', '', ?, NULL, NULL,
      'not_started', 0, ?, ?, 1
    )
  `).run(ownerId, timestamp, timestamp)
  database.prepare(`
    INSERT INTO project_members (
      project_id, actor_id, membership_role, joined_at
    ) VALUES ('project_default', ?, 'owner', ?)
  `).run(ownerId, timestamp)
}

describe('actor and project services', () => {
  let database: DatabaseSync
  let activities: ActivityService
  let actors: ActorService
  let projects: ProjectService

  beforeEach(() => {
    database = createTestDatabase()
    activities = new ActivityService(database)
    actors = new ActorService(database)
    projects = new ProjectService(database)
  })

  afterEach(() => {
    database.close()
  })

  it('exposes activity reads but keeps activity writes internal', () => {
    const reader: PublicActivityService = new publicApi.ActivityService(database)

    expect(reader.list).toBeTypeOf('function')
    expect('record' in reader).toBe(false)
    expect('recordActivity' in publicApi).toBe(false)

    if (false) {
      // @ts-expect-error ActivityService is a read-only public service.
      reader.record({} as ActivityInsert)
    }
  })

  it('returns the existing agent for duplicate client and name', () => {
    const first = actors.registerAgent({
      name: 'builder',
      role: 'dev-agent',
      client: 'codex',
      capabilities: ['typescript'],
    })
    const second = actors.registerAgent({
      name: 'builder',
      role: 'dev-agent',
      client: 'codex',
      capabilities: ['different-capability'],
    })

    expect(second.id).toBe(first.id)
    expect(second.capabilities).toEqual(['typescript'])
    expect(
      activities.list({
        entityId: first.id,
        source: 'mcp',
      }),
    ).toHaveLength(1)
  })

  it('creates a human and maps it through the shared actor contract', () => {
    const human = actors.createHuman({
      name: 'Lin',
      role: 'owner',
      capabilities: ['planning'],
    })

    expect(human).toMatchObject({
      name: 'Lin',
      kind: 'human',
      role: 'owner',
      status: 'active',
      client: null,
      capabilities: ['planning'],
      lastActiveAt: null,
      version: 1,
    })
    expect(human.id).toMatch(/^actor_[0-9a-f-]{36}$/)
  })

  it('lists, gets, and updates actors with role-aware validation', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const member = actors.createHuman(
      { name: 'Ming', role: 'member' },
      owner.id,
      'web',
    )

    expect(actors.list({ kind: 'human', status: 'active' })).toHaveLength(2)
    expect(actors.get(member.id)).toEqual(member)

    const updated = actors.update(
      member.id,
      {
        name: 'Ming Li',
        role: 'owner',
        capabilities: ['delivery'],
        version: member.version,
      },
      owner.id,
      'web',
    )
    expect(updated).toMatchObject({
      name: 'Ming Li',
      role: 'owner',
      capabilities: ['delivery'],
      version: 2,
    })

    expect(() => {
      actors.update(
        updated.id,
        {
          role: 'dev-agent' as never,
          version: updated.version,
        },
        owner.id,
        'web',
      )
    }).toThrow()
  })

  it('applies actor composite keyset and limit in stable name order', () => {
    actors.createHuman({ name: 'C', role: 'member' })
    const first = actors.createHuman({ name: 'A', role: 'owner' })
    const second = actors.createHuman({ name: 'B', role: 'member' })

    expect(actors.list({
      kind: 'human',
      limit: 2,
    })).toEqual([first, second])
    expect(actors.list({
      kind: 'human',
      after: { name: second.name, id: second.id },
      limit: 2,
    }).map(({ name }) => name)).toEqual(['C'])
  })

  it('treats an actor version-only update as a semantic no-op', () => {
    const owner = actors.createHuman({
      name: 'Lin',
      role: 'owner',
      capabilities: ['planning'],
    })
    const activityCount = activities.list({ entityId: owner.id }).length

    const result = actors.update(
      owner.id,
      { version: owner.version },
      owner.id,
      'web',
    )

    expect(result).toEqual(owner)
    expect(actors.get(owner.id)).toEqual(owner)
    expect(activities.list({ entityId: owner.id })).toHaveLength(activityCount)
  })

  it('treats an actor update with identical fields as a semantic no-op', () => {
    const owner = actors.createHuman({
      name: 'Lin',
      role: 'owner',
      capabilities: ['planning'],
    })
    const activityCount = activities.list({ entityId: owner.id }).length

    const result = actors.update(
      owner.id,
      {
        name: owner.name,
        role: owner.role,
        capabilities: [...owner.capabilities],
        version: owner.version,
      },
      owner.id,
      'web',
    )

    expect(result).toEqual(owner)
    expect(activities.list({ entityId: owner.id })).toHaveLength(activityCount)
  })

  it.each([
    ['name', { name: null }],
    ['role', { role: null }],
    ['capabilities', { capabilities: null }],
  ])(
    'rejects a null actor %s update before no-op detection',
    (_field, patch) => {
      const owner = actors.createHuman({
        name: 'Lin',
        role: 'owner',
        capabilities: ['planning'],
      })
      const activityCount = activities.list({ entityId: owner.id }).length

      expect(() => {
        actors.update(
          owner.id,
          { ...patch, version: owner.version } as never,
          owner.id,
          'web',
        )
      }).toThrowError(expect.objectContaining({ name: 'ZodError' }))
      expect(actors.get(owner.id)).toEqual(owner)
      expect(activities.list({ entityId: owner.id }))
        .toHaveLength(activityCount)
    },
  )

  it('continues to treat undefined actor fields as not provided', () => {
    const owner = actors.createHuman({
      name: 'Lin',
      role: 'owner',
      capabilities: ['planning'],
    })
    const activityCount = activities.list({ entityId: owner.id }).length

    const result = actors.update(
      owner.id,
      {
        name: undefined,
        role: undefined,
        capabilities: undefined,
        version: owner.version,
      } as never,
      owner.id,
      'web',
    )

    expect(result).toEqual(owner)
    expect(activities.list({ entityId: owner.id }))
      .toHaveLength(activityCount)
  })

  it('rejects agent identity conflicts with a stable domain error', () => {
    const admin = actors.createHuman({ name: 'Lin', role: 'owner' })
    const first = actors.registerAgent(
      { name: 'one', role: 'dev-agent', client: 'codex' },
      admin.id,
      'mcp',
    )
    actors.registerAgent(
      { name: 'two', role: 'qa-agent', client: 'codex' },
      admin.id,
      'mcp',
    )

    expect(() => {
      actors.update(
        first.id,
        { name: 'two', version: first.version },
        admin.id,
        'mcp',
      )
    }).toThrowError(expect.objectContaining({ code: 'ACTOR_NAME_CONFLICT' }))
  })

  it('touches an active actor and rejects stale actor versions', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const touched = actors.touch(owner.id, owner.id, 'web')

    expect(touched.lastActiveAt).not.toBeNull()
    expect(touched.version).toBe(2)
    expect(() => {
      actors.update(
        owner.id,
        { name: 'Stale', version: owner.version },
        owner.id,
        'web',
      )
    }).toThrowError(expect.objectContaining({
      code: 'ACTOR_VERSION_CONFLICT',
    }))
  })

  it('creates projects with unique deterministic codes and filters by primary owner', () => {
    const lin = actors.createHuman({ name: 'Lin', role: 'owner' })
    const ming = actors.createHuman(
      { name: 'Ming', role: 'owner' },
      lin.id,
      'web',
    )
    const atlas = projects.create(
      {
        name: 'Atlas',
        ownerId: lin.id,
        dueDate: '2026-08-31',
        description: '',
      },
      lin.id,
      'web',
    )
    const borealis = projects.create(
      {
        name: 'Borealis',
        ownerId: ming.id,
        startDate: '2026-09-01',
        dueDate: null,
        description: 'Second project',
      },
      lin.id,
      'web',
    )

    expect(atlas).toMatchObject({
      code: 'PRJ-0001',
      startDate: null,
      dueDate: '2026-08-31',
      status: 'not_started',
      progress: 0,
      version: 1,
    })
    expect(borealis.code).toBe('PRJ-0002')
    expect(projects.get(atlas.id)).toEqual(atlas)
    expect(projects.list({ ownerId: lin.id })).toEqual([atlas])
  })

  it('applies project composite keyset and limit in stable code order', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const created = ['A', 'B', 'C'].map((name) => projects.create(
      { name, ownerId: owner.id },
      owner.id,
      'web',
    ))

    expect(projects.list({
      ownerId: owner.id,
      limit: 2,
    })).toEqual(created.slice(0, 2))
    expect(projects.list({
      ownerId: owner.id,
      after: {
        code: created[1]!.code,
        id: created[1]!.id,
      },
      limit: 2,
    })).toEqual(created.slice(2))
  })

  it('adds one owner membership at creation and active members idempotently', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const member = actors.createHuman(
      { name: 'Ming', role: 'member' },
      owner.id,
      'web',
    )
    const project = projects.create(
      {
        name: 'Atlas',
        ownerId: owner.id,
        description: '',
      },
      owner.id,
      'web',
    )

    const first = projects.addMember(
      project.id,
      member.id,
      owner.id,
      'web',
    )
    const second = projects.addMember(
      project.id,
      member.id,
      owner.id,
      'web',
    )

    expect(first).toMatchObject({
      projectId: project.id,
      actorId: member.id,
      membershipRole: 'member',
    })
    expect(second).toEqual(first)
    expect(
      database.prepare(`
        SELECT membership_role, COUNT(*) AS count
        FROM project_members
        WHERE project_id = ?
        GROUP BY membership_role
        ORDER BY membership_role
      `).all(project.id),
    ).toEqual([
      { membership_role: 'member', count: 1 },
      { membership_role: 'owner', count: 1 },
    ])
    expect(
      activities.list({
        entityId: member.id,
        actorId: owner.id,
      }).filter((activity) => activity.operation === 'project.member.add'),
    ).toHaveLength(1)
  })

  it('deactivates instead of deleting a referenced actor', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const project = projects.create(
      {
        name: 'Atlas',
        ownerId: owner.id,
        description: '',
      },
      owner.id,
      'web',
    )

    const inactive = actors.deactivate(
      owner.id,
      owner.version,
      owner.id,
      'web',
    )

    expect(inactive.status).toBe('inactive')
    expect(actors.get(owner.id).status).toBe('inactive')
    expect(projects.get(project.id).ownerId).toBe(owner.id)
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM actors WHERE id = ?')
        .get(owner.id),
    ).toEqual({ count: 1 })
    expect(() => {
      projects.create(
        {
          name: 'Forbidden',
          ownerId: owner.id,
          description: '',
        },
        owner.id,
        'web',
      )
    }).toThrowError(expect.objectContaining({ code: 'ACTOR_INACTIVE' }))
  })

  it('rejects stale actor deactivation without actor or activity mutation', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const current = actors.touch(owner.id, owner.id, 'web')
    const activityCount = activities.list({ entityId: owner.id }).length

    expect(() => {
      actors.deactivate(owner.id, owner.version, owner.id, 'web')
    }).toThrowError(expect.objectContaining({
      code: 'ACTOR_VERSION_CONFLICT',
    }))
    expect(actors.get(owner.id)).toEqual(current)
    expect(activities.list({ entityId: owner.id })).toHaveLength(activityCount)
  })

  it('rejects inactive project members', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const member = actors.createHuman(
      { name: 'Ming', role: 'member' },
      owner.id,
      'web',
    )
    const project = projects.create(
      { name: 'Atlas', ownerId: owner.id, description: '' },
      owner.id,
      'web',
    )
    actors.deactivate(member.id, member.version, owner.id, 'web')

    expect(() => {
      projects.addMember(project.id, member.id, owner.id, 'web')
    }).toThrowError(expect.objectContaining({ code: 'ACTOR_INACTIVE' }))
  })

  it('updates projects with optimistic versions and canonical date ordering', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const project = projects.create(
      {
        name: 'Atlas',
        ownerId: owner.id,
        startDate: '2026-08-01',
        dueDate: '2026-08-31',
        description: '',
      },
      owner.id,
      'web',
    )

    const updated = projects.update(
      project.id,
      {
        progress: 50,
        status: 'in_progress',
        version: project.version,
      },
      owner.id,
      'web',
    )
    expect(updated).toMatchObject({
      progress: 50,
      status: 'in_progress',
      version: 2,
    })

    expect(() => {
      projects.update(
        project.id,
        { name: 'Stale', version: project.version },
        owner.id,
        'web',
      )
    }).toThrowError(expect.objectContaining({
      code: 'PROJECT_VERSION_CONFLICT',
    }))

    expect(() => {
      projects.update(
        project.id,
        {
          startDate: '2026-09-01',
          dueDate: '2026-08-01',
          version: updated.version,
        },
        owner.id,
        'web',
      )
    }).toThrow()
  })

  it('treats a project version-only update as a semantic no-op', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const project = projects.create(
      {
        name: 'Atlas',
        ownerId: owner.id,
        startDate: '2026-08-01',
        dueDate: '2026-08-31',
        description: '',
      },
      owner.id,
      'web',
    )
    const activityCount = activities.list({ entityId: project.id }).length

    const result = projects.update(
      project.id,
      { version: project.version },
      owner.id,
      'web',
    )

    expect(result).toEqual(project)
    expect(projects.get(project.id)).toEqual(project)
    expect(activities.list({ entityId: project.id }))
      .toHaveLength(activityCount)
  })

  it('treats a project update with identical fields as a semantic no-op', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const project = projects.create(
      {
        name: 'Atlas',
        ownerId: owner.id,
        startDate: '2026-08-01',
        dueDate: '2026-08-31',
        description: 'Delivery',
      },
      owner.id,
      'web',
    )
    const activityCount = activities.list({ entityId: project.id }).length

    const result = projects.update(
      project.id,
      {
        name: project.name,
        description: project.description,
        ownerId: project.ownerId,
        startDate: project.startDate,
        dueDate: project.dueDate,
        status: project.status,
        progress: project.progress,
        version: project.version,
      },
      owner.id,
      'web',
    )

    expect(result).toEqual(project)
    expect(activities.list({ entityId: project.id }))
      .toHaveLength(activityCount)
  })

  it('rejects project updates while the final owner is inactive', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const project = projects.create(
      { name: 'Atlas', ownerId: owner.id, description: '' },
      owner.id,
      'web',
    )
    actors.deactivate(owner.id, owner.version, owner.id, 'web')
    const activityCount = activities.list({ entityId: project.id }).length

    expect(() => {
      projects.update(
        project.id,
        { description: 'Blocked', version: project.version },
        owner.id,
        'web',
      )
    }).toThrowError(expect.objectContaining({ code: 'ACTOR_INACTIVE' }))
    expect(projects.get(project.id)).toEqual(project)
    expect(activities.list({ entityId: project.id }))
      .toHaveLength(activityCount)
  })

  it('deletes a non-default project and retains a complete audit record', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const agent = actors.registerAgent(
      { name: 'deleter', role: 'dev-agent', client: 'codex' },
      owner.id,
      'mcp',
    )
    const project = projects.create(
      { name: 'Atlas', ownerId: owner.id, description: '' },
      owner.id,
      'web',
    )
    const counts = insertProjectOwnedFixtures(
      database,
      project.id,
      agent.id,
    )

    const result = projects.delete(project.id, project.version, owner.id)

    expect(result).toEqual({
      id: project.id,
      name: project.name,
      deletedAt: expect.any(String),
      deletedCounts: counts,
    })
    expect(new Date(result.deletedAt).toISOString()).toBe(result.deletedAt)
    expect(() => projects.get(project.id)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }),
    )
    projectChildTables.forEach((table) => {
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM ${table}
        WHERE project_id = ?
      `).get(project.id)).toEqual({ count: 0 })
    })

    const audit = database.prepare(`
      SELECT operation, entity_id, project_id, source, action, note
      FROM activities
      WHERE operation = 'project.delete' AND entity_id = ?
    `).get(project.id) as {
      operation: string
      entity_id: string
      project_id: string | null
      source: string
      action: string
      note: string
    }
    expect(audit).toMatchObject({
      operation: 'project.delete',
      entity_id: project.id,
      project_id: null,
      source: 'web',
    })
    expect(audit.action).toContain(project.name)
    expect(JSON.parse(audit.note)).toEqual({
      projectId: project.id,
      projectName: project.name,
      counts,
    })
  })

  it('protects the literal default project from deletion', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    insertDefaultProject(database, owner.id)

    expect(() => {
      projects.delete('project_default', 1, owner.id)
    }).toThrowError(expect.objectContaining({
      code: 'DEFAULT_PROJECT_PROTECTED',
    }))
    expect(projects.get('project_default')).toMatchObject({
      id: 'project_default',
      name: 'Default project',
    })
  })

  it('forbids an unrelated global member from deleting a project', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const member = actors.createHuman(
      { name: 'Ming', role: 'member' },
      owner.id,
      'web',
    )
    const project = projects.create(
      { name: 'Atlas', ownerId: owner.id, description: '' },
      owner.id,
      'web',
    )

    expect(() => {
      projects.delete(project.id, project.version, member.id)
    }).toThrowError(expect.objectContaining({
      code: 'PROJECT_DELETE_FORBIDDEN',
      details: {
        actorId: member.id,
        projectId: project.id,
      },
    }))
    expect(projects.get(project.id)).toEqual(project)
  })

  it('allows a global owner to delete a project owned by another actor', () => {
    const systemOwner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const projectOwner = actors.createHuman(
      { name: 'Ming', role: 'member' },
      systemOwner.id,
      'web',
    )
    const project = projects.create(
      { name: 'Atlas', ownerId: projectOwner.id, description: '' },
      projectOwner.id,
      'web',
    )

    const result = projects.delete(
      project.id,
      project.version,
      systemOwner.id,
    )

    expect(result).toMatchObject({ id: project.id, name: project.name })
    expect(() => projects.get(project.id)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }),
    )
  })

  it('allows a global member to delete their own project', () => {
    const systemOwner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const projectOwner = actors.createHuman(
      { name: 'Ming', role: 'member' },
      systemOwner.id,
      'web',
    )
    const project = projects.create(
      { name: 'Atlas', ownerId: projectOwner.id, description: '' },
      projectOwner.id,
      'web',
    )

    const result = projects.delete(
      project.id,
      project.version,
      projectOwner.id,
    )

    expect(result).toMatchObject({ id: project.id, name: project.name })
    expect(() => projects.get(project.id)).toThrowError(
      expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }),
    )
  })

  it('forbids an agent from deleting a project it owns', () => {
    const systemOwner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const agent = actors.registerAgent(
      { name: 'project-owner', role: 'pm-agent', client: 'codex' },
      systemOwner.id,
      'mcp',
    )
    const project = projects.create(
      { name: 'Atlas', ownerId: agent.id, description: '' },
      agent.id,
      'mcp',
    )
    const counts = insertProjectOwnedFixtures(
      database,
      project.id,
      agent.id,
    )
    const activityCount = database.prepare(`
      SELECT COUNT(*) AS count FROM activities
    `).get()

    expect(() => {
      projects.delete(project.id, project.version, agent.id, 'mcp')
    }).toThrowError(expect.objectContaining({
      code: 'PERMISSION_DENIED',
      details: {
        role: 'pm-agent',
        operation: 'project.delete',
      },
    }))
    expect(projects.get(project.id)).toEqual(project)
    projectChildTables.forEach((table) => {
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM ${table}
        WHERE project_id = ?
      `).get(project.id)).toEqual({ count: counts[table] })
    })
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM activities
    `).get()).toEqual(activityCount)
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM activities
      WHERE operation = 'project.delete' AND entity_id = ?
    `).get(project.id)).toEqual({ count: 0 })
  })

  it('rejects stale deletion without changing the project or audit log', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const project = projects.create(
      { name: 'Atlas', ownerId: owner.id, description: '' },
      owner.id,
      'web',
    )
    const current = projects.update(
      project.id,
      { description: 'Current', version: project.version },
      owner.id,
      'web',
    )
    const activityCount = database.prepare(`
      SELECT COUNT(*) AS count FROM activities
    `).get()

    expect(() => {
      projects.delete(project.id, project.version, owner.id)
    }).toThrowError(expect.objectContaining({
      code: 'PROJECT_VERSION_CONFLICT',
      details: {
        projectId: project.id,
        expectedVersion: project.version,
        currentVersion: current.version,
      },
    }))
    expect(projects.get(project.id)).toEqual(current)
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM activities
    `).get()).toEqual(activityCount)
  })

  it('wraps an invalid deletion source without changing project or audit', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const project = projects.create(
      { name: 'Atlas', ownerId: owner.id, description: '' },
      owner.id,
      'web',
    )
    const activityCount = database.prepare(`
      SELECT COUNT(*) AS count FROM activities
    `).get()

    expect(() => {
      projects.delete(
        project.id,
        project.version,
        owner.id,
        'invalid' as never,
      )
    }).toThrowError(expect.objectContaining({
      code: 'PROJECT_DELETE_FAILED',
      details: { projectId: project.id },
    }))
    expect(projects.get(project.id)).toEqual(project)
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM activities
    `).get()).toEqual(activityCount)
  })

  it('rolls back project deletion when the project delete fails', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const agent = actors.registerAgent(
      { name: 'deleter', role: 'dev-agent', client: 'codex' },
      owner.id,
      'mcp',
    )
    const project = projects.create(
      { name: 'Atlas', ownerId: owner.id, description: '' },
      owner.id,
      'web',
    )
    const counts = insertProjectOwnedFixtures(
      database,
      project.id,
      agent.id,
    )
    database.exec(`
      CREATE TRIGGER fail_project_delete
      BEFORE DELETE ON projects
      BEGIN
        SELECT RAISE(ABORT, 'forced project deletion failure');
      END;
    `)

    expect(() => {
      projects.delete(project.id, project.version, owner.id)
    }).toThrowError(expect.objectContaining({
      code: 'PROJECT_DELETE_FAILED',
    }))
    expect(projects.get(project.id)).toEqual(project)
    projectChildTables.forEach((table) => {
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM ${table}
        WHERE project_id = ?
      `).get(project.id)).toEqual({ count: counts[table] })
    })
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM activities
      WHERE operation = 'project.delete' AND entity_id = ?
    `).get(project.id)).toEqual({ count: 0 })
  })

  it('records every successful mutation with actor, source, entity, and operation', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    const agent = actors.registerAgent(
      { name: 'builder', role: 'dev-agent', client: 'codex' },
      owner.id,
      'mcp',
    )
    const updatedAgent = actors.update(
      agent.id,
      { capabilities: ['typescript'], version: agent.version },
      owner.id,
      'mcp',
    )
    actors.touch(updatedAgent.id, owner.id, 'mcp')
    const member = actors.createHuman(
      { name: 'Ming', role: 'member' },
      owner.id,
      'web',
    )
    const project = projects.create(
      { name: 'Atlas', ownerId: owner.id, description: '' },
      owner.id,
      'web',
    )
    projects.addMember(project.id, member.id, owner.id, 'web')
    const updatedProject = projects.update(
      project.id,
      { description: 'Updated', version: project.version },
      owner.id,
      'web',
    )
    actors.deactivate(member.id, member.version, owner.id, 'web')

    const rows = database.prepare(`
      SELECT actor_id, source, entity_id, operation
      FROM activities
      ORDER BY rowid
    `).all()

    expect(rows).toEqual(expect.arrayContaining([
      {
        actor_id: owner.id,
        source: 'mcp',
        entity_id: agent.id,
        operation: 'actor.register',
      },
      {
        actor_id: owner.id,
        source: 'mcp',
        entity_id: agent.id,
        operation: 'actor.update',
      },
      {
        actor_id: owner.id,
        source: 'web',
        entity_id: project.id,
        operation: 'project.create',
      },
      {
        actor_id: owner.id,
        source: 'web',
        entity_id: member.id,
        operation: 'project.member.add',
      },
      {
        actor_id: owner.id,
        source: 'web',
        entity_id: updatedProject.id,
        operation: 'project.update',
      },
      {
        actor_id: owner.id,
        source: 'web',
        entity_id: member.id,
        operation: 'actor.deactivate',
      },
    ]))
    expect(rows).toHaveLength(9)
  })

  it('filters and paginates activities with a validated after cursor', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    actors.registerAgent(
      { name: 'builder', role: 'dev-agent', client: 'codex' },
      owner.id,
      'mcp',
    )
    actors.createHuman({ name: 'Ming', role: 'member' }, owner.id, 'web')

    const firstPage = activities.list({ actorId: owner.id, limit: 2 })
    const secondPage = activities.list({
      actorId: owner.id,
      after: firstPage.at(-1)!.id,
      limit: 2,
    })

    expect(firstPage).toHaveLength(2)
    expect(secondPage).toHaveLength(1)
    expect(
      activities.list({ actorId: owner.id, source: 'mcp' }),
    ).toHaveLength(1)
    expect(() => activities.list({ limit: 0 })).toThrow()
  })

  it('rolls back an entity mutation when its activity insert fails', () => {
    const owner = actors.createHuman({ name: 'Lin', role: 'owner' })
    database.exec(`
      CREATE TRIGGER fail_activity_insert
      BEFORE INSERT ON activities
      BEGIN
        SELECT RAISE(ABORT, 'forced activity failure');
      END;
    `)

    expect(() => {
      actors.update(
        owner.id,
        { name: 'Must Roll Back', version: owner.version },
        owner.id,
        'web',
      )
    }).toThrow(/forced activity failure/)

    expect(actors.get(owner.id)).toEqual(owner)
  })

  it('throws stable not-found errors', () => {
    expect(() => actors.get('actor_missing')).toThrowError(
      expect.objectContaining({ code: 'ACTOR_NOT_FOUND' }),
    )
    expect(() => projects.get('project_missing')).toThrowError(
      expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }),
    )
  })
})

describe('atomic actor-coordinated mutations', () => {
  let database: DatabaseSync
  let actors: ActorService
  let projects: ProjectService

  beforeEach(() => {
    database = createTestDatabase()
    actors = new ActorService(database)
    projects = new ProjectService(database)
  })

  afterEach(() => {
    database.close()
  })

  it('commits a nested service write and actor touch once', () => {
    const pm = actors.registerAgent({
      name: 'atomic-pm',
      role: 'pm-agent',
      client: 'codex',
    })

    const project = actors.runAtomic(() => {
      const created = projects.create({
        name: 'Atomic project',
        ownerId: pm.id,
      }, pm.id, 'mcp')
      actors.touch(pm.id)
      return created
    })

    expect(projects.get(project.id)).toEqual(project)
    expect(actors.get(pm.id).version).toBe(pm.version + 1)
    expect(database.isTransaction).toBe(false)
    expect(database.prepare(`
      SELECT operation, COUNT(*) AS count
      FROM activities
      WHERE operation IN ('project.create', 'actor.update')
      GROUP BY operation
      ORDER BY operation
    `).all()).toEqual([
      { operation: 'actor.update', count: 1 },
      { operation: 'project.create', count: 1 },
    ])
  })

  it('rolls back the business write if the actor is deactivated before touch', () => {
    const pm = actors.registerAgent({
      name: 'racing-pm',
      role: 'pm-agent',
      client: 'codex',
    })

    expect(() => actors.runAtomic(() => {
      projects.create({
        name: 'Rolled back project',
        ownerId: pm.id,
      }, pm.id, 'mcp')
      actors.deactivate(pm.id, pm.version, pm.id, 'mcp')
      actors.touch(pm.id)
    })).toThrow(new DomainError(
      'ACTOR_INACTIVE',
      'Actor is inactive',
      { actorId: pm.id },
    ))

    expect(projects.list()).toEqual([])
    expect(actors.get(pm.id)).toMatchObject({
      status: 'active',
      version: pm.version,
    })
    expect(database.isTransaction).toBe(false)
    expect(database.prepare(`
      SELECT operation
      FROM activities
      WHERE operation <> 'actor.register'
    `).all()).toEqual([])
  })
})

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const vitestEntry = join(
  repositoryRoot,
  'node_modules',
  'vitest',
  'vitest.mjs',
)
const concurrencyClient = join(
  repositoryRoot,
  'packages',
  'core',
  'src',
  'service-concurrency-client.test.ts',
)

function runConcurrencyClient(
  environment: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [vitestEntry, 'run', concurrencyClient],
      {
        cwd: join(repositoryRoot, 'packages', 'core'),
        env: {
          ...process.env,
          ...environment,
        },
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
          `Concurrency client exited ${code}\n${stdout}\n${stderr}`,
        ))
      }
    })
  })
}

describe('file database service concurrency', () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    temporaryDirectories.splice(0).forEach((directory) => {
      rmSync(directory, { recursive: true, force: true })
    })
  })

  function createDatabasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'project-os-service-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'project-os.db')
    const database = openDatabase(path)
    database.close()
    return path
  }

  it('serializes duplicate agent registration across processes', async () => {
    const path = createDatabasePath()
    const barrier = `${path}.agent-barrier`
    mkdirSync(barrier)
    const environment = {
      PROJECT_OS_CONCURRENCY_BARRIER: barrier,
      PROJECT_OS_CONCURRENCY_DATABASE: path,
      PROJECT_OS_CONCURRENCY_MODE: 'agent',
    }

    await Promise.all([
      runConcurrencyClient(environment),
      runConcurrencyClient(environment),
    ])

    const database = openDatabase(path)
    try {
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM actors
        WHERE kind = 'agent' AND client = 'codex' AND name = 'builder'
      `).get()).toEqual({ count: 1 })
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM activities
        WHERE operation = 'actor.register'
      `).get()).toEqual({ count: 1 })
    } finally {
      database.close()
    }
  }, 20_000)

  it('allocates unique consecutive project codes across processes', async () => {
    const path = createDatabasePath()
    const setup = openDatabase(path)
    const owner = new ActorService(setup).createHuman({
      name: 'Lin',
      role: 'owner',
    })
    setup.close()
    const barrier = `${path}.project-barrier`
    mkdirSync(barrier)
    const environment = {
      PROJECT_OS_CONCURRENCY_BARRIER: barrier,
      PROJECT_OS_CONCURRENCY_DATABASE: path,
      PROJECT_OS_CONCURRENCY_MODE: 'project',
      PROJECT_OS_CONCURRENCY_OWNER: owner.id,
    }

    await Promise.all([
      runConcurrencyClient(environment),
      runConcurrencyClient(environment),
    ])

    const database = openDatabase(path)
    try {
      expect(database.prepare(`
        SELECT code
        FROM projects
        ORDER BY code
      `).all()).toEqual([
        { code: 'PRJ-0001' },
        { code: 'PRJ-0002' },
      ])
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM activities
        WHERE operation = 'project.create'
      `).get()).toEqual({ count: 2 })
    } finally {
      database.close()
    }
  }, 20_000)
})
