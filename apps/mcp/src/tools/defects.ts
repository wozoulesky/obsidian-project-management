import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  persistedDefectSchema,
  persistedTaskSchema,
  projectMemberSchema,
} from '@project-os/contracts'
import {
  assertPermission,
} from '@project-os/core'
import type {
  ActorService,
  DefectService,
  UpdateDefectInput,
} from '@project-os/core'
import { z } from 'zod'
import {
  handleToolCall,
  successResult,
} from '../tool-result.js'
import {
  runAtomicWrite,
  touchAfterRead,
} from '../tool-execution.js'
import { requireAgent } from './identity.js'

type DefectToolServices = {
  actors: ActorService
  defects: DefectService
}

const agentIdSchema = projectMemberSchema.shape.actorId.describe(
  'Active Agent ID returned by agent_register',
)
const defectIdSchema = persistedDefectSchema.shape.id.describe('Defect ID')
const defectCreateInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: persistedDefectSchema.shape.projectId,
  title: persistedDefectSchema.shape.title,
  description: persistedDefectSchema.shape.description,
  severity: persistedDefectSchema.shape.severity,
  status: persistedDefectSchema.shape.status.optional(),
  assignee_id: persistedDefectSchema.shape.assigneeId,
  reproduction_steps:
    persistedDefectSchema.shape.reproductionSteps.optional(),
  linked_requirement_id:
    persistedDefectSchema.shape.linkedRequirementId,
  linked_task_id: persistedDefectSchema.shape.linkedTaskId,
})
const defectListInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: persistedDefectSchema.shape.projectId.optional(),
  assignee_id: persistedDefectSchema.shape.assigneeId.optional(),
  status: persistedDefectSchema.shape.status.optional(),
  after_project_id: persistedDefectSchema.shape.projectId.optional(),
  after_code: persistedDefectSchema.shape.code.optional(),
  after_id: persistedDefectSchema.shape.id.optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).superRefine((value, context) => {
  const cursorParts = [
    value.after_project_id,
    value.after_code,
    value.after_id,
  ]
  const present = cursorParts.filter((part) => part !== undefined).length
  if (present !== 0 && present !== cursorParts.length) {
    context.addIssue({
      code: 'custom',
      message:
        'after_project_id, after_code and after_id must be provided together',
      path: ['after_project_id'],
    })
  }
})
const defectUpdateInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  defect_id: defectIdSchema,
  title: persistedDefectSchema.shape.title.optional(),
  description: persistedDefectSchema.shape.description,
  severity: persistedDefectSchema.shape.severity.optional(),
  status: persistedDefectSchema.shape.status.optional(),
  assignee_id: persistedDefectSchema.shape.assigneeId.optional(),
  reproduction_steps:
    persistedDefectSchema.shape.reproductionSteps.optional(),
  linked_requirement_id:
    persistedDefectSchema.shape.linkedRequirementId,
  linked_task_id: persistedDefectSchema.shape.linkedTaskId,
  version: persistedDefectSchema.shape.version,
})
const defectToTaskInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  defect_id: defectIdSchema,
  start_date: persistedTaskSchema.shape.startDate,
  due_date: persistedTaskSchema.shape.dueDate,
  priority: persistedTaskSchema.shape.priority.optional(),
  version: persistedDefectSchema.shape.version,
})

function authorizeRead(
  services: DefectToolServices,
  agentId: string,
): void {
  const actor = requireAgent(services.actors, agentId)
  assertPermission(actor.role, 'defect.read')
}

