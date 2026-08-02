import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'

export function resolveNpmCommand({
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  fileExists = existsSync,
} = {}) {
  if (env.npm_execpath) {
    return {
      command: execPath,
      prefixArgs: [env.npm_execpath],
    }
  }

  if (platform === 'win32') {
    const bundledNpmCli = win32.join(
      win32.dirname(execPath),
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    )
    if (fileExists(bundledNpmCli)) {
      return {
        command: execPath,
        prefixArgs: [bundledNpmCli],
      }
    }

    return {
      command: env.ComSpec ?? 'cmd.exe',
      prefixArgs: ['/d', '/s', '/c', 'npm'],
    }
  }

  const npmBinary = posix.join('npm')
  return {
    command: npmBinary,
    prefixArgs: [],
  }
}
