import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
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
import { requireAgent } from './identity.js'

const agentIdSchema = z.string().min(1).describe(
  'Active Agent ID returned by agent_register',
)
const projectIdSchema = z.string().min(1).describe('Project ID')
const nullableDateSchema = z.iso.date().nullable()

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
    inputSchema: {
      agent_id: agentIdSchema,
      name: z.string().min(1),
      description: z.string().optional(),
      owner_id: z.string().min(1).describe('Active project owner Actor ID'),
      start_date: nullableDateSchema.optional(),
      due_date: nullableDateSchema.optional(),
    },
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
    const project = services.projects.create({
      name,
      ownerId,
      ...(description === undefined ? {} : { description }),
      ...(startDate === undefined ? {} : { startDate }),
      ...(dueDate === undefined ? {} : { dueDate }),
    }, agentId, 'mcp')
    services.actors.touch(agentId)
    return successResult(
      `Created project ${project.code}: ${project.name}.`,
      { project },
    )
  }))

  server.registerTool('project_get', {
    description:
      'Get one Project OS project. Requires an active agent_id with '
      + 'project.read permission and updates caller activity.',
    inputSchema: {
      agent_id: agentIdSchema,
      project_id: projectIdSchema,
    },
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
    services.actors.touch(agentId)
    return successResult(
      `Project ${project.code}: ${project.name}.`,
      { project },
    )
  }))

  server.registerTool('project_list', {
    description:
      'List Project OS projects. Requires an active agent_id with '
      + 'project.read permission and updates caller activity.',
    inputSchema: {
      agent_id: agentIdSchema,
      owner_id: z.string().min(1).optional(),
      status: projectStatusSchema.optional(),
      after_code: z.string().min(1).optional(),
      after_id: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
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
    services.actors.touch(agentId)
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
    inputSchema: {
      agent_id: agentIdSchema,
      project_id: projectIdSchema,
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      owner_id: z.string().min(1).optional(),
      start_date: nullableDateSchema.optional(),
      due_date: nullableDateSchema.optional(),
      status: projectStatusSchema.optional(),
      progress: z.number().int().min(0).max(100).optional(),
      version: z.number().int().positive().describe(
        'Current project version for optimistic concurrency',
      ),
    },
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
    const project = services.projects.update(
      projectId,
      input,
      agentId,
      'mcp',
    )
    services.actors.touch(agentId)
    return successResult(
      `Updated project ${project.code}: ${project.name}.`,
      { project },
    )
  }))
}
