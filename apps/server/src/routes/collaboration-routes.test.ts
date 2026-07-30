import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deliverableSchema,
  handoffSchema,
  sessionSchema,
} from '@project-os/contracts'
import type { Deliverable } from '@project-os/contracts'
import {
  DeliverableService,
  HandoffService,
  seedDatabase,
  SessionService,
} from '@project-os/core'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import {
  createAppContext,
  defaultSeedDocument,
  type AppContext,
} from '../context.js'

const contexts: AppContext[] = []
const directories: string[] = []

function createApi() {
  const directory = mkdtempSync(join(tmpdir(), 'project-os-collaboration-'))
  const context = createAppContext({
    databasePath: join(directory, 'test.db'),
    backupRoot: join(directory, 'backups'),
  })
  directories.push(directory)
  contexts.push(context)
  seedDatabase(context.database, defaultSeedDocument)
  return {
    api: request(createApp({ context })),
    context,
  }
}

function createAgent(context: AppContext) {
  const owner = defaultSeedDocument.actors[0]!
  const project = defaultSeedDocument.projects[0]!
  const agent = context.services.actors.registerAgent({
    name: 'Relay agent',
    role: 'dev-agent',
    client: 'codex',
    capabilities: ['relay'],
  }, owner.id, 'web')
  context.services.projects.addMember(
    project.id,
    agent.id,
    owner.id,
    'web',
  )
  return { agent, owner, project }
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.close()
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('collaboration routes', () => {
  it('lists active sessions by default and includes closed sessions on request', async () => {
    const { api, context } = createApi()
    const { agent, project } = createAgent(context)
    const sessions = new SessionService(context.database)
    const closed = sessions.checkin({
      agentId: agent.id,
      projectId: project.id,
      intent: 'Finish the old relay',
      taskIds: [],
    })
    sessions.checkout({
      agentId: agent.id,
      sessionId: closed.id,
      summary: 'Old relay complete',
      done: ['Implemented'],
      blockers: [],
      nextSteps: ['Verify'],
      gotchas: [],
      refs: [],
    })
    const active = sessions.checkin({
      agentId: agent.id,
      projectId: project.id,
      intent: 'Start the next relay',
      taskIds: [],
    })

    const defaultResponse = await api
      .get(`/api/v1/projects/${project.id}/sessions`)
      .expect(200)
    const includedResponse = await api
      .get(
        `/api/v1/projects/${project.id}/sessions`
        + '?include_closed=true&limit=1',
      )
      .expect(200)

    expect(defaultResponse.body.data.items.map(
      (item: unknown) => sessionSchema.parse(item).id,
    )).toEqual([active.id])
    expect(includedResponse.body.data.items.map(
      (item: unknown) => sessionSchema.parse(item).id,
    )).toEqual([active.id])

    const all = await api
      .get(
        `/api/v1/projects/${project.id}/sessions`
        + '?include_closed=true&limit=2',
      )
      .expect(200)
    expect(all.body.data.items.map(
      (item: unknown) => sessionSchema.parse(item).id,
    )).toEqual([active.id, closed.id])
    expect(all.body.data.items[1].status).toBe('closed')
  })

  it('lists handoffs latest-first and applies the requested limit', async () => {
    const { api, context } = createApi()
    const { agent, project } = createAgent(context)
    const handoffs = new HandoffService(context.database)
    const first = handoffs.create({
      projectId: project.id,
      authorId: agent.id,
      summary: 'First handoff',
      done: [],
      blockers: [],
      nextSteps: [],
      gotchas: [],
      refs: [],
    })
    const latest = handoffs.create({
      projectId: project.id,
      authorId: agent.id,
      summary: 'Latest handoff',
      done: ['REST'],
      blockers: [],
      nextSteps: ['Web'],
      gotchas: [],
      refs: [],
    })

    const response = await api
      .get(`/api/v1/projects/${project.id}/handoffs?limit=1`)
      .expect(200)

    expect(response.body.data.items.map(
      (item: unknown) => handoffSchema.parse(item).id,
    )).toEqual([latest.id])
    expect(response.body.data.items).not.toContainEqual(
      expect.objectContaining({ id: first.id }),
    )
  })

  it('filters deliverables by requirement and returns them latest-first', async () => {
    const { api, context } = createApi()
    const { agent, owner, project } = createAgent(context)
    const firstRequirement = context.services.requirements.create({
      projectId: project.id,
      title: 'First relay requirement',
      priority: 'P1',
    }, owner.id, 'web')
    const secondRequirement = context.services.requirements.create({
      projectId: project.id,
      title: 'Second relay requirement',
      priority: 'P1',
    }, owner.id, 'web')
    const deliverables = new DeliverableService(context.database)
    const first = deliverables.record({
      agentId: agent.id,
      projectId: project.id,
      requirementId: firstRequirement.id,
      title: 'First artifact',
      kind: 'file',
      ref: 'first.md',
    })
    deliverables.record({
      agentId: agent.id,
      projectId: project.id,
      requirementId: secondRequirement.id,
      title: 'Other artifact',
      kind: 'file',
      ref: 'other.md',
    })
    const latest = deliverables.record({
      agentId: agent.id,
      projectId: project.id,
      requirementId: firstRequirement.id,
      title: 'Latest artifact',
      kind: 'commit',
      ref: 'deadbeef',
    })

    const response = await api
      .get(
        `/api/v1/projects/${project.id}/deliverables`
        + `?requirement_id=${firstRequirement.id}&limit=2`,
      )
      .expect(200)
    const items: Deliverable[] = response.body.data.items.map(
      (item: unknown) => deliverableSchema.parse(item),
    )

    expect(items.map((item) => item.id)).toEqual([latest.id, first.id])
    expect(items.every(
      (item) => item.requirementId === firstRequirement.id,
    )).toBe(true)
  })

  it('rejects repeated, unknown, and invalid collaboration queries', async () => {
    const { api } = createApi()
    const projectId = defaultSeedDocument.projects[0]!.id
    const paths = [
      `/api/v1/projects/${projectId}/sessions?include_closed=yes`,
      `/api/v1/projects/${projectId}/sessions?include_closed=true&include_closed=false`,
      `/api/v1/projects/${projectId}/sessions?limit=0`,
      `/api/v1/projects/${projectId}/handoffs?limit=201`,
      `/api/v1/projects/${projectId}/handoffs?limit=1&limit=2`,
      `/api/v1/projects/${projectId}/deliverables?requirement_id=`,
      `/api/v1/projects/${projectId}/deliverables?unknown=1`,
    ]
    for (const path of paths) {
      await api.get(path).expect(400)
    }
  })

  it('rejects a missing parent project for every collaboration list', async () => {
    const { api } = createApi()
    for (const resource of ['sessions', 'handoffs', 'deliverables']) {
      const response = await api
        .get(`/api/v1/projects/project_missing/${resource}`)
        .expect(404)
      expect(response.body.error.code).toBe('PROJECT_NOT_FOUND')
    }
  })
})
