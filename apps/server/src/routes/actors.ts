import {
  actorStatusSchema,
  humanActorRoleSchema,
  persistedActorSchema,
} from '@project-os/contracts'
import { DomainError } from '@project-os/core'
import type {
  ActorListFilter,
  CreateHumanInput,
  UpdateActorInput,
} from '@project-os/core'
import type { Response, Router } from 'express'
import { z } from 'zod'
import type { AppRouteModule } from '../app.js'
import type { AppContext } from '../context.js'
import { successEnvelope } from '../envelope.js'

export const routeIdSchema = z.string().min(1).max(256)
export const routeVersionSchema = z.number().int().positive()

const boundedTextSchema = z.string().min(1).max(200)
const capabilitySchema = z.string().min(1).max(200)
const capabilitiesSchema = z.array(capabilitySchema).max(100)
const limitQuerySchema = z.string()
  .regex(/^[1-9]\d{0,2}$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(200))
  .default(50)
const cursorQuerySchema = z.string().min(1).max(4096).optional()

const actorIdParamsSchema = z.object({
  id: routeIdSchema,
}).strict()

const actorListQuerySchema = z.object({
  kind: z.enum(['human', 'agent']).optional(),
  status: actorStatusSchema.optional(),
  limit: limitQuerySchema,
  cursor: cursorQuerySchema,
}).strict()

const createActorBodySchema = z.object({
  name: boundedTextSchema,
  role: humanActorRoleSchema,
  capabilities: capabilitiesSchema.optional(),
}).strict()

const updateActorBodySchema = z.object({
  name: boundedTextSchema.optional(),
  role: humanActorRoleSchema.optional(),
  capabilities: capabilitiesSchema.optional(),
  version: routeVersionSchema,
}).strict()

const deactivateActorBodySchema = z.object({
  version: routeVersionSchema,
}).strict()

const cursorPayloadSchema = z.object({
  v: z.literal(1),
  scope: z.string().min(1),
  filters: z.string(),
  position: z.array(z.string()).min(1),
}).strict()

type CursorPayload = z.infer<typeof cursorPayloadSchema>

function cursorError(cursor: string): DomainError {
  return new DomainError(
    'PAGINATION_CURSOR_INVALID',
    'Pagination cursor is invalid or expired',
    { cursor },
  )
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const decoded = Buffer.from(cursor, 'base64url')
    if (decoded.toString('base64url') !== cursor) {
      throw cursorError(cursor)
    }
    return cursorPayloadSchema.parse(
      JSON.parse(decoded.toString('utf8')) as unknown,
    )
  } catch (error) {
    if (
      error instanceof DomainError
      && error.code === 'PAGINATION_CURSOR_INVALID'
    ) {
      throw error
    }
    throw cursorError(cursor)
  }
}

export function paginate<Item>(
  items: readonly Item[],
  options: {
    scope: string
    filters: Record<string, string | undefined>
    limit: number
    cursor: string | undefined
    position(item: Item): string[]
  },
): { items: Item[]; next_cursor: string | null } {
  const filters = JSON.stringify(options.filters)
  let start = 0
  if (options.cursor !== undefined) {
    const decoded = decodeCursor(options.cursor)
    if (decoded.scope !== options.scope || decoded.filters !== filters) {
      throw cursorError(options.cursor)
    }
    const cursorIndex = items.findIndex((item) => {
      const position = options.position(item)
      return position.length === decoded.position.length
        && position.every(
          (value, index) => value === decoded.position[index],
        )
    })
    if (cursorIndex < 0) {
      throw cursorError(options.cursor)
    }
    start = cursorIndex + 1
  }

  const pageItems = items.slice(start, start + options.limit)
  const hasMore = start + pageItems.length < items.length
  const last = pageItems.at(-1)
  return {
    items: pageItems,
    next_cursor: hasMore && last !== undefined
      ? encodeCursor({
          v: 1,
          scope: options.scope,
          filters,
          position: options.position(last),
        })
      : null,
  }
}

export function requestActorId(context: AppContext): string {
  const actor = context.services.actors.get(context.localActorId)
  if (actor.status !== 'active') {
    throw new DomainError(
      'ACTOR_INACTIVE',
      'Actor is inactive',
      { actorId: actor.id },
    )
  }
  return actor.id
}

export function sendSuccess(
  response: Response,
  data: unknown,
  status = 200,
): void {
  response.status(status).json(successEnvelope(
    data,
    String(response.locals.requestId),
  ))
}

export const actorRoutes: AppRouteModule = {
  register(router: Router, getContext) {
    router.get('/actors', (request, response) => {
      const query = actorListQuerySchema.parse(request.query)
      const context = getContext()
      const actors = context.services.actors.list({
        kind: query.kind,
        status: query.status,
      } as ActorListFilter).map(
        (actor) => persistedActorSchema.parse(actor),
      )
      const page = paginate(actors, {
        scope: 'actors',
        filters: {
          kind: query.kind,
          status: query.status,
        },
        limit: query.limit,
        cursor: query.cursor,
        position: (actor) => [actor.name, actor.id],
      })
      sendSuccess(response, page)
    })

    router.post('/actors', (request, response) => {
      const input = createActorBodySchema.parse(request.body)
      const context = getContext()
      const actor = context.services.actors.createHuman(
        input as CreateHumanInput,
        requestActorId(context),
        'web',
      )
      sendSuccess(response, persistedActorSchema.parse(actor), 201)
    })

    router.get('/actors/:id', (request, response) => {
      const { id } = actorIdParamsSchema.parse(request.params)
      const actor = getContext().services.actors.get(id)
      sendSuccess(response, persistedActorSchema.parse(actor))
    })

    router.patch('/actors/:id', (request, response) => {
      const { id } = actorIdParamsSchema.parse(request.params)
      const input = updateActorBodySchema.parse(request.body)
      const context = getContext()
      const actor = context.services.actors.update(
        id,
        input as UpdateActorInput,
        requestActorId(context),
        'web',
      )
      sendSuccess(response, persistedActorSchema.parse(actor))
    })

    router.post('/actors/:id/deactivate', (request, response) => {
      const { id } = actorIdParamsSchema.parse(request.params)
      const { version } = deactivateActorBodySchema.parse(request.body)
      const context = getContext()
      const actorId = requestActorId(context)
      const current = context.services.actors.get(id)
      if (current.version !== version) {
        throw new DomainError(
          'ACTOR_VERSION_CONFLICT',
          'Actor version is stale',
          {
            actorId: id,
            expectedVersion: version,
            currentVersion: current.version,
          },
        )
      }
      const actor = context.services.actors.deactivate(id, actorId, 'web')
      sendSuccess(response, persistedActorSchema.parse(actor))
    })
  },
}
