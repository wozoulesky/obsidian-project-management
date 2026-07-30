import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  seedDatabase,
} from '@project-os/core'
import request from 'supertest'
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest'
import { createApp } from '../app.js'
import {
  createAppContext,
  defaultSeedDocument,
} from '../context.js'
import type { AppContext } from '../context.js'

const contexts: AppContext[] = []
const directories: string[] = []

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'project-os-data-routes-'))
  const context = createAppContext({
    databasePath: join(directory, 'active.sqlite'),
    backupRoot: join(directory, 'backups'),
  })
  seedDatabase(context.database, defaultSeedDocument)
  contexts.push(context)
  directories.push(directory)
  return {
    app: createApp({ context }),
    context,
    directory,
  }
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.close()
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('settings routes', () => {
  it('returns the persisted application settings', async () => {
    const { app } = fixture()

    const response = await request(app).get('/api/v1/settings')

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual(defaultSeedDocument.settings)
  })

  it('updates partial settings, records activity, and preserves a no-op version', async () => {
    const { app, context } = fixture()

    const updated = await request(app)
      .patch('/api/v1/settings')
      .send({ theme: 'dark', version: 1 })

    expect(updated.status).toBe(200)
    expect(updated.body.data).toMatchObject({
      theme: 'dark',
      background: 'soft',
      accent: 'blue',
      density: 'comfortable',
      version: 2,
    })
    const noOp = await request(app)
      .patch('/api/v1/settings')
      .send({ theme: 'dark', version: 2 })
    expect(noOp.status).toBe(200)
    expect(noOp.body.data).toEqual(updated.body.data)
    expect(context.database.prepare(`
      SELECT operation, actor_id, source
      FROM activities
      WHERE operation = 'settings.update'
    `).all()).toEqual([{
      operation: 'settings.update',
      actor_id: 'actor_local_owner',
      source: 'web',
    }])
  })

  it('rejects stale, null, unknown, and actor-spoofed settings writes', async () => {
    const { app } = fixture()
    await request(app)
      .patch('/api/v1/settings')
      .send({ theme: 'dark', version: 1 })

    const cases = [
      { body: { accent: 'teal', version: 1 }, status: 409 },
      { body: { theme: null, version: 2 }, status: 400 },
      { body: { version: 2, unknown: true }, status: 400 },
      { body: { version: 2, actorId: 'actor_other' }, status: 400 },
      { body: { version: 2, source: 'mcp' }, status: 400 },
    ]
    for (const testCase of cases) {
      const response = await request(app)
        .patch('/api/v1/settings')
        .send(testCase.body)
      expect(response.status).toBe(testCase.status)
    }
  })
})

describe('token routes', () => {
  it('reveals plaintext once while listing and revoking only token metadata', async () => {
    const { app, context } = fixture()

    const issued = await request(app)
      .post('/api/v1/tokens')
      .send({ name: 'Local automation' })

    expect(issued.status).toBe(201)
    expect(issued.body.data).toMatchObject({
      name: 'Local automation',
      version: 1,
      revokedAt: null,
    })
    expect(issued.body.data.token).toMatch(/^pos_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/)
    expect(issued.headers['cache-control']).toBe('no-store')

    const listed = await request(app).get('/api/v1/tokens')
    expect(listed.status).toBe(200)
    expect(listed.body.data).toEqual([
      expect.objectContaining({
        id: issued.body.data.id,
        name: 'Local automation',
        version: 1,
      }),
    ])
    expect(JSON.stringify(listed.body)).not.toContain(issued.body.data.token)
    expect(JSON.stringify(listed.body)).not.toContain('token_hash')

    const revoked = await request(app)
      .post(`/api/v1/tokens/${issued.body.data.id}/revoke`)
      .send({ version: 1 })
    expect(revoked.status).toBe(200)
    expect(revoked.body.data).toMatchObject({
      id: issued.body.data.id,
      version: 2,
    })
    expect(revoked.body.data.revokedAt).toEqual(expect.any(String))
    expect(JSON.stringify(revoked.body)).not.toContain(issued.body.data.token)

    const activities = context.database.prepare(`
      SELECT operation, actor_id, source, details_json
      FROM activities
      WHERE operation IN ('token.issue', 'token.revoke')
      ORDER BY created_at, operation
    `).all()
    expect(activities).toHaveLength(2)
    expect(JSON.stringify(activities)).not.toContain(issued.body.data.token)
  })

  it('rejects malformed, spoofed, stale, and unknown token writes', async () => {
    const { app } = fixture()
    const issued = await request(app)
      .post('/api/v1/tokens')
      .send({ name: 'Token' })
    const id = issued.body.data.id as string

    const cases = [
      {
        method: 'post',
        path: '/api/v1/tokens',
        body: { name: 'Other', actorId: 'actor_other' },
        status: 400,
      },
      {
        method: 'post',
        path: '/api/v1/tokens',
        body: { name: 'Other', source: 'mcp' },
        status: 400,
      },
      {
        method: 'post',
        path: '/api/v1/tokens',
        body: { name: '' },
        status: 400,
      },
      {
        method: 'post',
        path: `/api/v1/tokens/${id}/revoke`,
        body: { version: null },
        status: 400,
      },
      {
        method: 'post',
        path: `/api/v1/tokens/${id}/revoke`,
        body: { version: 99 },
        status: 409,
      },
      {
        method: 'post',
        path: '/api/v1/tokens/token_missing/revoke',
        body: { version: 1 },
        status: 404,
      },
    ] as const
    for (const testCase of cases) {
      const response = await request(app)
        [testCase.method](testCase.path)
        .send(testCase.body)
      expect(response.status).toBe(testCase.status)
    }
  })
})

