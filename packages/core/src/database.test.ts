import {
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDatabase, openDatabase } from './database.js'
import { DomainError } from './errors.js'
import { runMigrations } from './migrations.js'

const approvedTables = [
  'access_tokens',
  'activities',
  'actors',
  'defects',
  'project_members',
  'projects',
  'requirement_tasks',
  'requirements',
  'schema_migrations',
  'settings',
  'tasks',
]

function insertActor(
  database: DatabaseSync,
  {
    id = 'actor-1',
    registeredAt = '2026-07-29T08:00:00.000Z',
    lastActiveAt = null,
  }: {
    id?: string
    registeredAt?: string
    lastActiveAt?: string | null
  } = {},
): void {
  database
    .prepare(`
      INSERT INTO actors (
        id, name, kind, role, status, client, capabilities_json,
        registered_at, last_active_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      'Lin',
      'human',
      'owner',
      'active',
      null,
      '[]',
      registeredAt,
      lastActiveAt,
      1,
    )
}

function insertProject(
  database: DatabaseSync,
  {
    id = 'project-1',
    startDate = '2026-07-29',
    dueDate = '2026-08-31',
    createdAt = '2026-07-29T08:00:00.000Z',
    updatedAt = '2026-07-29T08:00:00Z',
  }: {
    id?: string
    startDate?: string | null
    dueDate?: string | null
    createdAt?: string
    updatedAt?: string
  } = {},
): void {
  database
    .prepare(`
      INSERT INTO projects (
        id, code, name, description, owner_id, start_date, due_date,
        status, progress, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      `PRJ-${id}`,
      'Atlas',
      '',
      'actor-1',
      startDate,
      dueDate,
      'not_started',
      0,
      createdAt,
      updatedAt,
      1,
    )
}

function insertTask(
  database: DatabaseSync,
  {
    id = 'task-1',
    startDate = '2026-07-29',
    dueDate = '2026-08-01',
    createdAt = '2026-07-29T08:00:00Z',
    updatedAt = '2026-07-29T08:00:00.000Z',
  }: {
    id?: string
    startDate?: string
    dueDate?: string
    createdAt?: string
    updatedAt?: string
  } = {},
): void {
  database
    .prepare(`
      INSERT INTO tasks (
        id, code, project_id, title, description, assignee_id,
        start_date, due_date, priority, status, progress, milestone_id,
        dependency_ids_json, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      `TASK-${id}`,
      'project-1',
      'Implement canonical dates',
      '',
      'actor-1',
      startDate,
      dueDate,
      'P1',
      'not_started',
      0,
      'm1',
      '[]',
      createdAt,
      updatedAt,
      1,
    )
}

describe('database bootstrap', () => {
  const opened: DatabaseSync[] = []
  const temporaryDirectories: string[] = []

  afterEach(() => {
    opened.splice(0).forEach((database) => database.close())
    temporaryDirectories.splice(0).forEach((directory) => {
      rmSync(directory, { force: true, recursive: true })
    })
  })

  it('enables safety pragmas and creates every approved table', () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'project-os-memory-'))
    temporaryDirectories.push(workingDirectory)
    const originalDirectory = process.cwd()
    process.chdir(workingDirectory)

    let database: DatabaseSync
    try {
      database = createTestDatabase()
    } finally {
      process.chdir(originalDirectory)
    }
    opened.push(database)

    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    })
    expect(database.prepare('PRAGMA journal_mode').get()).toEqual({
      journal_mode: 'memory',
    })
    expect(existsSync(join(workingDirectory, 'data'))).toBe(false)

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)

    expect(tables).toEqual(expect.arrayContaining(approvedTables))
  })

  it('creates parent directories and configures file databases for WAL', () => {
    const directory = mkdtempSync(join(tmpdir(), 'project-os-file-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'nested', 'project-os.sqlite')

    const database = openDatabase(databasePath)
    opened.push(database)

    expect(existsSync(databasePath)).toBe(true)
    expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    })
    expect(database.prepare('PRAGMA busy_timeout').get()).toEqual({
      timeout: 5000,
    })
    expect(database.prepare('PRAGMA journal_mode').get()).toEqual({
      journal_mode: 'wal',
    })
  })

  it('applies migration 001 only once', () => {
    const database = createTestDatabase()
    opened.push(database)

    runMigrations(database)
    runMigrations(database)

    expect(
      database
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all(),
    ).toEqual([{ version: 1 }])
  })

  it('enforces foreign keys', () => {
    const database = createTestDatabase()
    opened.push(database)

    expect(() => {
      database
        .prepare(`
          INSERT INTO projects (
            id, code, name, description, owner_id, status, progress,
            created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          'project-1',
          'PRJ-001',
          'Atlas',
          '',
          'missing-actor',
          'not_started',
          0,
          '2026-07-29T00:00:00.000Z',
          '2026-07-29T00:00:00.000Z',
          1,
        )
    }).toThrow(/foreign key constraint failed/i)
  })
})

