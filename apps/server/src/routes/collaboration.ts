import {
  deliverableSchema,
  handoffSchema,
  persistedSessionSchema,
} from '@project-os/contracts'
import type { Router } from 'express'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
  internalOperation,
  parseResponse,
  routeIdSchema,
  sendSuccess,
} from './actors.js'

const limitQuerySchema = z.string()
  .regex(/^[1-9]\d{0,2}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(200))
  .default(50)

const projectParamsSchema = z.object({
  projectId: routeIdSchema,
}).strict()

const sessionQuerySchema = z.object({
  include_closed: z.enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
  limit: limitQuerySchema,
}).strict()

const listQuerySchema = z.object({
  limit: limitQuerySchema,
}).strict()

const deliverableQuerySchema = z.object({
  requirement_id: routeIdSchema.optional(),
  limit: limitQuerySchema,
}).strict()

export const collaborationRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.get('/projects/:projectId/sessions', (request, response) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const query = sessionQuerySchema.parse(request.query)
      const context = getContext()
      const raw = internalOperation(
        () => context.services.sessions.listForProject({
          projectId,
          includeClosed: query.include_closed,
        }),
      )
      const items = raw.slice(0, query.limit).map(
        (item) => parseResponse(persistedSessionSchema, item),
      )
      sendSuccess(response, { items })
    })

    router.get('/projects/:projectId/handoffs', (request, response) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const query = listQuerySchema.parse(request.query)
      const context = getContext()
      const raw = internalOperation(
        () => context.services.handoffs.listForProject({
          projectId,
          limit: query.limit,
        }),
      )
      const items = raw.map((item) => parseResponse(handoffSchema, item))
      sendSuccess(response, { items })
    })

    router.get('/projects/:projectId/deliverables', (request, response) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const query = deliverableQuerySchema.parse(request.query)
      const context = getContext()
      const raw = internalOperation(
        () => context.services.deliverables.listForProject({
          projectId,
          limit: query.limit,
          ...(query.requirement_id === undefined
            ? {}
            : { requirementId: query.requirement_id }),
        }),
      )
      const items = raw.map(
        (item) => parseResponse(deliverableSchema, item),
      )
      sendSuccess(response, { items })
    })
  },
}