describe('backup routes', () => {
  it('creates named and generated backups without exposing absolute paths', async () => {
    const { app, directory } = fixture()

    const named = await request(app)
      .post('/api/v1/backups')
      .send({ filename: 'snapshot.sqlite' })
    expect(named.status).toBe(201)
    expect(named.body.data).toEqual({
      filename: 'snapshot.sqlite',
      path: 'backups/snapshot.sqlite',
    })
    expect(JSON.stringify(named.body)).not.toContain(directory)
    expect(existsSync(join(directory, 'backups', 'snapshot.sqlite'))).toBe(true)

    const generated = await request(app)
      .post('/api/v1/backups')
      .send({})
    expect(generated.status).toBe(201)
    expect(generated.body.data.filename)
      .toMatch(/^project-os-[A-Za-z0-9._-]+\.sqlite$/)
    expect(generated.body.data.path)
      .toBe(`backups/${generated.body.data.filename}`)
    expect(JSON.stringify(generated.body)).not.toContain('hash')
  })

  it('restores by safe filename and immediately serves the replacement database', async () => {
    const { app } = fixture()
    const backup = await request(app)
      .post('/api/v1/backups')
      .send({ filename: 'before.sqlite' })
    expect(backup.status).toBe(201)
    const changed = await request(app)
      .patch('/api/v1/settings')
      .send({ theme: 'dark', version: 1 })
    expect(changed.body.data.theme).toBe('dark')

    const restored = await request(app)
      .post('/api/v1/backups/restore')
      .send({ filename: 'before.sqlite' })
    expect(restored.status).toBe(200)
    expect(restored.body.data).toEqual({
      filename: 'before.sqlite',
      path: 'backups/before.sqlite',
    })
    const settings = await request(app).get('/api/v1/settings')
    expect(settings.body.data.theme).toBe('system')
    expect((await request(app).get('/api/v1/health')).status).toBe(200)
  })

  it('rejects unsafe, duplicate, missing, and corrupt backup candidates', async () => {
    const { app, directory } = fixture()
    await request(app)
      .post('/api/v1/backups')
      .send({ filename: 'once.sqlite' })
    writeFileSync(join(directory, 'backups', 'corrupt.sqlite'), 'not sqlite')

    const cases = [
      {
        path: '/api/v1/backups',
        body: { filename: 'once.sqlite' },
      },
      {
        path: '/api/v1/backups',
        body: { filename: '../escape.sqlite' },
      },
      {
        path: '/api/v1/backups',
        body: { filename: 'wrong.db' },
      },
      {
        path: '/api/v1/backups/restore',
        body: { filename: '../active.sqlite' },
      },
      {
        path: '/api/v1/backups/restore',
        body: { filename: 'missing.sqlite' },
      },
      {
        path: '/api/v1/backups/restore',
        body: { filename: 'corrupt.sqlite' },
      },
      {
        path: '/api/v1/backups/restore',
        body: { filename: 'C:\\absolute.sqlite' },
      },
    ]
    for (const testCase of cases) {
      const response = await request(app)
        .post(testCase.path)
        .send(testCase.body)
      expect(response.status).toBe(400)
    }
  })

  it('rejects a candidate without the local human actor and keeps the old database live', async () => {
    const active = fixture()
    await request(active.app)
      .patch('/api/v1/settings')
      .send({ theme: 'dark', version: 1 })
    const candidate = createAppContext({
      databasePath: join(active.directory, 'candidate-active.sqlite'),
      backupRoot: join(active.directory, 'backups'),
      localActorId: 'actor_other',
    })
    contexts.push(candidate)
    const document = structuredClone(defaultSeedDocument)
    document.actors[0]!.id = 'actor_other'
    document.projects[0]!.ownerId = 'actor_other'
    document.projectMembers[0]!.actorId = 'actor_other'
    seedDatabase(candidate.database, document)
    await candidate.services.backups.create('no-local-actor.sqlite')

    const restored = await request(active.app)
      .post('/api/v1/backups/restore')
      .send({ filename: 'no-local-actor.sqlite' })

    expect(restored.status).toBe(400)
    expect(restored.body.error.code).toBe('BACKUP_INVALID')
    expect((await request(active.app).get('/api/v1/settings')).body.data.theme)
      .toBe('dark')
    expect((await request(active.app).get('/api/v1/health')).status).toBe(200)
  })
})

