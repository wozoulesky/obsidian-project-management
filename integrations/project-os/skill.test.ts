import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const skillDirectory = fileURLToPath(new URL('.', import.meta.url))

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
      [join(skillDirectory, 'scripts/verify-connection.mjs'), '--help'],
      { encoding: 'utf8' },
    )
    expect(help).toContain('--write-smoke')
  })
})
