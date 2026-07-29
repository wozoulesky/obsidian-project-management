#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const artifactsRoot = join(repositoryRoot, 'artifacts', 'mcp-smoke')
const mcpEntry = join(repositoryRoot, 'apps', 'mcp', 'dist', 'stdio.js')
const supportedClients = ['codex', 'claude', 'kimi']
const proofKeys = [
  'tools_discovered',
  'identity_registered',
  'project_read',
  'progress_written',
  'activity_verified',
]
const evidenceKeys = [
  'client',
  'installed',
  'authenticated',
  ...proofKeys,
  'error',
]
const requiredTools = [
  'agent_register',
  'project_list',
  'progress_submit',
  'activity_log',
]
const clientDefinitions = {
  codex: { executable: 'codex', identityClient: 'codex' },
  claude: { executable: 'claude', identityClient: 'claude-code' },
  kimi: { executable: 'kimi', identityClient: 'kimi-code' },
}

function usage() {
  return [
    'Usage: node scripts/smoke-clients.mjs [options]',
    '',
    '  --self-test                 Run free local harness tests',
    '  --clients <names>           Comma-separated codex,claude,kimi',
    '  --timeout-ms <milliseconds> Per-client timeout (default 120000)',
    '  --write-smoke               Invoke isolated installed clients',
    '  --help                      Show this help',
  ].join('\n')
}

function valueAfter(arguments_, index, flag) {
  const value = arguments_[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parseOptions(arguments_) {
  const options = {
    clients: [...supportedClients],
    help: false,
    selfTest: false,
    timeoutMs: 120_000,
    writeSmoke: false,
  }
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--self-test') {
      options.selfTest = true
    } else if (argument === '--write-smoke') {
      options.writeSmoke = true
    } else if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--clients') {
      const clients = valueAfter(arguments_, index, argument)
        .split(',').map((item) => item.trim()).filter(Boolean)
      if (
        clients.length === 0
        || clients.some((item) => !supportedClients.includes(item))
      ) {
        throw new Error(`--clients accepts only ${supportedClients.join(', ')}`)
      }
      options.clients = [...new Set(clients)]
      index += 1
    } else if (argument === '--timeout-ms') {
      const selected = valueAfter(arguments_, index, argument)
      if (!/^\d+$/.test(selected)) {
        throw new Error('--timeout-ms must be an integer')
      }
      options.timeoutMs = Number(selected)
      if (options.timeoutMs < 1_000 || options.timeoutMs > 600_000) {
        throw new Error('--timeout-ms must be between 1000 and 600000')
      }
      index += 1
    } else {
      throw new Error(`Unknown option: ${argument}`)
    }
  }
  return options
}

function parseInternalOptions(arguments_) {
  const options = {}
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index]
    const value = arguments_[index + 1]
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error('Invalid internal smoke arguments')
    }
    options[flag.slice(2)] = value
  }
  return options
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
}

async function terminateTree(child) {
  if (!Number.isInteger(child.pid)) return
  if (process.platform === 'win32') {
    const result = await new Promise((resolveTaskkill) => {
      const killer = spawn(
        'taskkill.exe',
        ['/pid', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true },
      )
      killer.once('error', () => resolveTaskkill(false))
      killer.once('exit', (code) => resolveTaskkill(code === 0))
    })
    if (!result && child.exitCode === null) child.kill('SIGKILL')
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  await sleep(300)
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

function runBounded(command, arguments_, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000
  const outputLimit = options.outputLimit ?? 256_000
  return new Promise((resolveRun) => {
    let child
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let timer
    let fallbackTimer
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(fallbackTimer)
      resolveRun({ stdout, stderr, timedOut, ...result })
    }
    try {
      child = spawn(command, arguments_, {
        cwd: options.cwd ?? repositoryRoot,
        env: options.environment ?? process.env,
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      finish({ error, exitCode: null, ok: false })
      return
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-outputLimit)
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-outputLimit)
    })
    child.once('error', (error) => {
      finish({ error, exitCode: null, ok: false })
    })
    child.once('exit', (exitCode, signal) => {
      finish({
        error: undefined,
        exitCode,
        ok: exitCode === 0 && !timedOut,
        signal,
      })
    })
    timer = setTimeout(() => {
      timedOut = true
      void terminateTree(child).finally(() => {
        fallbackTimer = setTimeout(() => {
          finish({
            error: new Error(`Client timed out after ${timeoutMs}ms`),
            exitCode: child.exitCode,
            ok: false,
            signal: child.signalCode,
          })
        }, 1_000)
      })
    }, timeoutMs)
  })
}

