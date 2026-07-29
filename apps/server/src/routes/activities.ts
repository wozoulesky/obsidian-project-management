import {
  activitySourceSchema,
  persistedActivitySchema,
} from '@project-os/contracts'
import type { ActivityListFilter } from '@project-os/core'
import type { Router } from 'express'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import {
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

export const activityRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.get('/activities', (request, response) => {
      const query = querySchema.parse(request.query)
      const context = getContext()
      const filters = {
        limit: query.limit,
        ...(query.project_id === undefined
          ? {}
          : { projectId: query.project_id }),
        ...(query.actor_id === undefined ? {} : { actorId: query.actor_id }),
        ...(query.entity_id === undefined
          ? {}
          : { entityId: query.entity_id }),
        ...(query.source === undefined ? {} : { source: query.source }),
      }
      const raw = internalOperation(() => query.after === undefined
        ? context.services.activities.list(filters as ActivityListFilter)
        : context.services.activities.listNewer({
          ...filters,
          after: query.after!,
        }))
      const items = raw.slice(0, query.limit).map(
        (item) => parseResponse(persistedActivitySchema, item),
      )
      sendSuccess(response, {
        items,
        next_cursor: query.after === undefined
          ? items[0]?.id ?? null
          : items.at(-1)?.id ?? query.after,
      })
    })
  },
}
