#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packagedProjectRoot = '{{PROJECT_OS_ROOT}}'
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
  'project_briefing',
  'project_create',
  'project_get',
  'project_list',
  'project_update',
  'requirement_create',
  'requirement_list',
  'requirement_update',
  'session_checkin',
  'session_checkout',
  'session_note',
  'task_create',
  'task_get',
  'task_list',
  'task_update',
  'deliverable_record',
]

function valueAfter(arguments_, index, flag) {
  const value = arguments_[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parseOptions(arguments_) {
  const bundledRoot = packagedProjectRoot.startsWith('{{')
    ? undefined
    : packagedProjectRoot
  const defaultRoot = resolve(
    bundledRoot
      ?? fileURLToPath(new URL('../../..', import.meta.url)),
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

class StdioJsonRpcClient {
  #buffer = ''
  #child
  #nextId = 1
  #pending = new Map()
  #stderr = ''

  constructor(options) {
    this.#child = spawn(process.execPath, [options.entry], {
      env: {
        ...process.env,
        PROJECT_OS_DB: options.database,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.#child.stdout.setEncoding('utf8')
    this.#child.stderr.setEncoding('utf8')
    this.#child.stdout.on('data', (chunk) => this.#read(chunk))
    this.#child.stderr.on('data', (chunk) => {
      this.#stderr += chunk
    })
    this.#child.on('error', (error) => this.#rejectPending(error))
    this.#child.on('exit', (code) => {
      if (this.#pending.size > 0) {
        const detail = this.#stderr.trim()
        this.#rejectPending(new Error(
          `MCP stdio server exited with code ${code}`
          + (detail === '' ? '' : `: ${detail}`),
        ))
      }
    })
  }

  #read(chunk) {
    this.#buffer += chunk
    while (true) {
      const newline = this.#buffer.indexOf('\n')
      if (newline < 0) return
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '')
      this.#buffer = this.#buffer.slice(newline + 1)
      if (line === '') continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        this.#rejectPending(new Error('MCP server returned invalid JSON'))
        continue
      }
      if (
        message === null
        || typeof message !== 'object'
        || !('id' in message)
      ) {
        continue
      }
      const pending = this.#pending.get(message.id)
      if (pending === undefined) continue
      this.#pending.delete(message.id)
      clearTimeout(pending.timeout)
      if ('error' in message) {
        pending.reject(new Error(
          typeof message.error?.message === 'string'
            ? message.error.message
            : 'MCP request failed',
        ))
      } else {
        pending.resolve(message.result)
      }
    }
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #write(message) {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  request(method, params = {}) {
    const id = this.#nextId
    this.#nextId += 1
    return new Promise((resolve_, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`MCP request timed out: ${method}`))
      }, 10_000)
      this.#pending.set(id, { reject, resolve: resolve_, timeout })
      this.#write({
        jsonrpc: '2.0',
        id,
        method,
        params,
      })
    })
  }

  notification(method, params = {}) {
    this.#write({
      jsonrpc: '2.0',
      method,
      params,
    })
  }

  async connect() {
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: {
        name: 'project-os-skill-verifier',
        version: '0.1.0',
      },
    })
    this.notification('notifications/initialized')
  }

  listTools() {
    return this.request('tools/list')
  }

  callTool(name, arguments_) {
    return this.request('tools/call', {
      name,
      arguments: arguments_,
    })
  }

  async close() {
    if (this.#child.exitCode !== null) return
    const exited = new Promise((resolve_) => {
      this.#child.once('exit', resolve_)
    })
    this.#child.kill()
    await Promise.race([
      exited,
      new Promise((resolve_) => setTimeout(resolve_, 2_000)),
    ])
  }
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
  return assertSuccess(name, await client.callTool(name, arguments_))
}

async function verify(options) {
  if (!existsSync(options.entry)) {
    throw new Error(
      `MCP entry not found: ${options.entry}. Run the MCP build first `
      + 'or pass --entry/PROJECT_OS_MCP_ENTRY.',
    )
  }

  const client = new StdioJsonRpcClient(options)
  try {
    await client.connect()
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