function executableInvocation(executable, arguments_, environment) {
  const extension = extname(executable).toLowerCase()
  if (
    process.platform !== 'win32'
    || !['.cmd', '.bat', '.ps1'].includes(extension)
  ) {
    return { command: executable, arguments: arguments_, environment }
  }
  const adaptedEnvironment = {
    ...environment,
    PROJECT_OS_SMOKE_EXECUTABLE: executable,
  }
  const references = []
  for (const [index, argument] of arguments_.entries()) {
    const key = `PROJECT_OS_SMOKE_ARG_${index}`
    adaptedEnvironment[key] = extension === '.ps1'
      ? argument
      : `"${argument.replaceAll('"', '\\"').replaceAll('%', '%%')}"`
    references.push(`$env:${key}`)
  }
  const command = extension === '.ps1'
    ? `& $env:PROJECT_OS_SMOKE_EXECUTABLE @(${references.join(',')})`
    : `& $env:PROJECT_OS_SMOKE_EXECUTABLE @(${references.join(',')})`
  return {
    command: 'powershell.exe',
    arguments: ['-NoProfile', '-NonInteractive', '-Command', command],
    environment: adaptedEnvironment,
  }
}

function runExecutable(executable, arguments_, options = {}) {
  const invocation = executableInvocation(
    executable,
    arguments_,
    options.environment ?? process.env,
  )
  return runBounded(invocation.command, invocation.arguments, {
    ...options,
    environment: invocation.environment,
  })
}

async function discoverCommand(name, environment = process.env) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error('Unsafe executable name')
  }
  const result = process.platform === 'win32'
    ? await runBounded('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$candidate = Get-Command '${name}' -ErrorAction SilentlyContinue `
          + '| Select-Object -First 1 -ExpandProperty Source; '
          + 'if ($null -ne $candidate) { [Console]::Out.Write($candidate) }',
      ], { environment, timeoutMs: 5_000 })
    : await runBounded('sh', ['-c', 'command -v "$1"', 'sh', name], {
        environment,
        timeoutMs: 5_000,
      })
  const selected = result.stdout.trim().split(/\r?\n/)[0]
  return result.ok && selected !== '' ? resolve(selected) : undefined
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function redact(value, paths = [], environment = process.env) {
  let output = String(value)
  const secrets = Object.entries(environment)
    .filter(([name, item]) =>
      typeof item === 'string'
      && item.length >= 8
      && /(TOKEN|API[_-]?KEY|SECRET|PASSWORD|AUTH|CREDENTIAL)/i.test(name))
    .map(([, item]) => item)
  const replacements = [
    ...paths.filter(Boolean).map((path) => [resolve(path), '<TEMP>']),
    [repositoryRoot, '<WORKSPACE>'],
    [homedir(), '<HOME>'],
    ...secrets.map((secret) => [secret, '<SECRET>']),
  ].flatMap(([sensitive, replacement]) => [
    [sensitive, replacement],
    [sensitive.replaceAll('\\', '/'), replacement],
  ])
  for (const [sensitive, replacement] of replacements) {
    if (sensitive === '') continue
    output = output.replace(
      new RegExp(escapeRegularExpression(sensitive), 'gi'),
      replacement,
    )
  }
  return output
    .replace(/\bpos_[A-Za-z0-9._-]+\b/g, '<TOKEN>')
    .replace(/\b(?:sk|api)[-_][A-Za-z0-9._-]{8,}\b/gi, '<API_KEY>')
    .replace(
      /\b(Bearer|Authorization)\s*[:=]?\s*[A-Za-z0-9._~+/-]{8,}=*/gi,
      '$1 <SECRET>',
    )
    .replace(
      /\b(api[_-]?key|token|secret|password|credential)\s*[:=]\s*["']?[^"'\s,}]+/gi,
      '$1=<SECRET>',
    )
}

function emptyEvidence(client, installed) {
  return {
    client,
    installed,
    authenticated: false,
    tools_discovered: false,
    identity_registered: false,
    project_read: false,
    progress_written: false,
    activity_verified: false,
    error: null,
  }
}

function validEvidence(evidence) {
  return (
    evidence !== null
    && typeof evidence === 'object'
    && !Array.isArray(evidence)
    && Object.keys(evidence).length === evidenceKeys.length
    && evidenceKeys.every((key) => key in evidence)
    && typeof evidence.client === 'string'
    && typeof evidence.installed === 'boolean'
    && typeof evidence.authenticated === 'boolean'
    && proofKeys.every((key) => typeof evidence[key] === 'boolean')
    && (evidence.error === null || typeof evidence.error === 'string')
  )
}

function completeEvidence(evidence) {
  return evidence.installed
    && evidence.authenticated
    && proofKeys.every((key) => evidence[key])
    && evidence.error === null
}

function authenticationFailure(output) {
  return /(not logged in|login required|please (?:run|use).*login|unauthorized|authentication failed|invalid api key|missing api key|credential.*(?:missing|not found)|\b401\b)/i
    .test(output)
}

function safeAuditArguments(value, key = '') {
  if (/(token|secret|password|authorization|api[_-]?key)/i.test(key)) {
    return '<REDACTED>'
  }
  if (Array.isArray(value)) {
    return value.map((item) => safeAuditArguments(item))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nested]) => [
        nestedKey,
        safeAuditArguments(nested, nestedKey),
      ]),
    )
  }
  return value
}

