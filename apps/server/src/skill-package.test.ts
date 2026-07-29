import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  seedDatabase,
} from '@project-os/core'
import type { Response } from 'supertest'
import request from 'supertest'
import { unzipSync } from 'fflate'
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest'
import { createApp } from './app.js'
import {
  createAppContext,
  defaultSeedDocument,
} from './context.js'
import type { AppContext } from './context.js'

const contexts: AppContext[] = []
const directories: string[] = []

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'project-os-skill-route-'))
  const context = createAppContext({
    databasePath: join(directory, 'active.sqlite'),
    backupRoot: join(directory, 'backups'),
  })
  seedDatabase(context.database, defaultSeedDocument)
  contexts.push(context)
  directories.push(directory)
  return createApp({ context })
}

function binaryParser(
  response: Response,
  callback: (error: Error | null, body?: Buffer) => void,
) {
  const chunks: Buffer[] = []
  response.on('data', (chunk: Buffer) => chunks.push(chunk))
  response.on('end', () => callback(null, Buffer.concat(chunks)))
}

afterEach(() => {
  for (const context of contexts.splice(0)) context.close()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Project OS Skill package routes', () => {
  it('downloads an installable archive with deterministic safe entries', async () => {
    const app = fixture()

    const first = await request(app)
      .get('/api/v1/skills/project-os.zip')
      .buffer(true)
      .parse(binaryParser)
    const second = await request(app)
      .get('/api/v1/skills/project-os.zip')
      .buffer(true)
      .parse(binaryParser)

    expect(first.status).toBe(200)
    expect(first.headers['content-type']).toContain('application/zip')
    expect(first.headers['content-disposition'])
      .toBe('attachment; filename="project-os.zip"')
    expect(createHash('sha256').update(first.body).digest('hex'))
      .toBe(createHash('sha256').update(second.body).digest('hex'))

    const entries = unzipSync(first.body as Uint8Array)
    const names = Object.keys(entries)
    expect(names).toContain('project-os/SKILL.md')
    expect(names).toContain('project-os/agents/openai.yaml')
    expect(names).toContain('project-os/references/codex-config.md')
    expect(names).toContain('project-os/scripts/verify-connection.mjs')
    expect(names).toEqual([...names].sort())
    expect(names.every((name) => (
      name.startsWith('project-os/')
      && !name.includes('..')
      && !name.includes('\\')
    ))).toBe(true)
    expect(names.some((name) => (
      name.includes('node_modules')
      || name.endsWith('package.json')
      || name.endsWith('.test.ts')
    ))).toBe(false)

    const content = Buffer.concat(
      Object.values(entries).map((entry) => Buffer.from(entry)),
    ).toString('utf8')
    const projectRoot = process.cwd().replaceAll('\\', '/')
      .replace(/\/apps\/server$/, '')
    expect(content).toContain(`${projectRoot}/apps/mcp/dist/stdio.js`)
    expect(content).toContain(`${projectRoot}/data/project_manage.db`)
    expect(content).not.toContain('E:/another/project_manage')
    expect(content).not.toMatch(/(?:\/tmp\/|AppData\/Local\/Temp\/)/i)
    expect(content).not.toMatch(/pos_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+/)
    expect(content).not.toMatch(/Bearer\s+[A-Za-z0-9._~-]+/)
  })

  it.each([
    ['codex', '[mcp_servers.project-os]'],
    ['claude-code', 'claude mcp add --transport stdio'],
    ['kimi-code', '"mcpServers"'],
  ])(
    'serves the %s stdio configuration as JSON',
    async (client, marker) => {
      const response = await request(fixture())
        .get(`/api/v1/skills/project-os/config-snippets/${client}`)

      expect(response.status).toBe(200)
      expect(response.body.data).toEqual({
        client,
        transport: 'stdio',
        snippet: expect.stringContaining(marker),
      })
      expect(response.body.data.snippet).toContain(
        '/apps/mcp/dist/stdio.js',
      )
      expect(response.body.data.snippet).toContain(
        '/data/project_manage.db',
      )
      expect(response.body.data.snippet).not.toMatch(/\/sse\b/i)
      expect(response.body.data.snippet).not.toMatch(
        /pos_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+/,
      )
    },
  )

  it('rejects unknown configuration clients', async () => {
    const response = await request(fixture())
      .get('/api/v1/skills/project-os/config-snippets/unknown')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })
})
