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

const apiPrefix = '/api/v1'
const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/
const localOriginPattern =
  /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/

type RequestLocals = {
  requestId: string
}

export type AppRouteModule = {
  register(router: Router, context: AppContext): void
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

function domainStatus(code: string): number {
  if (/DATABASE.*UNAVAILABLE/.test(code)) {
    return 503
  }
  if (
    /AUTH|IDENTITY|UNAUTHENTICATED|TOKEN_(?:INVALID|REQUIRED)/.test(code)
  ) {
    return 401
  }
  if (/PERMISSION|FORBIDDEN|ACCESS_DENIED/.test(code)) {
    return 403
  }
  if (/(?:_NOT_FOUND|MISSING)/.test(code)) {
    return 404
  }
  if (/(?:_VERSION_CONFLICT|CONFLICT)/.test(code)) {
    return 409
  }
  if (/(?:VALIDATION|INVALID)/.test(code)) {
    return 400
  }
  return 500
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
    const status = domainStatus(error.code)
    if (status === 500) {
      return {
        status,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: {},
      }
    }
    if (status === 503) {
      return {
        status,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database is unavailable',
        details: {},
      }
    }
    return {
      status,
      code: error.code,
      message: error.message,
      details: error.details,
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
  const origin = request.get('Origin')
  if (origin !== undefined && localOriginPattern.test(origin)) {
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

  for (const routeModule of options.routeModules ?? []) {
    routeModule.register(router, options.context)
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

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    const mapped = mapError(error)
    response.status(mapped.status).json(errorEnvelope(
      mapped.code,
      mapped.message,
      mapped.details,
      requestId(response),
    ))
  }
  app.use(errorHandler)

  return app
}
