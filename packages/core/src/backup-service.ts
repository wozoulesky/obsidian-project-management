import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import {
  backup,
  DatabaseSync,
} from 'node:sqlite'
import type { ActivitySource } from '@project-os/contracts'
import { recordActivity, withImmediateTransaction } from './activity-service.js'
import { openDatabase } from './database.js'
import { DomainError } from './errors.js'
import { ExportService, validateExportDocument } from './export-service.js'

const requiredTables = [
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
] as const

export type DatabaseLifecycle = {
  databasePath: string
  getDatabase(): DatabaseSync
  closeDatabase(): void
  replaceDatabase(database: DatabaseSync): void
}

function backupInvalid(): DomainError {
  return new DomainError('BACKUP_INVALID', 'Backup is invalid')
}

function pathInvalid(): DomainError {
  return new DomainError(
    'BACKUP_PATH_INVALID',
    'Backup destination is invalid',
  )
}

function restoreFailed(): DomainError {
  return new DomainError(
    'BACKUP_RESTORE_FAILED',
    'Backup restore could not be completed',
  )
}

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child)
  return pathFromParent !== ''
    && !pathFromParent.startsWith('..')
    && !isAbsolute(pathFromParent)
}

function removeGenerated(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // Best-effort cleanup must not mask the primary result.
  }
}

function moveIfExists(from: string, to: string): void {
  if (existsSync(from)) {
    renameSync(from, to)
  }
}

