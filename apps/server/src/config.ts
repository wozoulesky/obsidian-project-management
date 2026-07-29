import { fileURLToPath } from 'node:url'
import { isAbsolute, resolve } from 'node:path'
import { isIP } from 'node:net'

const defaultRepositoryRoot = resolve(
  fileURLToPath(new URL('../../../', import.meta.url)),
)

export type ServerConfig = {
  host: string
  allowedHosts?: readonly string[]
  allowedOrigins?: readonly string[]
  port: number
  databasePath: string
  backupRoot: string
  localActorId?: string
}

type Environment = Record<string, string | undefined>

function configurationError(field: string): Error {
  return new Error(`Invalid server configuration: ${field}`)
}

function commaSeparated(
  value: string | undefined,
): string[] {
  return value === undefined
    ? []
    : [...new Set(value.split(',').map((item) => item.trim()))]
}

function validAuthority(authority: string): boolean {
  const ipv6 = /^\[([0-9A-Fa-f:]+)\](?::(\d{1,5}))?$/.exec(authority)
  if (ipv6 !== null) {
    const port = ipv6[2]
    return isIP(ipv6[1]!) === 6
      && (port === undefined || Number(port) <= 65_535)
  }
  const hostname = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(authority)
  if (hostname === null || hostname[1]?.includes('..')) {
    return false
  }
  const port = hostname[2]
  return port === undefined || Number(port) <= 65_535
}

function validOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.origin === origin
    )
  } catch {
    return false
  }
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
  if (
    host.trim() !== host
    || host.length === 0
    || (
      isIP(host) === 0
      && !/^[A-Za-z0-9.-]+$/.test(host)
    )
  ) {
    throw configurationError('PROJECT_OS_HOST')
  }
  const allowedHosts = commaSeparated(
    environment.PROJECT_OS_ALLOWED_HOSTS,
  )
  if (
    allowedHosts.some((authority) => !validAuthority(authority))
    || (
      host !== '127.0.0.1'
      && host !== '::1'
      && host.toLowerCase() !== 'localhost'
      && allowedHosts.length === 0
    )
  ) {
    throw configurationError('PROJECT_OS_ALLOWED_HOSTS')
  }
  const allowedOrigins = commaSeparated(
    environment.PROJECT_OS_ALLOWED_ORIGINS,
  )
  if (allowedOrigins.some((origin) => !validOrigin(origin))) {
    throw configurationError('PROJECT_OS_ALLOWED_ORIGINS')
  }

  const portText = environment.PROJECT_OS_PORT ?? '4310'
  if (!/^\d+$/.test(portText)) {
    throw configurationError('PROJECT_OS_PORT')
  }
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw configurationError('PROJECT_OS_PORT')
  }

  const localActorId = environment.PROJECT_OS_LOCAL_ACTOR_ID
    ?? 'actor_local_owner'
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(localActorId)
  ) {
    throw configurationError('PROJECT_OS_LOCAL_ACTOR_ID')
  }

  return {
    host,
    allowedHosts,
    allowedOrigins,
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
    localActorId,
  }
}
