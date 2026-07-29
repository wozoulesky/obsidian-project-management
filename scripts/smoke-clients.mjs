#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import {
  join,
  resolve,
} from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(
  fileURLToPath(new URL('..', import.meta.url)),
)
const artifactsRoot = join(repositoryRoot, 'artifacts', 'mcp-smoke')
const mcpEntry = join(repositoryRoot, 'apps', 'mcp', 'dist', 'stdio.js')
const supportedClients = ['codex', 'claude', 'kimi']
const evidenceKeys = [
  'client',
  'installed',
  'authenticated',
  'tools_discovered',
  'identity_registered',
  'project_read',
  'progress_written',
  'activity_verified',
  'error',
]
const proofKeys = [
  'tools_discovered',
  'identity_registered',
  'project_read',
  'progress_written',
  'activity_verified',
]
const clientDefinitions = {
  codex: {
    executable: 'codex',
    identityClient: 'codex',
  },
  claude: {
    executable: 'claude',
    identityClient: 'claude-code',
  },
  kimi: {
    executable: 'kimi',
    identityClient: 'kimi-code',
  },
}

function usage() {
  return [
    'Usage: node scripts/smoke-clients.mjs [options]',
    '',
    'Options:',
    '  --self-test                 Run local fake-CLI tests only',
    '  --clients <names>           Comma-separated codex,claude,kimi',
    '  --timeout-ms <milliseconds> Per-client timeout (default 120000)',
    '  --write-smoke               WRITE: invoke installed clients and save evidence',
    '  --help                      Show this help',
    '',
    'Without --write-smoke the script will not invoke model-backed clients.',
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
        .split(',')
        .map((client) => client.trim())
        .filter(Boolean)
      const unknown = clients.filter(
        (client) => !supportedClients.includes(client),
      )
      if (clients.length === 0 || unknown.length > 0) {
        throw new Error(
          `--clients accepts only ${supportedClients.join(', ')}`
          + (unknown.length === 0 ? '' : `; unknown: ${unknown.join(', ')}`),
        )
      }
      options.clients = [...new Set(clients)]
      index += 1
    } else if (argument === '--timeout-ms') {
      const timeoutText = valueAfter(arguments_, index, argument)
      if (!/^\d+$/.test(timeoutText)) {
        throw new Error('--timeout-ms must be an integer')
      }
      options.timeoutMs = Number(timeoutText)
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

async function discoverCommand(name, environment = process.env) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error('Unsafe executable name')
  }
  const windows = process.platform === 'win32'
  const command = windows
    ? environment.ComSpec === undefined
      ? 'powershell.exe'
      : 'powershell.exe'
    : 'sh'
  const arguments_ = windows
    ? [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$candidate = Get-Command '${name}' -ErrorAction SilentlyContinue `
          + '| Select-Object -First 1 -ExpandProperty Source; '
          + 'if ($null -ne $candidate) { [Console]::Out.Write($candidate) }',
      ]
    : ['-c', 'command -v "$1"', 'sh', name]
  const result = await runBounded(command, arguments_, {
    environment,
    timeoutMs: 5_000,
  })
  const selected = result.stdout.trim().split(/\r?\n/)[0]
  return result.ok && selected !== '' ? resolve(selected) : undefined
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  if (process.platform === 'win32' && Number.isInteger(child.pid)) {
    await new Promise((resolveTaskkill) => {
      const killer = spawn(
        'taskkill.exe',
        ['/pid', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true },
      )
      killer.once('error', () => resolveTaskkill())
      killer.once('exit', () => resolveTaskkill())
    })
    return
  }
  child.kill('SIGTERM')
}

function runBounded(command, arguments_, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000
  const outputLimit = options.outputLimit ?? 256_000
  return new Promise((resolveRun) => {
    let child
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let timer
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveRun({
        command,
        stdout,
        stderr,
        timedOut,
        ...result,
      })
    }
    try {
      child = spawn(command, arguments_, {
        cwd: options.cwd ?? repositoryRoot,
        env: options.environment ?? process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      finish({ error, exitCode: null, ok: false })
      return
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-outputLimit)
    })
    child.stderr?.on('data', (chunk) => {
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
      void terminate(child).finally(() => {
        setTimeout(() => {
          finish({
            error: new Error(`Client timed out after ${timeoutMs}ms`),
            exitCode: child.exitCode,
            ok: false,
            signal: child.signalCode,
          })
        }, 1_000).unref()
      })
    }, timeoutMs)
  })
}

function secretValues(environment) {
  return Object.entries(environment)
    .filter(([name, value]) =>
      value !== undefined
      && value.length >= 8
      && /(TOKEN|API[_-]?KEY|SECRET|PASSWORD|AUTH)/i.test(name))
    .map(([, value]) => value)
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function redact(value, paths = [], environment = process.env) {
  let redacted = String(value)
  const replacements = [
    [homedir(), '<HOME>'],
    [repositoryRoot, '<WORKSPACE>'],
    ...paths.filter(Boolean).map((path) => [resolve(path), '<TEMP>']),
    ...secretValues(environment).map((secret) => [secret, '<SECRET>']),
  ]
  for (const [sensitive, replacement] of replacements) {
    if (sensitive === '') continue
    redacted = redacted.replace(
      new RegExp(escapeRegularExpression(sensitive), 'gi'),
      replacement,
    )
  }
  return redacted
    .replace(/\bpos_[A-Za-z0-9._-]+\b/g, '<TOKEN>')
    .replace(/\b(?:sk|api)[-_][A-Za-z0-9._-]{8,}\b/gi, '<API_KEY>')
    .replace(
      /\b(Bearer|Authorization)\s*[:=]?\s*[A-Za-z0-9._~+/-]{8,}=*/gi,
      '$1 <SECRET>',
    )
    .replace(
      /\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s,}]+/gi,
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
    && proofKeys.every((key) => typeof evidence[key] === 'boolean')
    && typeof evidence.installed === 'boolean'
    && typeof evidence.authenticated === 'boolean'
    && (evidence.error === null || typeof evidence.error === 'string')
  )
}

function completeEvidence(evidence) {
  return evidence.installed
    && evidence.authenticated
    && proofKeys.every((key) => evidence[key] === true)
    && evidence.error === null
}

function proofCandidate(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  if (proofKeys.every((key) => typeof value[key] === 'boolean')) {
    return Object.fromEntries(proofKeys.map((key) => [key, value[key]]))
  }
  for (const nested of Object.values(value)) {
    if (typeof nested === 'string') {
      const candidate = extractProof(nested)
      if (candidate !== undefined) return candidate
    } else {
      const candidate = proofCandidate(nested)
      if (candidate !== undefined) return candidate
    }
  }
  return undefined
}

function extractProof(output) {
  const candidates = [
    output.trim(),
    ...output.split(/\r?\n/).map((line) => line.trim()).reverse(),
  ]
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi
  for (const match of output.matchAll(fenced)) {
    candidates.unshift(match[1].trim())
  }
  const braces = output.match(/\{[\s\S]*\}/g)
  if (braces !== null) candidates.push(...braces)
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue
    try {
      const proof = proofCandidate(JSON.parse(candidate))
      if (proof !== undefined) return proof
    } catch {
      // Model-backed CLIs often emit JSONL around the final JSON response.
    }
  }
  return undefined
}

function authenticationFailure(output) {
  return /(not logged in|login required|please (?:run|use).*login|unauthorized|authentication failed|invalid api key|missing api key|credential.*(?:missing|not found)|\b401\b)/i
    .test(output)
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
    'project_default',
    agent.id,
    'actor_local_owner',
    'web',
  )
  const today = new Date().toISOString().slice(0, 10)
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
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
    throw new Error(
      `Smoke database seed failed: ${result.stderr || result.stdout}`,
    )
  }
  return {
    database,
    ...JSON.parse(result.stdout),
  }
}

function smokePrompt(client, seed, nonce) {
  return [
    'Use only the configured Project OS MCP server for this bounded smoke test.',
    'Do not read or edit workspace files and do not use shell/network tools.',
    `1. Discover the Project OS tools.`,
    `2. Call agent_register with name ${JSON.stringify(seed.agentName)}, `
      + `role "dev-agent", client `
      + `${JSON.stringify(clientDefinitions[client].identityClient)}, `
      + 'and capability "mcp-smoke".',
    '3. With the returned agent_id, call project_list and confirm '
      + `${seed.projectId} is present.`,
    `4. Call progress_submit for task ${seed.taskId}, progress 67, `
      + `status "in_progress", note ${JSON.stringify(`smoke-${nonce}`)}, `
      + `version ${seed.taskVersion}.`,
    '5. Call activity_log and verify the task.progress activity for that task.',
    'Return only one JSON object with exactly these boolean keys, all true '
      + 'only after the corresponding calls succeed:',
    '{"tools_discovered":true,"identity_registered":true,'
      + '"project_read":true,"progress_written":true,'
      + '"activity_verified":true}',
  ].join('\n')
}

async function writeMcpConfig(path, database, includeType = true) {
  await writeFile(path, JSON.stringify({
    mcpServers: {
      'project-os': {
        ...(includeType ? { type: 'stdio' } : {}),
        command: process.execPath,
        args: [mcpEntry],
        env: { PROJECT_OS_DB: database },
      },
    },
  }, null, 2), { encoding: 'utf8', mode: 0o600 })
}

async function clientInvocation(client, executable, workRoot, seed, prompt) {
  const configPath = join(workRoot, 'mcp.json')
  await writeMcpConfig(configPath, seed.database)
  if (client === 'codex') {
    const codexConfigRoot = join(workRoot, '.codex')
    await mkdir(codexConfigRoot, { recursive: true })
    await writeFile(
      join(codexConfigRoot, 'config.toml'),
      [
        '[mcp_servers.project_os]',
        `command = ${JSON.stringify(process.execPath)}`,
        `args = ${JSON.stringify([mcpEntry])}`,
        '',
        '[mcp_servers.project_os.env]',
        `PROJECT_OS_DB = ${JSON.stringify(seed.database)}`,
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 },
    )
    return {
      arguments: [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
        '-c',
        `mcp_servers.project_os.command=${JSON.stringify(process.execPath)}`,
        '-c',
        `mcp_servers.project_os.args=${JSON.stringify([mcpEntry])}`,
        '-c',
        'mcp_servers.project_os.env.PROJECT_OS_DB='
          + JSON.stringify(seed.database),
        prompt,
      ],
      command: executable,
      environment: { ...process.env },
    }
  }
  if (client === 'claude') {
    return {
      arguments: [
        '--print',
        prompt,
        '--output-format',
        'json',
        '--no-session-persistence',
        '--strict-mcp-config',
        '--mcp-config',
        configPath,
        '--permission-mode',
        'dontAsk',
        '--allowedTools',
        [
          'mcp__project-os__agent_register',
          'mcp__project-os__project_list',
          'mcp__project-os__progress_submit',
          'mcp__project-os__activity_log',
        ].join(','),
      ],
      command: executable,
      environment: { ...process.env },
    }
  }
  await mkdir(join(workRoot, '.kimi-code'), { recursive: true })
  await writeMcpConfig(
    join(workRoot, '.kimi-code', 'mcp.json'),
    seed.database,
    false,
  )
  return {
    arguments: [
      '--output-format',
      'stream-json',
      '--prompt',
      prompt,
    ],
    command: executable,
    environment: { ...process.env },
  }
}

async function verifyDatabase(seed, expectedNote) {
  const source = `
import { DatabaseSync } from 'node:sqlite'
const database = new DatabaseSync(${JSON.stringify(seed.database)}, {
  readOnly: true,
})
try {
  const actor = database.prepare(\`
    SELECT last_active_at
    FROM actors
    WHERE id = ? AND name = ? AND kind = 'agent' AND client = ?
  \`).get(
    ${JSON.stringify(seed.agentId)},
    ${JSON.stringify(seed.agentName)},
    ${JSON.stringify(seed.identityClient)},
  )
  const task = database.prepare(\`
    SELECT progress, status
    FROM tasks
    WHERE id = ? AND assignee_id = ?
  \`).get(${JSON.stringify(seed.taskId)}, ${JSON.stringify(seed.agentId)})
  const activity = database.prepare(\`
    SELECT 1
    FROM activities
    WHERE actor_id = ?
      AND entity_id = ?
      AND operation = 'task.progress'
      AND source = 'mcp'
      AND note = ?
    LIMIT 1
  \`).get(
    ${JSON.stringify(seed.agentId)},
    ${JSON.stringify(seed.taskId)},
    ${JSON.stringify(expectedNote)},
  )
  process.stdout.write(JSON.stringify({
    identity_registered:
      actor !== undefined && actor.last_active_at !== null,
    progress_written:
      task?.progress === 67 && task?.status === 'in_progress',
    activity_verified: activity !== undefined,
  }))
} finally {
  database.close()
}
`
  const result = await runBounded(
    process.execPath,
    ['--no-warnings', '--input-type=module', '--eval', source],
    { cwd: repositoryRoot, timeoutMs: 10_000 },
  )
  if (!result.ok) {
    throw new Error(
      `Smoke database verification failed: ${result.stderr || result.stdout}`,
    )
  }
  return JSON.parse(result.stdout)
}

function resultError(result, proof, paths) {
  const combined = `${result.stderr}\n${result.stdout}`.trim()
  let message
  if (result.timedOut) {
    message = 'Client invocation timed out'
  } else if (result.error !== undefined) {
    message = `Client could not start: ${result.error.message}`
  } else if (!result.ok) {
    message = combined === ''
      ? `Client exited with code ${result.exitCode}`
      : combined.slice(-1_000)
  } else if (proof === undefined) {
    message = 'Client completed without machine-readable smoke proof'
  } else {
    message = 'Client reported an incomplete MCP smoke run'
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
  try {
    const seed = await seedSmokeDatabase(workRoot, client)
    seed.identityClient = definition.identityClient
    const nonce = `${Date.now()}-${process.pid}`
    const note = `smoke-${nonce}`
    const prompt = smokePrompt(client, seed, nonce)
    const invocation = await clientInvocation(
      client,
      executable,
      workRoot,
      seed,
      prompt,
    )
    const result = await runBounded(
      invocation.command,
      invocation.arguments,
      {
        cwd: workRoot,
        environment: invocation.environment,
        timeoutMs,
      },
    )
    const combined = `${result.stdout}\n${result.stderr}`
    evidence.authenticated = result.ok && !authenticationFailure(combined)
    const proof = extractProof(result.stdout)
    const databaseProof = await verifyDatabase(seed, note)
    evidence.tools_discovered = proof?.tools_discovered === true
    evidence.identity_registered =
      proof?.identity_registered === true
      && databaseProof.identity_registered
    evidence.project_read = proof?.project_read === true
    evidence.progress_written =
      proof?.progress_written === true
      && databaseProof.progress_written
    evidence.activity_verified =
      proof?.activity_verified === true
      && databaseProof.activity_verified
    if (!completeEvidence(evidence)) {
      evidence.error = resultError(result, proof, [workRoot], process.env)
    }
    return evidence
  } catch (error) {
    evidence.error = redact(
      error instanceof Error ? error.message : String(error),
      [workRoot],
    ).slice(0, 1_000)
    return evidence
  } finally {
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
        `Temporary cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        [workRoot],
      ).slice(0, 1_000)
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

async function selfTest() {
  const selfRoot = await mkdtemp(join(tmpdir(), 'project-os-smoke-self-'))
  try {
    const fakeName = 'project-os-smoke-fake'
    let fakePath
    let fakeRun
    if (process.platform === 'win32') {
      fakePath = join(selfRoot, `${fakeName}.cmd`)
      await writeFile(
        fakePath,
        '@echo off\r\n'
          + 'echo {"tools_discovered":true,"identity_registered":true,'
          + '"project_read":true,"progress_written":true,'
          + '"activity_verified":true}\r\n',
        'utf8',
      )
      fakeRun = await runBounded(
        process.env.ComSpec ?? 'cmd.exe',
        ['/d', '/s', '/c', fakePath],
        { timeoutMs: 5_000 },
      )
    } else {
      fakePath = join(selfRoot, fakeName)
      await writeFile(
        fakePath,
        '#!/bin/sh\n'
          + 'printf \'%s\\n\' \'{"tools_discovered":true,'
          + '"identity_registered":true,"project_read":true,'
          + '"progress_written":true,"activity_verified":true}\'\n',
        'utf8',
      )
      await chmod(fakePath, 0o700)
      fakeRun = await runBounded(fakePath, [], { timeoutMs: 5_000 })
    }
    const environment = {
      ...process.env,
      PATH: `${selfRoot}${process.platform === 'win32' ? ';' : ':'}`
        + (process.env.PATH ?? ''),
    }
    const discovered = await discoverCommand(fakeName, environment)
    assert.equal(resolve(discovered), resolve(fakePath))
    assert.equal(fakeRun.ok, true)
    assert.deepEqual(extractProof(fakeRun.stdout), {
      tools_discovered: true,
      identity_registered: true,
      project_read: true,
      progress_written: true,
      activity_verified: true,
    })

    const timeout = await runBounded(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { timeoutMs: 50 },
    )
    assert.equal(timeout.ok, false)
    assert.equal(timeout.timedOut, true)

    const fakeSecret = 'smoke-secret-123456'
    const sensitive = [
      homedir(),
      repositoryRoot,
      selfRoot,
      'pos_super-secret-token',
      'sk-test-1234567890',
      fakeSecret,
    ].join(' ')
    const safe = redact(
      sensitive,
      [selfRoot],
      { PROJECT_OS_API_KEY: fakeSecret },
    )
    for (const value of [
      homedir(),
      repositoryRoot,
      selfRoot,
      'pos_super-secret-token',
      'sk-test-1234567890',
      fakeSecret,
    ]) {
      assert.equal(safe.includes(value), false)
    }

    const evidence = {
      ...emptyEvidence('codex', true),
      authenticated: true,
      tools_discovered: true,
      identity_registered: true,
      project_read: true,
      progress_written: true,
      activity_verified: true,
    }
    assert.equal(validEvidence(evidence), true)
    assert.equal(completeEvidence(evidence), true)
    assert.equal(
      validEvidence({ ...evidence, unexpected: true }),
      false,
    )

    const invocationSeed = {
      database: join(selfRoot, 'fake.sqlite'),
    }
    await clientInvocation(
      'codex',
      'codex',
      selfRoot,
      invocationSeed,
      'bounded prompt',
    )
    const codexConfig = await readFile(
      join(selfRoot, '.codex', 'config.toml'),
      'utf8',
    )
    assert.match(codexConfig, /\[mcp_servers\.project_os\]/)
    assert.match(codexConfig, /PROJECT_OS_DB/)
    const claudeInvocation = await clientInvocation(
      'claude',
      'claude',
      selfRoot,
      invocationSeed,
      'bounded prompt',
    )
    assert.equal(
      claudeInvocation.arguments[
        claudeInvocation.arguments.indexOf('--print') + 1
      ],
      'bounded prompt',
    )
    const kimiInvocation = await clientInvocation(
      'kimi',
      'kimi',
      selfRoot,
      invocationSeed,
      'bounded prompt',
    )
    assert.equal(kimiInvocation.arguments.includes('--auto'), false)
    assert.equal(kimiInvocation.arguments.includes('--yolo'), false)
    const kimiConfig = JSON.parse(await readFile(
      join(selfRoot, '.kimi-code', 'mcp.json'),
      'utf8',
    ))
    assert.equal(
      'type' in kimiConfig.mcpServers['project-os'],
      false,
    )
    process.stdout.write(
      'smoke-clients self-test: discovery, timeout, redaction, '
      + 'and evidence PASS\n',
    )
  } finally {
    await rm(selfRoot, { recursive: true, force: true })
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
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
      + 'use --self-test for the free local checks.',
    )
  }
  if (!existsSync(mcpEntry)) {
    throw new Error(
      `MCP entry is missing. Run npm run build --workspace @project-os/mcp`,
    )
  }

  const evidence = []
  for (const client of options.clients) {
    const result = await smokeClient(client, options.timeoutMs)
    await writeEvidence(result)
    evidence.push(result)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
  if (evidence.some((item) => !completeEvidence(item))) {
    process.exitCode = 1
  }
}

void main().catch((error) => {
  const message = redact(
    error instanceof Error ? error.message : String(error),
  )
  process.stderr.write(`Project OS client smoke failed: ${message}\n`)
  process.exitCode = 1
})
