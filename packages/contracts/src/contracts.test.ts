import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as contracts from './index.js'
import {
  activityOperationSchema,
  deleteProjectInputSchema,
  deleteProjectResultSchema,
} from './index.js'

const persistedHuman = {
  id: 'actor-1',
  name: 'Lin',
  kind: 'human' as const,
  role: 'owner' as const,
  status: 'active' as const,
  registeredAt: '2026-07-29T00:00:00.000Z',
  lastActiveAt: null,
  lastBriefingActivityId: null,
  version: 1,
}

const agent = {
  id: 'agent-1',
  name: 'Builder',
  kind: 'agent' as const,
  role: 'dev-agent' as const,
}

const project = {
  id: 'project-1',
  code: 'PROJ-1',
  name: 'Project OS',
  description: 'Relay work between agents',
  ownerId: 'actor-1',
  startDate: '2026-07-29',
  dueDate: null,
  status: 'in_progress' as const,
  progress: 25,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T01:00:00.000Z',
  version: 1,
}

const task = {
  id: 'task-1',
  code: 'TASK-1',
  title: 'Build relay contracts',
  description: '',
  assignee: agent,
  startDate: '2026-07-29',
  dueDate: '2026-07-30',
  priority: 'P1' as const,
  status: 'in_progress' as const,
  progress: 50,
  milestoneId: '',
  dependencyIds: [],
  projectId: 'project-1',
  assigneeId: 'agent-1',
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T01:00:00.000Z',
  version: 1,
}

const session = {
  id: 'session-1',
  projectId: 'project-1',
  agentId: 'agent-1',
  agent,
  intent: 'Implement relay contracts',
  taskIds: ['task-1'],
  status: 'active' as const,
  summary: null,
  createdAt: '2026-07-29T01:00:00.000Z',
  lastActiveAt: '2026-07-29T01:30:00.000Z',
  closedAt: null,
}

const handoff = {
  id: 'handoff-1',
  projectId: 'project-1',
  sessionId: 'session-1',
  author: agent,
  summary: 'Contracts are ready for the service layer',
  done: ['Added relay schemas'],
  blockers: [],
  nextSteps: ['Implement persistence'],
  gotchas: ['Keep wire field names stable'],
  refs: [
    { kind: 'commit' as const, ref: 'abc123', note: 'Contract commit' },
    { kind: 'file' as const, ref: 'packages/contracts/src/index.ts' },
    { kind: 'url' as const, ref: 'https://example.test/relay' },
    { kind: 'note' as const, ref: 'Review the cursor fallback' },
  ],
  createdAt: '2026-07-29T02:00:00.000Z',
}

const deliverable = {
  id: 'deliverable-1',
  projectId: 'project-1',
  requirementId: 'requirement-1',
  taskId: 'task-1',
  title: 'Relay contract implementation',
  kind: 'commit' as const,
  ref: 'abc123',
  note: null,
  createdBy: agent,
  sessionId: 'session-1',
  createdAt: '2026-07-29T01:45:00.000Z',
}

const activity = {
  id: 'activity-1',
  actor: agent,
  action: 'Checked in',
  operation: 'session.checkin' as const,
  createdAt: '2026-07-29T01:00:00.000Z',
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
    expect(contracts.actorSchema.parse(persistedHuman)).toMatchObject({
      id: persistedHuman.id,
      name: persistedHuman.name,
      kind: persistedHuman.kind,
      role: persistedHuman.role,
    })
  })

  it('exposes project identity and owner fields', () => {
    expect(contracts.projectSchema.shape.ownerId).toBeDefined()
    expect(contracts.projectSchema.shape.id).toBeDefined()
  })
})