describe('canonical SQLite dates', () => {
  const opened: DatabaseSync[] = []

  afterEach(() => {
    opened.splice(0).forEach((database) => database.close())
  })

  it.each(['not-a-date', '2026-02-30'])(
    'rejects %s in project and task date fields',
    (invalidDate) => {
      const database = createTestDatabase()
      opened.push(database)
      insertActor(database)

      expect(() => {
        insertProject(database, { startDate: invalidDate })
      }).toThrow(/check constraint failed/i)

      insertProject(database)

      expect(() => {
        insertTask(database, { startDate: invalidDate })
      }).toThrow(/check constraint failed/i)
    },
  )

  it.each([
    'garbageZ',
    '2026-07-29T08:00:00+08:00',
  ])('rejects non-canonical UTC timestamp %s on inserts and updates', (value) => {
    const database = createTestDatabase()
    opened.push(database)

    expect(() => {
      insertActor(database, { id: 'invalid-actor', registeredAt: value })
    }).toThrow(/check constraint failed/i)

    insertActor(database)

    expect(() => {
      database
        .prepare('UPDATE actors SET last_active_at = ? WHERE id = ?')
        .run(value, 'actor-1')
    }).toThrow(/check constraint failed/i)
  })

  it('rejects a malformed migration timestamp', () => {
    const database = createTestDatabase()
    opened.push(database)

    expect(() => {
      database
        .prepare(`
          INSERT INTO schema_migrations (version, applied_at)
          VALUES (?, ?)
        `)
        .run(2, 'garbageZ')
    }).toThrow(/check constraint failed/i)
  })

  it('accepts canonical dates and UTC timestamps with or without milliseconds', () => {
    const database = createTestDatabase()
    opened.push(database)

    insertActor(database, {
      registeredAt: '2026-07-29T08:00:00.123Z',
      lastActiveAt: '2026-07-29T08:00:01Z',
    })
    insertProject(database, {
      startDate: '2026-07-29',
      dueDate: '2026-08-31',
      createdAt: '2026-07-29T08:00:00Z',
      updatedAt: '2026-07-29T08:00:00.123Z',
    })
    insertTask(database, {
      startDate: '2026-07-30',
      dueDate: '2026-08-01',
      createdAt: '2026-07-29T08:00:01.123Z',
      updatedAt: '2026-07-29T08:00:02Z',
    })

    expect(
      database.prepare('SELECT COUNT(*) AS count FROM tasks').get(),
    ).toEqual({ count: 1 })
  })
})

describe('DomainError', () => {
  it('preserves its stable public shape and Error prototype', () => {
    const details = { currentVersion: 2 }
    const error = new DomainError('VERSION_CONFLICT', 'Version is stale', details)

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(DomainError)
    expect(error.name).toBe('DomainError')
    expect(error.code).toBe('VERSION_CONFLICT')
    expect(error.message).toBe('Version is stale')
    expect(error.details).toBe(details)
  })
})
