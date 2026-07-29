import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createProjectOsMcpServer } from '@project-os/mcp'
import {
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import {
  createAppContext,
  defaultSeedDocument,
  type AppContext,
} from './context.js'
import { createTestEnvironment } from '../../../scripts/test-environment.mjs'

type ToolArguments = Record<string, unknown>

type RegisteredAgent = {
  agent_id: string
}

type PersistedProject = {
  id: string
  version: number
}

type PersistedTask = {
  id: string
  projectId: string
  progress: number
  version: number
}

type Activity = {
  actorId: string
  entityId: string
  entityType: string
  operation: string
  source: string
}

type TestEnvironment = Awaited<ReturnType<typeof createTestEnvironment>>

function structured(result: Awaited<ReturnType<Client['callTool']>>) {
  expect(result.structuredContent).toBeDefined()
  return result.structuredContent as Record<string, unknown>
}

describe('REST and MCP consistency', () => {
  let api: ReturnType<typeof request> | undefined
  let client: Client | undefined
  let context: AppContext | undefined
  let environment: TestEnvironment | undefined
  let server: ReturnType<typeof createProjectOsMcpServer> | undefined

  function rest(): ReturnType<typeof request> {
    if (api === undefined) {
      throw new Error('REST test client is not initialized')
    }
    return api
  }

  function services(): AppContext['services'] {
    if (context === undefined) {
      throw new Error('Test context is not initialized')
    }
    return context.services
  }

  async function closeTestResources(): Promise<void> {
    const currentClient = client
    const currentServer = server
    const currentContext = context
    const currentEnvironment = environment
    api = undefined
    client = undefined
    server = undefined
    context = undefined
    environment = undefined

    let firstError: unknown
    try {
      const closeableResources = [
        ...(currentClient === undefined ? [] : [currentClient]),
        ...(currentServer === undefined ? [] : [currentServer]),
      ]
      const results = await Promise.allSettled(
        closeableResources.map(async (resource) => {
          await resource.close()
        }),
      )
      firstError = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      )?.reason
    } finally {
      try {
        currentContext?.close()
      } catch (error) {
        firstError ??= error
      } finally {
        if (currentEnvironment !== undefined) {
          try {
            await currentEnvironment.cleanup()
          } catch (error) {
            firstError ??= error
          }
        }
      }
    }
    if (firstError !== undefined) {
      throw firstError
    }
  }

  beforeEach(async () => {
    try {
      environment = await createTestEnvironment('consistency')
      context = createAppContext({
        databasePath: environment.databasePath,
        backupRoot: environment.backupRoot,
      })
      context.services.exports.importJson(defaultSeedDocument)
      api = request(createApp({ context }))

      server = createProjectOsMcpServer(context.services)
      client = new Client({
        name: 'project-os-consistency-test',
        version: '0.0.0',
      })
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair()
      await server.connect(serverTransport)
      await client.connect(clientTransport)
    } catch (error) {
      try {
        await closeTestResources()
      } catch {
        // The setup error is the first and most useful failure.
      }
      throw error
    }
  })

  afterEach(async () => {
    await closeTestResources()
  })

  async function callTool(name: string, arguments_: ToolArguments) {
    if (client === undefined) {
      throw new Error('MCP test client is not initialized')
    }
    return client.callTool({ name, arguments: arguments_ })
  }

  async function registerAgent(
    role: 'pm-agent' | 'dev-agent' = 'pm-agent',
  ): Promise<RegisteredAgent> {
    const result = await callTool('agent_register', {
      name: `${role}-${crypto.randomUUID()}`,
      role,
      client: 'codex',
    })
    return structured(result) as RegisteredAgent
  }

  async function createRestProject(ownerId: string): Promise<PersistedProject> {
    const response = await rest().post('/api/v1/projects').send({
      name: `REST project ${crypto.randomUUID()}`,
      ownerId,
      startDate: '2026-07-29',
      dueDate: '2026-08-31',
    })
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    return response.body.data as PersistedProject
  }

  async function createRestTask(
    projectId: string,
    assigneeId: string,
  ): Promise<PersistedTask> {
    const response = await rest()
      .post(`/api/v1/projects/${projectId}/tasks`)
      .send({
        title: `REST task ${crypto.randomUUID()}`,
        assigneeId,
        startDate: '2026-07-29',
        dueDate: '2026-08-01',
        priority: 'P1',
      })
      .expect(201)
    return response.body.data as PersistedTask
  }

  it('shows one MCP progress mutation through REST', async () => {
    const pm = await registerAgent()
    const dev = await registerAgent('dev-agent')
    const otherDev = await registerAgent('dev-agent')
    const project = await createRestProject(pm.agent_id)
    await rest().post(`/api/v1/projects/${project.id}/members`)
      .send({ actorId: dev.agent_id })
      .expect(201)
    await rest().post(`/api/v1/projects/${project.id}/members`)
      .send({ actorId: otherDev.agent_id })
      .expect(201)
    const task = await createRestTask(project.id, dev.agent_id)
    const otherTask = await createRestTask(project.id, otherDev.agent_id)

    await callTool('progress_submit', {
      agent_id: otherDev.agent_id,
      task_id: otherTask.id,
      progress: 40,
      status: 'in_progress',
      note: 'filter interference',
      version: otherTask.version,
    })
    await callTool('task_get', {
      agent_id: otherDev.agent_id,
      task_id: otherTask.id,
    })

    const result = await callTool('progress_submit', {
      agent_id: dev.agent_id,
      task_id: task.id,
      progress: 80,
      status: 'in_progress',
      note: 'cross-surface',
      version: task.version,
    })
    expect(result.isError).not.toBe(true)

    const taskResponse = await rest()
      .get(`/api/v1/tasks/${task.id}`)
      .expect(200)
    const activityResponse = await rest()
      .get(`/api/v1/activities?entity_id=${task.id}&limit=200`)
      .expect(200)
    const activities = activityResponse.body.data.items as Activity[]
    const progressActivities = activities.filter(
      (item: { operation: string }) => item.operation === 'task.progress',
    )

    expect(taskResponse.body.data).toMatchObject({
      progress: 80,
      status: 'in_progress',
    })
    expect(activities).toHaveLength(2)
    expect(activities.every((item) =>
      item.entityId === task.id && item.entityType === 'task',
    )).toBe(true)
    expect(progressActivities).toEqual([
      expect.objectContaining({
        actorId: dev.agent_id,
        entityId: task.id,
        entityType: 'task',
        source: 'mcp',
        operation: 'task.progress',
        note: 'cross-surface',
      }),
    ])
    expect(activities.find(({ operation }) => operation === 'task.create'))
      .toMatchObject({
        actorId: defaultSeedDocument.actors[0]!.id,
        entityId: task.id,
        entityType: 'task',
        source: 'web',
      })
  })

  it('shows REST project and task writes through MCP reads and lists', async () => {
    const pm = await registerAgent()
    const project = await createRestProject(pm.agent_id)
    const task = await createRestTask(project.id, pm.agent_id)

    const projectGet = await callTool('project_get', {
      agent_id: pm.agent_id,
      project_id: project.id,
    })
    const projectList = await callTool('project_list', {
      agent_id: pm.agent_id,
      owner_id: pm.agent_id,
    })
    const taskGet = await callTool('task_get', {
      agent_id: pm.agent_id,
      task_id: task.id,
    })
    const taskList = await callTool('task_list', {
      agent_id: pm.agent_id,
      project_id: project.id,
    })

    expect(structured(projectGet).project).toMatchObject({ id: project.id })
    expect(structured(projectList).projects).toEqual([
      expect.objectContaining({ id: project.id }),
    ])
    expect(structured(taskGet).task).toMatchObject({ id: task.id })
    expect(structured(taskList).items).toEqual([
      expect.objectContaining({ id: task.id }),
    ])
  })

  it('returns stable task version conflicts in both directions', async () => {
    const pm = await registerAgent()
    const project = await createRestProject(pm.agent_id)
    const task = await createRestTask(project.id, pm.agent_id)

    const restUpdate = await rest().patch(`/api/v1/tasks/${task.id}`).send({
      title: 'Updated through REST',
      version: task.version,
    }).expect(200)
    const staleMcp = await callTool('task_update', {
      agent_id: pm.agent_id,
      task_id: task.id,
      title: 'Stale MCP update',
      version: task.version,
    })

    expect(staleMcp.isError).toBe(true)
    expect(structured(staleMcp)).toMatchObject({
      code: 'TASK_VERSION_CONFLICT',
      details: {
        expectedVersion: task.version,
        currentVersion: restUpdate.body.data.version,
      },
    })

    const mcpUpdate = await callTool('task_update', {
      agent_id: pm.agent_id,
      task_id: task.id,
      title: 'Updated through MCP',
      version: restUpdate.body.data.version,
    })
    const mcpTask = structured(mcpUpdate).task as PersistedTask
    const staleRest = await rest().patch(`/api/v1/tasks/${task.id}`).send({
      title: 'Stale REST update',
      version: restUpdate.body.data.version,
    }).expect(409)

    expect(staleRest.body.error).toMatchObject({
      code: 'TASK_VERSION_CONFLICT',
      details: {
        expectedVersion: restUpdate.body.data.version,
        currentVersion: mcpTask.version,
      },
    })
    expect((await rest().get(`/api/v1/tasks/${task.id}`).expect(200)).body.data)
      .toMatchObject({
        title: 'Updated through MCP',
        version: mcpTask.version,
      })
  })

  it('keeps actor touches separate from business activity', async () => {
    const pm = await registerAgent()
    const otherPm = await registerAgent()
    const project = await createRestProject(pm.agent_id)
    const task = await createRestTask(project.id, pm.agent_id)
    const actorActivityCountBefore = services().activities.list({
      actorId: pm.agent_id,
      limit: 200,
    }).length
    const touchCountBefore = services().activities.list({
      actorId: pm.agent_id,
      limit: 200,
    }).filter(({ operation }) => operation === 'actor.update').length

    await callTool('task_get', {
      agent_id: pm.agent_id,
      task_id: task.id,
    })
    await callTool('task_list', {
      agent_id: pm.agent_id,
      project_id: project.id,
    })
    await callTool('progress_submit', {
      agent_id: pm.agent_id,
      task_id: task.id,
      progress: 80,
      status: 'in_progress',
      note: 'single business event',
      version: task.version,
    })
    await callTool('task_get', {
      agent_id: otherPm.agent_id,
      task_id: task.id,
    })

    const actorActivities = (await rest()
      .get(`/api/v1/activities?actor_id=${pm.agent_id}&limit=200`)
      .expect(200)).body.data.items as Activity[]
    const taskBusinessActivities = (await rest()
      .get(`/api/v1/activities?entity_id=${task.id}&limit=200`)
      .expect(200)).body.data.items as Activity[]
    const actorTouches = actorActivities.filter(
      (item) => item.operation === 'actor.update',
    )

    expect(actorActivities).toHaveLength(actorActivityCountBefore + 4)
    expect(actorActivities.every((item) =>
      item.actorId === pm.agent_id
      && item.source === 'mcp'
      && (
        (
          item.operation === 'task.progress'
          && item.entityId === task.id
          && item.entityType === 'task'
        )
        || (
          (
            item.operation === 'actor.register'
            || item.operation === 'actor.update'
          )
          && item.entityId === pm.agent_id
          && item.entityType === 'actor'
        )
      ),
    )).toBe(true)
    expect(taskBusinessActivities
      .filter(({ entityType }) => entityType === 'task')
      .map(({ operation }) => operation)
      .sort())
      .toEqual(['task.create', 'task.progress'])
    expect(actorTouches).toHaveLength(touchCountBefore + 3)
  })
})

