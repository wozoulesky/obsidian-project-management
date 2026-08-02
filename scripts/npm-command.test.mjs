import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveNpmCommand } from './npm-command.mjs'

test('uses the active npm CLI through Node when npm_execpath is available', () => {
  assert.deepEqual(
    resolveNpmCommand({
      env: { npm_execpath: 'C:\\npm\\npm-cli.js' },
      execPath: 'C:\\node\\node.exe',
      platform: 'win32',
      fileExists: () => false,
    }),
    {
      command: 'C:\\node\\node.exe',
      prefixArgs: ['C:\\npm\\npm-cli.js'],
    },
  )
})

test('uses the npm CLI bundled beside node on Windows when npm_execpath is absent', () => {
  assert.deepEqual(
    resolveNpmCommand({
      env: {},
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      platform: 'win32',
      fileExists: () => true,
    }),
    {
      command: 'C:\\Program Files\\nodejs\\node.exe',
      prefixArgs: [
        'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      ],
    },
  )
})

test('falls back to npm on platforms without a discoverable CLI', () => {
  assert.deepEqual(
    resolveNpmCommand({
      env: {},
      execPath: '/usr/bin/node',
      platform: 'linux',
      fileExists: () => false,
    }),
    {
      command: 'npm',
      prefixArgs: [],
    },
  )
})