describe('export and import routes', () => {
  it('exports the document envelope without tokens or activities', async () => {
    const { app } = fixture()
    const issued = await request(app)
      .post('/api/v1/tokens')
      .send({ name: 'Export secret' })
    await request(app)
      .patch('/api/v1/settings')
      .send({ theme: 'dark', version: 1 })

    const exported = await request(app).get('/api/v1/export')

    expect(exported.status).toBe(200)
    expect(exported.body.data).toMatchObject({
      schemaVersion: 1,
      actors: expect.any(Array),
      projects: expect.any(Array),
      settings: expect.objectContaining({ theme: 'dark' }),
    })
    expect(exported.body.data).not.toHaveProperty('tokens')
    expect(exported.body.data).not.toHaveProperty('activities')
    expect(JSON.stringify(exported.body)).not.toContain(issued.body.data.token)
    expect(JSON.stringify(exported.body)).not.toContain('token_hash')
  })

  it('round-trips a JSON document through a single multipart file', async () => {
    const source = fixture()
    await request(source.app)
      .patch('/api/v1/settings')
      .send({ density: 'compact', version: 1 })
    const exported = await request(source.app).get('/api/v1/export')
    expect(exported.status).toBe(200)

    const target = fixture()
    const retained = await request(target.app)
      .post('/api/v1/tokens')
      .send({ name: 'Retained token' })
    const imported = await request(target.app)
      .post('/api/v1/import')
      .attach('file', Buffer.from(JSON.stringify(exported.body.data)), {
        filename: 'project-os.json',
        contentType: 'application/json',
      })

    expect(imported.status).toBe(200)
    expect(imported.body.data).toEqual({
      ok: true,
      counts: {
        actors: exported.body.data.actors.length,
        projects: exported.body.data.projects.length,
        projectMembers: exported.body.data.projectMembers.length,
        tasks: exported.body.data.tasks.length,
        requirements: exported.body.data.requirements.length,
        defects: exported.body.data.defects.length,
        sessions: exported.body.data.sessions.length,
        handoffs: exported.body.data.handoffs.length,
        deliverables: exported.body.data.deliverables.length,
      },
    })
    expect((await request(target.app).get('/api/v1/settings')).body.data.density)
      .toBe('compact')
    const tokens = await request(target.app).get('/api/v1/tokens')
    expect(tokens.body.data[0].id).toBe(retained.body.data.id)
  })

  it('rejects invalid multipart imports without changing live data', async () => {
    const { app } = fixture()
    const before = (await request(app).get('/api/v1/export')).body.data
    const invalid = structuredClone(before)
    invalid.tokens = [{ token: 'plaintext' }]

    const cases = [
      () => request(app).post('/api/v1/import'),
      () => request(app)
        .post('/api/v1/import')
        .attach('file', Buffer.from('{'), {
          filename: 'bad.json',
          contentType: 'application/json',
        }),
      () => request(app)
        .post('/api/v1/import')
        .attach('file', Buffer.from(JSON.stringify(invalid)), {
          filename: 'invalid.json',
          contentType: 'application/json',
        }),
      () => request(app)
        .post('/api/v1/import')
        .attach('file', Buffer.from('{}'), {
          filename: 'wrong.txt',
          contentType: 'text/plain',
        }),
      () => request(app)
        .post('/api/v1/import')
        .attach('file', Buffer.from(JSON.stringify(before)), {
          filename: 'one.json',
          contentType: 'application/json',
        })
        .attach('file', Buffer.from(JSON.stringify(before)), {
          filename: 'two.json',
          contentType: 'application/json',
        }),
      () => request(app)
        .post('/api/v1/import')
        .field('actorId', 'actor_other')
        .attach('file', Buffer.from(JSON.stringify(before)), {
          filename: 'spoofed-actor.json',
          contentType: 'application/json',
        }),
      () => request(app)
        .post('/api/v1/import')
        .field('source', 'mcp')
        .attach('file', Buffer.from(JSON.stringify(before)), {
          filename: 'spoofed-source.json',
          contentType: 'application/json',
        }),
    ]
    for (const send of cases) {
      const response = await send()
      expect(response.status).toBe(400)
      expect(response.body.error.code).toEqual(expect.any(String))
    }
    const after = (await request(app).get('/api/v1/export')).body.data
    expect({
      ...after,
      exportedAt: before.exportedAt,
    }).toEqual(before)
  })

  it('rejects an import without the local actor and keeps settings and health live', async () => {
    const { app } = fixture()
    await request(app)
      .patch('/api/v1/settings')
      .send({ theme: 'dark', version: 1 })
    const document = (await request(app).get('/api/v1/export')).body.data
    document.actors[0].id = 'actor_other'
    document.projects[0].ownerId = 'actor_other'
    document.projectMembers[0].actorId = 'actor_other'

    const imported = await request(app)
      .post('/api/v1/import')
      .attach('file', Buffer.from(JSON.stringify(document)), {
        filename: 'no-local-actor.json',
        contentType: 'application/json',
      })

    expect(imported.status).toBe(400)
    expect(imported.body.error.code).toBe('IMPORT_INVALID')
    expect((await request(app).get('/api/v1/settings')).body.data.theme)
      .toBe('dark')
    expect((await request(app).get('/api/v1/health')).status).toBe(200)
  })

  it.each([
    {
      name: 'missing boundary',
      contentType: 'multipart/form-data',
      body: 'not-a-valid-multipart-body',
    },
    {
      name: 'truncated body',
      contentType: 'multipart/form-data; boundary=project-os-test-boundary',
      body: [
        '--project-os-test-boundary\r\n',
        'Content-Disposition: form-data; name="file"; filename="data.json"\r\n',
        'Content-Type: application/json\r\n\r\n',
        '{"schemaVersion":1',
      ].join(''),
    },
  ])(
    'classifies raw multipart with $name as a stable import error',
    async ({ contentType, body }) => {
      const { app } = fixture()

      const response = await request(app)
        .post('/api/v1/import')
        .set('Content-Type', contentType)
        .send(body)

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        data: null,
        error: {
          code: 'IMPORT_INVALID',
          message: 'Import document is invalid',
          details: {},
        },
        meta: {
          request_id: response.headers['x-request-id'],
        },
      })
    },
  )

  it.each([
    {
      name: 'inactive status',
      mutate(actor: Record<string, unknown>) {
        actor.status = 'inactive'
      },
    },
    {
      name: 'agent kind',
      mutate(actor: Record<string, unknown>) {
        actor.kind = 'agent'
        actor.role = 'dev-agent'
        actor.client = 'codex'
      },
    },
    {
      name: 'role',
      mutate(actor: Record<string, unknown>) {
        actor.role = 'member'
      },
    },
    {
      name: 'name',
      mutate(actor: Record<string, unknown>) {
        actor.name = 'Replacement Owner'
      },
    },
    {
      name: 'client',
      mutate(actor: Record<string, unknown>) {
        delete actor.client
      },
    },
  ])(
    'rejects local actor $name tampering without changing local state',
    async ({ mutate }) => {
      const { app, context } = fixture()
      const issued = await request(app)
        .post('/api/v1/tokens')
        .send({ name: 'Retained token' })
      await request(app)
        .patch('/api/v1/settings')
        .send({ theme: 'dark', version: 1 })
      const beforeActivities = context.database.prepare(`
        SELECT operation, actor_id, source, entity_id
        FROM activities
        ORDER BY created_at, id
      `).all()
      const beforeTokens = (await request(app).get('/api/v1/tokens')).body.data
      const document = (await request(app).get('/api/v1/export')).body.data
      mutate(document.actors[0] as Record<string, unknown>)

      const imported = await request(app)
        .post('/api/v1/import')
        .attach('file', Buffer.from(JSON.stringify(document)), {
          filename: 'tampered-local-actor.json',
          contentType: 'application/json',
        })

      expect(imported.status).toBe(400)
      expect(imported.body.error.code).toBe('IMPORT_INVALID')
      expect((await request(app).get('/api/v1/tokens')).body.data)
        .toEqual(beforeTokens)
      expect(beforeTokens[0].id).toBe(issued.body.data.id)
      expect(context.database.prepare(`
        SELECT operation, actor_id, source, entity_id
        FROM activities
        ORDER BY created_at, id
      `).all()).toEqual(beforeActivities)
      expect((await request(app).get('/api/v1/settings')).body.data)
        .toMatchObject({ theme: 'dark', version: 2 })
      const subsequentWrite = await request(app)
        .patch('/api/v1/settings')
        .send({ accent: 'teal', version: 2 })
      expect(subsequentWrite.status).toBe(200)
      expect(subsequentWrite.body.data).toMatchObject({
        theme: 'dark',
        accent: 'teal',
        version: 3,
      })
      expect((await request(app).get('/api/v1/health')).status).toBe(200)
    },
  )

  it('rejects multipart files over 25 MiB with a stable 413 envelope', async () => {
    const { app } = fixture()
    const response = await request(app)
      .post('/api/v1/import')
      .attach('file', Buffer.alloc(25 * 1024 * 1024 + 1, 0x20), {
        filename: 'too-large.json',
        contentType: 'application/json',
      })

    expect(response.status).toBe(413)
    expect(response.body.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      details: {},
    })
  })

  it('turns an invalid internal export shape into a sanitized 500', async () => {
    const { app, context } = fixture()
    const invalid = context.services.exports.exportJson() as
      ReturnType<AppContext['services']['exports']['exportJson']> & {
        actors: Array<Record<string, unknown>>
      }
    invalid.actors[0]!.token_hash = 'internal-secret'
    context.services.exports = {
      exportJson: () => invalid,
    } as never

    const response = await request(app).get('/api/v1/export')

    expect(response.status).toBe(500)
    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    })
    expect(JSON.stringify(response.body)).not.toContain('internal-secret')
  })

  it('does not misclassify an import service failure as malformed multipart', async () => {
    const { app, context } = fixture()
    const document = context.services.exports.exportJson()
    context.services.exports = {
      exportJson: () => document,
      importJson: () => {
        throw new Error('injected import service failure')
      },
    } as never

    const response = await request(app)
      .post('/api/v1/import')
      .attach('file', Buffer.from(JSON.stringify(document)), {
        filename: 'valid.json',
        contentType: 'application/json',
      })

    expect(response.status).toBe(500)
    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: {},
    })
  })

  it('applies host and origin protections before data transfer routes', async () => {
    const { app } = fixture()

    expect((await request(app)
      .get('/api/v1/export')
      .set('Host', 'example.com')).status).toBe(403)
    expect((await request(app)
      .post('/api/v1/import')
      .set('Origin', 'https://example.com')).status).toBe(403)
  })
})