export function registerDefectTools(
  server: McpServer,
  services: DefectToolServices,
): void {
  server.registerTool('defect_create', {
    description:
      'Create a Project OS defect. Requires agent_id with defect.write '
      + 'permission and records MCP activity atomically.',
    inputSchema: defectCreateInputSchema,
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
    description,
    severity,
    status,
    assignee_id: assigneeId,
    reproduction_steps: reproductionSteps,
    linked_requirement_id: linkedRequirementId,
    linked_task_id: linkedTaskId,
  }) => handleToolCall(() => {
    requireAgent(services.actors, agentId)
    const defect = runAtomicWrite(services.actors, agentId, () =>
      services.defects.create({
        projectId,
        title,
        severity,
        assigneeId,
        ...(description === undefined ? {} : { description }),
        ...(status === undefined ? {} : { status }),
        ...(reproductionSteps === undefined ? {} : { reproductionSteps }),
        ...(linkedRequirementId === undefined
          ? {}
          : { linkedRequirementId }),
        ...(linkedTaskId === undefined ? {} : { linkedTaskId }),
      }, agentId, 'mcp'))
    return successResult(
      `Created defect ${defect.code}: ${defect.title}.`,
      { defect },
    )
  }))

  server.registerTool('defect_list', {
    description:
      'List Project OS defects with project, assignee, status and composite '
      + 'cursor filters. Requires agent_id with defect.read permission and '
      + 'updates caller activity.',
    inputSchema: defectListInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    project_id: projectId,
    assignee_id: assigneeId,
    status,
    after_project_id: afterProjectId,
    after_code: afterCode,
    after_id: afterId,
    limit,
  }) => handleToolCall(() => {
    authorizeRead(services, agentId)
    const items = services.defects.list({
      ...(projectId === undefined ? {} : { projectId }),
      ...(assigneeId === undefined ? {} : { assigneeId }),
      ...(status === undefined ? {} : { status }),
      ...(afterProjectId === undefined
        || afterCode === undefined
        || afterId === undefined
        ? {}
        : {
            after: {
              projectId: afterProjectId,
              code: afterCode,
              id: afterId,
            },
          }),
      ...(limit === undefined ? {} : { limit }),
    })
    touchAfterRead(services.actors, agentId)
    return successResult(`Found ${items.length} defect(s).`, { items })
  }))

  server.registerTool('defect_update', {
    description:
      'Update an existing Project OS defect using its current version. '
      + 'Requires agent_id; shared defect permissions apply and MCP activity '
      + 'is recorded atomically.',
    inputSchema: defectUpdateInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    defect_id: defectId,
    title,
    description,
    severity,
    status,
    assignee_id: assigneeId,
    reproduction_steps: reproductionSteps,
    linked_requirement_id: linkedRequirementId,
    linked_task_id: linkedTaskId,
    version,
  }) => handleToolCall(() => {
    requireAgent(services.actors, agentId)
    const input: UpdateDefectInput = {
      version,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      ...(severity === undefined ? {} : { severity }),
      ...(status === undefined ? {} : { status }),
      ...(assigneeId === undefined ? {} : { assigneeId }),
      ...(reproductionSteps === undefined ? {} : { reproductionSteps }),
      ...(linkedRequirementId === undefined
        ? {}
        : { linkedRequirementId }),
      ...(linkedTaskId === undefined ? {} : { linkedTaskId }),
    }
    const defect = runAtomicWrite(services.actors, agentId, () =>
      services.defects.update(
        defectId,
        input,
        agentId,
        'mcp',
      ))
    return successResult(
      `Updated defect ${defect.code}: ${defect.title}.`,
      { defect },
    )
  }))

  server.registerTool('defect_to_task', {
    description:
      'Convert a defect into a linked task using optimistic version '
      + 'concurrency. Requires agent_id with task.write permission and records '
      + 'the defect/task mutation plus MCP activity atomically.',
    inputSchema: defectToTaskInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    defect_id: defectId,
    start_date: startDate,
    due_date: dueDate,
    priority,
    version,
  }) => handleToolCall(() => {
    requireAgent(services.actors, agentId)
    const task = runAtomicWrite(services.actors, agentId, () =>
      services.defects.toTask(
        defectId,
        {
          startDate,
          dueDate,
          version,
          ...(priority === undefined ? {} : { priority }),
        },
        agentId,
        'mcp',
      ))
    return successResult(
      `Converted defect to task ${task.code}: ${task.title}.`,
      { task },
    )
  }))
}
