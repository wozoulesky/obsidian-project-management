import {
  persistedTaskProgressInputSchema,
  persistedTaskSchema,
  prioritySchema,
  taskStatusSchema,
} from '@project-os/contracts'
import type { Router } from 'express'
import type {
  CreateTaskInput,
  TaskListFilter,
  UpdateTaskInput,
} from '@project-os/core'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
  paginate,
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
  const tasks = context.services.tasks.list(filter as TaskListFilter)
    .map((task) => persistedTaskSchema.parse(task))
  return paginate(tasks, {
    scope: routerScope,
    filters: {
      project_id: filter.projectId,
      assignee_id: filter.assigneeId,
      status: filter.status,
    },
    limit: options.limit,
    cursor: options.cursor,
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
      sendSuccess(response, persistedTaskSchema.parse(task), 201)
    })

    router.get('/projects/:projectId/tasks', (request, response) => {
      const { projectId } = projectTaskParamsSchema.parse(request.params)
      const query = projectTaskListQuerySchema.parse(request.query)
      const context = getContext()
      context.services.projects.get(projectId)
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
      sendSuccess(response, persistedTaskSchema.parse(task))
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
      sendSuccess(response, persistedTaskSchema.parse(task))
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
      sendSuccess(response, persistedTaskSchema.parse(task))
    })
  },
}
