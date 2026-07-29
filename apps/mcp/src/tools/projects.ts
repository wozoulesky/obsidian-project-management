import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  createProjectInputSchema,
  persistedProjectSchema,
  projectMemberSchema,
  projectStatusSchema,
} from '@project-os/contracts'
import {
  assertPermission,
} from '@project-os/core'
import type {
  ActorService,
  ProjectService,
  UpdateProjectInput,
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

const agentIdSchema = projectMemberSchema.shape.actorId.describe(
  'Active Agent ID returned by agent_register',
)
const projectIdSchema = projectMemberSchema.shape.projectId.describe(
  'Project ID',
)
const projectCreateInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  name: createProjectInputSchema.shape.name,
  description: createProjectInputSchema.shape.description.optional(),
  owner_id: createProjectInputSchema.shape.ownerId.describe(
    'Active project owner Actor ID',
  ),
  start_date: createProjectInputSchema.shape.startDate.optional(),
  due_date: createProjectInputSchema.shape.dueDate.optional(),
})
const projectGetInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: projectIdSchema,
})
const projectListInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  owner_id: createProjectInputSchema.shape.ownerId.optional(),
  status: projectStatusSchema.optional(),
  after_code: persistedProjectSchema.shape.code.optional(),
  after_id: persistedProjectSchema.shape.id.optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).superRefine((value, context) => {
  const hasAfterCode = value.after_code !== undefined
  const hasAfterId = value.after_id !== undefined
  if (hasAfterCode !== hasAfterId) {
    context.addIssue({
      code: 'custom',
      message: 'after_code and after_id must be provided together',
      path: hasAfterCode ? ['after_id'] : ['after_code'],
    })
  }
})
const projectUpdateInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: projectIdSchema,
  name: persistedProjectSchema.shape.name.optional(),
  description: persistedProjectSchema.shape.description.optional(),
  owner_id: persistedProjectSchema.shape.ownerId.optional(),
  start_date: persistedProjectSchema.shape.startDate.optional(),
  due_date: persistedProjectSchema.shape.dueDate.optional(),
  status: persistedProjectSchema.shape.status.optional(),
  progress: persistedProjectSchema.shape.progress.optional(),
  version: persistedProjectSchema.shape.version.describe(
    'Current project version for optimistic concurrency',
  ),
})

type ToolServices = {
  actors: ActorService
  projects: ProjectService
}

function authorize(
  services: ToolServices,
  agentId: string,
  operation: 'project.read' | 'project.write',
): void {
  const actor = requireAgent(services.actors, agentId)
  assertPermission(actor.role, operation)
}

export function registerProjectTools(
  server: McpServer,
  services: ToolServices,
): void {
  server.registerTool('project_create', {
    description:
      'Create a Project OS project and owner membership. Requires agent_id '
      + 'with project.write permission and records MCP activity.',
    inputSchema: projectCreateInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    name,
    description,
    owner_id: ownerId,
    start_date: startDate,
    due_date: dueDate,
  }) => handleToolCall(() => {
    authorize(services, agentId, 'project.write')
    const project = runAtomicWrite(services.actors, agentId, () =>
      services.projects.create({
        name,
        ownerId,
        ...(description === undefined ? {} : { description }),
        ...(startDate === undefined ? {} : { startDate }),
        ...(dueDate === undefined ? {} : { dueDate }),
      }, agentId, 'mcp'))
    return successResult(
      `Created project ${project.code}: ${project.name}.`,
      { project },
    )
  }))

  server.registerTool('project_get', {
    description:
      'Get one Project OS project. Requires an active agent_id with '
      + 'project.read permission and updates caller activity.',
    inputSchema: projectGetInputSchema,
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
    authorize(services, agentId, 'project.read')
    const project = services.projects.get(projectId)
    bestEffortTouch(services.actors, agentId)
    return successResult(
      `Project ${project.code}: ${project.name}.`,
      { project },
    )
  }))

  server.registerTool('project_list', {
    description:
      'List Project OS projects. Requires an active agent_id with '
      + 'project.read permission and updates caller activity.',
    inputSchema: projectListInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    owner_id: ownerId,
    status,
    after_code: afterCode,
    after_id: afterId,
    limit,
  }) => handleToolCall(() => {
    authorize(services, agentId, 'project.read')
    const projects = services.projects.list({
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(status === undefined ? {} : { status }),
      ...(afterCode === undefined || afterId === undefined
        ? {}
        : { after: { code: afterCode, id: afterId } }),
      ...(limit === undefined ? {} : { limit }),
    })
    bestEffortTouch(services.actors, agentId)
    return successResult(
      `Found ${projects.length} Project OS project(s).`,
      { projects },
    )
  }))

  server.registerTool('project_update', {
    description:
      'Update a Project OS project using optimistic version concurrency. '
      + 'Requires agent_id with project.write permission and records MCP '
      + 'activity.',
    inputSchema: projectUpdateInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    project_id: projectId,
    name,
    description,
    owner_id: ownerId,
    start_date: startDate,
    due_date: dueDate,
    status,
    progress,
    version,
  }) => handleToolCall(() => {
    authorize(services, agentId, 'project.write')
    const input: UpdateProjectInput = {
      version,
      ...(name === undefined ? {} : { name }),
      ...(description === undefined ? {} : { description }),
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(startDate === undefined ? {} : { startDate }),
      ...(dueDate === undefined ? {} : { dueDate }),
      ...(status === undefined ? {} : { status }),
      ...(progress === undefined ? {} : { progress }),
    }
    const project = runAtomicWrite(services.actors, agentId, () =>
      services.projects.update(
        projectId,
        input,
        agentId,
        'mcp',
      ))
    return successResult(
      `Updated project ${project.code}: ${project.name}.`,
      { project },
    )
  }))
}
