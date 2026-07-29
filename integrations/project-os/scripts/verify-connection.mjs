#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js'

const approvedTools = [
  'activity_log',
  'agent_list',
  'agent_register',
  'agent_whoami',
  'dashboard_snapshot',
  'defect_create',
  'defect_list',
  'defect_to_task',
  'defect_update',
  'list_overdue',
  'progress_submit',
  'project_create',
  'project_get',
  'project_list',
  'project_update',
  'requirement_create',
  'requirement_list',
  'requirement_update',
  'task_create',
  'task_get',
  'task_list',
  'task_update',
]

function valueAfter(arguments_, index, flag) {
  const value = arguments_[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parseOptions(arguments_) {
  const defaultRoot = resolve(
    fileURLToPath(new URL('../../..', import.meta.url)),
  )
  const options = {
    root: process.env.PROJECT_OS_ROOT ?? defaultRoot,
    entry: process.env.PROJECT_OS_MCP_ENTRY,
    database: process.env.PROJECT_OS_DB,
    agentId: process.env.PROJECT_OS_AGENT_ID,
    writeSmoke: false,
    help: false,
  }

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--write-smoke') {
      options.writeSmoke = true
    } else if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--root') {
      options.root = valueAfter(arguments_, index, argument)
      index += 1
    } else if (argument === '--entry') {
      options.entry = valueAfter(arguments_, index, argument)
      index += 1
    } else if (argument === '--database') {
      options.database = valueAfter(arguments_, index, argument)
      index += 1
    } else if (argument === '--agent-id') {
      options.agentId = valueAfter(arguments_, index, argument)
      index += 1
    } else {
      throw new Error(`Unknown option: ${argument}`)
    }
  }

  if (options.agentId !== undefined && !options.writeSmoke) {
    throw new Error(
      '--agent-id requires --write-smoke because authenticated MCP calls '
      + 'update Agent activity',
    )
  }

  options.root = resolve(options.root)
  options.entry = resolve(
    options.entry ?? resolve(options.root, 'apps/mcp/dist/stdio.js'),
  )
  options.database = resolve(
    options.database ?? resolve(options.root, 'data/project_manage.db'),
  )
  return options
}

function usage() {
  return [
    'Usage: node scripts/verify-connection.mjs [options]',
    '',
    'Options:',
    '  --root <path>       Project OS root (or PROJECT_OS_ROOT)',
    '  --entry <path>      stdio entry (or PROJECT_OS_MCP_ENTRY)',
    '  --database <path>   SQLite path (or PROJECT_OS_DB)',
    '  --agent-id <id>     Existing Agent ID; requires --write-smoke',
    '  --write-smoke       WRITE: register/resume or touch a smoke-test Agent',
    '  --help              Show this help',
    '',
    'Without --write-smoke, verification only discovers the exact tool',
    'contract and does not call authenticated Project OS tools.',
  ].join('\n')
}

function assertSuccess(name, result) {
  if (result.isError) {
    const detail = result.structuredContent === undefined
      ? JSON.stringify(result.content)
      : JSON.stringify(result.structuredContent)
    throw new Error(`${name} failed: ${detail}`)
  }
  return result.structuredContent ?? {}
}

async function call(client, name, arguments_) {
  return assertSuccess(name, await client.callTool({
    name,
    arguments: arguments_,
  }))
}

async function verify(options) {
  if (!existsSync(options.entry)) {
    throw new Error(
      `MCP entry not found: ${options.entry}. Run the MCP build first `
      + 'or pass --entry/PROJECT_OS_MCP_ENTRY.',
    )
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [options.entry],
    env: {
      ...getDefaultEnvironment(),
      PROJECT_OS_DB: options.database,
    },
    stderr: 'pipe',
  })
  const client = new Client({
    name: 'project-os-skill-verifier',
    version: '0.1.0',
  })

  try {
    await client.connect(transport)
    const discovered = (await client.listTools()).tools
      .map(({ name }) => name)
      .sort()
    const missing = approvedTools.filter((name) => !discovered.includes(name))
    const unexpected = discovered.filter((name) => !approvedTools.includes(name))
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        `Unexpected tool surface. Missing: ${missing.join(', ') || 'none'}; `
        + `unexpected: ${unexpected.join(', ') || 'none'}`,
      )
    }

    const checks = ['listTools']
    let agentId
    if (options.writeSmoke) {
      if (options.agentId === undefined) {
        const identity = await call(client, 'agent_register', {
          name: 'project-os-connection-verifier',
          role: 'doc-agent',
          client: 'skill-verifier',
          capabilities: ['connection-smoke'],
        })
        agentId = identity.agent_id
      } else {
        agentId = options.agentId
      }
      await call(client, 'agent_whoami', { agent_id: agentId })
      await call(client, 'project_list', {
        agent_id: agentId,
        limit: 1,
      })
      await call(client, 'list_overdue', { agent_id: agentId })
      await call(client, 'activity_log', {
        agent_id: agentId,
        limit: 1,
      })
      checks.push(
        'agent_whoami',
        'project_list',
        'list_overdue',
        'activity_log',
      )
    }

    return {
      ok: true,
      mode: options.writeSmoke ? 'write-smoke' : 'contract-only',
      transport: 'stdio',
      entry: options.entry,
      database: options.database,
      toolCount: discovered.length,
      checks,
      writeSmoke: options.writeSmoke,
      sideEffects: options.writeSmoke
        ? [
            ...(options.agentId === undefined
              ? ['registers or resumes the dedicated smoke-test Agent']
              : []),
            'updates Agent last-active state',
          ]
        : [],
      ...(agentId === undefined ? {} : { agentId }),
    }
  } finally {
    await client.close()
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  const result = await verify(options)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Project OS connection verification failed: ${message}\n`)
  process.exitCode = 1
})
