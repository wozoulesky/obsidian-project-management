import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ActivityService } from './activity-service.js'
import { ActorService } from './actor-service.js'
import {
  BackupService,
  type DatabaseLifecycle,
} from './backup-service.js'
import { openDatabase } from './database.js'
import { DomainError } from './errors.js'
import {
  ExportService,
  validateExportDocument,
} from './export-service.js'
import type { ExportDocument } from './export-service.js'
import {
  createLegacyFixtureSeedDocument,
  seedDatabase,
} from './seed.js'
import { SettingsService } from './settings-service.js'
import { TokenService } from './token-service.js'

const timestamp = '2026-07-29T01:00:00.000Z'

type TestLifecycle = DatabaseLifecycle & {
  database: DatabaseSync
}

function createLifecycle(path: string): TestLifecycle {
  let database = openDatabase(path)
  return {
    get database() {
      return database
    },
    databasePath: path,
    getDatabase: () => database,
    closeDatabase: () => database.close(),
    replaceDatabase: (replacement) => {
      database = replacement
    },
  }
}

function insertOwner(database: DatabaseSync, id = 'actor_owner'): void {
  database.prepare(`
    INSERT INTO actors (
      id, name, kind, role, status, client, capabilities_json,
      registered_at, last_active_at, version
    ) VALUES (?, ?, 'human', 'owner', 'active', NULL, '[]', ?, NULL, 1)
  `).run(id, 'Owner', timestamp)
}

function fixtureDocument(name = 'Atlas'): ExportDocument {
  const owner = {
    id: 'actor_owner',
    name: 'Owner',
    kind: 'human' as const,
    role: 'owner' as const,
    status: 'active' as const,
    client: null,
    capabilities: [],
    registeredAt: timestamp,
    lastActiveAt: null,
    version: 1,
  }
  return {
    schemaVersion: 1 as const,
    exportedAt: timestamp,
    actors: [owner],
    projects: [{
      id: 'project_atlas',
      code: 'PRJ-001',
      name,
      description: '',
      ownerId: owner.id,
      startDate: '2026-07-01',
      dueDate: '2026-08-01',
      status: 'in_progress' as const,
      progress: 20,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    }],
    projectMembers: [{
      projectId: 'project_atlas',
      actorId: owner.id,
      membershipRole: 'owner' as const,
      joinedAt: timestamp,
    }],
    tasks: [{
      id: 'task_one',
      code: 'TASK-001',
      projectId: 'project_atlas',
      title: 'Ship',
      description: '',
      assignee: owner,
      assigneeId: owner.id,
      startDate: '2026-07-01',
      dueDate: '2026-07-02',
      priority: 'P0' as const,
      status: 'not_started' as const,
      progress: 0,
      milestoneId: '',
      dependencyIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    }],
    requirements: [{
      id: 'requirement_one',
      code: 'REQ-001',
      projectId: 'project_atlas',
      title: 'Safe import',
      description: '',
      priority: 'P0' as const,
      status: 'draft' as const,
      linkedTaskIds: ['task_one'],
      completedTaskCount: 0,
      acceptanceCriteria: ['atomic'],
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    }],
    defects: [{
      id: 'defect_one',
      code: 'D-001',
      projectId: 'project_atlas',
      title: 'Example',
      description: '',
      severity: 'normal' as const,
      status: 'open' as const,
      assignee: owner,
      assigneeId: owner.id,
      reproductionSteps: [],
      linkedRequirementId: 'requirement_one',
      linkedTaskId: 'task_one',
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    }],
    settings: {
      theme: 'system' as const,
      background: 'soft' as const,
      accent: 'blue' as const,
      density: 'comfortable' as const,
      updatedAt: timestamp,
      version: 1,
    },
  }
}

