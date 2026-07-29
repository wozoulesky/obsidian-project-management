import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const npmCli = process.env.npm_execpath
  ?? (process.platform === 'win32' ? 'npm.cmd' : 'npm')

function spawnNpm(args) {
  return spawn(
    npmCli === process.env.npm_execpath ? process.execPath : npmCli,
    npmCli === process.env.npm_execpath ? [npmCli, ...args] : args,
    {
      detached: process.platform !== 'win32',
      env: process.env,
      stdio: 'inherit',
    },
  )
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

const children = [
  spawnNpm(['run', 'start', '--workspace', '@project-os/server']),
  spawnNpm(['run', 'dev', '--workspace', 'web']),
]

let stopping
function stopAll(signal = 'SIGTERM') {
  stopping ??= Promise.all(children.map((child) => terminate(child, signal)))
  return stopping
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void stopAll(signal).then(() => {
      process.exitCode = 0
    })
  })
}

const exits = children.map((child, index) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    resolve({
      index,
      code: child.exitCode ?? 128,
    })
    return
  }
  child.once('error', (error) => resolve({ index, code: 1, error }))
  child.once('exit', (code, signal) => resolve({
    index,
    code: code ?? (signal === null ? 1 : 128),
  }))
}))

const firstExit = await Promise.race(exits)
if (firstExit.error !== undefined) {
  console.error(firstExit.error.message)
}
await stopAll()
process.exitCode = firstExit.code
