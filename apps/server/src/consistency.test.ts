import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createProjectOsMcpServer } from '@project-os/mcp'
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

type TestEnvironment = Awaited<ReturnType<typeof createTestEnvironment>>

function structured(result: Awaited<ReturnType<Client['callTool']>>) {
  expect(result.structuredContent).toBeDefined()
  return result.structuredContent as Record<string, unknown>
}

describe('REST and MCP consistency', () => {
  let api: ReturnType<typeof request>
  let client: Client
  let context: AppContext
  let environment: TestEnvironment
  let server: ReturnType<typeof createProjectOsMcpServer>

  beforeEach(async () => {
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
  })

  afterEach(async () => {
    await client.close()
    await server.close()
    context.close()
    await environment.cleanup()
  })

  async function callTool(name: string, arguments_: ToolArguments) {
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
    const response = await api.post('/api/v1/projects').send({
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
    const response = await api
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
    const project = await createRestProject(pm.agent_id)
    await api.post(`/api/v1/projects/${project.id}/members`)
      .send({ actorId: dev.agent_id })
      .expect(201)
    const task = await createRestTask(project.id, dev.agent_id)

    const result = await callTool('progress_submit', {
      agent_id: dev.agent_id,
      task_id: task.id,
      progress: 80,
      status: 'in_progress',
      note: 'cross-surface',
      version: task.version,
    })
    expect(result.isError).not.toBe(true)

    const taskResponse = await api
      .get(`/api/v1/tasks/${task.id}`)
      .expect(200)
    const activityResponse = await api
      .get(`/api/v1/activities?entity_id=${task.id}&limit=200`)
      .expect(200)
    const progressActivities = activityResponse.body.data.items.filter(
      (item: { operation: string }) => item.operation === 'task.progress',
    )

    expect(taskResponse.body.data).toMatchObject({
      progress: 80,
      status: 'in_progress',
    })
    expect(progressActivities).toEqual([
      expect.objectContaining({
        source: 'mcp',
        operation: 'task.progress',
        note: 'cross-surface',
      }),
    ])
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

    const restUpdate = await api.patch(`/api/v1/tasks/${task.id}`).send({
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
    const staleRest = await api.patch(`/api/v1/tasks/${task.id}`).send({
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
    expect((await api.get(`/api/v1/tasks/${task.id}`).expect(200)).body.data)
      .toMatchObject({
        title: 'Updated through MCP',
        version: mcpTask.version,
      })
  })

  it('keeps actor touches separate from business activity', async () => {
    const pm = await registerAgent()
    const project = await createRestProject(pm.agent_id)
    const task = await createRestTask(project.id, pm.agent_id)
    const touchCountBefore = context.services.activities.list({
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

    const actorActivities = (await api
      .get(`/api/v1/activities?actor_id=${pm.agent_id}&limit=200`)
      .expect(200)).body.data.items as Array<{
        entityId: string
        entityType: string
        operation: string
      }>
    const taskBusinessActivities = (await api
      .get(`/api/v1/activities?entity_id=${task.id}&limit=200`)
      .expect(200)).body.data.items as Array<{
        entityId: string
        entityType: string
        operation: string
      }>
    const actorTouches = actorActivities.filter(
      (item) => item.operation === 'actor.update',
    )

    expect(taskBusinessActivities
      .filter(({ entityType }) => entityType === 'task')
      .map(({ operation }) => operation)
      .sort())
      .toEqual(['task.create', 'task.progress'])
    expect(actorTouches).toHaveLength(touchCountBefore + 3)
  })
})
