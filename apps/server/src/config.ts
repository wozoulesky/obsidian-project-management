import { fileURLToPath } from 'node:url'
import { isAbsolute, resolve } from 'node:path'

const defaultRepositoryRoot = resolve(
  fileURLToPath(new URL('../../../', import.meta.url)),
)

export type ServerConfig = {
  host: '127.0.0.1' | '::1'
  port: number
  databasePath: string
  backupRoot: string
}

type Environment = Record<string, string | undefined>

function configurationError(field: string): Error {
  return new Error(`Invalid server configuration: ${field}`)
}

function storagePath(
  value: string | undefined,
  fallback: string,
  repositoryRoot: string,
  field: string,
): string {
  const selected = value ?? fallback
  if (selected.trim().length === 0) {
    throw configurationError(field)
  }
  return isAbsolute(selected)
    ? resolve(selected)
    : resolve(repositoryRoot, selected)
}

export function loadConfig(
  environment: Environment = process.env,
  repositoryRoot = defaultRepositoryRoot,
): ServerConfig {
  const host = environment.PROJECT_OS_HOST ?? '127.0.0.1'
  if (host !== '127.0.0.1' && host !== '::1') {
    throw configurationError('PROJECT_OS_HOST')
  }

  const portText = environment.PROJECT_OS_PORT ?? '4310'
  if (!/^\d+$/.test(portText)) {
    throw configurationError('PROJECT_OS_PORT')
  }
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw configurationError('PROJECT_OS_PORT')
  }

  return {
    host,
    port,
    databasePath: storagePath(
      environment.PROJECT_OS_DATABASE_PATH,
      'data/project_manage.db',
      repositoryRoot,
      'PROJECT_OS_DATABASE_PATH',
    ),
    backupRoot: storagePath(
      environment.PROJECT_OS_BACKUP_ROOT,
      'data/backups',
      repositoryRoot,
      'PROJECT_OS_BACKUP_ROOT',
    ),
  }
}