function migrationVersions(database: DatabaseSync): number[] {
  return (database.prepare(`
    SELECT version
    FROM schema_migrations
    ORDER BY version
  `).all() as { version: number }[]).map(({ version }) => version)
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function validateCandidate(path: string, runtimeVersions: number[]): void {
  let candidate: DatabaseSync | undefined
  try {
    candidate = new DatabaseSync(path, { readOnly: true })
    candidate.exec('PRAGMA foreign_keys = ON')
    const integrityRows = candidate.prepare('PRAGMA integrity_check').all() as {
      integrity_check: string
    }[]
    if (
      integrityRows.length !== 1
      || integrityRows[0]?.integrity_check !== 'ok'
    ) {
      throw backupInvalid()
    }

    const tables = candidate.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name
    `).all() as { name: string }[]
    const names = new Set(tables.map(({ name }) => name))
    if (requiredTables.some((table) => !names.has(table))) {
      throw backupInvalid()
    }

    const candidateVersions = migrationVersions(candidate)
    if (!sameNumbers(candidateVersions, runtimeVersions)) {
      throw backupInvalid()
    }

    validateExportDocument(new ExportService(candidate).exportJson())
    const foreignKeyViolations = candidate
      .prepare('PRAGMA foreign_key_check')
      .all()
    if (foreignKeyViolations.length !== 0) {
      throw backupInvalid()
    }
  } catch {
    throw backupInvalid()
  } finally {
    try {
      candidate?.close()
    } catch {
      // The stable validation error is more useful than a close failure.
    }
  }
}

export class BackupService {
  private readonly activePath: string
  private readonly root: string

  constructor(
    private readonly lifecycle: DatabaseLifecycle,
    backupDirectory: string,
  ) {
    this.activePath = resolve(lifecycle.databasePath)
    this.root = resolve(backupDirectory)
  }

  async create(
    filename: string,
    actorId?: string,
    source: ActivitySource = 'web',
  ): Promise<string> {
    if (
      typeof filename !== 'string'
      || filename.length === 0
      || isAbsolute(filename)
    ) {
      throw pathInvalid()
    }
    const destination = resolve(this.root, filename)
    if (
      !isWithin(this.root, destination)
      || destination === this.activePath
      || existsSync(destination)
    ) {
      throw pathInvalid()
    }
    mkdirSync(dirname(destination), { recursive: true })

    try {
      await backup(this.lifecycle.getDatabase(), destination)
      if (actorId !== undefined) {
        withImmediateTransaction(this.lifecycle.getDatabase(), () => {
          recordActivity(this.lifecycle.getDatabase(), {
            actorId,
            source,
            operation: 'backup.create',
            entityType: 'backup',
            entityId: 'snapshot',
            action: 'Created a database backup',
          })
        })
      }
      return destination
    } catch {
      removeGenerated(destination)
      throw new DomainError(
        'BACKUP_CREATE_FAILED',
        'Backup could not be created',
      )
    }
  }

  restore(
    candidatePath: string,
    actorId?: string,
    source: ActivitySource = 'web',
  ): DatabaseSync {
    if (typeof candidatePath !== 'string' || candidatePath.length === 0) {
      throw backupInvalid()
    }
    const candidate = resolve(candidatePath)
    if (candidate === this.activePath || !existsSync(candidate)) {
      throw backupInvalid()
    }

    const nonce = randomUUID()
    const staging = resolve(
      dirname(this.activePath),
      `.project-os-restore-${nonce}.sqlite`,
    )
    const rollback = resolve(
      dirname(this.activePath),
      `.project-os-rollback-${nonce}.sqlite`,
    )
    const displaced = resolve(
      dirname(this.activePath),
      `.project-os-displaced-${nonce}.sqlite`,
    )
    const generatedPaths = [
      staging,
      `${staging}-wal`,
      `${staging}-shm`,
      rollback,
      `${rollback}-wal`,
      `${rollback}-shm`,
      displaced,
      `${displaced}-wal`,
      `${displaced}-shm`,
    ]

    try {
      copyFileSync(candidate, staging)
      const runtimeVersions = migrationVersions(this.lifecycle.getDatabase())
      validateCandidate(staging, runtimeVersions)
    } catch {
      for (const path of generatedPaths) {
        removeGenerated(path)
      }
      throw backupInvalid()
    }

    let replacement: DatabaseSync | undefined
    try {
      this.lifecycle.getDatabase()
        .prepare('PRAGMA wal_checkpoint(TRUNCATE)')
        .get()
      this.lifecycle.closeDatabase()

      renameSync(this.activePath, rollback)
      moveIfExists(`${this.activePath}-wal`, `${rollback}-wal`)
      moveIfExists(`${this.activePath}-shm`, `${rollback}-shm`)
      renameSync(staging, this.activePath)

      replacement = openDatabase(this.activePath)
      this.lifecycle.replaceDatabase(replacement)
      if (actorId !== undefined) {
        withImmediateTransaction(replacement, () => {
          recordActivity(replacement!, {
            actorId,
            source,
            operation: 'backup.restore',
            entityType: 'backup',
            entityId: 'snapshot',
            action: 'Restored a database backup',
          })
        })
      }

      removeGenerated(rollback)
      removeGenerated(`${rollback}-wal`)
      removeGenerated(`${rollback}-shm`)
      return replacement
    } catch {
      try {
        replacement?.close()
      } catch {
        // Continue with restoring the original file.
      }

      try {
        if (existsSync(rollback)) {
          if (existsSync(this.activePath)) {
            renameSync(this.activePath, displaced)
          }
          moveIfExists(`${this.activePath}-wal`, `${displaced}-wal`)
          moveIfExists(`${this.activePath}-shm`, `${displaced}-shm`)
          renameSync(rollback, this.activePath)
          moveIfExists(`${rollback}-wal`, `${this.activePath}-wal`)
          moveIfExists(`${rollback}-shm`, `${this.activePath}-shm`)
        }
        const original = openDatabase(this.activePath)
        this.lifecycle.replaceDatabase(original)
      } catch {
        throw restoreFailed()
      } finally {
        for (const path of generatedPaths) {
          removeGenerated(path)
        }
      }
      throw restoreFailed()
    } finally {
      removeGenerated(staging)
      removeGenerated(`${staging}-wal`)
      removeGenerated(`${staging}-shm`)
    }
  }
}
