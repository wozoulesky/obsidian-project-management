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

export class ResponseContractError extends Error {
  constructor() {
    super('Response did not match its public contract')
    this.name = 'ResponseContractError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export function parseResponse<Output>(
  schema: z.ZodType<Output>,
  value: unknown,
): Output {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new ResponseContractError()
  }
  return parsed.data
}

export function internalOperation<Result>(
  operation: () => Result,
): Result {
  try {
    return operation()
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ResponseContractError()
    }
    throw error
  }
}

export function callService<Output>(
  schema: z.ZodType<Output>,
  operation: () => unknown,
): Output {
  return parseResponse(schema, internalOperation(operation))
}

export function cursorError(cursor: string): DomainError {
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

export function readCursorPosition(options: {
  scope: string
  filters: Record<string, string | undefined>
  cursor: string | undefined
}): string[] | undefined {
  if (options.cursor === undefined) {
    return undefined
  }
  const decoded = decodeCursor(options.cursor)
  if (
    decoded.scope !== options.scope
    || decoded.filters !== JSON.stringify(options.filters)
  ) {
    throw cursorError(options.cursor)
  }
  return decoded.position
}

export function paginate<Item>(
  items: readonly Item[],
  options: {
    scope: string
    filters: Record<string, string | undefined>
    limit: number
    position(item: Item): string[]
  },
): { items: Item[]; next_cursor: string | null } {
  const filters = JSON.stringify(options.filters)
  const hasMore = items.length > options.limit
  const pageItems = items.slice(0, options.limit)
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
  const actor = callService(
    persistedActorSchema,
    () => context.services.actors.get(context.localActorId),
  )
  if (actor.status !== 'active') {
    throw new DomainError(
      'ACTOR_INACTIVE',
      'Actor is inactive',
      { actorId: actor.id },
    )
  }
  if (actor.kind !== 'human') {
    throw new DomainError(
      'LOCAL_ACTOR_INVALID',
      'Configured local actor must be an active human',
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
      const filters = {
        kind: query.kind,
        status: query.status,
      }
      const position = readCursorPosition({
        scope: 'actors',
        filters,
        cursor: query.cursor,
      })
      let after: ActorListFilter['after']
      if (position !== undefined) {
        if (position.length !== 2) {
          throw cursorError(query.cursor!)
        }
        let anchor
        try {
          anchor = callService(
            persistedActorSchema,
            () => context.services.actors.get(position[1]!),
          )
        } catch (error) {
          if (
            error instanceof DomainError
            && error.code === 'ACTOR_NOT_FOUND'
          ) {
            throw cursorError(query.cursor!)
          }
          throw error
        }
        if (
          anchor.name !== position[0]
          || anchor.id !== position[1]
          || (query.kind !== undefined && anchor.kind !== query.kind)
          || (query.status !== undefined && anchor.status !== query.status)
        ) {
          throw cursorError(query.cursor!)
        }
        after = { name: anchor.name, id: anchor.id }
      }
      const fetchLimit = query.limit + 1
      const rawActors = internalOperation(
        () => context.services.actors.list({
          ...filters,
          ...(after === undefined ? {} : { after }),
          limit: fetchLimit,
        } as ActorListFilter),
      )
      const actors = rawActors.slice(0, fetchLimit).map(
        (actor) => parseResponse(persistedActorSchema, actor),
      )
      const page = paginate(actors, {
        scope: 'actors',
        filters,
        limit: query.limit,
        position: (actor) => [actor.name, actor.id],
      })
      sendSuccess(response, page)
    })

    router.post('/actors', (request, response) => {
      const input = createActorBodySchema.parse(request.body)
      const context = getContext()
      const actor = callService(
        persistedActorSchema,
        () => context.services.actors.createHuman(
          input as CreateHumanInput,
          requestActorId(context),
          'web',
        ),
      )
      sendSuccess(response, actor, 201)
    })

    router.get('/actors/:id', (request, response) => {
      const { id } = actorIdParamsSchema.parse(request.params)
      const context = getContext()
      const actor = callService(
        persistedActorSchema,
        () => context.services.actors.get(id),
      )
      sendSuccess(response, actor)
    })

    router.patch('/actors/:id', (request, response) => {
      const { id } = actorIdParamsSchema.parse(request.params)
      const input = updateActorBodySchema.parse(request.body)
      const context = getContext()
      const actor = callService(
        persistedActorSchema,
        () => context.services.actors.update(
          id,
          input as UpdateActorInput,
          requestActorId(context),
          'web',
        ),
      )
      sendSuccess(response, actor)
    })

    router.post('/actors/:id/deactivate', (request, response) => {
      const { id } = actorIdParamsSchema.parse(request.params)
      const { version } = deactivateActorBodySchema.parse(request.body)
      const context = getContext()
      const actorId = requestActorId(context)
      const current = callService(
        persistedActorSchema,
        () => context.services.actors.get(id),
      )
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
      const actor = callService(
        persistedActorSchema,
        () => context.services.actors.deactivate(id, actorId, 'web'),
      )
      sendSuccess(response, actor)
    })
  },
}
