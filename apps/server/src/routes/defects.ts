import {
  defectStatusSchema,
  persistedDefectSchema,
  persistedProjectSchema,
  persistedTaskSchema,
  prioritySchema,
  severitySchema,
} from '@project-os/contracts'
import { DomainError } from '@project-os/core'
import type {
  CreateDefectInput,
  DefectListFilter,
  DefectToTaskInput,
  UpdateDefectInput,
} from '@project-os/core'
import type { Router } from 'express'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
  callService,
  cursorError,
  internalOperation,
  paginate,
  parseResponse,
  readCursorPosition,
  requestActorId,
  routeIdSchema,
  routeVersionSchema,
  sendSuccess,
} from './actors.js'

const limitSchema = z.string().regex(/^[1-9]\d{0,2}$/).transform(Number)
  .pipe(z.number().int().min(1).max(200)).default(50)
const paramsSchema = z.object({ id: routeIdSchema }).strict()
const projectParamsSchema = z.object({ projectId: routeIdSchema }).strict()
const listSchema = z.object({
  project_id: routeIdSchema.optional(),
  assignee_id: routeIdSchema.optional(),
  status: defectStatusSchema.optional(),
  limit: limitSchema,
  cursor: z.string().min(1).max(4096).optional(),
}).strict()
const scopedListSchema = listSchema.omit({ project_id: true })
const stepsSchema = z.array(z.string().max(50_000)).max(1_000)
const createFields = {
  title: z.string().min(1).max(500),
  description: z.string().max(50_000).optional(),
  severity: severitySchema,
  status: defectStatusSchema.optional(),
  assigneeId: routeIdSchema,
  reproductionSteps: stepsSchema.optional(),
  linkedRequirementId: routeIdSchema.optional(),
  linkedTaskId: routeIdSchema.optional(),
}
const createSchema = z.object({
  projectId: routeIdSchema,
  ...createFields,
}).strict()
const scopedCreateSchema = z.object(createFields).strict()
const updateSchema = z.object({
  title: createFields.title.optional(),
  description: createFields.description,
  severity: severitySchema.optional(),
  status: defectStatusSchema.optional(),
  assigneeId: routeIdSchema.optional(),
  reproductionSteps: stepsSchema.optional(),
  linkedRequirementId: routeIdSchema.optional(),
  linkedTaskId: routeIdSchema.optional(),
  version: routeVersionSchema,
}).strict()
const toTaskSchema = z.object({
  startDate: z.iso.date(),
  dueDate: z.iso.date(),
  priority: prioritySchema.optional(),
  version: routeVersionSchema,
}).strict()

function listDefects(
  scope: string,
  context: ReturnType<Parameters<AppRouteModule['register']>[1]>,
  filter: {
    projectId: DefectListFilter['projectId'] | undefined
    assigneeId: DefectListFilter['assigneeId'] | undefined
    status: DefectListFilter['status'] | undefined
  },
  limit: number,
  cursor: string | undefined,
) {
  const filters = {
    project_id: filter.projectId,
    assignee_id: filter.assigneeId,
    status: filter.status,
  }
  const position = readCursorPosition({ scope, filters, cursor })
  let after: DefectListFilter['after']
  if (position !== undefined) {
    if (position.length !== 3) throw cursorError(cursor!)
    let anchor
    try {
      anchor = callService(
        persistedDefectSchema,
        () => context.services.defects.get(position[2]!),
      )
    } catch (error) {
      if (
        error instanceof DomainError
        && error.code === 'DEFECT_NOT_FOUND'
      ) throw cursorError(cursor!)
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
      || (filter.status !== undefined && anchor.status !== filter.status)
    ) throw cursorError(cursor!)
    after = {
      projectId: anchor.projectId,
      code: anchor.code,
      id: anchor.id,
    }
  }
  const fetchLimit = limit + 1
  const raw = internalOperation(() => context.services.defects.list({
    ...(filter.projectId === undefined
      ? {}
      : { projectId: filter.projectId }),
    ...(filter.assigneeId === undefined
      ? {}
      : { assigneeId: filter.assigneeId }),
    ...(filter.status === undefined ? {} : { status: filter.status }),
    ...(after === undefined ? {} : { after }),
    limit: fetchLimit,
  }))
  const items = raw.slice(0, fetchLimit).map(
    (item) => parseResponse(persistedDefectSchema, item),
  )
  return paginate(items, {
    scope,
    filters,
    limit,
    position: (item) => [item.projectId, item.code, item.id],
  })
}

export const defectRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.post('/projects/:projectId/defects', (request, response) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const input = scopedCreateSchema.parse(request.body)
      const context = getContext()
      sendSuccess(response, callService(
        persistedDefectSchema,
        () => context.services.defects.create(
          { ...input, projectId } as CreateDefectInput,
          requestActorId(context),
          'web',
        ),
      ), 201)
    })
    router.get('/projects/:projectId/defects', (request, response) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const query = scopedListSchema.parse(request.query)
      const context = getContext()
      callService(
        persistedProjectSchema,
        () => context.services.projects.get(projectId),
      )
      sendSuccess(response, listDefects(
        'project-defects',
        context,
        {
          projectId,
          assigneeId: query.assignee_id,
          status: query.status,
        },
        query.limit,
        query.cursor,
      ))
    })
    router.post('/defects', (request, response) => {
      const input = createSchema.parse(request.body)
      const context = getContext()
      sendSuccess(response, callService(
        persistedDefectSchema,
        () => context.services.defects.create(
          input as CreateDefectInput,
          requestActorId(context),
          'web',
        ),
      ), 201)
    })
    router.get('/defects', (request, response) => {
      const query = listSchema.parse(request.query)
      const context = getContext()
      sendSuccess(response, listDefects(
        'defects',
        context,
        {
          projectId: query.project_id,
          assigneeId: query.assignee_id,
          status: query.status,
        },
        query.limit,
        query.cursor,
      ))
    })
    router.get('/defects/:id', (request, response) => {
      const { id } = paramsSchema.parse(request.params)
      const context = getContext()
      sendSuccess(response, callService(
        persistedDefectSchema,
        () => context.services.defects.get(id),
      ))
    })
    router.patch('/defects/:id', (request, response) => {
      const { id } = paramsSchema.parse(request.params)
      const input = updateSchema.parse(request.body)
      const context = getContext()
      sendSuccess(response, callService(
        persistedDefectSchema,
        () => context.services.defects.update(
          id,
          input as UpdateDefectInput,
          requestActorId(context),
          'web',
        ),
      ))
    })
    router.post('/defects/:id/to-task', (request, response) => {
      const { id } = paramsSchema.parse(request.params)
      const input = toTaskSchema.parse(request.body)
      const context = getContext()
      sendSuccess(response, callService(
        persistedTaskSchema,
        () => context.services.defects.toTask(
          id,
          input as DefectToTaskInput,
          requestActorId(context),
          'web',
        ),
      ))
    })
  },
}
