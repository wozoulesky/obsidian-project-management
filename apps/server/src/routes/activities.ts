import {
  activitySourceSchema,
  persistedActivitySchema,
} from '@project-os/contracts'
import type { Router } from 'express'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
  callService,
  internalOperation,
  parseResponse,
  routeIdSchema,
  sendSuccess,
} from './actors.js'

const querySchema = z.object({
  after: routeIdSchema.optional(),
  project_id: routeIdSchema.optional(),
  actor_id: routeIdSchema.optional(),
  entity_id: routeIdSchema.optional(),
  source: activitySourceSchema.optional(),
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number)
    .pipe(z.number().int().min(1).max(200)).default(50),
}).strict()

const initialPageSchema = z.object({
  items: z.array(persistedActivitySchema).max(200),
  cursor: routeIdSchema.nullable(),
}).strict()

export const activityRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.get('/activities', (request, response) => {
      const query = querySchema.parse(request.query)
      const context = getContext()
      const cursorFilters = {
        ...(query.project_id === undefined
          ? {}
          : { projectId: query.project_id }),
        ...(query.actor_id === undefined ? {} : { actorId: query.actor_id }),
        ...(query.entity_id === undefined
          ? {}
          : { entityId: query.entity_id }),
        ...(query.source === undefined ? {} : { source: query.source }),
      }
      const filters = {
        ...cursorFilters,
        limit: query.limit,
      }
      if (query.after === undefined) {
        const page = callService(
          initialPageSchema,
          () => context.services.activities.initialPage(filters),
        )
        sendSuccess(response, {
          items: page.items,
          next_cursor: page.cursor,
        })
        return
      }
      const raw = internalOperation(
        () => context.services.activities.listNewer({
          ...filters,
          after: query.after!,
        }),
      )
      const items = raw.slice(0, query.limit).map(
        (item) => parseResponse(persistedActivitySchema, item),
      )
      sendSuccess(response, {
        items,
        next_cursor: items.at(-1)?.id ?? query.after,
      })
    })
  },
}
