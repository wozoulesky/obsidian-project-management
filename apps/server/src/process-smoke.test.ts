import {
  execFile,
  spawn,
  type ChildProcess,
} from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  fileURLToPath,
  pathToFileURL,
} from 'node:url'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const npmCli = process.env.npm_execpath

const childProcesses: ChildProcess[] = []
const temporaryDirectories: string[] = []

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null
    ? address.port
    : undefined
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose()
      } else {
        rejectClose(error)
      }
    })
  })
  if (port === undefined) {
    throw new Error('Failed to allocate a smoke-test port')
  }
  return port
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  if (process.platform === 'win32' && child.pid !== undefined) {
    await execFileAsync(
      'taskkill',
      ['/pid', String(child.pid), '/T', '/F'],
    ).catch(() => undefined)
  } else if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }

  await Promise.race([
    once(child, 'exit'),
    new Promise((resolveTimeout) => {
      setTimeout(resolveTimeout, 2_000)
    }),
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

async function waitForHealth(
  child: ChildProcess,
  url: string,
  output: () => string,
): Promise<unknown> {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Server exited before health check: ${output()}`,
      )
    }

    try {
      const response = await fetch(url)
      if (response.ok) {
        return response.json()
      }
    } catch {
      // The listener is still starting.
    }

    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 100)
    })
  }

  throw new Error(`Server health check timed out: ${output()}`)
}

afterEach(async () => {
  await Promise.all(childProcesses.splice(0).map(terminateProcessTree))
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ))
})

it('builds and starts the root production server command', async () => {
  if (npmCli === undefined) {
    throw new Error('npm_execpath is required for the process smoke test')
  }

  await execFileAsync(
    process.execPath,
    [npmCli, 'run', 'build', '--workspace', '@project-os/server'],
    {
      cwd: repositoryRoot,
      timeout: 60_000,
    },
  )

  const directory = await mkdtemp(join(tmpdir(), 'project-os-smoke-'))
  temporaryDirectories.push(directory)
  const port = await availablePort()
  const child = spawn(
    process.execPath,
    [npmCli, 'start'],
    {
      cwd: repositoryRoot,
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        PROJECT_OS_HOST: '127.0.0.1',
        PROJECT_OS_PORT: String(port),
        PROJECT_OS_DATABASE_PATH: join(directory, 'smoke.db'),
        PROJECT_OS_BACKUP_ROOT: join(directory, 'backups'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  childProcesses.push(child)

  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })

  await expect(waitForHealth(
    child,
    `http://127.0.0.1:${port}/api/v1/health`,
    () => output,
  )).resolves.toMatchObject({
    data: {
      status: 'ok',
      database: 'ok',
    },
    error: null,
  })
})

it('resolves the workspace MCP library from source without requiring dist', () => {
  expect(import.meta.resolve('@project-os/mcp')).toBe(
    pathToFileURL(join(
      repositoryRoot,
      'apps',
      'mcp',
      'src',
      'index.ts',
    )).href,
  )
})
