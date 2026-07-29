import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs'
import {
  dirname,
  isAbsolute,
  parse,
  relative,
  resolve,
} from 'node:path'
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

export type BackupServiceOptions = {
  beforePublish?: (destination: string) => void
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

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

function pathExistsWithoutFollowing(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function assertNoLinkComponents(path: string): void {
  const absolute = resolve(path)
  const root = parse(absolute).root
  const parts = relative(root, absolute).split(/[\\/]/).filter(Boolean)
  let current = root

  for (const part of parts) {
    current = resolve(current, part)
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw pathInvalid()
      }
    } catch (error) {
      if (error instanceof DomainError) {
        throw error
      }
      if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === 'ENOENT'
      ) {
        continue
      }
      throw pathInvalid()
    }
  }
}

function ensureSafeDirectory(root: string, directory: string): void {
  const pathFromRoot = relative(root, directory)
  if (
    pathFromRoot.startsWith('..')
    || isAbsolute(pathFromRoot)
  ) {
    throw pathInvalid()
  }

  let current = root
  const parts = pathFromRoot.split(/[\\/]/).filter(Boolean)
  for (const part of parts) {
    current = resolve(current, part)
    if (!pathExistsWithoutFollowing(current)) {
      try {
        mkdirSync(current)
      } catch {
        throw pathInvalid()
      }
    }
    let status
    try {
      status = lstatSync(current)
    } catch {
      throw pathInvalid()
    }
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw pathInvalid()
    }
    let real
    try {
      real = realpathSync(current)
    } catch {
      throw pathInvalid()
    }
    if (!samePath(real, current) || !isWithin(root, real)) {
      throw pathInvalid()
    }
  }
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

function validateCandidate(
  path: string,
  runtimeVersions: number[],
  actorId?: string,
): void {
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

    if (actorId !== undefined) {
      const actor = candidate.prepare(`
        SELECT kind, status
        FROM actors
        WHERE id = ?
      `).get(actorId) as {
        kind: string
        status: string
      } | undefined
      if (actor?.kind !== 'human' || actor.status !== 'active') {
        throw backupInvalid()
      }
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
    private readonly options: BackupServiceOptions = {},
  ) {
    this.activePath = resolve(lifecycle.databasePath)
    const requestedRoot = resolve(backupDirectory)
    assertNoLinkComponents(requestedRoot)
    try {
      mkdirSync(requestedRoot, { recursive: true })
    } catch {
      throw pathInvalid()
    }
    assertNoLinkComponents(requestedRoot)
    try {
      this.root = realpathSync(requestedRoot)
    } catch {
      throw pathInvalid()
    }
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
      || samePath(destination, this.activePath)
      || pathExistsWithoutFollowing(destination)
    ) {
      throw pathInvalid()
    }
    ensureSafeDirectory(this.root, dirname(destination))
    assertNoLinkComponents(dirname(destination))
    let staging: string | undefined
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = resolve(
        dirname(destination),
        `.project-os-backup-${randomUUID()}.sqlite`,
      )
      if (!pathExistsWithoutFollowing(candidate)) {
        staging = candidate
        break
      }
    }
    if (staging === undefined) {
      throw new DomainError(
        'BACKUP_CREATE_FAILED',
        'Backup could not be created',
      )
    }

    let published = false
    try {
      await backup(this.lifecycle.getDatabase(), staging)
      assertNoLinkComponents(dirname(destination))
      assertNoLinkComponents(staging)
      if (
        !lstatSync(staging).isFile()
        || !samePath(realpathSync(dirname(destination)), dirname(destination))
      ) {
        throw pathInvalid()
      }
      this.options.beforePublish?.(destination)
      assertNoLinkComponents(dirname(destination))
      assertNoLinkComponents(staging)
      if (
        !lstatSync(staging).isFile()
        || !samePath(realpathSync(dirname(destination)), dirname(destination))
      ) {
        throw pathInvalid()
      }
      linkSync(staging, destination)
      published = true
      removeGenerated(staging)
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
    } catch (error) {
      removeGenerated(staging)
      if (published) {
        removeGenerated(destination)
      }
      if (error instanceof DomainError) {
        throw error
      }
      if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === 'EEXIST'
      ) {
        throw pathInvalid()
      }
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
    if (!pathExistsWithoutFollowing(candidate)) {
      throw backupInvalid()
    }
    try {
      assertNoLinkComponents(candidate)
      const status = lstatSync(candidate)
      const realCandidate = realpathSync(candidate)
      if (
        status.isSymbolicLink()
        || !status.isFile()
        || samePath(realCandidate, realpathSync(this.activePath))
      ) {
        throw pathInvalid()
      }
    } catch (error) {
      if (error instanceof DomainError) {
        throw error
      }
      throw pathInvalid()
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
      validateCandidate(staging, runtimeVersions, actorId)
    } catch {
      for (const path of generatedPaths) {
        removeGenerated(path)
      }
      throw backupInvalid()
    }

    let replacement: DatabaseSync | undefined
    let replacementAccepted = false
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
      replacementAccepted = true
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
      if (replacement !== undefined) {
        if (replacementAccepted) {
          try {
            this.lifecycle.closeDatabase()
          } catch {
            try {
              replacement.close()
            } catch {
              // Continue with restoring the original file.
            }
          }
        } else {
          try {
            replacement.close()
          } catch {
            // Continue with restoring the original file.
          }
        }
      }

      let original: DatabaseSync | undefined
      let originalAccepted = false
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
        original = openDatabase(this.activePath)
        this.lifecycle.replaceDatabase(original)
        originalAccepted = true
      } catch {
        if (original !== undefined && !originalAccepted) {
          try {
            original.close()
          } catch {
            // Preserve the stable restore failure.
          }
        }
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
