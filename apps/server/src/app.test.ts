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
  createApp,
  type AppRouteModule,
} from './app.js'
import { loadConfig } from './config.js'
import {
  createAppContext,
  defaultSeedDocument,
  type AppContext,
} from './context.js'
import { startServer } from './index.js'

const createdContexts: AppContext[] = []
const createdDirectories: string[] = []

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

  it.each([
    ['INPUT_INVALID', 400],
    ['AUTHENTICATION_REQUIRED', 401],
    ['PERMISSION_DENIED', 403],
    ['PROJECT_NOT_FOUND', 404],
    ['PROJECT_VERSION_CONFLICT', 409],
    ['DATABASE_UNAVAILABLE', 503],
  ])('maps %s to %i', async (code, status) => {
    const response = await request(testApp())
      .get(`/api/v1/test/domain/${code}`)

    expect(response.status).toBe(status)
    expect(apiErrorEnvelopeSchema.parse(response.body)).toEqual(response.body)
    expect(response.body.error.code).toBe(code)
    expect(response.body.meta.request_id)
      .toBe(response.headers['x-request-id'])
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

  it('applies local-only CORS and baseline security headers', async () => {
    const local = await request(testApp())
      .get('/api/v1/health')
      .set('Origin', 'http://127.0.0.1:5173')
    const remote = await request(testApp())
      .get('/api/v1/health')
      .set('Origin', 'https://example.com')
    const preflight = await request(testApp())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('X-Request-Id', 'preflight-request')

    expect(local.headers['access-control-allow-origin'])
      .toBe('http://127.0.0.1:5173')
    expect(remote.headers['access-control-allow-origin']).toBeUndefined()
    expect(preflight.status).toBe(204)
    expect(preflight.headers['x-request-id']).toBe('preflight-request')
    expect(preflight.headers['cache-control']).toBe('no-store')
    expect(local.headers['x-powered-by']).toBeUndefined()
    expect(local.headers['x-content-type-options']).toBe('nosniff')
    expect(local.headers['x-frame-options']).toBe('DENY')
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

  it.each([
    [{ PROJECT_OS_HOST: '0.0.0.0' }, 'PROJECT_OS_HOST'],
    [{ PROJECT_OS_PORT: '0' }, 'PROJECT_OS_PORT'],
    [{ PROJECT_OS_PORT: '65536' }, 'PROJECT_OS_PORT'],
    [{ PROJECT_OS_PORT: '4310.5' }, 'PROJECT_OS_PORT'],
  ])('rejects invalid configuration %j', (environment, field) => {
    expect(() => loadConfig(environment, resolve('fixture-repository')))
      .toThrow(`Invalid server configuration: ${field}`)
  })
})

describe('production context', () => {
  it('constructs all services, including token support, and closes idempotently', () => {
    const context = testContext()

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
})