describe('test environment cleanup', () => {
  it('shares one in-flight cleanup and remains repeatable', async () => {
    const environment = await createTestEnvironment('cleanup-concurrent')

    const first = environment.cleanup()
    const second = environment.cleanup()
    const results = await Promise.allSettled([first, second])

    expect(second).toBe(first)
    expect(results).toEqual([
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ])
    expect(environment.cleanup()).toBe(first)
    await expect(environment.cleanup()).resolves.toBeUndefined()
  })

  it('refuses a marker mismatch and can clean after restoration', async () => {
    const environment = await createTestEnvironment('cleanup-marker')
    const markerPath = join(
      environment.directory,
      '.project-os-test-environment',
    )
    const marker = await readFile(markerPath, 'utf8')

    await writeFile(markerPath, 'replaced marker', 'utf8')
    await expect(environment.cleanup()).rejects.toThrow(
      'Refusing to clean an unverified test directory',
    )
    await writeFile(markerPath, marker, 'utf8')
    await expect(environment.cleanup()).resolves.toBeUndefined()
  })

  it('refuses a replaced path and can clean after restoration', async () => {
    const environment = await createTestEnvironment('cleanup-replaced')
    const originalDirectory = `${environment.directory}-original`

    await rename(environment.directory, originalDirectory)
    await writeFile(environment.directory, 'replacement', 'utf8')
    await expect(environment.cleanup()).rejects.toThrow(
      'Refusing to clean a replaced test directory',
    )
    await rm(environment.directory)
    await rename(originalDirectory, environment.directory)
    await expect(environment.cleanup()).resolves.toBeUndefined()
  })
})
