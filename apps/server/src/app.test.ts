import { Server } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  apiErrorEnvelopeSchema,
  apiSuccessEnvelopeSchema,
} from '@project-os/contracts'
import {
  createTestDatabase,
  DomainError,
  seedDatabase,
} from '@project-os/core'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  apiErrorHandler,
  createApp,
  type AppRouteModule,
} from './app.js'
import type {
  NextFunction,
  Request,
  Response,
} from 'express'
import { loadConfig } from './config.js'
import {
  createAppContext,
  defaultSeedDocument,
  type AppContext,
} from './context.js'
import { startServer } from './index.js'

const createdContexts: AppContext[] = []
const createdDirectories: string[] = []

const publicDomainErrorCases = [
  ['ACTIVITY_CURSOR_INVALID', 400],
  ['ACTOR_CLIENT_INVALID', 400],
  ['ACTOR_INACTIVE', 400],
  ['ACTOR_KIND_INVALID', 400],
  ['BACKUP_INVALID', 400],
  ['BACKUP_PATH_INVALID', 400],
  ['DASHBOARD_ACTIVITY_LIMIT_INVALID', 400],
  ['IMPORT_INVALID', 400],
  ['LOCAL_ACTOR_INVALID', 400],
  ['PROJECT_DATE_RANGE_INVALID', 400],
  ['PAGINATION_CURSOR_INVALID', 400],
  ['REQUIREMENT_PROJECT_MISMATCH', 400],
  ['SETTINGS_INVALID', 400],
  ['TASK_DATE_RANGE_INVALID', 400],
  ['TASK_PROJECT_MISMATCH', 400],
  ['TASK_REFERENCE_INVALID', 400],
  ['TOKEN_INVALID', 401],
  ['PERMISSION_DENIED', 403],
  ['ACTOR_NOT_FOUND', 404],
  ['DEFECT_NOT_FOUND', 404],
  ['PROJECT_NOT_FOUND', 404],
  ['REQUIREMENT_NOT_FOUND', 404],
  ['TASK_NOT_FOUND', 404],
  ['TOKEN_NOT_FOUND', 404],
  ['ACTOR_NAME_CONFLICT', 409],
  ['ACTOR_VERSION_CONFLICT', 409],
  ['DEFECT_VERSION_CONFLICT', 409],
  ['PROJECT_VERSION_CONFLICT', 409],
  ['REQUIREMENT_VERSION_CONFLICT', 409],
  ['SETTINGS_VERSION_CONFLICT', 409],
  ['TASK_VERSION_CONFLICT', 409],
  ['TOKEN_VERSION_CONFLICT', 409],
  ['VERSION_CONFLICT', 409],
] as const

const internalDomainErrorCases = [
  ['BACKUP_CREATE_FAILED', 500, 'INTERNAL_ERROR'],
  ['SETTINGS_UPDATE_FAILED', 500, 'INTERNAL_ERROR'],
  ['TOKEN_ISSUE_FAILED', 500, 'INTERNAL_ERROR'],
  ['TOKEN_REVOKE_FAILED', 500, 'INTERNAL_ERROR'],
  ['BACKUP_RESTORE_FAILED', 503, 'SERVICE_UNAVAILABLE'],
  ['DATABASE_MIGRATIONS_INVALID', 503, 'SERVICE_UNAVAILABLE'],
  ['DATABASE_SCHEMA_NEWER', 503, 'SERVICE_UNAVAILABLE'],
] as const

function testContext(): AppContext {
  const directory = mkdtempSync(join(tmpdir(), 'project-os-server-'))
  const context = createAppContext({
    databasePath: join(directory, 'test.db'),
    backupRoot: join(directory, 'backups'),
  })
  createdDirectories.push(directory)
  createdContexts.push(context)
  return context
}

