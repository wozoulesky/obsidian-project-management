import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  deliverableRecordInputSchema,
  projectMemberSchema,
  sessionCheckinInputSchema,
  sessionCheckoutInputSchema,
  sessionNoteInputSchema,
} from '@project-os/contracts'
import {
  assertPermission,
} from '@project-os/core'
import type {
  ActorService,
  BriefingService,
  DeliverableService,
  SessionService,
  WorkOperation,
} from '@project-os/core'
import { z } from 'zod'
import {
  runAtomicWrite,
} from '../tool-execution.js'
import {
  handleToolCall,
  successResult,
} from '../tool-result.js'
import { requireAgent } from './identity.js'

type CollaborationToolServices = {
  actors: ActorService
  briefing: BriefingService
  deliverables: DeliverableService
  sessions: SessionService
}

const agentIdSchema = projectMemberSchema.shape.actorId.describe(
  'Active Agent ID returned by agent_register',
)
const sessionCheckinToolInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: sessionCheckinInputSchema.shape.projectId,
  intent: sessionCheckinInputSchema.shape.intent,
  task_ids: sessionCheckinInputSchema.shape.taskIds.optional(),
})
const projectBriefingInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: sessionCheckinInputSchema.shape.projectId,
})
const sessionNoteToolInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  session_id: sessionNoteInputSchema.shape.sessionId,
  note: sessionNoteInputSchema.shape.note,
  task_id: sessionNoteInputSchema.shape.taskId,
})
const sessionCheckoutToolInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  session_id: sessionCheckoutInputSchema.shape.sessionId,
  summary: sessionCheckoutInputSchema.shape.summary,
  done: sessionCheckoutInputSchema.shape.done,
  blockers: sessionCheckoutInputSchema.shape.blockers,
  next_steps: sessionCheckoutInputSchema.shape.nextSteps,
  gotchas: sessionCheckoutInputSchema.shape.gotchas.optional(),
  refs: sessionCheckoutInputSchema.shape.refs.optional(),
})
const deliverableRecordToolInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: deliverableRecordInputSchema.shape.projectId,
  title: deliverableRecordInputSchema.shape.title,
  kind: deliverableRecordInputSchema.shape.kind,
  ref: deliverableRecordInputSchema.shape.ref,
  requirement_id: deliverableRecordInputSchema.shape.requirementId,
  task_id: deliverableRecordInputSchema.shape.taskId,
  session_id: deliverableRecordInputSchema.shape.sessionId,
  note: deliverableRecordInputSchema.shape.note,
}).superRefine((value, context) => {
  if (
    value.requirement_id === undefined
    && value.task_id === undefined
  ) {
    context.addIssue({
      code: 'custom',
      message: 'requirement_id or task_id is required',
      path: ['requirement_id'],
    })
  }
})

function authorize(
  services: CollaborationToolServices,
  agentId: string,
  operation: Extract<
    WorkOperation,
    'session.manage' | 'briefing.read' | 'deliverable.record'
  >,
): void {
  const actor = requireAgent(services.actors, agentId)
  assertPermission(actor.role, operation)
}

export function registerCollaborationTools(
  server: McpServer,
  services: CollaborationToolServices,
): void {
  server.registerTool('session_checkin', {
    description:
      'Check an Agent into a Project OS work session and return the session '
      + 'with its project briefing. Requires session.manage permission and '
      + 'records the check-in, briefing cursor, and caller touch atomically.',
    inputSchema: sessionCheckinToolInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    project_id: projectId,
    intent,
    task_ids: taskIds,
  }) => handleToolCall(() => {
    authorize(services, agentId, 'session.manage')
    const result = runAtomicWrite(services.actors, agentId, () => {
      const session = services.sessions.checkin({
        agentId,
        projectId,
        intent,
        taskIds: taskIds ?? [],
      })
      const briefing = services.briefing.getBriefing({
        agentId,
        projectId,
      })
      return { session, briefing }
    })
    return successResult(
      `Checked into session ${result.session.id} for ${result.session.intent}.`,
      result,
    )
  }))

  server.registerTool('project_briefing', {
    description:
      'Read the Agent project briefing and advance its activity cursor. '
      + 'Requires briefing.read permission and updates caller activity.',
    inputSchema: projectBriefingInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    project_id: projectId,
  }) => handleToolCall(() => {
    authorize(services, agentId, 'briefing.read')
    const briefing = runAtomicWrite(services.actors, agentId, () =>
      services.briefing.getBriefing({
        agentId,
        projectId,
      }))
    return successResult(
      `Project briefing contains ${briefing.new_activities.length} new activity item(s).`,
      { briefing },
    )
  }))

  server.registerTool('session_note', {
    description:
      'Add a note to an owned, active Project OS session. Requires '
      + 'session.manage permission and records the note atomically.',
    inputSchema: sessionNoteToolInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    session_id: sessionId,
    note,
    task_id: taskId,
  }) => handleToolCall(() => {
    authorize(services, agentId, 'session.manage')
    const activity = runAtomicWrite(services.actors, agentId, () =>
      services.sessions.note({
        agentId,
        sessionId,
        note,
        ...(taskId === undefined ? {} : { taskId }),
      }))
    return successResult(
      `Added note to session ${sessionId}.`,
      { activity },
    )
  }))

  server.registerTool('session_checkout', {
    description:
      'Close an owned Project OS session and create its structured handoff. '
      + 'Requires session.manage permission and records both atomically.',
    inputSchema: sessionCheckoutToolInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    session_id: sessionId,
    summary,
    done,
    blockers,
    next_steps: nextSteps,
    gotchas,
    refs,
  }) => handleToolCall(() => {
    authorize(services, agentId, 'session.manage')
    const result = runAtomicWrite(services.actors, agentId, () =>
      services.sessions.checkout({
        agentId,
        sessionId,
        summary,
        done,
        blockers,
        nextSteps,
        gotchas: gotchas ?? [],
        refs: refs ?? [],
      }))
    return successResult(
      `Checked out of session ${sessionId} with handoff ${result.handoff.id}.`,
      result,
    )
  }))

  server.registerTool('deliverable_record', {
    description:
      'Record a Project OS deliverable linked to a requirement or task. '
      + 'Requires deliverable.record permission and writes atomically.',
    inputSchema: deliverableRecordToolInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    project_id: projectId,
    title,
    kind,
    ref,
    requirement_id: requirementId,
    task_id: taskId,
    session_id: sessionId,
    note,
  }) => handleToolCall(() => {
    authorize(services, agentId, 'deliverable.record')
    const deliverable = runAtomicWrite(services.actors, agentId, () =>
      services.deliverables.record({
        agentId,
        projectId,
        title,
        kind,
        ref,
        ...(requirementId === undefined ? {} : { requirementId }),
        ...(taskId === undefined ? {} : { taskId }),
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(note === undefined ? {} : { note }),
      }))
    return successResult(
      `Recorded deliverable ${deliverable.id}: ${deliverable.title}.`,
      { deliverable },
    )
  }))
}
