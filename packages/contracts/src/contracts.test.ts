import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as contracts from './index.js'

const persistedHuman = {
  id: 'actor-1',
  name: 'Lin',
  kind: 'human' as const,
  role: 'owner' as const,
  status: 'active' as const,
  registeredAt: '2026-07-29T00:00:00.000Z',
  lastActiveAt: null,
  version: 1,
}

describe('shared contracts', () => {
  it('rejects progress outside 0..100', () => {
    expect(
      contracts.taskProgressInputSchema.safeParse({
        progress: 101,
        status: 'in_progress',
        note: '',
        version: 1,
      }).success,
    ).toBe(false)
  })

  it('parses human actors', () => {
    expect(contracts.actorSchema.parse(persistedHuman)).toMatchObject(
      persistedHuman,
    )
  })

  it('exposes project identity and owner fields', () => {
    expect(contracts.projectSchema.shape.ownerId).toBeDefined()
    expect(contracts.projectSchema.shape.id).toBeDefined()
  })
})

describe('activity operations', () => {
  it('accepts every stable operation used by Web, MCP, and administration', () => {
    const stableOperations = [
      'task.update',
      'task.schedule',
      'requirement.update',
      'defect.create',
      'actor.create',
      'actor.update',
      'actor.deactivate',
      'actor.register',
      'project.create',
      'project.update',
      'project.member.add',
      'task.create',
      'task.progress',
      'requirement.create',
      'defect.update',
      'defect.to_task',
      'settings.update',
      'backup.create',
      'backup.restore',
      'import.run',
      'token.issue',
      'token.revoke',
    ] as const

    for (const operation of stableOperations) {
      expect(
        contracts.activityOperationSchema.safeParse(operation).success,
        operation,
      ).toBe(true)
    }
  })

  it('rejects unknown operations', () => {
    expect(
      contracts.activityOperationSchema.safeParse('task.destroy').success,
    ).toBe(false)
  })
})

describe('pagination', () => {
  it('defaults an omitted limit to 50', () => {
    expect(contracts.paginationSchema.parse({})).toEqual({ limit: 50 })
  })

  it('accepts 200 and rejects 201', () => {
    expect(contracts.paginationSchema.safeParse({ limit: 200 }).success).toBe(
      true,
    )
    expect(contracts.paginationSchema.safeParse({ limit: 201 }).success).toBe(
      false,
    )
  })
})

describe('persisted validation boundaries', () => {
  it('accepts canonical UTC timestamps and rejects offset timestamps', () => {
    expect(contracts.persistedActorSchema.safeParse(persistedHuman).success).toBe(
      true,
    )
    expect(
      contracts.persistedActorSchema.safeParse({
        ...persistedHuman,
        registeredAt: '2026-07-29T08:00:00.000+08:00',
      }).success,
    ).toBe(false)
  })

  it('requires persisted identity, project, timestamp, and version fields', () => {
    const compatibilityTask = {
      id: 'task-1',
      code: 'TASK-1',
      title: 'Ship',
      description: '',
      assignee: { id: 'actor-1', name: 'Lin', kind: 'human' as const },
      startDate: '2026-07-29',
      dueDate: '2026-07-30',
      priority: 'P1' as const,
      status: 'in_progress' as const,
      progress: 50,
      milestoneId: '',
      dependencyIds: [],
    }
    const compatibilityRequirement = {
      id: 'requirement-1',
      code: 'REQ-1',
      title: 'Persist',
      priority: 'P1' as const,
      status: 'draft' as const,
      linkedTaskIds: [],
      completedTaskCount: 0,
      acceptanceCriteria: [],
    }
    const compatibilityDefect = {
      id: 'defect-1',
      code: 'DEF-1',
      title: 'Missing boundary',
      severity: 'normal' as const,
      status: 'open' as const,
      assignee: { id: 'actor-1', name: 'Lin', kind: 'human' as const },
      updatedAt: '2026-07-29T00:00:00.000Z',
      reproductionSteps: [],
    }

    expect(
      contracts.persistedActorSchema.safeParse({
        ...persistedHuman,
        version: undefined,
      }).success,
    ).toBe(false)
    expect(
      contracts.persistedTaskSchema.safeParse(compatibilityTask).success,
    ).toBe(false)
    expect(
      contracts.persistedRequirementSchema.safeParse(compatibilityRequirement)
        .success,
    ).toBe(false)
    expect(
      contracts.persistedDefectSchema.safeParse(compatibilityDefect).success,
    ).toBe(false)
  })

  it('rejects actor roles that do not match the actor kind', () => {
    expect(
      contracts.actorSchema.safeParse({
        ...persistedHuman,
        role: 'dev-agent',
      }).success,
    ).toBe(false)
  })
})

describe('API envelopes', () => {
  it('parses success and error envelopes', () => {
    const successSchema = contracts.apiSuccessEnvelopeSchema(
      z.object({ id: z.string().min(1) }),
    )

    expect(
      successSchema.parse({
        data: { id: 'task-1' },
        error: null,
        meta: { request_id: 'request-1' },
      }),
    ).toEqual({
      data: { id: 'task-1' },
      error: null,
      meta: { request_id: 'request-1' },
    })
    expect(
      contracts.apiErrorEnvelopeSchema.parse({
        data: null,
        error: {
          code: 'NOT_FOUND',
          message: 'Task not found',
          details: { taskId: 'task-1' },
        },
        meta: { request_id: 'request-2' },
      }),
    ).toEqual({
      data: null,
      error: {
        code: 'NOT_FOUND',
        message: 'Task not found',
        details: { taskId: 'task-1' },
      },
      meta: { request_id: 'request-2' },
    })
  })

  it('rejects malformed and legacy envelopes', () => {
    const successSchema = contracts.apiSuccessEnvelopeSchema(z.string())

    expect(
      successSchema.safeParse({
        data: 'ok',
        requestId: 'request-1',
      }).success,
    ).toBe(false)
    expect(
      contracts.apiErrorEnvelopeSchema.safeParse({
        error: { code: '', message: 'Task not found' },
        requestId: 'request-2',
      }).success,
    ).toBe(false)
    expect(
      successSchema.safeParse({
        data: 'ok',
        error: { code: 'NOPE' },
        meta: { request_id: 'request-1' },
      }).success,
    ).toBe(false)
  })
})
