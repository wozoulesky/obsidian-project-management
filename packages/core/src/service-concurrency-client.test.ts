import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ActorService } from './actor-service.js'
import { openDatabase } from './database.js'
import { ProjectService } from './project-service.js'

const path = process.env.PROJECT_OS_CONCURRENCY_DATABASE
const mode = process.env.PROJECT_OS_CONCURRENCY_MODE
const enabled = path !== undefined && mode !== undefined
const concurrencyDescribe = enabled ? describe : describe.skip
const database = enabled ? openDatabase(path) : undefined
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4))

function waitForBothClients(): void {
  const barrier = process.env.PROJECT_OS_CONCURRENCY_BARRIER
  if (barrier === undefined) {
    throw new Error('Concurrency barrier is required')
  }

  writeFileSync(join(barrier, `${process.pid}.ready`), '')
  const deadline = Date.now() + 10_000

  while (
    readdirSync(barrier).filter((file) => file.endsWith('.ready')).length < 2
  ) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the other concurrency client')
    }
    Atomics.wait(sleepBuffer, 0, 0, 20)
  }
}

afterAll(() => {
  database?.close()
})

concurrencyDescribe('service concurrency client', () => {
  it('performs one service mutation against the shared file database', () => {
    expect(database).toBeDefined()

    if (database === undefined) {
      return
    }

    waitForBothClients()

    if (mode === 'agent') {
      const agent = new ActorService(database).registerAgent({
        name: 'builder',
        role: 'dev-agent',
        client: 'codex',
      })
      expect(agent.name).toBe('builder')
      return
    }

    if (mode === 'project') {
      const ownerId = process.env.PROJECT_OS_CONCURRENCY_OWNER
      expect(ownerId).toBeDefined()
      if (ownerId === undefined) {
        return
      }

      const project = new ProjectService(database).create(
        {
          name: `Concurrent project ${process.pid}`,
          ownerId,
          description: '',
        },
        ownerId,
        'web',
      )
      expect(project.code).toMatch(/^PRJ-\d{4}$/)
      return
    }

    throw new Error(`Unknown concurrency mode: ${mode}`)
  })
})
