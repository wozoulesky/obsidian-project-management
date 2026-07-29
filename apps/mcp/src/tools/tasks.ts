import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  persistedTaskProgressInputSchema,
  persistedTaskSchema,
  projectMemberSchema,
} from '@project-os/contracts'
import {
  assertPermission,
} from '@project-os/core'
import type {
  ActorService,
  TaskService,
  UpdateTaskInput,
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

type TaskToolServices = {
  actors: ActorService
  tasks: TaskService
}

const agentIdSchema = projectMemberSchema.shape.actorId.describe(
  'Active Agent ID returned by agent_register',
)
const taskIdSchema = persistedTaskSchema.shape.id.describe('Task ID')
const taskCreateInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: persistedTaskSchema.shape.projectId,
  title: persistedTaskSchema.shape.title,
  description: persistedTaskSchema.shape.description.optional(),
  assignee_id: persistedTaskSchema.shape.assigneeId,
  start_date: persistedTaskSchema.shape.startDate,
  due_date: persistedTaskSchema.shape.dueDate,
  priority: persistedTaskSchema.shape.priority,
  milestone_id: persistedTaskSchema.shape.milestoneId.optional(),
  parent_id: persistedTaskSchema.shape.parentId,
  dependency_ids: persistedTaskSchema.shape.dependencyIds.optional(),
})
const taskGetInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  task_id: taskIdSchema,
})
const taskListInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  project_id: persistedTaskSchema.shape.projectId.optional(),
  assignee_id: persistedTaskSchema.shape.assigneeId.optional(),
  status: persistedTaskSchema.shape.status.optional(),
  after_project_id: persistedTaskSchema.shape.projectId.optional(),
  after_code: persistedTaskSchema.shape.code.optional(),
  after_id: persistedTaskSchema.shape.id.optional(),
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
const taskUpdateInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  task_id: taskIdSchema,
  title: persistedTaskSchema.shape.title.optional(),
  description: persistedTaskSchema.shape.description.optional(),
  assignee_id: persistedTaskSchema.shape.assigneeId.optional(),
  start_date: persistedTaskSchema.shape.startDate.optional(),
  due_date: persistedTaskSchema.shape.dueDate.optional(),
  priority: persistedTaskSchema.shape.priority.optional(),
  status: persistedTaskSchema.shape.status.optional(),
  progress: persistedTaskSchema.shape.progress.optional(),
  milestone_id: persistedTaskSchema.shape.milestoneId.optional(),
  parent_id: persistedTaskSchema.shape.parentId,
  dependency_ids: persistedTaskSchema.shape.dependencyIds.optional(),
  version: persistedTaskSchema.shape.version,
})
const progressSubmitInputSchema = z.strictObject({
  agent_id: agentIdSchema,
  task_id: taskIdSchema,
  progress: persistedTaskProgressInputSchema.shape.progress,
  status: persistedTaskProgressInputSchema.shape.status,
  note: persistedTaskProgressInputSchema.shape.note,
  version: persistedTaskProgressInputSchema.shape.version,
})

function authorizeRead(
  services: TaskToolServices,
  agentId: string,
): void {
  const actor = requireAgent(services.actors, agentId)
  assertPermission(actor.role, 'task.read')
}

export function registerTaskTools(
  server: McpServer,
  services: TaskToolServices,
): void {
  server.registerTool('task_create', {
    description:
      'Create a task inside a Project OS project. Requires agent_id with '
      + 'task.write permission and records MCP activity atomically.',
    inputSchema: taskCreateInputSchema,
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
    assignee_id: assigneeId,
    start_date: startDate,
    due_date: dueDate,
    priority,
    milestone_id: milestoneId,
    parent_id: parentId,
    dependency_ids: dependencyIds,
  }) => handleToolCall(() => {
    requireAgent(services.actors, agentId)
    const task = runAtomicWrite(services.actors, agentId, () =>
      services.tasks.create({
        projectId,
        title,
        assigneeId,
        startDate,
        dueDate,
        priority,
        ...(description === undefined ? {} : { description }),
        ...(milestoneId === undefined ? {} : { milestoneId }),
        ...(parentId === undefined ? {} : { parentId }),
        ...(dependencyIds === undefined ? {} : { dependencyIds }),
      }, agentId, 'mcp'))
    return successResult(
      `Created task ${task.code}: ${task.title}.`,
      { task },
    )
  }))

  server.registerTool('task_get', {
    description:
      'Get one Project OS task. Requires agent_id with task.read permission '
      + 'and updates the caller last-active timestamp.',
    inputSchema: taskGetInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({ agent_id: agentId, task_id: taskId }) => handleToolCall(() => {
    authorizeRead(services, agentId)
    const task = services.tasks.get(taskId)
    bestEffortTouch(services.actors, agentId)
    return successResult(`Task ${task.code}: ${task.title}.`, { task })
  }))

  server.registerTool('task_list', {
    description:
      'List Project OS tasks with optional project, assignee, status and '
      + 'composite cursor filters. Requires agent_id with task.read '
      + 'permission and updates caller activity.',
    inputSchema: taskListInputSchema,
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
    const items = services.tasks.list({
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
    bestEffortTouch(services.actors, agentId)
    return successResult(`Found ${items.length} task(s).`, { items })
  }))

  server.registerTool('task_update', {
    description:
      'Update an existing task with optimistic version concurrency. Requires '
      + 'agent_id; shared task permissions apply and MCP activity is recorded.',
    inputSchema: taskUpdateInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    task_id: taskId,
    title,
    description,
    assignee_id: assigneeId,
    start_date: startDate,
    due_date: dueDate,
    priority,
    status,
    progress,
    milestone_id: milestoneId,
    parent_id: parentId,
    dependency_ids: dependencyIds,
    version,
  }) => handleToolCall(() => {
    requireAgent(services.actors, agentId)
    const input: UpdateTaskInput = {
      version,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      ...(assigneeId === undefined ? {} : { assigneeId }),
      ...(startDate === undefined ? {} : { startDate }),
      ...(dueDate === undefined ? {} : { dueDate }),
      ...(priority === undefined ? {} : { priority }),
      ...(status === undefined ? {} : { status }),
      ...(progress === undefined ? {} : { progress }),
      ...(milestoneId === undefined ? {} : { milestoneId }),
      ...(parentId === undefined ? {} : { parentId }),
      ...(dependencyIds === undefined ? {} : { dependencyIds }),
    }
    const task = runAtomicWrite(services.actors, agentId, () =>
      services.tasks.update(taskId, input, agentId, 'mcp'))
    return successResult(
      `Updated task ${task.code}: ${task.title}.`,
      { task },
    )
  }))

  server.registerTool('progress_submit', {
    description:
      'Submit progress for an existing assigned task using its current '
      + 'version. Requires agent_id with task.progress permission and records '
      + 'the note in MCP activity atomically.',
    inputSchema: progressSubmitInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, ({
    agent_id: agentId,
    task_id: taskId,
    progress,
    status,
    note,
    version,
  }) => handleToolCall(() => {
    requireAgent(services.actors, agentId)
    const task = runAtomicWrite(services.actors, agentId, () =>
      services.tasks.submitProgress(
        taskId,
        { progress, status, note, version },
        agentId,
        'mcp',
      ))
    return successResult(
      `Updated ${task.code} to ${task.progress}% (${task.status}).`,
      { task },
    )
  }))
}
