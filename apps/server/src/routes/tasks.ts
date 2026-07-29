import {
  persistedProjectSchema,
  persistedTaskProgressInputSchema,
  persistedTaskSchema,
  prioritySchema,
  taskStatusSchema,
} from '@project-os/contracts'
import type { Router } from 'express'
import { DomainError } from '@project-os/core'
import type {
  CreateTaskInput,
  TaskListFilter,
  UpdateTaskInput,
} from '@project-os/core'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
  cursorError,
  paginate,
  parseResponse,
  readCursorPosition,
  requestActorId,
  routeIdSchema,
  routeVersionSchema,
  sendSuccess,
} from './actors.js'

const limitQuerySchema = z.string()
  .regex(/^[1-9]\d{0,2}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(200))
  .default(50)

const taskIdParamsSchema = z.object({
  id: routeIdSchema,
}).strict()

const projectTaskParamsSchema = z.object({
  projectId: routeIdSchema,
}).strict()

const taskListQuerySchema = z.object({
  project_id: routeIdSchema.optional(),
  assignee_id: routeIdSchema.optional(),
  status: taskStatusSchema.optional(),
  limit: limitQuerySchema,
  cursor: z.string().min(1).max(4096).optional(),
}).strict()

const projectTaskListQuerySchema = z.object({
  assignee_id: routeIdSchema.optional(),
  status: taskStatusSchema.optional(),
  limit: limitQuerySchema,
  cursor: z.string().min(1).max(4096).optional(),
}).strict()

const createTaskBodySchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(50_000).optional(),
  assigneeId: routeIdSchema,
  startDate: z.iso.date(),
  dueDate: z.iso.date(),
  priority: prioritySchema,
  milestoneId: z.string().max(256).optional(),
  parentId: routeIdSchema.optional(),
  dependencyIds: z.array(routeIdSchema).max(1_000).optional(),
}).strict()

const updateTaskBodySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(50_000).optional(),
  assigneeId: routeIdSchema.optional(),
  startDate: z.iso.date().optional(),
  dueDate: z.iso.date().optional(),
  priority: prioritySchema.optional(),
  status: taskStatusSchema.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  milestoneId: z.string().max(256).optional(),
  parentId: routeIdSchema.optional(),
  dependencyIds: z.array(routeIdSchema).max(1_000).optional(),
  version: routeVersionSchema,
}).strict()

const progressBodySchema = persistedTaskProgressInputSchema.extend({
  note: z.string().max(50_000),
}).strict()

function taskPosition(task: z.infer<typeof persistedTaskSchema>): string[] {
  return [task.projectId, task.code, task.id]
}

function listTasks(
  routerScope: string,
  context: ReturnType<Parameters<AppRouteModule['register']>[1]>,
  filter: {
    projectId: string | undefined
    assigneeId: string | undefined
    status: z.infer<typeof taskStatusSchema> | undefined
  },
  options: {
    limit: number
    cursor: string | undefined
  },
) {
  const cursorFilters = {
    project_id: filter.projectId,
    assignee_id: filter.assigneeId,
    status: filter.status,
  }
  const position = readCursorPosition({
    scope: routerScope,
    filters: cursorFilters,
    cursor: options.cursor,
  })
  let after: TaskListFilter['after']
  if (position !== undefined) {
    if (position.length !== 3) {
      throw cursorError(options.cursor!)
    }
    let anchor
    try {
      anchor = parseResponse(
        persistedTaskSchema,
        context.services.tasks.get(position[2]!),
      )
    } catch (error) {
      if (error instanceof DomainError && error.code === 'TASK_NOT_FOUND') {
        throw cursorError(options.cursor!)
      }
      throw error
    }
    if (
      anchor.projectId !== position[0]
      || anchor.code !== position[1]
      || anchor.id !== position[2]
      || (
        filter.projectId !== undefined
        && anchor.projectId !== filter.projectId
      )
      || (
        filter.assigneeId !== undefined
        && anchor.assigneeId !== filter.assigneeId
      )
      || (
        filter.status !== undefined
        && anchor.status !== filter.status
      )
    ) {
      throw cursorError(options.cursor!)
    }
    after = {
      projectId: anchor.projectId,
      code: anchor.code,
      id: anchor.id,
    }
  }
  const fetchLimit = options.limit + 1
  const rawTasks = context.services.tasks.list({
    ...filter,
    ...(after === undefined ? {} : { after }),
    limit: fetchLimit,
  } as TaskListFilter)
  const tasks = rawTasks.slice(0, fetchLimit).map(
    (task) => parseResponse(persistedTaskSchema, task),
  )
  return paginate(tasks, {
    scope: routerScope,
    filters: cursorFilters,
    limit: options.limit,
    position: taskPosition,
  })
}

export const taskRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.post('/projects/:projectId/tasks', (request, response) => {
      const { projectId } = projectTaskParamsSchema.parse(request.params)
      const input = createTaskBodySchema.parse(request.body)
      const context = getContext()
      const task = context.services.tasks.create(
        { ...input, projectId } as CreateTaskInput,
        requestActorId(context),
        'web',
      )
      sendSuccess(response, parseResponse(persistedTaskSchema, task), 201)
    })

    router.get('/projects/:projectId/tasks', (request, response) => {
      const { projectId } = projectTaskParamsSchema.parse(request.params)
      const query = projectTaskListQuerySchema.parse(request.query)
      const context = getContext()
      parseResponse(
        persistedProjectSchema,
        context.services.projects.get(projectId),
      )
      const page = listTasks(
        'project-tasks',
        context,
        {
          projectId,
          assigneeId: query.assignee_id,
          status: query.status,
        },
        { limit: query.limit, cursor: query.cursor },
      )
      sendSuccess(response, page)
    })

    router.get('/tasks', (request, response) => {
      const query = taskListQuerySchema.parse(request.query)
      const context = getContext()
      const page = listTasks(
        'tasks',
        context,
        {
          projectId: query.project_id,
          assigneeId: query.assignee_id,
          status: query.status,
        },
        { limit: query.limit, cursor: query.cursor },
      )
      sendSuccess(response, page)
    })

    router.get('/tasks/:id', (request, response) => {
      const { id } = taskIdParamsSchema.parse(request.params)
      const task = getContext().services.tasks.get(id)
      sendSuccess(response, parseResponse(persistedTaskSchema, task))
    })

    router.patch('/tasks/:id', (request, response) => {
      const { id } = taskIdParamsSchema.parse(request.params)
      const input = updateTaskBodySchema.parse(request.body)
      const context = getContext()
      const task = context.services.tasks.update(
        id,
        input as UpdateTaskInput,
        requestActorId(context),
        'web',
      )
      sendSuccess(response, parseResponse(persistedTaskSchema, task))
    })

    router.post('/tasks/:id/progress', (request, response) => {
      const { id } = taskIdParamsSchema.parse(request.params)
      const input = progressBodySchema.parse(request.body)
      const context = getContext()
      const task = context.services.tasks.submitProgress(
        id,
        input,
        requestActorId(context),
        'web',
      )
      sendSuccess(response, parseResponse(persistedTaskSchema, task))
    })
  },
}
