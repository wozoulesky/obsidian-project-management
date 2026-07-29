import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RuntimeControl,
  RuntimeStoppingError,
  supervisedExitCode,
} from './runtime-control.mjs'

test('a stop requested during startup prevents later child registration', async () => {
  const terminated = []
  const control = new RuntimeControl(async (child, signal) => {
    terminated.push([child, signal])
  })

  await control.stop('SIGTERM')

  assert.throws(
    () => control.checkpoint(),
    RuntimeStoppingError,
  )
  assert.throws(
    () => control.add({ pid: 1 }),
    RuntimeStoppingError,
  )
  assert.deepEqual(terminated, [])
})

test('cleanup serializes registered child termination without duplicates', async () => {
  const terminated = []
  const control = new RuntimeControl(async (child, signal) => {
    terminated.push([child.pid, signal])
  })
  control.add({ pid: 1 })
  control.add({ pid: 2 })

  await Promise.all([
    control.stop('SIGINT'),
    control.stop('SIGINT'),
  ])

  assert.deepEqual(terminated, [
    [1, 'SIGINT'],
    [2, 'SIGINT'],
  ])
})

test('a parent-requested shutdown keeps the clean signal exit policy', () => {
  assert.equal(supervisedExitCode(128, true), 0)
  assert.equal(supervisedExitCode(1, false), 1)
})