const testRoutes: AppRouteModule = {
  register(router) {
    router.get('/test/domain/:code', (request) => {
      throw new DomainError(
        request.params.code!,
        'Domain message',
        { entityId: 'project_missing' },
      )
    })
    router.get('/test/unexpected', () => {
      throw new Error(
        'SQLITE_ERROR: SELECT secret FROM tokens at C:\\private\\server.ts:12',
      )
    })
    router.get('/test/malicious-domain', () => {
      throw new DomainError(
        'ACTOR_INACTIVE',
        'SELECT secret FROM tokens at C:\\private\\server.ts:12',
        {
          actorId: 'actor_safe',
          sql: 'SELECT secret FROM tokens',
          path: 'C:\\private\\server.ts',
          stack: 'at privateFunction (C:\\private\\server.ts:12)',
          nested: { trace: '/Users/private/server.ts:12' },
        },
      )
    })
    router.get('/test/zod', () => {
      z.object({ value: z.string() }).parse({ value: 42 })
    })
    router.post('/test/json', (_request, response) => {
      response.status(204).end()
    })
  },
}

function testApp(context = testContext()) {
  return createApp({ context, routeModules: [testRoutes] })
}

afterEach(() => {
  for (const context of createdContexts.splice(0)) {
    context.close()
  }
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

describe('application shell', () => {
  it('returns a shared success envelope and matching request id for health', async () => {
    const response = await request(testApp()).get('/api/v1/health')

    expect(response.status).toBe(200)
    expect(
      apiSuccessEnvelopeSchema(z.object({
        status: z.literal('ok'),
        database: z.literal('ok'),
      })).parse(response.body),
    ).toEqual(response.body)
    expect(response.body).toEqual({
      data: { status: 'ok', database: 'ok' },
      error: null,
      meta: { request_id: response.headers['x-request-id'] },
    })
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('reuses a safe incoming request id', async () => {
    const response = await request(testApp())
      .get('/api/v1/health')
      .set('X-Request-Id', 'request_A-1.2:3')

    expect(response.headers['x-request-id']).toBe('request_A-1.2:3')
    expect(response.body.meta.request_id).toBe('request_A-1.2:3')
  })

  it('replaces an unsafe incoming request id with a UUID', async () => {
    const response = await request(testApp())
      .get('/api/v1/health')
      .set('X-Request-Id', `unsafe-${'x'.repeat(129)}`)

    expect(response.headers['x-request-id'])
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(response.body.meta.request_id)
      .toBe(response.headers['x-request-id'])
  })

  it.each(publicDomainErrorCases)('maps %s to %i', async (code, status) => {
    const response = await request(testApp())
      .get(`/api/v1/test/domain/${code}`)

    expect(response.status).toBe(status)
    expect(apiErrorEnvelopeSchema.parse(response.body)).toEqual(response.body)
    expect(response.body.error.code).toBe(code)
    expect(response.body.meta.request_id)
      .toBe(response.headers['x-request-id'])
  })

  it.each(internalDomainErrorCases)(
    'maps internal %s to a sanitized %i',
    async (code, status, publicCode) => {
      const response = await request(testApp())
        .get(`/api/v1/test/domain/${code}`)

      expect(response.status).toBe(status)
      expect(response.body.error.code).toBe(publicCode)
      expect(response.body.error.details).toEqual({})
      expect(response.body.error.message).not.toBe('Domain message')
    },
  )

  it('sanitizes known DomainError messages and details', async () => {
    const response = await request(testApp())
      .get('/api/v1/test/malicious-domain')

    expect(response.status).toBe(400)
    expect(response.body.error).toEqual({
      code: 'ACTOR_INACTIVE',
      message: 'Request is invalid',
      details: { actorId: 'actor_safe' },
    })
    expect(JSON.stringify(response.body)).not.toMatch(
      /SELECT|tokens|private|server\.ts|stack|trace|SQL/i,
    )
  })

  it('does not expose unexpected error internals', async () => {
    const response = await request(testApp())
      .get('/api/v1/test/unexpected')

    expect(response.status).toBe(500)
    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    })
    expect(JSON.stringify(response.body)).not.toMatch(
      /SELECT|tokens|private|server\.ts|SQLITE|stack/i,
    )
  })

  it('maps Zod failures to a validation envelope', async () => {
    const response = await request(testApp()).get('/api/v1/test/zod')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.details.issues).toBeInstanceOf(Array)
  })

  it('returns a common envelope for an unknown route', async () => {
    const response = await request(testApp()).get('/api/v1/not-real')

    expect(response.status).toBe(404)
    expect(response.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Route not found',
      details: {},
    })
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('returns 400 for malformed JSON', async () => {
    const response = await request(testApp())
      .post('/api/v1/test/json')
      .type('application/json')
      .send('{"broken":')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_JSON')
  })

  it('returns 413 for oversized JSON', async () => {
    const response = await request(testApp())
      .post('/api/v1/test/json')
      .type('application/json')
      .send(JSON.stringify({ value: 'x'.repeat(101 * 1024) }))

    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('returns a stable 503 after the database is closed', async () => {
    const context = testContext()
    context.close()

    const response = await request(testApp(context)).get('/api/v1/health')

    expect(response.status).toBe(503)
    expect(response.body.error).toEqual({
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database is unavailable',
      details: {},
    })
    expect(JSON.stringify(response.body)).not.toMatch(/database is not open/i)
  })

  it('allows only loopback Host and Origin values', async () => {
    const local = await request(testApp())
      .get('/api/v1/health')
      .set('Host', 'localhost:4310')
      .set('Origin', 'http://127.0.0.1:5173')
    const remote = await request(testApp())
      .get('/api/v1/health')
      .set('Origin', 'https://example.com')
    const remotePreflight = await request(testApp())
      .options('/api/v1/health')
      .set('Origin', 'https://example.com')
    const invalidHost = await request(testApp())
      .get('/api/v1/health')
      .set('Host', 'example.com:4310')
    const invalidHostPort = await request(testApp())
      .get('/api/v1/health')
      .set('Host', 'localhost:70000')
    const ipv6 = await request(testApp())
      .get('/api/v1/health')
      .set('Host', '[::1]:4310')
    const preflight = await request(testApp())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('X-Request-Id', 'preflight-request')

    expect(local.headers['access-control-allow-origin'])
      .toBe('http://127.0.0.1:5173')
    expect(remote.status).toBe(403)
    expect(remote.body.error.code).toBe('ORIGIN_FORBIDDEN')
    expect(remotePreflight.status).toBe(403)
    expect(remotePreflight.body.error.code).toBe('ORIGIN_FORBIDDEN')
    expect(invalidHost.status).toBe(403)
    expect(invalidHost.body.error.code).toBe('HOST_FORBIDDEN')
    expect(invalidHostPort.status).toBe(403)
    expect(ipv6.status).toBe(200)
    expect(preflight.status).toBe(204)
    expect(preflight.headers['x-request-id']).toBe('preflight-request')
    expect(preflight.headers['cache-control']).toBe('no-store')
    expect(local.headers['x-powered-by']).toBeUndefined()
    expect(local.headers['x-content-type-options']).toBe('nosniff')
    expect(local.headers['x-frame-options']).toBe('DENY')
  })

  it('delegates errors after response headers are sent', () => {
    const error = new Error('late failure')
    const next = vi.fn() as unknown as NextFunction

    apiErrorHandler(
      error,
      {} as Request,
      { headersSent: true } as Response,
      next,
    )

    expect(next).toHaveBeenCalledWith(error)
  })

  it('does not start a listener from createApp', () => {
    const listen = vi.spyOn(Server.prototype, 'listen')

    createApp({ context: testContext() })

    expect(listen).not.toHaveBeenCalled()
  })
})

describe('configuration', () => {
  it('uses loopback defaults and repository-local storage', () => {
    const repositoryRoot = resolve('fixture-repository')

    expect(loadConfig({}, repositoryRoot)).toEqual({
      host: '127.0.0.1',
      port: 4310,
      databasePath: join(repositoryRoot, 'data', 'project_manage.db'),
      backupRoot: join(repositoryRoot, 'data', 'backups'),
      localActorId: 'actor_local_owner',
    })
  })

  it('supports an explicit database path', () => {
    const repositoryRoot = resolve('fixture-repository')

    expect(loadConfig({
      PROJECT_OS_DATABASE_PATH: 'runtime/custom.db',
    }, repositoryRoot).databasePath).toBe(
      join(repositoryRoot, 'runtime', 'custom.db'),
    )
  })

  it('supports an explicit controlled local actor id', () => {
    const repositoryRoot = resolve('fixture-repository')

    expect(loadConfig({
      PROJECT_OS_LOCAL_ACTOR_ID: 'actor_desktop_owner',
    }, repositoryRoot).localActorId).toBe('actor_desktop_owner')
  })

  it.each([
    [{ PROJECT_OS_HOST: '0.0.0.0' }, 'PROJECT_OS_HOST'],
    [{ PROJECT_OS_PORT: '0' }, 'PROJECT_OS_PORT'],
    [{ PROJECT_OS_PORT: '65536' }, 'PROJECT_OS_PORT'],
    [{ PROJECT_OS_PORT: '4310.5' }, 'PROJECT_OS_PORT'],
    [{ PROJECT_OS_LOCAL_ACTOR_ID: '' }, 'PROJECT_OS_LOCAL_ACTOR_ID'],
    [{
      PROJECT_OS_LOCAL_ACTOR_ID: `actor_${'x'.repeat(123)}`,
    }, 'PROJECT_OS_LOCAL_ACTOR_ID'],
    [{
      PROJECT_OS_LOCAL_ACTOR_ID: 'actor local owner',
    }, 'PROJECT_OS_LOCAL_ACTOR_ID'],
  ])('rejects invalid configuration %j', (environment, field) => {
    expect(() => loadConfig(environment, resolve('fixture-repository')))
      .toThrow(`Invalid server configuration: ${field}`)
  })
})

describe('production context', () => {
  it('constructs all services, including token support, and closes idempotently', () => {
    const context = testContext()

    expect(context.localActorId).toBe('actor_local_owner')
    expect(Object.keys(context.services).sort()).toEqual([
      'activities',
      'actors',
      'backups',
      'dashboard',
      'defects',
      'exports',
      'projects',
      'requirements',
      'settings',
      'tasks',
      'tokens',
    ])
    expect(() => {
      context.close()
      context.close()
    }).not.toThrow()
  })

  it('closes the database if service construction fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'project-os-failure-'))
    createdDirectories.push(directory)
    const invalidBackupRoot = join(directory, 'not-a-directory')
    writeFileSync(invalidBackupRoot, 'occupied')
    const close = vi.spyOn(DatabaseSync.prototype, 'close')

    expect(() => createAppContext({
      databasePath: join(directory, 'failure.db'),
      backupRoot: invalidBackupRoot,
    })).toThrow()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('provides a complete default seed and only seeds an empty database', () => {
    const database = createTestDatabase()

    try {
      expect(seedDatabase(database, defaultSeedDocument)).toBe(true)
      expect(seedDatabase(database, defaultSeedDocument)).toBe(false)
      expect(database.prepare('SELECT COUNT(*) AS count FROM actors').get())
        .toEqual({ count: 1 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM projects').get())
        .toEqual({ count: 1 })
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM project_members
        WHERE membership_role = 'owner'
      `).get()).toEqual({ count: 1 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM settings').get())
        .toEqual({ count: 1 })
    } finally {
      database.close()
    }
  })

  it('keeps captured service handles live across a real database restore', async () => {
    const context = testContext()
    seedDatabase(context.database, defaultSeedDocument)
    const services = context.services
    const actors = services.actors
    const projects = services.projects
    const tasks = services.tasks
    const settings = services.settings
    const tokens = services.tokens
    const backups = services.backups
    const ownerId = defaultSeedDocument.actors[0]!.id
    const projectId = defaultSeedDocument.projects[0]!.id
    const beforeToken = tokens.issue('before-restore')
    const beforeTask = tasks.create({
      projectId,
      title: 'Before restore',
      assigneeId: ownerId,
      startDate: '2026-07-29',
      dueDate: '2026-07-30',
      priority: 'P1',
    }, ownerId, 'web')
    const backupPath = await backups.create('restore.sqlite')

    actors.createHuman({ name: 'Discarded actor', role: 'member' })
    projects.create({
      name: 'Discarded project',
      ownerId,
      startDate: null,
      dueDate: null,
    }, ownerId, 'web')
    tasks.create({
      projectId,
      title: 'Discarded task',
      assigneeId: ownerId,
      startDate: '2026-07-29',
      dueDate: '2026-07-30',
      priority: 'P2',
    }, ownerId, 'web')
    settings.update({
      ...settings.get(),
      theme: 'dark',
    }, ownerId, 'web')
    tokens.issue('discarded-token')

    backups.restore(backupPath)

    const runtimeRoutes: AppRouteModule = {
      register(router, getContext) {
        router.get('/test/actor-count', (_request, response) => {
          response.json({
            count: getContext().services.actors.list().length,
          })
        })
      },
    }
    const health = await request(createApp({
      context,
      routeModules: [runtimeRoutes],
    })).get('/api/v1/health')
    const routedActors = await request(createApp({
      context,
      routeModules: [runtimeRoutes],
    })).get('/api/v1/test/actor-count')

    expect(health.status).toBe(200)
    expect(routedActors.body).toEqual({ count: 1 })
    expect(actors.list().map(({ name }) => name)).toEqual(['Local Owner'])
    expect(projects.list().map(({ name }) => name)).toEqual(['Default Project'])
    expect(tasks.list().map(({ id }) => id)).toEqual([beforeTask.id])
    expect(settings.get().theme).toBe('system')
    expect(tokens.verify(beforeToken.token)).toBe(true)
    expect(actors.createHuman({
      name: 'After restore actor',
      role: 'member',
    }).name).toBe('After restore actor')
    expect(projects.create({
      name: 'After restore project',
      ownerId,
      startDate: null,
      dueDate: null,
    }, ownerId, 'web').name).toBe('After restore project')
    expect(tasks.create({
      projectId,
      title: 'After restore task',
      assigneeId: ownerId,
      startDate: '2026-07-29',
      dueDate: '2026-07-30',
      priority: 'P2',
    }, ownerId, 'web').title).toBe('After restore task')
    expect(settings.update({
      ...settings.get(),
      accent: 'purple',
    }, ownerId, 'web').accent).toBe('purple')
    expect(tokens.issue('after-restore-token').name)
      .toBe('after-restore-token')
  })

  it('starts on the configured loopback interface and closes idempotently', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'project-os-runtime-'))
    createdDirectories.push(directory)
    const runtime = await startServer({
      host: '127.0.0.1',
      port: 0,
      databasePath: join(directory, 'runtime.db'),
      backupRoot: join(directory, 'backups'),
    })

    try {
      expect(runtime.server.listening).toBe(true)
      const address = runtime.server.address()
      expect(typeof address === 'object' && address?.address)
        .toBe('127.0.0.1')
      await Promise.all([runtime.close(), runtime.close()])
      expect(runtime.server.listening).toBe(false)
      expect(() => runtime.context.database).toThrow('Database is unavailable')
    } finally {
      await runtime.close()
    }
  })

  it('rejects close if context cleanup throws and still settles idempotently', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'project-os-close-'))
    createdDirectories.push(directory)
    const runtime = await startServer({
      host: '127.0.0.1',
      port: 0,
      databasePath: join(directory, 'runtime.db'),
      backupRoot: join(directory, 'backups'),
    })
    const originalClose = runtime.context.close.bind(runtime.context)
    const closeError = new Error('close failed')
    runtime.context.close = () => {
      throw closeError
    }

    try {
      const outcome = await Promise.race([
        runtime.close().then(
          () => 'resolved',
          (error: unknown) => error,
        ),
        new Promise((resolveTimeout) => {
          setTimeout(() => resolveTimeout('timed out'), 100)
        }),
      ])

      expect(outcome).toBe(closeError)
      await expect(runtime.close()).rejects.toBe(closeError)
      expect(runtime.server.listening).toBe(false)
    } finally {
      runtime.context.close = originalClose
      originalClose()
    }
  })
})
