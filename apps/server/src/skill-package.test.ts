import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
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
import {
  createProjectOsSkillArchive,
  createSkillConfigSnippet,
  validateSkillPackageEntry,
} from './skill-package.js'

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
    expect(names).toEqual([
      'project-os/SKILL.md',
      'project-os/agents/openai.yaml',
      'project-os/references/claude-code-config.md',
      'project-os/references/codex-config.md',
      'project-os/references/kimi-code-config.md',
      'project-os/references/tool-reference.md',
      'project-os/scripts/verify-connection.mjs',
    ])
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

  it('creates a PowerShell-safe single-line Claude command for spaced paths', () => {
    const root = "C:\\Program Files\\O'Brien Project"

    const snippet = createSkillConfigSnippet('claude-code', root)

    expect(snippet).not.toContain('\\\n')
    expect(snippet).not.toContain('\r')
    expect(snippet).not.toContain('\n')
    expect(snippet).toBe(
      "claude mcp add --transport stdio --env "
      + "'PROJECT_OS_DB=C:/Program Files/O''Brien Project/"
      + "data/project_manage.db' project-os -- node "
      + "'C:/Program Files/O''Brien Project/apps/mcp/dist/stdio.js'",
    )
  })

  it('uses the same generated snippets in the exported setup references', () => {
    const entries = unzipSync(createProjectOsSkillArchive())
    const references = {
      codex: Buffer.from(
        entries['project-os/references/codex-config.md']!,
      ).toString('utf8'),
      'claude-code': Buffer.from(
        entries['project-os/references/claude-code-config.md']!,
      ).toString('utf8'),
      'kimi-code': Buffer.from(
        entries['project-os/references/kimi-code-config.md']!,
      ).toString('utf8'),
    }

    for (const client of [
      'codex',
      'claude-code',
      'kimi-code',
    ] as const) {
      expect(references[client]).toContain(
        createSkillConfigSnippet(client),
      )
    }
  })

  it('runs the exported verifier outside the repository without dependencies', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'project-os-skill-extract-'))
    directories.push(directory)
    const entries = unzipSync(createProjectOsSkillArchive())
    for (const [name, bytes] of Object.entries(entries)) {
      const destination = join(directory, ...name.split('/'))
      mkdirSync(join(destination, '..'), { recursive: true })
      writeFileSync(destination, bytes)
    }
    const databasePath = join(directory, 'verification.sqlite')
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      PROJECT_OS_DB: databasePath,
    }
    delete environment.PROJECT_OS_AGENT_ID

    const output = await import('node:child_process').then(
      ({ execFileSync }) => execFileSync(
        process.execPath,
        [join(
          directory,
          'project-os',
          'scripts',
          'verify-connection.mjs',
        )],
        {
          encoding: 'utf8',
          env: environment,
          timeout: 15_000,
        },
      ),
    )

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      mode: 'contract-only',
      transport: 'stdio',
      toolCount: 22,
      checks: ['listTools'],
      writeSmoke: false,
    })
  })

  it.each([
    ['project-os/.env', 'SAFE=value'],
    ['project-os/debug-credentials.txt', 'SAFE=value'],
    ['project-os/references/config.md', 'token = "abcdefghijklmnop"'],
    ['project-os/references/config.md', 'Bearer eyJabcdefghijklmnop'],
    ['project-os/references/config.md', '-----BEGIN PRIVATE KEY-----'],
    ['project-os/references/config.md', '{{PROJECT_OS_DB}}'],
    [
      'project-os/references/config.md',
      'C:/Users/demo/AppData/Local/Temp/project-os.db',
    ],
    ['project-os/../escape.md', 'safe'],
  ])(
    'rejects unsafe packaged entry %s before compression',
    (name, content) => {
      expect(() => validateSkillPackageEntry(
        name,
        new TextEncoder().encode(content),
      )).toThrow(/unsafe|invalid/i)
    },
  )

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