function appendAudit(path, event) {
  appendFileSync(path, `${JSON.stringify(event)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

function jsonLineTap(onMessage) {
  let buffer = ''
  return (chunk) => {
    buffer += chunk.toString('utf8')
    while (true) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (line === '') continue
      try {
        onMessage(JSON.parse(line))
      } catch {
        // The proxy remains transparent if a peer emits non-JSON diagnostics.
      }
    }
  }
}

async function runAuditProxy(options) {
  const pending = new Map()
  const server = spawn(process.execPath, [options.entry], {
    env: { ...process.env, PROJECT_OS_DB: options.database },
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const requestTap = jsonLineTap((message) => {
    if (message?.id === undefined) return
    if (message.method === 'tools/list') {
      pending.set(String(message.id), { type: 'tools_list' })
    } else if (message.method === 'tools/call') {
      pending.set(String(message.id), {
        type: 'tool_call',
        name: message.params?.name,
        arguments: safeAuditArguments(message.params?.arguments ?? {}),
      })
    }
  })
  const responseTap = jsonLineTap((message) => {
    if (message?.id === undefined) return
    const request = pending.get(String(message.id))
    if (request === undefined) return
    pending.delete(String(message.id))
    const success = message.error === undefined && message.result?.isError !== true
    if (request.type === 'tools_list') {
      appendAudit(options.audit, {
        type: 'tools_list',
        success,
        toolNames: Array.isArray(message.result?.tools)
          ? message.result.tools.map((tool) => tool.name)
            .filter((name) => typeof name === 'string')
          : [],
      })
    } else {
      appendAudit(options.audit, {
        ...request,
        success,
      })
    }
  })
  process.stdin.on('data', (chunk) => {
    requestTap(chunk)
    server.stdin.write(chunk)
  })
  process.stdin.on('end', () => server.stdin.end())
  server.stdout.on('data', (chunk) => {
    responseTap(chunk)
    process.stdout.write(chunk)
  })
  server.stderr.pipe(process.stderr)
  const close = () => {
    if (server.exitCode === null) server.kill('SIGTERM')
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    server.once('error', rejectExit)
    server.once('exit', (code) => resolveExit(code ?? 1))
  })
  process.off('SIGINT', close)
  process.off('SIGTERM', close)
  process.exitCode = exitCode
}

async function seedSmokeDatabase(workRoot, client) {
  const definition = clientDefinitions[client]
  const database = join(workRoot, `${client}.sqlite`)
  const backupRoot = join(workRoot, 'backups')
  const seedScript = join(workRoot, 'seed.mts')
  const agentName = `project-os-smoke-${client}`
  await mkdir(backupRoot, { recursive: true })
  const contextUrl = pathToFileURL(
    join(repositoryRoot, 'apps', 'server', 'src', 'context.ts'),
  ).href
  const coreUrl = pathToFileURL(
    join(repositoryRoot, 'packages', 'core', 'src', 'index.ts'),
  ).href
  const source = `
import { createAppContext, defaultSeedDocument } from ${JSON.stringify(contextUrl)}
import { seedDatabase } from ${JSON.stringify(coreUrl)}
const context = createAppContext({
  databasePath: ${JSON.stringify(database)},
  backupRoot: ${JSON.stringify(backupRoot)},
})
try {
  seedDatabase(context.database, defaultSeedDocument)
  const agent = context.services.actors.registerAgent({
    name: ${JSON.stringify(agentName)},
    role: 'dev-agent',
    client: ${JSON.stringify(definition.identityClient)},
    capabilities: ['mcp-smoke'],
  })
  context.services.projects.addMember(
    'project_default', agent.id, 'actor_local_owner', 'web'
  )
  const today = new Date().toISOString().slice(0, 10)
  const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const task = context.services.tasks.create({
    projectId: 'project_default',
    title: ${JSON.stringify(`MCP smoke ${client}`)},
    description: 'Isolated real-client smoke task',
    assigneeId: agent.id,
    startDate: today,
    dueDate: due,
    priority: 'P2',
  }, 'actor_local_owner', 'web')
  context.database.prepare(
    'UPDATE actors SET last_active_at = NULL WHERE id = ?'
  ).run(agent.id)
  process.stdout.write(JSON.stringify({
    agentId: agent.id,
    agentName: agent.name,
    projectId: 'project_default',
    taskId: task.id,
    taskVersion: task.version,
  }))
} finally {
  context.close()
}
`
  await writeFile(seedScript, source, { encoding: 'utf8', mode: 0o600 })
  const result = await runBounded(
    process.execPath,
    ['--import', 'tsx', seedScript],
    { cwd: repositoryRoot, timeoutMs: 30_000 },
  )
  if (!result.ok) {
    throw new Error(`Smoke database seed failed: ${result.stderr}`)
  }
  return { database, ...JSON.parse(result.stdout) }
}

function smokePrompt(client, seed, nonce) {
  return [
    'Use only the configured Project OS MCP server for this bounded smoke test.',
    'Do not read or edit workspace files and do not use shell/network tools.',
    'Discover the available Project OS tools.',
    `Call agent_register with name ${JSON.stringify(seed.agentName)}, `
      + `role "dev-agent", client `
      + `${JSON.stringify(clientDefinitions[client].identityClient)}, `
      + 'and capability "mcp-smoke".',
    `Use the returned agent_id to call project_list and confirm `
      + `${seed.projectId} exists.`,
    `Call progress_submit for task ${seed.taskId}, progress 67, `
      + `status "in_progress", note ${JSON.stringify(`smoke-${nonce}`)}, `
      + `version ${seed.taskVersion}.`,
    'Call activity_log with the returned agent_id and verify task.progress.',
    'Finish with a short plain-text summary. Do not emit an evidence verdict.',
  ].join('\n')
}

function proxyDefinition(seed, auditPath) {
  return {
    command: process.execPath,
    args: [
      scriptPath,
      '--audit-proxy',
      '--entry', mcpEntry,
      '--database', seed.database,
      '--audit', auditPath,
    ],
  }
}

async function writeMcpConfig(path, proxy, includeType = true) {
  await writeFile(path, JSON.stringify({
    mcpServers: {
      'project-os': {
        ...(includeType ? { type: 'stdio' } : {}),
        command: proxy.command,
        args: proxy.args,
      },
    },
  }, null, 2), { encoding: 'utf8', mode: 0o600 })
}

function globalClientFiles(client) {
  const profile = process.env.USERPROFILE ?? homedir()
  if (client === 'codex') {
    const root = join(profile, '.codex')
    return {
      credentialFiles: [join(root, 'auth.json')],
      watchedFiles: [
        join(root, 'auth.json'),
        join(root, 'config.toml'),
        join(root, '.codex-global-state.json'),
      ],
    }
  }
  if (client === 'claude') {
    const root = join(profile, '.claude')
    return {
      credentialFiles: [join(root, '.credentials.json')],
      watchedFiles: [
        join(root, '.credentials.json'),
        join(root, 'settings.json'),
        join(profile, '.claude.json'),
      ],
    }
  }
  const root = join(profile, '.kimi-code')
  return {
    credentialFiles: [
      join(root, 'config.toml'),
      join(root, 'device_id'),
      join(root, 'server.token'),
    ],
    watchedFiles: [
      join(root, 'config.toml'),
      join(root, 'device_id'),
      join(root, 'server.token'),
      join(root, 'session_index.jsonl'),
      join(root, 'workspaces.json'),
    ],
  }
}

function fileFingerprint(path) {
  if (!existsSync(path)) return { exists: false }
  const details = statSync(path)
  return {
    exists: true,
    size: details.size,
    mtimeMs: details.mtimeMs,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  }
}

function snapshotFiles(paths) {
  return Object.fromEntries(paths.map((path) => [path, fileFingerprint(path)]))
}

function snapshotsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function copyCredential(source, destination) {
  await mkdir(resolve(destination, '..'), { recursive: true })
  await copyFile(source, destination)
  await chmod(destination, 0o600)
}

async function prepareIsolatedState(client, workRoot) {
  const definition = globalClientFiles(client)
  const before = snapshotFiles(definition.watchedFiles)
  const isolatedHome = join(workRoot, 'home')
  await mkdir(isolatedHome, { recursive: true })
  const environment = {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
  }
  if (client === 'codex') {
    const source = definition.credentialFiles[0]
    if (!existsSync(source)) {
      throw new Error('Codex credential file is unavailable for isolation')
    }
    const codexHome = join(isolatedHome, '.codex')
    await copyCredential(source, join(codexHome, 'auth.json'))
    environment.CODEX_HOME = codexHome
  } else if (client === 'claude') {
    const credential = definition.credentialFiles.find(existsSync)
    const environmentAuth = Object.entries(process.env).some(([name, value]) =>
      /^(ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)$/.test(name)
      && typeof value === 'string'
      && value.length > 0)
    if (credential === undefined && !environmentAuth) {
      throw new Error(
        'Claude credentials are not file- or environment-isolatable',
      )
    }
    if (credential !== undefined) {
      await copyCredential(
        credential,
        join(isolatedHome, '.claude', '.credentials.json'),
      )
    }
  } else {
    const present = definition.credentialFiles.filter(existsSync)
    if (!present.some((path) => path.endsWith('config.toml'))) {
      throw new Error('Kimi credential configuration is unavailable')
    }
    for (const source of present) {
      await copyCredential(
        source,
        join(isolatedHome, '.kimi-code', source.split(/[\\/]/).at(-1)),
      )
    }
  }
  return {
    assertUnchanged() {
      return snapshotsEqual(before, snapshotFiles(definition.watchedFiles))
    },
    environment,
    isolatedHome,
  }
}

async function clientInvocation(
  client,
  executable,
  workRoot,
  seed,
  prompt,
  environment,
  auditPath,
) {
  const proxy = proxyDefinition(seed, auditPath)
  const configPath = join(workRoot, 'mcp.json')
  await writeMcpConfig(configPath, proxy)
  if (client === 'codex') {
    const configPathToml = join(environment.CODEX_HOME, 'config.toml')
    await writeFile(configPathToml, [
      '[mcp_servers.project_os]',
      `command = ${JSON.stringify(proxy.command)}`,
      `args = ${JSON.stringify(proxy.args)}`,
      '',
    ].join('\n'), { encoding: 'utf8', mode: 0o600 })
    return {
      arguments: [
        'exec', '--json', '--skip-git-repo-check',
        '--sandbox', 'workspace-write', prompt,
      ],
      executable,
    }
  }
  if (client === 'claude') {
    return {
      arguments: [
        '--print', prompt,
        '--output-format', 'json',
        '--no-session-persistence',
        '--strict-mcp-config',
        '--mcp-config', configPath,
        '--permission-mode', 'dontAsk',
        '--allowedTools',
        requiredTools.map((name) => `mcp__project-os__${name}`).join(','),
      ],
      executable,
    }
  }
  await mkdir(join(workRoot, '.kimi-code'), { recursive: true })
  await writeMcpConfig(
    join(workRoot, '.kimi-code', 'mcp.json'),
    proxy,
    false,
  )
  return {
    arguments: ['--output-format', 'stream-json', '--prompt', prompt],
    executable,
  }
}

function readAudit(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line))
}

function matchingCall(events, name, predicate) {
  return events.some((event) =>
    event.type === 'tool_call'
    && event.name === name
    && event.success === true
    && predicate(event.arguments ?? {}))
}

function auditProof(events, seed, note) {
  const tools = events.find((event) =>
    event.type === 'tools_list' && event.success === true)
  return {
    tools_discovered:
      tools !== undefined
      && requiredTools.every((name) => tools.toolNames.includes(name)),
    identity_registered: matchingCall(
      events,
      'agent_register',
      (arguments_) =>
        arguments_.name === seed.agentName
        && arguments_.role === 'dev-agent'
        && arguments_.client === seed.identityClient
        && arguments_.capabilities?.includes('mcp-smoke'),
    ),
    project_read: matchingCall(
      events,
      'project_list',
      (arguments_) => arguments_.agent_id === seed.agentId,
    ),
    progress_written: matchingCall(
      events,
      'progress_submit',
      (arguments_) =>
        arguments_.agent_id === seed.agentId
        && arguments_.task_id === seed.taskId
        && arguments_.progress === 67
        && arguments_.status === 'in_progress'
        && arguments_.note === note
        && arguments_.version === seed.taskVersion,
    ),
    activity_verified: matchingCall(
      events,
      'activity_log',
      (arguments_) => arguments_.agent_id === seed.agentId,
    ),
  }
}

async function verifyDatabase(seed, expectedNote) {
  const source = `
import { DatabaseSync } from 'node:sqlite'
const database = new DatabaseSync(${JSON.stringify(seed.database)}, {
  readOnly: true,
})
try {
  const actor = database.prepare(
    'SELECT last_active_at FROM actors WHERE id = ? AND name = ? AND client = ?'
  ).get(
    ${JSON.stringify(seed.agentId)},
    ${JSON.stringify(seed.agentName)},
    ${JSON.stringify(seed.identityClient)},
  )
  const task = database.prepare(
    'SELECT progress, status FROM tasks WHERE id = ? AND assignee_id = ?'
  ).get(${JSON.stringify(seed.taskId)}, ${JSON.stringify(seed.agentId)})
  const activity = database.prepare(\`
    SELECT 1 FROM activities
    WHERE actor_id = ? AND entity_id = ? AND operation = 'task.progress'
      AND source = 'mcp' AND note = ? LIMIT 1
  \`).get(
    ${JSON.stringify(seed.agentId)},
    ${JSON.stringify(seed.taskId)},
    ${JSON.stringify(expectedNote)},
  )
  const project = database.prepare(\`
    SELECT 1 FROM projects AS p
    JOIN project_members AS pm ON pm.project_id = p.id
    WHERE p.id = ? AND pm.actor_id = ?
    LIMIT 1
  \`).get(
    ${JSON.stringify(seed.projectId)},
    ${JSON.stringify(seed.agentId)},
  )
  process.stdout.write(JSON.stringify({
    database_healthy: true,
    identity_registered: actor?.last_active_at != null,
    project_read: project !== undefined,
    progress_written: task?.progress === 67 && task?.status === 'in_progress',
    activity_verified: activity !== undefined,
  }))
} finally {
  database.close()
}
`
  const result = await runBounded(
    process.execPath,
    ['--no-warnings', '--input-type=module', '--eval', source],
    { timeoutMs: 10_000 },
  )
  if (!result.ok) throw new Error('Smoke database verification failed')
  return JSON.parse(result.stdout)
}

function diagnosticError(result, audit, paths) {
  const output = `${result.stderr}\n${result.stdout}`.trim()
  let message
  if (result.timedOut) {
    message = 'Client invocation timed out'
  } else if (result.error !== undefined) {
    message = `Client could not start: ${result.error.message}`
  } else if (authenticationFailure(output)) {
    message = 'Client authentication failed'
  } else if (!result.ok) {
    message = output === ''
      ? `Client exited with code ${result.exitCode}`
      : output.slice(-1_000)
  } else if (audit.length === 0) {
    message = 'Client completed without audited MCP traffic'
  } else {
    message = 'Audited MCP workflow was incomplete'
  }
  return redact(message, paths).slice(0, 1_000)
}

async function smokeClient(client, timeoutMs) {
  const definition = clientDefinitions[client]
  const evidence = emptyEvidence(client, false)
  const executable = await discoverCommand(definition.executable)
  if (executable === undefined) {
    evidence.error = 'CLI not installed'
    return evidence
  }
  evidence.installed = true
  const workRoot = await mkdtemp(join(tmpdir(), `project-os-${client}-`))
  let isolation
  try {
    isolation = await prepareIsolatedState(client, workRoot)
    const seed = await seedSmokeDatabase(workRoot, client)
    seed.identityClient = definition.identityClient
    const nonce = `${Date.now()}-${process.pid}`
    const note = `smoke-${nonce}`
    const auditPath = join(workRoot, 'mcp-audit.jsonl')
    const prompt = smokePrompt(client, seed, nonce)
    const invocation = await clientInvocation(
      client,
      executable,
      workRoot,
      seed,
      prompt,
      isolation.environment,
      auditPath,
    )
    const result = await runExecutable(
      invocation.executable,
      invocation.arguments,
      {
        cwd: workRoot,
        environment: isolation.environment,
        timeoutMs,
      },
    )
    const unchanged = isolation.assertUnchanged()
    const events = readAudit(auditPath)
    const audited = auditProof(events, seed, note)
    const database = await verifyDatabase(seed, note)
    evidence.authenticated =
      result.ok
      && !authenticationFailure(`${result.stdout}\n${result.stderr}`)
      && unchanged
    evidence.tools_discovered =
      audited.tools_discovered
      && database.database_healthy
      && unchanged
    evidence.identity_registered =
      audited.identity_registered
      && database.identity_registered
      && unchanged
    evidence.project_read =
      audited.project_read
      && database.project_read
      && unchanged
    evidence.progress_written =
      audited.progress_written
      && database.progress_written
      && unchanged
    evidence.activity_verified =
      audited.activity_verified
      && database.activity_verified
      && unchanged
    if (!unchanged) {
      evidence.error = 'Global client state changed during isolated smoke'
    } else if (!completeEvidence(evidence)) {
      evidence.error = diagnosticError(result, events, [workRoot])
    }
    return evidence
  } catch (error) {
    evidence.error = redact(
      error instanceof Error ? error.message : String(error),
      [workRoot],
    ).slice(0, 1_000)
    return evidence
  } finally {
    if (isolation !== undefined && !isolation.assertUnchanged()) {
      evidence.authenticated = false
      for (const key of proofKeys) evidence[key] = false
      evidence.error = 'Global client state changed during isolated smoke'
    }
    try {
      await rm(workRoot, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 250,
      })
    } catch (error) {
      evidence.activity_verified = false
      evidence.error = redact(
        `Temporary credential cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        [workRoot],
      )
    }
  }
}

async function writeEvidence(evidence) {
  assert(validEvidence(evidence), 'Refusing to write invalid smoke evidence')
  await mkdir(artifactsRoot, { recursive: true })
  await writeFile(
    join(artifactsRoot, `${evidence.client}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
}

async function selfGrandchildParent(options) {
  const child = spawn(
    process.execPath,
    [scriptPath, '--self-heartbeat', '--file', options.file],
    { stdio: 'ignore', windowsHide: true },
  )
  writeFileSyncSafe(options.pid, String(child.pid))
  await new Promise(() => {})
}

function writeFileSyncSafe(path, value) {
  appendFileSync(path, value, { encoding: 'utf8', mode: 0o600 })
}

async function selfHeartbeat(options) {
  const timer = setInterval(() => {
    appendFileSync(options.file, '.', { encoding: 'utf8', mode: 0o600 })
  }, 25)
  const finish = () => {
    clearInterval(timer)
    appendFileSync(options.file, 'X', { encoding: 'utf8', mode: 0o600 })
    process.exit(0)
  }
  process.once('SIGTERM', finish)
  process.once('SIGINT', finish)
  await new Promise(() => {})
}

async function selfTest() {
  const selfRoot = await mkdtemp(join(tmpdir(), 'project-os-smoke-self-'))
  try {
    const fakeDirectory = join(selfRoot, 'fake cli with spaces')
    await mkdir(fakeDirectory, { recursive: true })
    const fakeName = 'project-os-smoke-fake'
    const fakeJs = join(fakeDirectory, 'fake executable.mjs')
    await writeFile(
      fakeJs,
      'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n',
      'utf8',
    )
    let fakePath
    if (process.platform === 'win32') {
      fakePath = join(fakeDirectory, `${fakeName}.cmd`)
      await writeFile(
        fakePath,
        '@echo off\r\nnode "%~dp0fake executable.mjs" %*\r\n',
        'utf8',
      )
    } else {
      fakePath = join(fakeDirectory, fakeName)
      await writeFile(
        fakePath,
        `#!/bin/sh\nexec "${process.execPath}" "${fakeJs}" "$@"\n`,
        'utf8',
      )
      await chmod(fakePath, 0o700)
    }
    const environment = {
      ...process.env,
      PATH: `${fakeDirectory}${process.platform === 'win32' ? ';' : ':'}`
        + (process.env.PATH ?? ''),
    }
    const discovered = await discoverCommand(fakeName, environment)
    assert.equal(resolve(discovered), resolve(fakePath))
    const invoked = await runExecutable(
      discovered,
      ['argument with spaces', 'literal&safe'],
      { environment, timeoutMs: 5_000 },
    )
    assert.equal(
      invoked.ok,
      true,
      `invoke adapter failed: ${redact(invoked.stderr, [selfRoot])}`,
    )
    assert.deepEqual(JSON.parse(invoked.stdout), [
      'argument with spaces',
      'literal&safe',
    ])

    const heartbeat = join(selfRoot, 'heartbeat.txt')
    const pidFile = join(selfRoot, 'grandchild.pid')
    const timeout = await runBounded(
      process.execPath,
      [
        scriptPath,
        '--self-grandchild-parent',
        '--file', heartbeat,
        '--pid', pidFile,
      ],
      { timeoutMs: 250 },
    )
    assert.equal(timeout.timedOut, true)
    const before = existsSync(heartbeat) ? (await stat(heartbeat)).size : 0
    await sleep(250)
    const after = existsSync(heartbeat) ? (await stat(heartbeat)).size : 0
    assert.equal(after, before, 'grandchild heartbeat continued after timeout')
    assert.equal(existsSync(pidFile), true)

    const prompt = smokePrompt('codex', {
      agentName: 'audit-agent',
      projectId: 'project_default',
      taskId: 'task_audit',
      taskVersion: 1,
    }, 'nonce')
    assert.equal(prompt.includes('"tools_discovered":true'), false)

    const seed = {
      agentId: 'agent_audit',
      agentName: 'audit-agent',
      identityClient: 'codex',
      projectId: 'project_default',
      taskId: 'task_audit',
      taskVersion: 1,
    }
    const maliciousModelOutput = JSON.stringify(Object.fromEntries(
      proofKeys.map((key) => [key, true]),
    ))
    assert.equal(maliciousModelOutput.includes('"tools_discovered":true'), true)
    assert.deepEqual(auditProof([], seed, 'smoke-nonce'), {
      tools_discovered: false,
      identity_registered: false,
      project_read: false,
      progress_written: false,
      activity_verified: false,
    })
    const events = [
      {
        type: 'tools_list',
        success: true,
        toolNames: [...requiredTools],
      },
      {
        type: 'tool_call',
        name: 'agent_register',
        success: true,
        arguments: {
          name: seed.agentName,
          role: 'dev-agent',
          client: seed.identityClient,
          capabilities: ['mcp-smoke'],
        },
      },
      {
        type: 'tool_call',
        name: 'project_list',
        success: true,
        arguments: { agent_id: seed.agentId },
      },
      {
        type: 'tool_call',
        name: 'progress_submit',
        success: true,
        arguments: {
          agent_id: seed.agentId,
          task_id: seed.taskId,
          progress: 67,
          status: 'in_progress',
          note: 'smoke-nonce',
          version: 1,
        },
      },
      {
        type: 'tool_call',
        name: 'activity_log',
        success: true,
        arguments: { agent_id: seed.agentId },
      },
    ]
    assert.deepEqual(auditProof(events, seed, 'smoke-nonce'), {
      tools_discovered: true,
      identity_registered: true,
      project_read: true,
      progress_written: true,
      activity_verified: true,
    })
    const fakeServer = join(selfRoot, 'fake-mcp-server.mjs')
    const proxyAudit = join(selfRoot, 'proxy-audit.jsonl')
    await writeFile(fakeServer, `
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  while (buffer.includes('\\n')) {
    const newline = buffer.indexOf('\\n')
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (line === '') continue
    const request = JSON.parse(line)
    let result = {}
    if (request.method === 'initialize') {
      result = {
        protocolVersion: '2025-06-18',
        capabilities: {},
        serverInfo: { name: 'fake', version: '1' },
      }
    } else if (request.method === 'tools/list') {
      result = {
        tools: ${JSON.stringify(requiredTools.map((name) => ({ name })))},
      }
    } else if (request.method === 'tools/call') {
      result = { content: [], isError: false }
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result,
    }) + '\\n')
  }
})
`, 'utf8')
    const proxy = spawn(process.execPath, [
      scriptPath,
      '--audit-proxy',
      '--entry', fakeServer,
      '--database', join(selfRoot, 'unused.sqlite'),
      '--audit', proxyAudit,
    ], {
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let proxyOutput = ''
    proxy.stdout.setEncoding('utf8')
    proxy.stdout.on('data', (chunk) => {
      proxyOutput += chunk
    })
    for (const request of [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'agent_register',
          arguments: {
            name: 'audit-agent',
            api_key: 'must-not-be-recorded',
          },
        },
      },
    ]) {
      proxy.stdin.write(`${JSON.stringify(request)}\n`)
    }
    proxy.stdin.end()
    const proxyExit = new Promise((resolveExit) => {
      proxy.once('exit', (code) => resolveExit(code))
    })
    let proxyTimer
    const proxyTimeout = new Promise((resolveTimeout) => {
      proxyTimer = setTimeout(() => {
        void terminateTree(proxy).then(() => resolveTimeout('timeout'))
      }, 5_000)
    })
    const proxyResult = await Promise.race([proxyExit, proxyTimeout])
    clearTimeout(proxyTimer)
    assert.equal(proxyResult, 0)
    assert.equal(proxyOutput.includes('"id":2'), true)
    const proxyEvents = readAudit(proxyAudit)
    assert.equal(proxyEvents[0].type, 'tools_list')
    assert.equal(proxyEvents[1].name, 'agent_register')
    assert.equal(proxyEvents[1].arguments.api_key, '<REDACTED>')
    assert.equal(
      JSON.stringify(proxyEvents).includes('must-not-be-recorded'),
      false,
    )
    assert.equal(
      safeAuditArguments({ api_key: 'secret-value', agent_id: 'agent_audit' })
        .api_key,
      '<REDACTED>',
    )

    const watchedFile = join(selfRoot, 'global-state.json')
    await writeFile(watchedFile, '{"state":1}', 'utf8')
    const snapshot = snapshotFiles([watchedFile])
    assert.equal(snapshotsEqual(snapshot, snapshotFiles([watchedFile])), true)
    await writeFile(watchedFile, '{"state":2}', 'utf8')
    assert.equal(snapshotsEqual(snapshot, snapshotFiles([watchedFile])), false)

    const fakeSecret = 'smoke-secret-123456'
    const safe = redact(
      [
        homedir(),
        repositoryRoot,
        selfRoot,
        selfRoot.replaceAll('\\', '/'),
        'pos_super-secret-token',
        'sk-test-1234567890',
        fakeSecret,
      ].join(' '),
      [selfRoot],
      { PROJECT_OS_API_KEY: fakeSecret },
    )
    for (const value of [
      homedir(),
      repositoryRoot,
      selfRoot,
      selfRoot.replaceAll('\\', '/'),
      'pos_super-secret-token',
      'sk-test-1234567890',
      fakeSecret,
    ]) {
      assert.equal(safe.includes(value), false)
    }
    const evidence = {
      ...emptyEvidence('codex', true),
      authenticated: true,
      ...Object.fromEntries(proofKeys.map((key) => [key, true])),
    }
    assert.equal(validEvidence(evidence), true)
    assert.equal(completeEvidence(evidence), true)
    process.stdout.write(
      'smoke-clients self-test: audit, isolation, invocation adapter, '
      + 'process tree, redaction, and evidence PASS\n',
    )
  } finally {
    await rm(selfRoot, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    })
  }
}

async function main() {
  const raw = process.argv.slice(2)
  if (raw[0] === '--audit-proxy') {
    await runAuditProxy(parseInternalOptions(raw.slice(1)))
    return
  }
  if (raw[0] === '--self-grandchild-parent') {
    await selfGrandchildParent(parseInternalOptions(raw.slice(1)))
    return
  }
  if (raw[0] === '--self-heartbeat') {
    await selfHeartbeat(parseInternalOptions(raw.slice(1)))
    return
  }
  const options = parseOptions(raw)
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  if (options.selfTest) {
    await selfTest()
    return
  }
  if (!options.writeSmoke) {
    throw new Error(
      'Real client invocation is disabled without --write-smoke; '
      + 'use --self-test for free local checks.',
    )
  }
  if (!existsSync(mcpEntry)) {
    throw new Error('MCP entry is missing; build @project-os/mcp first')
  }
  const evidence = []
  for (const client of options.clients) {
    const result = await smokeClient(client, options.timeoutMs)
    await writeEvidence(result)
    evidence.push(result)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
  if (evidence.some((item) => !completeEvidence(item))) process.exitCode = 1
}

void main().catch((error) => {
  const message = redact(
    error instanceof Error ? error.message : String(error),
  )
  process.stderr.write(`Project OS client smoke failed: ${message}\n`)
  process.exitCode = 1
})
