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
import { ProjectService } from './project-service.js'

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

    const inactive = actors.deactivate(owner.id, owner.id, 'web')

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
    actors.deactivate(member.id, owner.id, 'web')

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
    actors.deactivate(owner.id, owner.id, 'web')
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
    actors.deactivate(member.id, owner.id, 'web')

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
        cwd: repositoryRoot,
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
