import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  activitySourceSchema,
  persistedActivitySchema,
  persistedProjectSchema,
  persistedTaskSchema,
  projectMemberSchema,
} from '@project-os/contracts'
import {
  assertPermission,
} from '@project-os/core'
import type {
  ActivityService,
  ActorService,
  DashboardService,
} from '@project-os/core'
import { z } from 'zod'
import {
  handleToolCall,
  successResult,
} from '../tool-result.js'
import { touchAfterRead } from '../tool-execution.js'
import { requireAgent } from './identity.js'

type ReportToolServices = {
  activities: ActivityService
  actors: ActorService
  dashboard: DashboardService
}

const agentIdSchema = projectMemberSchema.shape.actorId.describe(
  'Active Agent ID returned by agent_register',
)
const dashboardSnapshotInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: persistedProjectSchema.shape.id.optional(),
  today: persistedTaskSchema.shape.startDate.optional(),
  activity_limit: z.number().int().min(1).max(200).optional(),
})
const listOverdueInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: persistedProjectSchema.shape.id.optional(),
  today: persistedTaskSchema.shape.startDate.optional(),
})
const activityLogInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  entity_id: persistedActivitySchema.shape.entityId.optional(),
  actor_id: persistedActivitySchema.shape.actorId.optional(),
  project_id: persistedProjectSchema.shape.id.optional(),
  source: activitySourceSchema.optional(),
  after: persistedActivitySchema.shape.id.optional(),
  since: persistedActivitySchema.shape.id.optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).superRefine((value, context) => {
  if (value.after !== undefined && value.since !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'after and since cannot be provided together',
      path: ['since'],
    })
  }
})

function authorize(
  services: ReportToolServices,
  agentId: string,
  operation: 'report.read' | 'activity.read',
): void {
  const actor = requireAgent(services.actors, agentId)
  assertPermission(actor.role, operation)
}

export function registerReportTools(
  server: McpServer,
  services: ReportToolServices,
): void {
  server.registerTool('dashboard_snapshot', {
    description:
      'Read the Project OS dashboard snapshot. Requires agent_id with '
      + 'report.read permission and updates caller activity.',
    inputSchema: dashboardSnapshotInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    project_id: projectId,
    today,
    activity_limit: activityLimit,
  }) => handleToolCall(() => {
    authorize(services, agentId, 'report.read')
    const snapshot = services.dashboard.snapshot({
      ...(projectId === undefined ? {} : { projectId }),
      ...(today === undefined ? {} : { today }),
      ...(activityLimit === undefined ? {} : { activityLimit }),
    })
    touchAfterRead(services.actors, agentId)
    return successResult(
      `Dashboard: ${snapshot.metrics.totalTasks} task(s), `
      + `${snapshot.metrics.activeDefects} active defect(s).`,
      { snapshot },
    )
  }))

  server.registerTool('list_overdue', {
    description:
      'List overdue Project OS tasks. Requires agent_id with report.read '
      + 'permission and updates caller activity.',
    inputSchema: listOverdueInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    project_id: projectId,
    today,
  }) => handleToolCall(() => {
    authorize(services, agentId, 'report.read')
    const items = services.dashboard.listOverdue({
      ...(projectId === undefined ? {} : { projectId }),
      ...(today === undefined ? {} : { today }),
    })
    touchAfterRead(services.actors, agentId)
    return successResult(`Found ${items.length} overdue task(s).`, { items })
  }))

  server.registerTool('activity_log', {
    description:
      'Read Project OS activity with entity, actor, project, source and '
      + 'cursor filters. after pages older activity in reverse chronological '
      + 'order; since returns only newer activity in ascending order. Requires '
      + 'agent_id with activity.read permission and updates caller activity '
      + 'after taking the result snapshot.',
    inputSchema: activityLogInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    entity_id: entityId,
    actor_id: actorId,
    project_id: projectId,
    source,
    after,
    since,
    limit,
  }) => handleToolCall(() => {
    authorize(services, agentId, 'activity.read')
    const filter = {
      ...(entityId === undefined ? {} : { entityId }),
      ...(actorId === undefined ? {} : { actorId }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(source === undefined ? {} : { source }),
      ...(limit === undefined ? {} : { limit }),
    }
    const items = since === undefined
      ? services.activities.list({
        ...filter,
        ...(after === undefined ? {} : { after }),
      })
      : services.activities.listNewer({
        ...filter,
        after: since,
      })
    touchAfterRead(services.actors, agentId)
    return successResult(`Found ${items.length} activity item(s).`, { items })
  }))
}
