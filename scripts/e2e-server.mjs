import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const npmCli = process.env.npm_execpath
  ?? (process.platform === 'win32' ? 'npm.cmd' : 'npm')
const npmCommand = npmCli === process.env.npm_execpath
  ? [process.execPath, [npmCli]]
  : [npmCli, []]
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'project-os-e2e-'))

function spawnNpm(args, environment = {}) {
  return spawn(npmCommand[0], [...npmCommand[1], ...args], {
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

const children = []
let cleanupPromise
async function cleanup(signal = 'SIGTERM') {
  cleanupPromise ??= (async () => {
    await Promise.all(children.map((child) => terminate(child, signal)))
    await rm(temporaryDirectory, { recursive: true, force: true })
  })()
  return cleanupPromise
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void cleanup(signal).then(() => {
      process.exitCode = 0
    })
  })
}

try {
  await execFileAsync(
    npmCommand[0],
    [...npmCommand[1], 'run', 'build', '--workspace', 'web'],
    { timeout: 120_000 },
  )

  const apiPort = await availablePort()
  const api = spawnNpm(
    ['run', 'start', '--workspace', '@project-os/server'],
    {
      PROJECT_OS_HOST: '127.0.0.1',
      PROJECT_OS_PORT: String(apiPort),
      PROJECT_OS_DATABASE_PATH: join(temporaryDirectory, 'e2e.db'),
      PROJECT_OS_BACKUP_ROOT: join(temporaryDirectory, 'backups'),
    },
  )
  children.push(api)
  await waitFor(`http://127.0.0.1:${apiPort}/api/v1/health`, api)

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
  children.push(preview)
  await waitFor('http://127.0.0.1:4173', preview)

  const exits = children.map((child) => new Promise((resolve) => {
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
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await cleanup()
}
