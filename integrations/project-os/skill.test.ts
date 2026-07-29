import {
  execFileSync,
  spawnSync,
} from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import {
  join,
  resolve,
} from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import {
  afterAll,
  describe,
  expect,
  it,
} from 'vitest'

const skillDirectory = fileURLToPath(new URL('.', import.meta.url))
const verifierPath = join(
  skillDirectory,
  'scripts/verify-connection.mjs',
)
const builtMcpEntry = resolve(
  skillDirectory,
  '../../apps/mcp/dist/stdio.js',
)
const temporaryDirectories: string[] = []

function read(relativePath: string): string {
  return readFileSync(join(skillDirectory, relativePath), 'utf8')
}

function allText(): string {
  return [
    'SKILL.md',
    'agents/openai.yaml',
    'references/tool-reference.md',
    'references/codex-config.md',
    'references/claude-code-config.md',
    'references/kimi-code-config.md',
    'scripts/verify-connection.mjs',
  ].map(read).join('\n')
}

function runVerifier(...arguments_: string[]): string {
  const environment = { ...process.env }
  delete environment.PROJECT_OS_AGENT_ID
  return execFileSync(
    process.execPath,
    [
      verifierPath,
      '--entry',
      builtMcpEntry,
      ...arguments_,
    ],
    {
      encoding: 'utf8',
      env: environment,
    },
  )
}

function databaseSnapshot(databasePath: string, agentId: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    return {
      actor: database.prepare(`
        SELECT version, last_active_at
        FROM actors
        WHERE id = ?
      `).get(agentId),
      activityCount: database.prepare(`
        SELECT COUNT(*) AS count
        FROM activities
      `).get()?.count,
    }
  } finally {
    database.close()
  }
}

afterAll(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('Project OS Agent Skill package', () => {
  it('contains current configs and no legacy SSE', () => {
    expect(read('SKILL.md')).toContain('agent_register')
    expect(read('references/codex-config.md'))
      .toContain('[mcp_servers.project-os]')
    expect(read('references/claude-code-config.md'))
      .toContain('claude mcp add --transport stdio')
    expect(read('references/kimi-code-config.md'))
      .toContain('.kimi-code/mcp.json')
    expect(allText()).toContain('/apps/mcp/dist/stdio.js')
    expect(allText()).toContain('/data/project_manage.db')
    expect(allText()).not.toMatch(/transport["']?\s*:\s*["']sse/i)
  })

  it('documents exactly the approved 22-tool surface', () => {
    const reference = read('references/tool-reference.md')
    const toolNames = reference.match(/`[a-z][a-z_]+`/g)
      ?.map((name) => name.slice(1, -1))

    expect(toolNames).toEqual([
      'agent_register',
      'agent_whoami',
      'agent_list',
      'project_create',
      'project_get',
      'project_list',
      'project_update',
      'task_create',
      'task_get',
      'task_list',
      'task_update',
      'progress_submit',
      'requirement_create',
      'requirement_list',
      'requirement_update',
      'defect_create',
      'defect_list',
      'defect_update',
      'defect_to_task',
      'dashboard_snapshot',
      'list_overdue',
      'activity_log',
    ])
    expect(allText()).not.toMatch(/\b(requirement_get|defect_get)\b/)
  })

  it('keeps SKILL frontmatter minimal and openai metadata usable', () => {
    const skill = read('SKILL.md')
    const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]

    expect(frontmatter?.match(/^[a-z_]+:/gm)).toEqual([
      'name:',
      'description:',
    ])
    expect(read('agents/openai.yaml')).toContain(
      'default_prompt: "Use $project-os',
    )
  })

  it('keeps ordinary connection verification read-only', () => {
    const verifier = read('scripts/verify-connection.mjs')

    expect(verifier).toContain("'--write-smoke'")
    expect(verifier).toContain('agent_whoami')
    expect(verifier).toContain('project_list')
    expect(verifier).toContain('list_overdue')
    expect(verifier).toContain('activity_log')
    expect(verifier).toMatch(/if \(options\.writeSmoke\)/)

    const help = execFileSync(
      process.execPath,
      [verifierPath, '--help'],
      { encoding: 'utf8' },
    )
    expect(help).toContain('--write-smoke')
  })

  it('does not touch Agent or activity state without write-smoke', () => {
    const directory = mkdtempSync(join(tmpdir(), 'project-os-skill-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'verify.db')
    const seeded = JSON.parse(runVerifier(
      '--database',
      databasePath,
      '--write-smoke',
    )) as {
      agentId: string
      mode: string
      sideEffects: string[]
    }
    expect(seeded).toMatchObject({
      mode: 'write-smoke',
      sideEffects: [
        'registers or resumes the dedicated smoke-test Agent',
        'updates Agent last-active state',
      ],
    })
    const before = databaseSnapshot(databasePath, seeded.agentId)

    const ordinary = JSON.parse(runVerifier(
      '--database',
      databasePath,
    )) as {
      checks: string[]
      mode: string
      sideEffects: string[]
      toolCount: number
      writeSmoke: boolean
    }
    expect(ordinary).toMatchObject({
      checks: ['listTools'],
      mode: 'contract-only',
      sideEffects: [],
      toolCount: 22,
      writeSmoke: false,
    })

    const environment = { ...process.env }
    delete environment.PROJECT_OS_AGENT_ID
    const rejected = spawnSync(
      process.execPath,
      [
        verifierPath,
        '--entry',
        builtMcpEntry,
        '--database',
        databasePath,
        '--agent-id',
        seeded.agentId,
      ],
      {
        encoding: 'utf8',
        env: environment,
      },
    )
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain(
      '--agent-id requires --write-smoke',
    )
    expect(databaseSnapshot(databasePath, seeded.agentId)).toEqual(before)
  })
})
