import { randomUUID } from 'node:crypto'
import {
  DomainError,
} from '@project-os/core'
import express from 'express'
import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
  Router,
} from 'express'
import { ZodError } from 'zod'
import type { AppContext } from './context.js'
import { errorEnvelope, successEnvelope } from './envelope.js'
import { actorRoutes } from './routes/actors.js'
import { projectRoutes } from './routes/projects.js'
import { taskRoutes } from './routes/tasks.js'

const apiPrefix = '/api/v1'
const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/
const safeDetailKeys = new Set([
  'actorId',
  'assigneeId',
  'actualVersion',
  'client',
  'currentVersion',
  'cursor',
  'defectId',
  'dependencyId',
  'dueDate',
  'entityId',
  'expectedProjectId',
  'expectedVersion',
  'fromStatus',
  'limit',
  'name',
  'operation',
  'parentId',
  'projectId',
  'requirementId',
  'role',
  'startDate',
  'taskId',
  'toStatus',
  'tokenId',
])

const publicDomainStatuses: Readonly<Record<string, number>> = {
  ACTIVITY_CURSOR_INVALID: 400,
  ACTOR_CLIENT_INVALID: 400,
  ACTOR_INACTIVE: 400,
  ACTOR_KIND_INVALID: 400,
  BACKUP_INVALID: 400,
  BACKUP_PATH_INVALID: 400,
  DASHBOARD_ACTIVITY_LIMIT_INVALID: 400,
  IMPORT_INVALID: 400,
  INPUT_INVALID: 400,
  PROJECT_DATE_INVALID: 400,
  PROJECT_DATE_RANGE_INVALID: 400,
  PAGINATION_CURSOR_INVALID: 400,
  REQUIREMENT_PROJECT_MISMATCH: 400,
  SETTINGS_INVALID: 400,
  TASK_ASSIGNEE_MISMATCH: 400,
  TASK_DATE_INVALID: 400,
  TASK_DATE_RANGE_INVALID: 400,
  TASK_DEPENDENCY_INVALID: 400,
  TASK_PROJECT_MISMATCH: 400,
  TASK_REFERENCE_INVALID: 400,
  AUTHENTICATION_REQUIRED: 401,
  TOKEN_INVALID: 401,
  TOKEN_REQUIRED: 401,
  HOST_FORBIDDEN: 403,
  ORIGIN_FORBIDDEN: 403,
  PERMISSION_DENIED: 403,
  ACTOR_NOT_FOUND: 404,
  DEFECT_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  REQUIREMENT_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  TOKEN_NOT_FOUND: 404,
  ACTOR_IDENTITY_CONFLICT: 409,
  ACTOR_NAME_CONFLICT: 409,
  ACTOR_VERSION_CONFLICT: 409,
  DEFECT_VERSION_CONFLICT: 409,
  PROJECT_VERSION_CONFLICT: 409,
  REQUIREMENT_VERSION_CONFLICT: 409,
  SETTINGS_VERSION_CONFLICT: 409,
  TASK_VERSION_CONFLICT: 409,
  TOKEN_VERSION_CONFLICT: 409,
  VERSION_CONFLICT: 409,
}

const internalDomainPolicies: Readonly<Record<string, {
  status: number
  code: string
  message: string
}>> = {
  BACKUP_CREATE_FAILED: {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  },
  SETTINGS_UPDATE_FAILED: {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  },
  TOKEN_ISSUE_FAILED: {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  },
  TOKEN_REVOKE_FAILED: {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  },
  BACKUP_RESTORE_FAILED: {
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'Service is unavailable',
  },
  DATABASE_MIGRATIONS_INVALID: {
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'Service is unavailable',
  },
  DATABASE_SCHEMA_NEWER: {
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'Service is unavailable',
  },
  DATABASE_UNAVAILABLE: {
    status: 503,
    code: 'DATABASE_UNAVAILABLE',
    message: 'Database is unavailable',
  },
}

type RequestLocals = {
  requestId: string
}

export type AppRouteModule = {
  register(router: Router, getContext: () => AppContext): void
}

export type CreateAppOptions = {
  context: AppContext
  routeModules?: readonly AppRouteModule[]
}

type HttpError = Error & {
  status?: number
  type?: string
}

type ErrorResponse = {
  status: number
  code: string
  message: string
  details: Record<string, unknown>
}

function requestId(response: Response): string {
  return (response.locals as RequestLocals).requestId
}

function hasSensitiveText(value: string): boolean {
  return value.length > 500
    || /[\u0000-\u001F\u007F]/.test(value)
    || /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|PRAGMA|SQLITE)\b/i.test(value)
    || /[A-Za-z]:[\\/]|\/(?:Users|home|etc|var|tmp)\//i.test(value)
    || /\.[cm]?[jt]sx?:\d+(?::\d+)?/.test(value)
}

function safeMessage(message: string, status: number): string {
  if (!hasSensitiveText(message)) {
    return message
  }
  if (status === 400) {
    return 'Request is invalid'
  }
  if (status === 401) {
    return 'Authentication is required'
  }
  if (status === 403) {
    return 'Operation is forbidden'
  }
  if (status === 404) {
    return 'Resource was not found'
  }
  return 'Resource conflict'
}

function sanitizeDetailValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (
    value === null
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'string') {
    return hasSensitiveText(value) ? undefined : value
  }
  if (depth >= 5 || typeof value !== 'object') {
    return undefined
  }
  if (seen.has(value)) {
    return undefined
  }
  seen.add(value)
  if (Array.isArray(value)) {
    return value.slice(0, 100).flatMap((item) => {
      const sanitized = sanitizeDetailValue(item, seen, depth + 1)
      return sanitized === undefined ? [] : [sanitized]
    })
  }
  const sanitized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!safeDetailKeys.has(key)) {
      continue
    }
    const safeValue = sanitizeDetailValue(item, seen, depth + 1)
    if (safeValue !== undefined) {
      sanitized[key] = safeValue
    }
  }
  return sanitized
}

function safeDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeDetailValue(details, new WeakSet(), 0) as
    Record<string, unknown>
}

function mapError(error: unknown): ErrorResponse {
  if (error instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: {
        issues: error.issues.map(({ code, message, path }) => ({
          code,
          message,
          path,
        })),
      },
    }
  }

  if (error instanceof DomainError) {
    const internal = internalDomainPolicies[error.code]
    if (internal !== undefined) {
      return {
        ...internal,
        details: {},
      }
    }
    const status = publicDomainStatuses[error.code]
    if (status !== undefined) {
      return {
        status,
        code: error.code,
        message: safeMessage(error.message, status),
        details: safeDetails(error.details),
      }
    }
    return {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    }
  }

  if (
    error instanceof SyntaxError
    && (error as HttpError).type === 'entity.parse.failed'
  ) {
    return {
      status: 400,
      code: 'INVALID_JSON',
      message: 'Request body is not valid JSON',
      details: {},
    }
  }

  if (
    typeof error === 'object'
    && error !== null
    && (
      (error as HttpError).type === 'entity.too.large'
      || (error as HttpError).status === 413
    )
  ) {
    return {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body is too large',
      details: {},
    }
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    details: {},
  }
}

function validPort(port: string): boolean {
  if (!/^\d{1,5}$/.test(port)) {
    return false
  }
  const value = Number(port)
  return value >= 1 && value <= 65_535
}

function isLoopbackAuthority(authority: string): boolean {
  const ipv6 = /^\[::1\](?::([^:]+))?$/.exec(authority)
  if (ipv6 !== null) {
    return ipv6[1] === undefined || validPort(ipv6[1])
  }
  const hostname = /^(127\.0\.0\.1|localhost)(?::([^:]+))?$/i.exec(authority)
  if (hostname === null) {
    return false
  }
  return hostname[2] === undefined || validPort(hostname[2])
}

function isLoopbackOrigin(origin: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    && parsed.origin === origin
    && isLoopbackAuthority(parsed.host)
  )
}

function securityHeaders(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'",
  )
  const host = request.get('Host')
  if (host === undefined || !isLoopbackAuthority(host)) {
    next(new DomainError(
      'HOST_FORBIDDEN',
      'Request host is not allowed',
    ))
    return
  }
  const origin = request.get('Origin')
  if (origin !== undefined) {
    if (!isLoopbackOrigin(origin)) {
      next(new DomainError(
        'ORIGIN_FORBIDDEN',
        'Request origin is not allowed',
      ))
      return
    }
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Request-Id',
    )
    response.setHeader(
      'Access-Control-Allow-Methods',
      'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    )
    if (request.method === 'OPTIONS') {
      response.status(204).end()
      return
    }
  }
  next()
}

export const apiErrorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error)
    return
  }
  const mapped = mapError(error)
  response.status(mapped.status).json(errorEnvelope(
    mapped.code,
    mapped.message,
    mapped.details,
    requestId(response),
  ))
}

export function createApp(options: CreateAppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.use((request, response, next) => {
    const supplied = request.get('X-Request-Id')
    const selected = supplied !== undefined && requestIdPattern.test(supplied)
      ? supplied
      : randomUUID()
    ;(response.locals as RequestLocals).requestId = selected
    response.setHeader('X-Request-Id', selected)
    next()
  })
  app.use(apiPrefix, (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use(securityHeaders)
  app.use(express.json({ limit: '100kb' }))

  const router = express.Router()
  router.get('/health', (_request, response, next) => {
    try {
      const result = options.context.database
        .prepare('SELECT 1 AS ok')
        .get() as { ok?: number } | undefined
      if (result?.ok !== 1) {
        throw new Error('Database health check failed')
      }
      response.json(successEnvelope(
        { status: 'ok', database: 'ok' },
        requestId(response),
      ))
    } catch {
      next(new DomainError(
        'DATABASE_UNAVAILABLE',
        'Database is unavailable',
      ))
    }
  })

  for (const routeModule of [
    actorRoutes,
    projectRoutes,
    taskRoutes,
    ...(options.routeModules ?? []),
  ]) {
    routeModule.register(router, () => options.context)
  }
  app.use(apiPrefix, router)

  app.use((_request, response) => {
    response.status(404).json(errorEnvelope(
      'NOT_FOUND',
      'Route not found',
      {},
      requestId(response),
    ))
  })

  app.use(apiErrorHandler)

  return app
}
