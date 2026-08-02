import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  RuntimeControl,
  RuntimeStoppingError,
} from './runtime-control.mjs'
import { resolveNpmCommand } from './npm-command.mjs'

const execFileAsync = promisify(execFile)
const npmCommand = resolveNpmCommand()
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'project-os-e2e-'))
const shutdownAfterReady = process.argv.includes('--shutdown-after-ready')

function spawnNpm(args, environment = {}) {
  return spawn(npmCommand.command, [...npmCommand.prefixArgs, ...args], {
    cwd: repositoryRoot,
    detached: process.platform !== 'win32',
    env: { ...process.env, ...environment },
    stdio: 'inherit',
  })
}

async function terminate(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  const exited = once(child, 'exit')
  if (process.platform === 'win32' && child.pid !== undefined) {
    await execFileAsync(
      'taskkill',
      ['/pid', String(child.pid), '/T', '/F'],
    ).catch(() => undefined)
  } else if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)
    } catch {
      child.kill(signal)
    }
  }

  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])

  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32' && child.pid !== undefined) {
      await execFileAsync(
        'taskkill',
        ['/pid', String(child.pid), '/T', '/F'],
      ).catch(() => undefined)
    } else if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
  }
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null
    ? address.port
    : undefined
  await new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error))
  })
  if (port === undefined) {
    throw new Error('Failed to allocate an E2E API port')
  }
  return port
}

async function waitFor(url, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Process exited before ${url} became ready`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const control = new RuntimeControl(terminate)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void control.stop(signal).then(() => {
      process.exitCode = 0
    })
  })
}

try {
  await execFileAsync(
    npmCommand.command,
    [...npmCommand.prefixArgs, 'run', 'build'],
    {
      cwd: repositoryRoot,
      timeout: 120_000,
    },
  )
  control.checkpoint()
  await execFileAsync(
    npmCommand.command,
    [
      ...npmCommand.prefixArgs,
      'run',
      'build',
      '--workspace',
      'web',
      '--',
      '--mode',
      'e2e',
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        VITE_E2E_FIXTURES: 'true',
      },
      timeout: 120_000,
    },
  )
  control.checkpoint()

  const apiPort = await availablePort()
  control.checkpoint()
  const api = spawnNpm(
    ['run', 'start', '--workspace', '@project-os/server'],
    {
      PROJECT_OS_HOST: '127.0.0.1',
      PROJECT_OS_PORT: String(apiPort),
      PROJECT_OS_DATABASE_PATH: join(temporaryDirectory, 'e2e.db'),
      PROJECT_OS_BACKUP_ROOT: join(temporaryDirectory, 'backups'),
    },
  )
  control.add(api)
  await waitFor(`http://127.0.0.1:${apiPort}/api/v1/health`, api)
  control.checkpoint()

  const previewConfigPath = join(temporaryDirectory, 'vite.config.mjs')
  await writeFile(
    previewConfigPath,
    `export default {
  preview: {
    proxy: {
      '/api': 'http://127.0.0.1:${apiPort}',
    },
  },
}
`,
    'utf8',
  )
  control.checkpoint()
  const preview = spawnNpm([
    'run',
    'preview',
    '--workspace',
    'web',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort',
    '--config',
    previewConfigPath,
  ])
  control.add(preview)
  await waitFor('http://127.0.0.1:4173', preview)
  control.checkpoint()

  if (shutdownAfterReady) {
    await control.stop('SIGTERM')
    control.checkpoint()
  }

  const exits = [api, preview].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode ?? 128 })
      return
    }
    child.once('error', (error) => resolve({ code: 1, error }))
    child.once('exit', (code, signal) => resolve({
      code: code ?? (signal === null ? 1 : 128),
    }))
  }))
  const firstExit = await Promise.race(exits)
  if (firstExit.error !== undefined) {
    console.error(firstExit.error.message)
  }
  process.exitCode = firstExit.code
} catch (error) {
  if (!control.stopping && !(error instanceof RuntimeStoppingError)) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
} finally {
  await control.stop()
  await rm(temporaryDirectory, { recursive: true, force: true })
}