describe('settings, tokens, export, backup, and seed', () => {
  let temporaryDirectory: string

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'project-os-core-'))
  })

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  it('returns valid complete settings defaults and persists a versioned update', () => {
    const database = openDatabase(join(temporaryDirectory, 'settings.sqlite'))
    insertOwner(database)
    const settings = new SettingsService(database)
    const initial = settings.get()

    expect(initial).toMatchObject({
      theme: 'system',
      background: 'soft',
      accent: 'blue',
      density: 'comfortable',
      version: 1,
    })

    const updated = settings.update(
      { ...initial, theme: 'dark' },
      'actor_owner',
      'web',
    )
    expect(updated).toMatchObject({ theme: 'dark', version: 2 })
    expect(settings.get()).toEqual(updated)
    expect(new ActivityService(database).list({ entityId: 'app' }))
      .toHaveLength(1)
    database.close()
  })

  it('optimistically locks the virtual default before the first persisted update', () => {
    const database = openDatabase(join(temporaryDirectory, 'settings.sqlite'))
    insertOwner(database)
    const settings = new SettingsService(database)
    const initial = settings.get()

    expect(() => settings.update(
      { ...initial, theme: 'dark', version: 99 },
      'actor_owner',
      'web',
    )).toThrowError(expect.objectContaining({
      code: 'SETTINGS_VERSION_CONFLICT',
    }))
    expect(() => settings.update(
      { ...initial, theme: 'dark', version: null } as never,
      'actor_owner',
      'web',
    )).toThrowError(expect.objectContaining({ code: 'SETTINGS_INVALID' }))
    const missingVersion = { ...initial } as Record<string, unknown>
    delete missingVersion.version
    expect(() => settings.update(
      missingVersion as never,
      'actor_owner',
      'web',
    )).toThrowError(expect.objectContaining({ code: 'SETTINGS_INVALID' }))
    expect(database.prepare('SELECT COUNT(*) AS count FROM settings').get())
      .toEqual({ count: 0 })
    expect(new ActivityService(database).list()).toHaveLength(0)

    expect(settings.update(initial, 'actor_owner', 'web')).toEqual(initial)
    expect(database.prepare('SELECT COUNT(*) AS count FROM settings').get())
      .toEqual({ count: 0 })
    const updated = settings.update(
      { ...initial, theme: 'dark' },
      'actor_owner',
      'web',
    )
    expect(updated.version).toBe(2)
    database.close()
  })

  it('rejects stale and null settings and keeps semantic no-ops unchanged', () => {
    const database = openDatabase(join(temporaryDirectory, 'settings.sqlite'))
    insertOwner(database)
    const settings = new SettingsService(database)
    const created = settings.update(
      { ...settings.get(), theme: 'dark' },
      'actor_owner',
      'web',
    )
    const changed = settings.update(
      { ...created, accent: 'teal' },
      'actor_owner',
      'web',
    )
    const count = new ActivityService(database).list().length

    expect(() => settings.update(
      { ...created, density: 'compact' },
      'actor_owner',
      'web',
    )).toThrowError(expect.objectContaining({ code: 'SETTINGS_VERSION_CONFLICT' }))
    expect(() => settings.update(
      { ...changed, theme: null } as never,
      'actor_owner',
      'web',
    )).toThrow()
    expect(settings.update(changed, 'actor_owner', 'web')).toEqual(changed)
    expect(new ActivityService(database).list()).toHaveLength(count)
    database.close()
  })

  it('rolls settings back when its activity cannot be recorded', () => {
    const database = openDatabase(join(temporaryDirectory, 'settings.sqlite'))
    insertOwner(database)
    const settings = new SettingsService(database)
    const initial = settings.get()

    expect(() => settings.update(
      { ...initial, theme: 'dark' },
      'missing_actor',
      'web',
    )).toThrowError(expect.objectContaining({ code: 'SETTINGS_UPDATE_FAILED' }))
    expect(settings.get()).toEqual(initial)
    database.close()
  })

  it('stores only a versioned scrypt digest and returns plaintext once', () => {
    const databasePath = join(temporaryDirectory, 'tokens.sqlite')
    const database = openDatabase(databasePath)
    insertOwner(database)
    const tokens = new TokenService(database)
    const issued = tokens.issue('local-codex', 'actor_owner', 'web')
    const databaseBytes = readFileSync(databasePath)

    expect(issued.token).toMatch(/^pos_[A-Za-z0-9_-]{40,}$/)
    expect(JSON.stringify(database.prepare(
      'SELECT * FROM access_tokens WHERE id = ?',
    ).get(issued.id))).not.toContain(issued.token)
    expect(databaseBytes.includes(Buffer.from(issued.token))).toBe(false)
    expect(JSON.stringify(tokens.list())).not.toContain(issued.token)
    expect(JSON.stringify(new ActivityService(database).list()))
      .not.toContain(issued.token)
    expect(tokens.verify(issued.token)).toBe(true)
    expect(tokens.list()[0]?.lastUsedAt).not.toBeNull()
    database.close()
  })

  it('handles malformed, unknown, and revoked tokens without throwing', () => {
    const database = openDatabase(join(temporaryDirectory, 'tokens.sqlite'))
    insertOwner(database)
    const tokens = new TokenService(database)
    const first = tokens.issue('same-name')
    const second = tokens.issue('same-name')

    expect(first.id).not.toBe(second.id)
    expect(tokens.verify(null as never)).toBe(false)
    expect(tokens.verify('not-a-token')).toBe(false)
    expect(tokens.verify(`pos_${'a'.repeat(43)}`)).toBe(false)
    const revoked = tokens.revoke(first.id, first.version, 'actor_owner', 'web')
    expect(revoked.revokedAt).not.toBeNull()
    expect(tokens.verify(first.token)).toBe(false)
    expect(tokens.verify(second.token)).toBe(true)

    const activityCount = new ActivityService(database).list().length
    expect(tokens.revoke(
      first.id,
      revoked.version,
      'actor_owner',
      'web',
    )).toEqual(revoked)
    expect(new ActivityService(database).list()).toHaveLength(activityCount)
    database.close()
  })

  it('wraps token audit failures and rolls their mutations back', () => {
    const database = openDatabase(join(temporaryDirectory, 'tokens.sqlite'))
    const tokens = new TokenService(database)

    expect(() => tokens.issue('audited', 'missing_actor', 'web'))
      .toThrowError(expect.objectContaining({ code: 'TOKEN_ISSUE_FAILED' }))
    expect(tokens.list()).toHaveLength(0)

    const issued = tokens.issue('revoke-me')
    expect(() => tokens.revoke(
      issued.id,
      issued.version,
      'missing_actor',
      'web',
    )).toThrowError(expect.objectContaining({ code: 'TOKEN_REVOKE_FAILED' }))
    expect(tokens.verify(issued.token)).toBe(true)
    database.close()
  })

  it('exports all primary data without secrets or activities and round-trips', () => {
    const source = openDatabase(join(temporaryDirectory, 'source.sqlite'))
    const target = openDatabase(join(temporaryDirectory, 'target.sqlite'))
    const sourceExports = new ExportService(source)
    sourceExports.importJson(fixtureDocument())
    const token = new TokenService(source).issue('secret')
    const exported = sourceExports.exportJson()
    const serialized = JSON.stringify(exported)

    expect(Object.keys(exported)).toEqual([
      'schemaVersion',
      'exportedAt',
      'actors',
      'projects',
      'projectMembers',
      'tasks',
      'requirements',
      'defects',
      'settings',
    ])
    expect(serialized).not.toContain(token.token)
    expect(serialized).not.toContain('token_hash')
    expect(serialized).not.toContain('activities')

    new ExportService(target).importJson(exported)
    expect({
      ...new ExportService(target).exportJson(),
      exportedAt: exported.exportedAt,
    }).toEqual(exported)
    source.close()
    target.close()
  })

  it('validates the entire import and cross-project references before writing', () => {
    const database = openDatabase(join(temporaryDirectory, 'import.sqlite'))
    const service = new ExportService(database)
    service.importJson(fixtureDocument())
    const before = service.exportJson()
    const invalid = structuredClone(before)
    invalid.tasks[0]!.dependencyIds = ['missing']

    expect(() => service.importJson(invalid)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_INVALID' }),
    )
    expect({
      ...service.exportJson(),
      exportedAt: before.exportedAt,
    }).toEqual(before)
    database.close()
  })

  it('rejects duplicate IDs, unknown keys, and invalid dates before writing', () => {
    const database = openDatabase(join(temporaryDirectory, 'import.sqlite'))
    const service = new ExportService(database)
    const valid = fixtureDocument()
    service.importJson(valid)
    const invalid = {
      ...structuredClone(valid),
      exportedAt: 'not-a-date',
      actors: [...valid.actors, valid.actors[0]],
      surprise: true,
    }

    expect(() => service.importJson(invalid)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_INVALID' }),
    )
    expect(service.exportJson().projects[0]?.name).toBe('Atlas')
    database.close()
  })

  it('rejects inverted project and task date ranges', () => {
    const database = openDatabase(join(temporaryDirectory, 'dates.sqlite'))
    const service = new ExportService(database)
    const invalid = fixtureDocument()
    invalid.projects[0]!.startDate = '2026-08-02'
    invalid.tasks[0]!.startDate = '2026-07-03'

    expect(() => service.importJson(invalid)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_INVALID' }),
    )
    expect(database.prepare('SELECT COUNT(*) AS count FROM projects').get())
      .toEqual({ count: 0 })
    database.close()
  })

  it('preserves tokens and activities while replacing primary import data', () => {
    const database = openDatabase(join(temporaryDirectory, 'import.sqlite'))
    const exports = new ExportService(database)
    exports.importJson(fixtureDocument())
    const token = new TokenService(database).issue(
      'preserved',
      'actor_owner',
      'web',
    )
    const activities = new ActivityService(database).list().length

    exports.importJson(fixtureDocument('Renamed'))

    expect(exports.exportJson().projects[0]?.name).toBe('Renamed')
    expect(new TokenService(database).verify(token.token)).toBe(true)
    expect(new ActivityService(database).list()).toHaveLength(activities)
    database.close()
  })

  it('rejects an import that omits an activity actor or project anchor', () => {
    const database = openDatabase(join(temporaryDirectory, 'anchors.sqlite'))
    const exports = new ExportService(database)
    exports.importJson(fixtureDocument())
    database.prepare(`
      INSERT INTO activities (
        id, actor_id, project_id, source, operation, entity_type,
        entity_id, action, note, details_json, created_at
      ) VALUES (?, ?, ?, 'web', 'project.update', 'project', ?, ?, NULL, '{}', ?)
    `).run(
      'activity_anchor',
      'actor_owner',
      'project_atlas',
      'project_atlas',
      'Anchored project',
      timestamp,
    )
    const before = exports.exportJson()
    const emptyGraph = {
      ...fixtureDocument(),
      actors: [],
      projects: [],
      projectMembers: [],
      tasks: [],
      requirements: [],
      defects: [],
    }

    expect(() => exports.importJson(emptyGraph)).toThrowError(
      expect.objectContaining({ code: 'IMPORT_INVALID' }),
    )
    expect({
      ...exports.exportJson(),
      exportedAt: before.exportedAt,
    }).toEqual(before)
    expect(() => validateExportDocument(exports.exportJson())).not.toThrow()
    database.close()
  })

  it('keeps audit rows and tokens while producing exactly the imported graph', () => {
    const database = openDatabase(join(temporaryDirectory, 'exact.sqlite'))
    const exports = new ExportService(database)
    exports.importJson(fixtureDocument())
    database.prepare(`
      INSERT INTO activities (
        id, actor_id, project_id, source, operation, entity_type,
        entity_id, action, note, details_json, created_at
      ) VALUES (?, ?, ?, 'web', 'project.update', 'project', ?, ?, NULL, '{}', ?)
    `).run(
      'activity_anchor',
      'actor_owner',
      'project_atlas',
      'project_atlas',
      'Anchored project',
      timestamp,
    )
    const token = new TokenService(database).issue('preserved')
    const incoming = fixtureDocument('Imported exact graph')

    exports.importJson(incoming, 'actor_owner', 'web')

    const actual = exports.exportJson()
    expect({ ...actual, exportedAt: incoming.exportedAt }).toEqual(incoming)
    expect(new TokenService(database).verify(token.token)).toBe(true)
    expect(new ActivityService(database).list()).toHaveLength(2)
    expect(() => validateExportDocument(actual)).not.toThrow()
    database.close()
  })

  it('replaces an anchored project whose former owner is not imported', () => {
    const database = openDatabase(join(temporaryDirectory, 'owner-swap.sqlite'))
    const exports = new ExportService(database)
    const initial = fixtureDocument()
    const auditor: ExportDocument['actors'][number] = {
      id: 'actor_auditor',
      name: 'Auditor',
      kind: 'human',
      role: 'member' as const,
      status: 'active',
      client: null,
      capabilities: [],
      registeredAt: timestamp,
      lastActiveAt: null,
      version: 1,
    }
    initial.actors.push(auditor)
    initial.projectMembers.push({
      projectId: 'project_atlas',
      actorId: auditor.id,
      membershipRole: 'member',
      joinedAt: timestamp,
    })
    exports.importJson(initial)
    database.prepare(`
      INSERT INTO activities (
        id, actor_id, project_id, source, operation, entity_type,
        entity_id, action, note, details_json, created_at
      ) VALUES (?, ?, ?, 'web', 'project.update', 'project', ?, ?, NULL, '{}', ?)
    `).run(
      'activity_auditor',
      auditor.id,
      'project_atlas',
      'project_atlas',
      'Audited project',
      timestamp,
    )
    const incoming = structuredClone(initial)
    incoming.actors = [auditor]
    incoming.projects[0]!.ownerId = auditor.id
    incoming.projectMembers = [{
      projectId: 'project_atlas',
      actorId: auditor.id,
      membershipRole: 'owner',
      joinedAt: timestamp,
    }]
    incoming.tasks[0]!.assigneeId = auditor.id
    incoming.tasks[0]!.assignee = auditor
    incoming.defects[0]!.assigneeId = auditor.id
    incoming.defects[0]!.assignee = auditor

    exports.importJson(incoming, auditor.id, 'web')

    const actual = exports.exportJson()
    expect({ ...actual, exportedAt: incoming.exportedAt }).toEqual(incoming)
    expect(actual.actors.some(({ id }) => id === 'actor_owner')).toBe(false)
    database.close()
  })

  it('rejects import.run actors that are absent from the incoming graph', () => {
    const database = openDatabase(join(temporaryDirectory, 'actor-import.sqlite'))
    const exports = new ExportService(database)
    exports.importJson(fixtureDocument())
    const before = exports.exportJson()

    expect(() => exports.importJson(before, 'missing_actor', 'web'))
      .toThrowError(expect.objectContaining({ code: 'IMPORT_INVALID' }))
    expect({
      ...exports.exportJson(),
      exportedAt: before.exportedAt,
    }).toEqual(before)
    database.close()
  })

  it('creates a WAL-consistent backup and restores it through an explicit lifecycle', async () => {
    const databasePath = join(temporaryDirectory, 'active.sqlite')
    const backupDirectory = join(temporaryDirectory, 'backups')
    const lifecycle = createLifecycle(databasePath)
    new ExportService(lifecycle.database).importJson(fixtureDocument('Before'))
    const backups = new BackupService(lifecycle, backupDirectory)
    const backupPath = await backups.create('snapshot.sqlite')

    new ExportService(lifecycle.database).importJson(fixtureDocument('After'))
    const oldHandle = lifecycle.database
    const reopened = backups.restore(backupPath)

    expect(reopened).toBe(lifecycle.database)
    expect(new ExportService(lifecycle.database).exportJson().projects[0]?.name)
      .toBe('Before')
    expect(() => oldHandle.prepare('SELECT 1').get()).toThrow()
    expect(existsSync(`${databasePath}-wal`)).toBe(true)
    lifecycle.database.close()
  })

  it('leaves the active database and candidate unchanged after invalid restore', () => {
    const databasePath = join(temporaryDirectory, 'active.sqlite')
    const candidate = join(temporaryDirectory, 'candidate.sqlite')
    const lifecycle = createLifecycle(databasePath)
    new ExportService(lifecycle.database).importJson(fixtureDocument())
    writeFileSync(candidate, 'not sqlite')
    const candidateBefore = readFileSync(candidate)
    const backups = new BackupService(
      lifecycle,
      join(temporaryDirectory, 'backups'),
    )

    expect(() => backups.restore(candidate)).toThrowError(
      expect.objectContaining({ code: 'BACKUP_INVALID' }),
    )
    expect(new ExportService(lifecycle.database).exportJson().projects[0]?.name)
      .toBe('Atlas')
    expect(readFileSync(candidate)).toEqual(candidateBefore)
    lifecycle.database.close()
  })

  it('rejects candidates with a newer or missing migration set', async () => {
    const databasePath = join(temporaryDirectory, 'active.sqlite')
    const lifecycle = createLifecycle(databasePath)
    const backups = new BackupService(
      lifecycle,
      join(temporaryDirectory, 'backups'),
    )
    const newer = join(temporaryDirectory, 'newer.sqlite')
    const missing = join(temporaryDirectory, 'missing.sqlite')
    await backups.create('base.sqlite')
    copyFileSync(join(temporaryDirectory, 'backups', 'base.sqlite'), newer)
    copyFileSync(newer, missing)
    const newerDatabase = openDatabase(newer)
    newerDatabase.exec('PRAGMA foreign_keys = OFF')
    newerDatabase.prepare(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
    ).run(999, timestamp)
    newerDatabase.close()
    const missingDatabase = openDatabase(missing)
    missingDatabase.prepare('DELETE FROM schema_migrations').run()
    missingDatabase.close()

    for (const candidate of [newer, missing]) {
      expect(() => backups.restore(candidate)).toThrowError(
        expect.objectContaining({ code: 'BACKUP_INVALID' }),
      )
    }
    lifecycle.database.close()
  })

  it('rolls the file exchange back if lifecycle replacement fails', async () => {
    const databasePath = join(temporaryDirectory, 'active.sqlite')
    const lifecycle = createLifecycle(databasePath)
    const backups = new BackupService(
      lifecycle,
      join(temporaryDirectory, 'backups'),
    )
    new ExportService(lifecycle.database).importJson(fixtureDocument('Before'))
    const candidate = await backups.create('snapshot.sqlite')
    new ExportService(lifecycle.database).importJson(fixtureDocument('After'))
    const originalReplace = lifecycle.replaceDatabase
    let shouldFail = true
    lifecycle.replaceDatabase = (database) => {
      if (shouldFail) {
        shouldFail = false
        throw new Error('injected swap failure')
      }
      originalReplace(database)
    }

    expect(() => backups.restore(candidate)).toThrow()
    expect(new ExportService(lifecycle.database).exportJson().projects[0]?.name)
      .toBe('After')
    lifecycle.database.close()
  })

  it('prevents backup traversal, active overwrite, and accidental overwrite', async () => {
    const databasePath = join(temporaryDirectory, 'active.sqlite')
    const lifecycle = createLifecycle(databasePath)
    const backups = new BackupService(
      lifecycle,
      join(temporaryDirectory, 'backups'),
    )

    await expect(backups.create('../escape.sqlite')).rejects.toMatchObject({
      code: 'BACKUP_PATH_INVALID',
    })
    await expect(backups.create(databasePath)).rejects.toMatchObject({
      code: 'BACKUP_PATH_INVALID',
    })
    await backups.create('once.sqlite')
    await expect(backups.create('once.sqlite')).rejects.toMatchObject({
      code: 'BACKUP_PATH_INVALID',
    })
    lifecycle.database.close()
  })

  it('rejects a backup destination that escapes through a directory link', async ({
    skip,
  }) => {
    const databasePath = join(temporaryDirectory, 'active.sqlite')
    const backupRoot = join(temporaryDirectory, 'backups')
    const outside = join(temporaryDirectory, 'outside')
    const linkedDirectory = join(backupRoot, 'linked')
    mkdirSync(backupRoot)
    mkdirSync(outside)
    try {
      symlinkSync(outside, linkedDirectory, process.platform === 'win32'
        ? 'junction'
        : 'dir')
    } catch {
      skip()
      return
    }
    const lifecycle = createLifecycle(databasePath)
    const backups = new BackupService(lifecycle, backupRoot)

    await expect(backups.create('linked/escape.sqlite')).rejects.toMatchObject({
      code: 'BACKUP_PATH_INVALID',
    })
    expect(existsSync(join(outside, 'escape.sqlite'))).toBe(false)
    lifecycle.database.close()
  })

  it('rejects a restore candidate that is itself a symbolic link', async ({
    skip,
  }) => {
    const databasePath = join(temporaryDirectory, 'active.sqlite')
    const backupRoot = join(temporaryDirectory, 'backups')
    const lifecycle = createLifecycle(databasePath)
    const backups = new BackupService(lifecycle, backupRoot)
    const candidate = await backups.create('candidate.sqlite')
    const linkedCandidate = join(temporaryDirectory, 'linked-candidate.sqlite')
    try {
      symlinkSync(candidate, linkedCandidate, 'file')
    } catch {
      lifecycle.database.close()
      skip()
      return
    }

    expect(() => backups.restore(linkedCandidate)).toThrowError(
      expect.objectContaining({ code: 'BACKUP_PATH_INVALID' }),
    )
    lifecycle.database.close()
  })

  it('seeds only an entirely empty database and is idempotent', () => {
    const database = openDatabase(join(temporaryDirectory, 'seed.sqlite'))
    const document = fixtureDocument()

    expect(seedDatabase(database, document)).toBe(true)
    expect(seedDatabase(database, document)).toBe(false)
    expect(new ExportService(database).exportJson().tasks).toHaveLength(1)
    database.close()
  })

  it('does not partially seed when any primary table already has data', () => {
    const database = openDatabase(join(temporaryDirectory, 'seed.sqlite'))
    insertOwner(database, 'existing')

    expect(seedDatabase(database, fixtureDocument())).toBe(false)
    expect(database.prepare('SELECT COUNT(*) AS count FROM projects').get())
      .toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM actors').get())
      .toEqual({ count: 1 })
    database.close()
  })

  it('does not seed over settings, tokens, or activity audit anchors', () => {
    const cases = [
      {
        name: 'settings',
        prepare(database: DatabaseSync) {
          database.prepare(`
            INSERT INTO settings (key, value_json, updated_at, version)
            VALUES ('app', ?, ?, 7)
          `).run(JSON.stringify({
            theme: 'dark',
            background: 'solid',
            accent: 'purple',
            density: 'compact',
          }), timestamp)
        },
      },
      {
        name: 'token',
        prepare(database: DatabaseSync) {
          database.prepare(`
            INSERT INTO access_tokens (
              id, name, token_hash, created_at, last_used_at, revoked_at, version
            ) VALUES ('token_existing', 'existing', 'digest', ?, NULL, NULL, 1)
          `).run(timestamp)
        },
      },
      {
        name: 'activity',
        prepare(database: DatabaseSync) {
          insertOwner(database, 'activity_actor')
          database.prepare(`
            INSERT INTO activities (
              id, actor_id, project_id, source, operation, entity_type,
              entity_id, action, note, details_json, created_at
            ) VALUES (
              'activity_existing', 'activity_actor', NULL, 'web',
              'actor.create', 'actor', 'activity_actor', 'Existing',
              NULL, '{}', ?
            )
          `).run(timestamp)
        },
      },
    ]

    for (const testCase of cases) {
      const database = openDatabase(
        join(temporaryDirectory, `seed-${testCase.name}.sqlite`),
      )
      testCase.prepare(database)
      expect(seedDatabase(database, fixtureDocument())).toBe(false)
      expect(database.prepare('SELECT COUNT(*) AS count FROM projects').get())
        .toEqual({ count: 0 })
      if (testCase.name === 'settings') {
        expect(database.prepare(
          "SELECT version FROM settings WHERE key = 'app'",
        ).get()).toEqual({ version: 7 })
      }
      if (testCase.name === 'token') {
        expect(database.prepare(
          "SELECT name FROM access_tokens WHERE id = 'token_existing'",
        ).get()).toEqual({ name: 'existing' })
      }
      database.close()
    }
  })

  it('adapts legacy fixtures into a default project without browser imports', () => {
    const legacyActor = { id: 'human-lin', name: 'Lin', kind: 'human' as const }
    const document = createLegacyFixtureSeedDocument({
      actors: { lin: legacyActor },
      tasks: [{
        id: 'task-1',
        code: 'TASK-1',
        title: 'Legacy',
        description: '',
        assignee: legacyActor,
        startDate: '2026-07-01',
        dueDate: '2026-07-02',
        priority: 'P1',
        status: 'not_started',
        progress: 0,
        milestoneId: '',
        dependencyIds: [],
      }],
      requirements: [],
      defects: [],
    })

    expect(document.projects).toHaveLength(1)
    expect(document.tasks[0]).toMatchObject({
      projectId: document.projects[0]?.id,
      assigneeId: legacyActor.id,
    })
    expect('activities' in document).toBe(false)
    expect('risks' in document).toBe(false)
  })

  it('accepts the typed legacy fixture directly at the seed boundary', () => {
    const database = openDatabase(join(temporaryDirectory, 'legacy-seed.sqlite'))
    const legacyActor = { id: 'human-lin', name: 'Lin', kind: 'human' as const }

    expect(seedDatabase(database, {
      actors: { lin: legacyActor },
      tasks: [],
      requirements: [],
      defects: [],
    })).toBe(true)
    expect(new ExportService(database).exportJson().projects).toHaveLength(1)
    database.close()
  })

  it('reports malformed legacy seed input as a stable import error', () => {
    const database = openDatabase(join(temporaryDirectory, 'bad-seed.sqlite'))

    expect(() => seedDatabase(database, {
      actors: {},
      tasks: [],
      requirements: [],
      defects: [],
    })).toThrowError(expect.objectContaining({ code: 'IMPORT_INVALID' }))
    database.close()
  })

  it('does not expose SQLite errors when a seed violates storage constraints', () => {
    const database = openDatabase(
      join(temporaryDirectory, 'constraint-seed.sqlite'),
    )

    expect(() => seedDatabase(database, {
      actors: {
        one: {
          id: 'agent-one',
          name: 'builder',
          kind: 'agent',
          role: 'dev-agent',
          client: 'codex',
        },
        two: {
          id: 'agent-two',
          name: 'builder',
          kind: 'agent',
          role: 'dev-agent',
          client: 'codex',
        },
      },
      tasks: [],
      requirements: [],
      defects: [],
    })).toThrowError(expect.objectContaining({ code: 'IMPORT_INVALID' }))
    expect(database.prepare('SELECT COUNT(*) AS count FROM actors').get())
      .toEqual({ count: 0 })
    database.close()
  })

  it('wraps public validation failures in stable domain errors', () => {
    const database = openDatabase(join(temporaryDirectory, 'errors.sqlite'))

    expect(() => new ExportService(database).importJson(null))
      .toThrowError(expect.objectContaining({ code: 'IMPORT_INVALID' }))
    expect(() => new SettingsService(database).update(
      null as never,
      'actor_owner',
      'web',
    )).toThrowError(DomainError)
    database.close()
  })
})
