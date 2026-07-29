import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  persistedRequirementSchema,
  projectMemberSchema,
} from '@project-os/contracts'
import {
  assertPermission,
} from '@project-os/core'
import type {
  ActorService,
  RequirementService,
  UpdateRequirementInput,
} from '@project-os/core'
import { z } from 'zod'
import {
  handleToolCall,
  successResult,
} from '../tool-result.js'
import {
  bestEffortTouch,
  runAtomicWrite,
} from '../tool-execution.js'
import { requireAgent } from './identity.js'

type RequirementToolServices = {
  actors: ActorService
  requirements: RequirementService
}

const agentIdSchema = projectMemberSchema.shape.actorId.describe(
  'Active Agent ID returned by agent_register',
)
const requirementIdSchema = persistedRequirementSchema.shape.id.describe(
  'Requirement ID',
)
const requirementCreateInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: persistedRequirementSchema.shape.projectId,
  title: persistedRequirementSchema.shape.title,
  description: persistedRequirementSchema.shape.description,
  priority: persistedRequirementSchema.shape.priority,
  status: persistedRequirementSchema.shape.status.optional(),
  acceptance_criteria:
    persistedRequirementSchema.shape.acceptanceCriteria.optional(),
  linked_task_ids: persistedRequirementSchema.shape.linkedTaskIds.optional(),
})
const requirementListInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: persistedRequirementSchema.shape.projectId.optional(),
  status: persistedRequirementSchema.shape.status.optional(),
  after_project_id: persistedRequirementSchema.shape.projectId.optional(),
  after_code: persistedRequirementSchema.shape.code.optional(),
  after_id: persistedRequirementSchema.shape.id.optional(),
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
const requirementUpdateInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  requirement_id: requirementIdSchema,
  title: persistedRequirementSchema.shape.title.optional(),
  description: persistedRequirementSchema.shape.description,
  priority: persistedRequirementSchema.shape.priority.optional(),
  status: persistedRequirementSchema.shape.status.optional(),
  acceptance_criteria:
    persistedRequirementSchema.shape.acceptanceCriteria.optional(),
  linked_task_ids: persistedRequirementSchema.shape.linkedTaskIds.optional(),
  version: persistedRequirementSchema.shape.version,
})

function authorizeRead(
  services: RequirementToolServices,
  agentId: string,
): void {
  const actor = requireAgent(services.actors, agentId)
  assertPermission(actor.role, 'requirement.read')
}

export function registerRequirementTools(
  server: McpServer,
  services: RequirementToolServices,
): void {
  server.registerTool('requirement_create', {
    description:
      'Create a Project OS requirement. Requires agent_id with '
      + 'requirement.write permission and records MCP activity atomically.',
    inputSchema: requirementCreateInputSchema,
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
    priority,
    status,
    acceptance_criteria: acceptanceCriteria,
    linked_task_ids: linkedTaskIds,
  }) => handleToolCall(() => {
    requireAgent(services.actors, agentId)
    const requirement = runAtomicWrite(services.actors, agentId, () =>
      services.requirements.create({
        projectId,
        title,
        priority,
        ...(description === undefined ? {} : { description }),
        ...(status === undefined ? {} : { status }),
        ...(acceptanceCriteria === undefined
          ? {}
          : { acceptanceCriteria }),
        ...(linkedTaskIds === undefined ? {} : { linkedTaskIds }),
      }, agentId, 'mcp'))
    return successResult(
      `Created requirement ${requirement.code}: ${requirement.title}.`,
      { requirement },
    )
  }))

  server.registerTool('requirement_list', {
    description:
      'List Project OS requirements with project, status and composite '
      + 'cursor filters. Requires agent_id with requirement.read permission '
      + 'and updates caller activity.',
    inputSchema: requirementListInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    project_id: projectId,
    status,
    after_project_id: afterProjectId,
    after_code: afterCode,
    after_id: afterId,
    limit,
  }) => handleToolCall(() => {
    authorizeRead(services, agentId)
    const items = services.requirements.list({
      ...(projectId === undefined ? {} : { projectId }),
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
    bestEffortTouch(services.actors, agentId)
    return successResult(
      `Found ${items.length} requirement(s).`,
      { items },
    )
  }))

  server.registerTool('requirement_update', {
    description:
      'Update a Project OS requirement using its current version. Requires '
      + 'agent_id; shared requirement permissions apply and MCP activity is '
      + 'recorded atomically.',
    inputSchema: requirementUpdateInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    requirement_id: requirementId,
    title,
    description,
    priority,
    status,
    acceptance_criteria: acceptanceCriteria,
    linked_task_ids: linkedTaskIds,
    version,
  }) => handleToolCall(() => {
    requireAgent(services.actors, agentId)
    const input: UpdateRequirementInput = {
      version,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      ...(priority === undefined ? {} : { priority }),
      ...(status === undefined ? {} : { status }),
      ...(acceptanceCriteria === undefined
        ? {}
        : { acceptanceCriteria }),
      ...(linkedTaskIds === undefined ? {} : { linkedTaskIds }),
    }
    const requirement = runAtomicWrite(services.actors, agentId, () =>
      services.requirements.update(
        requirementId,
        input,
        agentId,
        'mcp',
      ))
    return successResult(
      `Updated requirement ${requirement.code}: ${requirement.title}.`,
      { requirement },
    )
  }))
}
