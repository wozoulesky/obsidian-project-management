import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import {
  RuntimeControl,
  supervisedExitCode,
} from './runtime-control.mjs'
import { resolveNpmCommand } from './npm-command.mjs'

const execFileAsync = promisify(execFile)
const npmCommand = resolveNpmCommand()

function spawnNpm(args) {
  return spawn(
    npmCommand.command,
    [...npmCommand.prefixArgs, ...args],
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

const control = new RuntimeControl(terminate)
const children = []
let shutdownRequested = false
for (const args of [
  ['run', 'start', '--workspace', '@project-os/server'],
  ['run', 'dev', '--workspace', 'web'],
]) {
  const child = spawnNpm(args)
  control.add(child)
  children.push(child)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdownRequested = true
    void control.stop(signal).then(() => {
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
await control.stop()
process.exitCode = supervisedExitCode(firstExit.code, shutdownRequested)