describe('project deletion contracts', () => {
  it('validates deletion input, result, and activity operation', () => {
    expect(deleteProjectInputSchema.parse({ version: 2 })).toEqual({
      version: 2,
    })
    expect(deleteProjectInputSchema.safeParse({ version: 0 }).success).toBe(
      false,
    )
    expect(
      deleteProjectResultSchema.parse({
        id: 'project_demo',
        name: 'Demo',
        deletedAt: '2026-08-02T08:00:00.000Z',
      }),
    ).toEqual({
      id: 'project_demo',
      name: 'Demo',
      deletedAt: '2026-08-02T08:00:00.000Z',
    })
    expect(activityOperationSchema.parse('project.delete')).toBe(
      'project.delete',
    )
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
      'session.checkin',
      'session.note',
      'session.checkout',
      'handoff.update',
      'deliverable.record',
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

  it('requires a nullable, non-empty briefing activity waterline', () => {
    const {
      lastBriefingActivityId: _lastBriefingActivityId,
      ...withoutWaterline
    } = persistedHuman

    expect(
      contracts.persistedActorSchema.safeParse(withoutWaterline).success,
    ).toBe(false)
    expect(
      contracts.persistedActorSchema.safeParse({
        ...persistedHuman,
        lastBriefingActivityId: '',
      }).success,
    ).toBe(false)
    expect(
      contracts.persistedActorSchema.safeParse({
        ...persistedHuman,
        lastBriefingActivityId: 'activity-1',
      }).success,
    ).toBe(true)
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

describe('relay entities and briefing', () => {
  it('parses sessions and persisted sessions with embedded agent snapshots', () => {
    expect(contracts.sessionSchema.parse(session)).toEqual(session)
    expect(contracts.persistedSessionSchema.parse(session)).toEqual(session)
    expect(
      contracts.sessionSchema.safeParse({
        ...session,
        agent: { ...agent, role: 'owner' },
      }).success,
    ).toBe(false)
    expect(
      contracts.sessionSchema.safeParse({
        ...session,
        status: 'waiting',
      }).success,
    ).toBe(false)
  })

  it('parses handoffs and rejects empty references', () => {
    expect(contracts.handoffSchema.parse(handoff)).toEqual(handoff)
    expect(
      contracts.handoffSchema.safeParse({
        ...handoff,
        refs: [{ kind: 'file', ref: '' }],
      }).success,
    ).toBe(false)
  })

  it('parses deliverables with actor snapshots', () => {
    expect(contracts.deliverableSchema.parse(deliverable)).toEqual(deliverable)
    expect(
      contracts.deliverableSchema.safeParse({
        ...deliverable,
        kind: 'artifact',
      }).success,
    ).toBe(false)
  })

  it('preserves the project briefing wire field names', () => {
    const briefing = {
      project,
      my_tasks: [task],
      in_progress_tasks: [
        {
          task,
          latest_progress: {
            note: 'Halfway done',
            actor_name: 'Builder',
            created_at: '2026-07-29T01:30:00.000Z',
          },
        },
        { task, latest_progress: null },
      ],
      unclaimed_tasks: [],
      sessions: [session],
      latest_handoff: handoff,
      recent_deliverables: [deliverable],
      new_activities: [activity],
      activities_truncated: false,
      activity_cursor: 'activity-1',
    }

    expect(contracts.projectBriefingSchema.parse(briefing)).toEqual(briefing)
    expect(
      contracts.projectBriefingSchema.safeParse({
        ...briefing,
        activities_truncated: 'false',
      }).success,
    ).toBe(false)
  })
})

describe('relay inputs', () => {
  it('validates session check-ins and limits claimed tasks to 20', () => {
    expect(
      contracts.sessionCheckinInputSchema.parse({
        projectId: 'project-1',
        agentId: 'agent-1',
        intent: 'Continue relay work',
        taskIds: ['task-1'],
      }),
    ).toEqual({
      projectId: 'project-1',
      agentId: 'agent-1',
      intent: 'Continue relay work',
      taskIds: ['task-1'],
    })
    expect(
      contracts.sessionCheckinInputSchema.safeParse({
        projectId: 'project-1',
        agentId: 'agent-1',
        intent: '',
        taskIds: [],
      }).success,
    ).toBe(false)
    expect(
      contracts.sessionCheckinInputSchema.safeParse({
        projectId: 'project-1',
        agentId: 'agent-1',
        intent: 'Claim too much',
        taskIds: Array.from({ length: 21 }, (_, index) => `task-${index}`),
      }).success,
    ).toBe(false)
  })

  it('validates non-empty session notes with an optional task association', () => {
    expect(
      contracts.sessionNoteInputSchema.parse({
        sessionId: 'session-1',
        agentId: 'agent-1',
        note: 'The cursor is project-scoped',
        taskId: 'task-1',
      }),
    ).toEqual({
      sessionId: 'session-1',
      agentId: 'agent-1',
      note: 'The cursor is project-scoped',
      taskId: 'task-1',
    })
    expect(
      contracts.sessionNoteInputSchema.safeParse({
        sessionId: 'session-1',
        agentId: 'agent-1',
        note: '',
      }).success,
    ).toBe(false)
  })

  it('validates structured session checkout input', () => {
    const checkout = {
      sessionId: 'session-1',
      agentId: 'agent-1',
      summary: 'Relay contracts implemented',
      done: ['Schemas added'],
      blockers: [],
      nextSteps: ['Add services'],
      gotchas: [],
      refs: [{ kind: 'commit' as const, ref: 'abc123' }],
    }

    expect(contracts.sessionCheckoutInputSchema.parse(checkout)).toEqual(
      checkout,
    )
    expect(
      contracts.sessionCheckoutInputSchema.safeParse({
        ...checkout,
        summary: '',
      }).success,
    ).toBe(false)
    expect(
      contracts.sessionCheckoutInputSchema.safeParse({
        ...checkout,
        refs: [{ kind: 'commit', ref: '' }],
      }).success,
    ).toBe(false)
  })

  it('requires a deliverable to reference a requirement or task', () => {
    const base = {
      projectId: 'project-1',
      agentId: 'agent-1',
      title: 'Relay contracts',
      kind: 'commit' as const,
      ref: 'abc123',
    }

    expect(
      contracts.deliverableRecordInputSchema.safeParse({
        ...base,
        requirementId: 'requirement-1',
      }).success,
    ).toBe(true)
    expect(
      contracts.deliverableRecordInputSchema.safeParse({
        ...base,
        taskId: 'task-1',
        sessionId: 'session-1',
        note: 'Ready for review',
      }).success,
    ).toBe(true)
    expect(
      contracts.deliverableRecordInputSchema.safeParse(base).success,
    ).toBe(false)
    expect(
      contracts.deliverableRecordInputSchema.safeParse({
        ...base,
        requirementId: '',
      }).success,
    ).toBe(false)
    expect(
      contracts.deliverableRecordInputSchema.safeParse({
        ...base,
        taskId: 'task-1',
        ref: '',
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
    expect(
      successSchema.safeParse({
        data: 'ok',
        error: null,
        meta: { request_id: 'request-1', trace: 'not-public' },
        stack: 'not-public',
      }).success,
    ).toBe(false)
    expect(
      contracts.apiErrorEnvelopeSchema.safeParse({
        data: null,
        error: {
          code: 'NOT_FOUND',
          message: 'Missing',
          details: {},
          stack: 'not-public',
        },
        meta: { request_id: 'request-2' },
        trace: 'not-public',
      }).success,
    ).toBe(false)
  })
})
