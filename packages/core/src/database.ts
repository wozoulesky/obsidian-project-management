import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from './migrations.js'

const memoryDatabasePath = ':memory:'

export function openDatabase(path: string): DatabaseSync {
  const isMemoryDatabase = path === memoryDatabasePath

  if (!isMemoryDatabase) {
    mkdirSync(dirname(resolve(path)), { recursive: true })
  }

  const database = new DatabaseSync(path)

  try {
    database.exec('PRAGMA foreign_keys = ON')
    database.exec('PRAGMA busy_timeout = 5000')

    if (!isMemoryDatabase) {
      database.prepare('PRAGMA journal_mode = WAL').get()
    }

    runMigrations(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

export function createTestDatabase(): DatabaseSync {
  return openDatabase(memoryDatabasePath)
}
