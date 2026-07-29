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
