import {
  persistedProjectSchema,
  persistedRequirementSchema,
  prioritySchema,
  requirementStatusSchema,
} from '@project-os/contracts'
import { DomainError } from '@project-os/core'
import type {
  CreateRequirementInput,
  RequirementListFilter,
  UpdateRequirementInput,
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
const cursorSchema = z.string().min(1).max(4096).optional()
const criteriaSchema = z.array(z.string().max(50_000)).max(1_000)
const linksSchema = z.array(routeIdSchema).max(1_000)
const paramsSchema = z.object({ id: routeIdSchema }).strict()
const projectParamsSchema = z.object({ projectId: routeIdSchema }).strict()
const listSchema = z.object({
  project_id: routeIdSchema.optional(),
  status: requirementStatusSchema.optional(),
  limit: limitSchema,
  cursor: cursorSchema,
}).strict()
const scopedListSchema = listSchema.omit({ project_id: true })
const createFields = {
  title: z.string().min(1).max(500),
  description: z.string().max(50_000).optional(),
  priority: prioritySchema,
  status: requirementStatusSchema.optional(),
  acceptanceCriteria: criteriaSchema.optional(),
  linkedTaskIds: linksSchema.optional(),
}
const createSchema = z.object({
  projectId: routeIdSchema,
  ...createFields,
}).strict()
const scopedCreateSchema = z.object(createFields).strict()
const updateSchema = z.object({
  title: createFields.title.optional(),
  description: createFields.description,
  priority: prioritySchema.optional(),
  status: requirementStatusSchema.optional(),
  acceptanceCriteria: criteriaSchema.optional(),
  linkedTaskIds: linksSchema.optional(),
  version: routeVersionSchema,
}).strict()

function listRequirements(
  scope: string,
  context: ReturnType<Parameters<AppRouteModule['register']>[1]>,
  filter: {
    projectId: RequirementListFilter['projectId'] | undefined
    status: RequirementListFilter['status'] | undefined
  },
  limit: number,
  cursor: string | undefined,
) {
  const filters = {
    project_id: filter.projectId,
    status: filter.status,
  }
  const position = readCursorPosition({ scope, filters, cursor })
  let after: RequirementListFilter['after']
  if (position !== undefined) {
    if (position.length !== 3) throw cursorError(cursor!)
    let anchor
    try {
      anchor = callService(
        persistedRequirementSchema,
        () => context.services.requirements.get(position[2]!),
      )
    } catch (error) {
      if (
        error instanceof DomainError
        && error.code === 'REQUIREMENT_NOT_FOUND'
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
      || (filter.status !== undefined && anchor.status !== filter.status)
    ) throw cursorError(cursor!)
    after = {
      projectId: anchor.projectId,
      code: anchor.code,
      id: anchor.id,
    }
  }
  const fetchLimit = limit + 1
  const raw = internalOperation(() => context.services.requirements.list({
    ...(filter.projectId === undefined
      ? {}
      : { projectId: filter.projectId }),
    ...(filter.status === undefined ? {} : { status: filter.status }),
    ...(after === undefined ? {} : { after }),
    limit: fetchLimit,
  }))
  const items = raw.slice(0, fetchLimit).map(
    (item) => parseResponse(persistedRequirementSchema, item),
  )
  return paginate(items, {
    scope,
    filters,
    limit,
    position: (item) => [item.projectId, item.code, item.id],
  })
}

export const requirementRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.post('/projects/:projectId/requirements', (request, response) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const input = scopedCreateSchema.parse(request.body)
      const context = getContext()
      const item = callService(
        persistedRequirementSchema,
        () => context.services.requirements.create(
          { ...input, projectId } as CreateRequirementInput,
          requestActorId(context),
          'web',
        ),
      )
      sendSuccess(response, item, 201)
    })
    router.get('/projects/:projectId/requirements', (request, response) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const query = scopedListSchema.parse(request.query)
      const context = getContext()
      callService(
        persistedProjectSchema,
        () => context.services.projects.get(projectId),
      )
      sendSuccess(response, listRequirements(
        'project-requirements',
        context,
        { projectId, status: query.status },
        query.limit,
        query.cursor,
      ))
    })
    router.post('/requirements', (request, response) => {
      const input = createSchema.parse(request.body)
      const context = getContext()
      const item = callService(
        persistedRequirementSchema,
        () => context.services.requirements.create(
          input as CreateRequirementInput,
          requestActorId(context),
          'web',
        ),
      )
      sendSuccess(response, item, 201)
    })
    router.get('/requirements', (request, response) => {
      const query = listSchema.parse(request.query)
      const context = getContext()
      sendSuccess(response, listRequirements(
        'requirements',
        context,
        { projectId: query.project_id, status: query.status },
        query.limit,
        query.cursor,
      ))
    })
    router.get('/requirements/:id', (request, response) => {
      const { id } = paramsSchema.parse(request.params)
      const context = getContext()
      sendSuccess(response, callService(
        persistedRequirementSchema,
        () => context.services.requirements.get(id),
      ))
    })
    router.patch('/requirements/:id', (request, response) => {
      const { id } = paramsSchema.parse(request.params)
      const input = updateSchema.parse(request.body)
      const context = getContext()
      sendSuccess(response, callService(
        persistedRequirementSchema,
        () => context.services.requirements.update(
          id,
          input as UpdateRequirementInput,
          requestActorId(context),
          'web',
        ),
      ))
    })
  },
}
